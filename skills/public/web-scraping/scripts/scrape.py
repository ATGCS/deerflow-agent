#!/usr/bin/env python3
"""
Web Scraping Skill - 基于 Scrapling 框架的智能网页爬虫

支持:
- fetch: 基础 HTTP 请求
- dynamic_fetch: Playwright 浏览器渲染
- stealthy_fetch: 隐身浏览器绕过反爬虫
- bulk_fetch: 批量抓取
- adaptive: 自适应元素提取
"""

import argparse
import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional
from urllib.parse import urlparse

try:
    from scrapling import Fetcher, DynamicFetcher, StealthyFetcher
    from scrapling.fetchers import AsyncFetcher, AsyncDynamicFetcher, AsyncStealthyFetcher
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "scrapling not installed. Run: pip install scrapling",
        "install_command": "pip install scrapling playwright && playwright install chromium"
    }))
    sys.exit(1)


def ensure_dependencies():
    """确保依赖已安装"""
    try:
        from scrapling import Fetcher
        return True
    except ImportError:
        return False


def get_output_format(content, format_type: str) -> str:
    """根据格式类型获取内容"""
    if format_type == "html":
        return content.html if hasattr(content, 'html') else str(content)
    elif format_type == "text":
        return content.text if hasattr(content, 'text') else str(content)
    else:
        if hasattr(content, 'markdown'):
            return content.markdown
        elif hasattr(content, 'text'):
            return content.text
        return str(content)


def extract_elements(page, selector: str, format_type: str = "markdown") -> list:
    """提取匹配选择器的元素"""
    elements = []
    try:
        for elem in page.css(selector):
            element_data = {
                "selector": selector,
                "text": elem.text if hasattr(elem, 'text') else "",
            }
            if format_type == "html":
                element_data["html"] = elem.html if hasattr(elem, 'html') else ""
            elements.append(element_data)
    except Exception as e:
        pass
    return elements


def do_fetch(url: str, args: argparse.Namespace) -> dict:
    """基础 HTTP 请求抓取"""
    start_time = time.time()

    adapter = getattr(args, 'adapter', 'httpx')
    fetcher = Fetcher(adapter=adapter)

    try:
        page = fetcher.fetch(url)
        response_time = int((time.time() - start_time) * 1000)

        content = get_output_format(page, args.format)

        result = {
            "success": True,
            "data": {
                "url": url,
                "title": page.title if hasattr(page, 'title') else "",
                "content": content,
                "format": args.format,
                "metadata": {
                    "status": getattr(page, 'status_code', 200),
                    "response_time_ms": response_time,
                    "final_url": getattr(page, 'url', url)
                }
            }
        }

        if args.selector:
            result["data"]["elements"] = extract_elements(page, args.selector, args.format)

        return result

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "url": url
        }


def do_dynamic_fetch(url: str, args: argparse.Namespace) -> dict:
    """动态渲染抓取"""
    start_time = time.time()

    fetcher = DynamicFetcher()

    kwargs = {
        "url": url,
        "headless": getattr(args, 'headless', True),
    }

    if args.wait:
        kwargs["wait_selector"] = args.wait
    if getattr(args, 'network_idle', False):
        kwargs["network_idle"] = True
    if getattr(args, 'timeout', None):
        kwargs["timeout"] = args.timeout

    try:
        page = fetcher.fetch(**kwargs)
        response_time = int((time.time() - start_time) * 1000)

        content = get_output_format(page, args.format)

        result = {
            "success": True,
            "data": {
                "url": url,
                "title": page.title if hasattr(page, 'title') else "",
                "content": content,
                "format": args.format,
                "metadata": {
                    "status": 200,
                    "response_time_ms": response_time,
                    "final_url": getattr(page, 'url', url),
                    "method": "dynamic"
                }
            }
        }

        if args.selector:
            result["data"]["elements"] = extract_elements(page, args.selector, args.format)

        return result

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "url": url
        }


def do_stealthy_fetch(url: str, args: argparse.Namespace) -> dict:
    """隐身抓取，绕过反爬虫"""
    start_time = time.time()

    fetcher = StealthyFetcher()

    kwargs = {
        "url": url,
        "headless": getattr(args, 'headless', True),
    }

    if args.wait:
        kwargs["wait_selector"] = args.wait
    if getattr(args, 'network_idle', False):
        kwargs["network_idle"] = True
    if getattr(args, 'proxy', None):
        kwargs["proxy"] = args.proxy
    if getattr(args, 'timeout', None):
        kwargs["timeout"] = args.timeout

    try:
        page = fetcher.fetch(**kwargs)
        response_time = int((time.time() - start_time) * 1000)

        content = get_output_format(page, args.format)

        result = {
            "success": True,
            "data": {
                "url": url,
                "title": page.title if hasattr(page, 'title') else "",
                "content": content,
                "format": args.format,
                "metadata": {
                    "status": 200,
                    "response_time_ms": response_time,
                    "final_url": getattr(page, 'url', url),
                    "method": "stealthy"
                }
            }
        }

        if args.selector:
            result["data"]["elements"] = extract_elements(page, args.selector, args.format)

        return result

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "url": url
        }


def do_bulk_fetch(urls_file: str, args: argparse.Namespace) -> dict:
    """批量抓取"""
    if not os.path.exists(urls_file):
        return {
            "success": False,
            "error": f"URLs file not found: {urls_file}"
        }

    with open(urls_file, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    if not urls:
        return {
            "success": False,
            "error": "No URLs found in file"
        }

    method = getattr(args, 'method', 'fetch')
    concurrency = getattr(args, 'concurrency', 5)
    delay = getattr(args, 'delay', 1000) / 1000.0

    results = []
    errors = []

    def fetch_single(url: str) -> dict:
        time.sleep(delay)
        single_args = argparse.Namespace(
            format=args.format,
            selector=getattr(args, 'selector', None),
            headless=getattr(args, 'headless', True),
            wait=getattr(args, 'wait', None),
            network_idle=getattr(args, 'network_idle', False),
            proxy=getattr(args, 'proxy', None),
            adapter=getattr(args, 'adapter', 'httpx'),
            timeout=getattr(args, 'timeout', None)
        )

        if method == 'dynamic':
            return do_dynamic_fetch(url, single_args)
        elif method == 'stealthy':
            return do_stealthy_fetch(url, single_args)
        else:
            return do_fetch(url, single_args)

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        future_to_url = {executor.submit(fetch_single, url): url for url in urls}

        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                result = future.result()
                if result.get("success"):
                    results.append(result)
                else:
                    errors.append(result)
            except Exception as e:
                errors.append({
                    "success": False,
                    "error": str(e),
                    "url": url
                })

    return {
        "success": True,
        "data": {
            "total_urls": len(urls),
            "successful": len(results),
            "failed": len(errors),
            "results": results,
            "errors": errors if errors else None
        }
    }


def do_adaptive(url: str, args: argparse.Namespace) -> dict:
    """自适应元素提取"""
    start_time = time.time()

    if not args.selector:
        return {
            "success": False,
            "error": "adaptive mode requires --selector argument"
        }

    fetcher = StealthyFetcher(adaptive=True)

    kwargs = {
        "url": url,
        "headless": True,
    }

    if args.wait:
        kwargs["wait_selector"] = args.wait

    try:
        page = fetcher.fetch(**kwargs)
        response_time = int((time.time() - start_time) * 1000)

        elements = []
        for elem in page.css(args.selector, adaptive=True):
            elements.append({
                "selector": args.selector,
                "text": elem.text if hasattr(elem, 'text') else "",
                "html": elem.html if hasattr(elem, 'html') else ""
            })

        if getattr(args, 'save', False):
            cache_dir = os.path.join(os.path.dirname(__file__), ".adaptive_cache")
            os.makedirs(cache_dir, exist_ok=True)
            cache_file = os.path.join(cache_dir, f"{urlparse(url).netloc}.json")
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump({
                    "url": url,
                    "selector": args.selector,
                    "timestamp": time.time()
                }, f)

        return {
            "success": True,
            "data": {
                "url": url,
                "title": page.title if hasattr(page, 'title') else "",
                "selector": args.selector,
                "elements": elements,
                "element_count": len(elements),
                "metadata": {
                    "response_time_ms": response_time,
                    "method": "adaptive"
                }
            }
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "url": url
        }


def main():
    parser = argparse.ArgumentParser(
        description="Web Scraping Skill - 智能网页爬虫",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # fetch 命令
    fetch_parser = subparsers.add_parser("fetch", help="基础 HTTP 请求抓取")
    fetch_parser.add_argument("url", help="目标 URL")
    fetch_parser.add_argument("--format", choices=["markdown", "html", "text"], default="markdown", help="输出格式")
    fetch_parser.add_argument("--selector", help="CSS 选择器提取特定元素")
    fetch_parser.add_argument("--adapter", choices=["httpx", "requests"], default="httpx", help="HTTP 适配器")

    # dynamic_fetch 命令
    dynamic_parser = subparsers.add_parser("dynamic_fetch", help="Playwright 浏览器渲染抓取")
    dynamic_parser.add_argument("url", help="目标 URL")
    dynamic_parser.add_argument("--format", choices=["markdown", "html", "text"], default="markdown", help="输出格式")
    dynamic_parser.add_argument("--selector", help="CSS 选择器")
    dynamic_parser.add_argument("--wait", help="等待特定元素出现")
    dynamic_parser.add_argument("--network-idle", action="store_true", help="等待网络空闲")
    dynamic_parser.add_argument("--timeout", type=int, default=30000, help="超时时间(毫秒)")
    dynamic_parser.add_argument("--headless", action="store_true", default=True, help="无头模式")

    # stealthy_fetch 命令
    stealthy_parser = subparsers.add_parser("stealthy_fetch", help="隐身浏览器绕过反爬虫")
    stealthy_parser.add_argument("url", help="目标 URL")
    stealthy_parser.add_argument("--format", choices=["markdown", "html", "text"], default="markdown", help="输出格式")
    stealthy_parser.add_argument("--selector", help="CSS 选择器")
    stealthy_parser.add_argument("--wait", help="等待特定元素")
    stealthy_parser.add_argument("--network-idle", action="store_true", help="等待网络空闲")
    stealthy_parser.add_argument("--timeout", type=int, default=30000, help="超时时间(毫秒)")
    stealthy_parser.add_argument("--headless", action="store_true", default=True, help="无头模式")
    stealthy_parser.add_argument("--proxy", help="代理服务器地址")

    # bulk_fetch 命令
    bulk_parser = subparsers.add_parser("bulk_fetch", help="批量抓取多个 URL")
    bulk_parser.add_argument("urls_file", help="包含 URL 列表的文件路径")
    bulk_parser.add_argument("--format", choices=["markdown", "html", "text"], default="markdown", help="输出格式")
    bulk_parser.add_argument("--selector", help="CSS 选择器")
    bulk_parser.add_argument("--concurrency", type=int, default=5, help="并发数")
    bulk_parser.add_argument("--delay", type=int, default=1000, help="请求间隔(毫秒)")
    bulk_parser.add_argument("--method", choices=["fetch", "dynamic", "stealthy"], default="fetch", help="抓取方法")

    # adaptive 命令
    adaptive_parser = subparsers.add_parser("adaptive", help="自适应元素提取")
    adaptive_parser.add_argument("url", help="目标 URL")
    adaptive_parser.add_argument("--selector", required=True, help="CSS 选择器")
    adaptive_parser.add_argument("--wait", help="等待特定元素")
    adaptive_parser.add_argument("--save", action="store_true", help="保存元素特征供后续使用")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if not ensure_dependencies():
        print(json.dumps({
            "success": False,
            "error": "Dependencies not installed",
            "install_command": "pip install scrapling playwright && playwright install chromium"
        }))
        sys.exit(1)

    result = None

    if args.command == "fetch":
        result = do_fetch(args.url, args)
    elif args.command == "dynamic_fetch":
        result = do_dynamic_fetch(args.url, args)
    elif args.command == "stealthy_fetch":
        result = do_stealthy_fetch(args.url, args)
    elif args.command == "bulk_fetch":
        result = do_bulk_fetch(args.urls_file, args)
    elif args.command == "adaptive":
        result = do_adaptive(args.url, args)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
