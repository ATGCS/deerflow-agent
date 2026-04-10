"""
Web Search Tool - Search the web using Baidu (Playwright-first, no API key required).

设计约定：
- 只用百度搜索源，不再依赖 ddgs / DuckDuckGo / Tavily 等第三方 SDK。
- 完全零配置：不需要在 config.yaml 里配置任何 API key。
- 默认使用 Playwright 真浏览器绕过“百度安全验证”，并落盘保存 storage_state（cookie/localStorage）供后续无头复用。

环境变量：
- DEERFLOW_BAIDU_STORAGE_STATE: storage_state 文件路径（默认写到本目录 .cache/ 下）
- DEERFLOW_BAIDU_STATE_TTL_HOURS: storage_state 视为新鲜的 TTL（小时，默认 168=7 天）
- DEERFLOW_BAIDU_PAGE_CONTENT_CHARS: 每条结果落地页提取的最大字符数（默认 12000）
"""

import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from langchain_core.tools import tool

try:
    # Optional: in some minimal runtime/tests we don't load full app config.
    from deerflow.config import get_app_config  # type: ignore
except Exception:  # pragma: no cover
    get_app_config = None

logger = logging.getLogger(__name__)


def _strip_html(s: str) -> str:
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _baidu_html_search(query: str, max_results: int) -> list[dict]:
    """
    Baidu HTML search endpoint (no API key).

    HTTP-first strategy: try lightweight HTTP requests first (~1-3s),
    fall back to Playwright only when HTTP hits captcha/verify pages.
    This reduces typical search latency from 15-30s down to 2-5s.

    Returns dicts compatible with ddgs-like output:
      { title, href, body }

    Note: Baidu pages may be returned in UTF-8 or GB18030; decode best-effort.
    """

    def _fetch(url: str, headers: dict) -> str | None:
        req = urllib.request.Request(url, headers=headers)
        try:
            # Short timeout (5s) for fast failover — Playwright fallback handles slow cases
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw = resp.read()
        except Exception as e:
            logger.debug("HTTP fetch failed for %s: %s", url[:80], e)
            return None
        try:
            return raw.decode("utf-8", errors="ignore")
        except Exception:
            return raw.decode("gb18030", errors="ignore")

    def _looks_like_verify_page(html: str) -> bool:
        if "百度安全验证" in html:
            return True
        low = html.lower()
        return ("captcha" in low) or ("verify" in low and "baidu" in low)

    q = urllib.parse.quote_plus(query)

    # Prefer mobile endpoint to reduce "安全验证" triggers.
    mobile_url = f"https://m.baidu.com/s?word={q}"
    mobile_headers = {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.0 Mobile/15E148 Safari/604.1"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Referer": "https://m.baidu.com/",
    }

    desktop_url = f"https://www.baidu.com/s?wd={q}"
    desktop_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Referer": "https://www.baidu.com/",
    }

    html = _fetch(mobile_url, mobile_headers)
    if not html:
        # HTTP fetch failed entirely — try Playwright as last resort
        pw = _baidu_playwright_search(query=query, max_results=max_results)
        return pw or []

    if _looks_like_verify_page(html):
        html = _fetch(desktop_url, desktop_headers)
        if not html or _looks_like_verify_page(html):
            # Both HTTP endpoints hit captcha — fall back to Playwright
            logger.info("Baidu HTTP search hit captcha, falling back to Playwright")
            pw = _baidu_playwright_search(query=query, max_results=max_results)
            return pw or []

    link_re = re.compile(
        r"<h3[^>]*>\s*<a[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)</a>\s*</h3>",
        re.I,
    )
    abstract_re = re.compile(
        r"<div[^>]*class=\"[^\"]*(?:c-abstract|content-right|c-span-last|c-abstract-content)[^\"]*\"[^>]*>([\s\S]*?)</div>",
        re.I,
    )
    mobile_link_re = re.compile(
        r"<h3[^>]*class=\"[^\"]*\bc-title\b[^\"]*\"[^>]*>\s*<a[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)</a>",
        re.I,
    )

    links = mobile_link_re.findall(html) or link_re.findall(html)
    abstracts = abstract_re.findall(html)
    out: list[dict] = []
    for i, (href, title_html) in enumerate(links):
        if len(out) >= max_results:
            break
        title = _strip_html(title_html)
        snippet = _strip_html(abstracts[i]) if i < len(abstracts) else ""
        if not href:
            continue
        out.append({"title": title, "href": href, "body": snippet})
    return out


def _bing_html_search(query: str, max_results: int) -> list[dict]:
    """Fallback search via Bing HTML (no API key)."""
    q = urllib.parse.quote_plus(query)
    url = f"https://www.bing.com/search?q={q}&setlang=zh-CN"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Referer": "https://www.bing.com/",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        # Short timeout for fast failover (5s)
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read()
        html = raw.decode("utf-8", errors="ignore")
    except Exception:
        return []

    # Bing SERP item
    li_re = re.compile(r"<li[^>]*class=\"[^\"]*\bb_algo\b[^\"]*\"[^>]*>([\s\S]*?)</li>", re.I)
    a_re = re.compile(r"<h2[^>]*>\s*<a[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)</a>\s*</h2>", re.I)
    p_re = re.compile(r"<p[^>]*>([\s\S]*?)</p>", re.I)

    out: list[dict] = []
    for block in li_re.findall(html):
        if len(out) >= max_results:
            break
        m = a_re.search(block)
        if not m:
            continue
        href = m.group(1).strip()
        title = _strip_html(m.group(2) or "").strip()
        if not href or not title:
            continue
        pm = p_re.search(block)
        snippet = _strip_html(pm.group(1) if pm else "").strip()
        out.append({"title": title, "href": href, "body": snippet})
    return out


def _ensure_non_empty_content(query: str, title: str, url: str, content: str) -> str:
    c = (content or "").strip()
    if c:
        return c
    t = (title or "").strip()
    u = (url or "").strip()
    if t and u:
        return f"{t}（来源：{u}）。检索关键词：{query}。"
    if t:
        return f"{t}。检索关键词：{query}。"
    if u:
        return f"来源：{u}。检索关键词：{query}。"
    return f"与“{query}”相关的搜索结果，正文暂未提取成功。"


def _fetch_page_text_fallback(url: str, max_chars: int) -> str:
    """Secondary extraction by direct HTTP fetch to increase body length."""
    if not url or max_chars <= 0:
        return ""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read()
    except Exception:
        return ""
    html = raw.decode("utf-8", errors="ignore")
    if not html:
        return ""
    # Try meta description first, then full body.
    m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    parts: list[str] = []
    if m:
        desc = _strip_html(m.group(1) or "").strip()
        if desc:
            parts.append(desc)
    body_text = _strip_html(html).strip()
    if body_text:
        parts.append(body_text)
    out = "\n".join(p for p in parts if p).strip()
    if not out:
        return ""
    return out[:max_chars]


def _get_baidu_storage_state_path() -> str:
    override = os.environ.get("DEERFLOW_BAIDU_STORAGE_STATE")
    if override:
        return override
    base = os.path.dirname(__file__)
    cache_dir = os.path.join(base, ".cache")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, "baidu_storage_state.json")


def _get_baidu_storage_ttl_seconds() -> int:
    raw = os.environ.get("DEERFLOW_BAIDU_STATE_TTL_HOURS", "").strip()
    if raw:
        try:
            hours = int(raw)
            return max(0, hours) * 3600
        except Exception:
            pass
    return 7 * 24 * 3600


def _get_baidu_page_content_chars() -> int:
    raw = os.environ.get("DEERFLOW_BAIDU_PAGE_CONTENT_CHARS", "").strip()
    if raw:
        try:
            n = int(raw)
            return max(0, n)
        except Exception:
            pass
    return 12000


def _storage_state_is_fresh(path: str) -> bool:
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return False
    ttl = _get_baidu_storage_ttl_seconds()
    if ttl <= 0:
        return True
    return (time.time() - st.st_mtime) < ttl


def _baidu_playwright_search(query: str, max_results: int) -> list[dict]:
    try:
        from playwright.sync_api import TimeoutError as PwTimeoutError  # type: ignore
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception:
        return []

    def _looks_like_verify(title: str, html: str) -> bool:
        if "百度安全验证" in title:
            return True
        low = html.lower()
        return ("captcha" in low) or ("verify" in low and "baidu" in low)

    storage_path = _get_baidu_storage_state_path()
    use_cached = _storage_state_is_fresh(storage_path)

    url = f"https://www.baidu.com/s?wd={urllib.parse.quote_plus(query)}"

    launch_args = [
        "--disable-blink-features=AutomationControlled",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
    ]

    def _normalize_paragraphs(text: str, max_chars: int) -> str:
        if not text or max_chars <= 0:
            return ""
        # Split into paragraphs/lines, normalize whitespace, de-dup.
        raw_lines = re.split(r"[\r\n]+", text)
        lines: list[str] = []
        seen: set[str] = set()
        for ln in raw_lines:
            ln = re.sub(r"\s+", " ", (ln or "")).strip()
            if not ln:
                continue
            # drop ultra-short nav-like fragments
            if len(ln) <= 2:
                continue
            key = ln
            if key in seen:
                continue
            seen.add(key)
            lines.append(ln)
            if sum(len(x) for x in lines) > max_chars * 3:
                # don't grow unbounded before final trim
                break
        out = "\n".join(lines).strip()
        return out[:max_chars]

    def _is_bad_paragraph(line: str) -> bool:
        # Heuristics: common chrome / actions / cookie banners
        bad_keywords = [
            "登录",
            "注册",
            "首页",
            "导航",
            "菜单",
            "搜索",
            "隐私",
            "Cookie",
            "cookies",
            "免责声明",
            "版权所有",
            "联系我们",
            "广告",
            "下载",
            "打开APP",
            "扫一扫",
            "返回顶部",
            "评论",
            "分享",
        ]
        if len(line) <= 3:
            return True
        hit = 0
        low = line.lower()
        for kw in bad_keywords:
            if kw.lower() in low:
                hit += 1
        # Keep more text for "long content" mode; only drop very noisy short lines.
        return hit >= 3 and len(line) < 60

    def _extract_readable_text_from_page(p, max_chars: int) -> str:
        if max_chars <= 0:
            return ""
        try:
            desc = p.locator('meta[name="description"]').first.get_attribute("content") or ""
            desc = _strip_html(desc).strip()
            if desc:
                return desc[:max_chars]
        except Exception:
            pass

        # Site-specific preferred selectors (higher precision)
        try:
            host = urllib.parse.urlparse(getattr(p, "url", "") or "").netloc.lower()
        except Exception:
            host = ""

        preferred_selectors: list[str] = []
        if "baike.baidu.com" in host:
            preferred_selectors = [
                ".lemma-summary",
                "[class*='lemmaSummary']",
                ".basicInfo-block",
                "#lemmaContent-0",
            ]
        elif "openai.com" in host:
            preferred_selectors = ["main", "article", '[role="main"]']

        for sel in preferred_selectors:
            try:
                t0 = p.locator(sel).first.inner_text(timeout=2_000)
                t0 = re.sub(r"\s+", " ", (t0 or "")).strip()
                if t0:
                    return _normalize_paragraphs(t0, max_chars=max_chars)
            except Exception:
                pass

        try:
            txt = p.evaluate(
                """
() => {
  const killSelectors = [
    'script','style','noscript','svg','canvas',
    'header','footer','nav','aside',
    '[role="navigation"]','[role="banner"]','[role="contentinfo"]',
    '.header','.footer','.nav','.navbar','.breadcrumb','.breadcrumbs',
    '.sidebar','.aside','.ads','.ad','.advert','[id*="ad"]','[class*="ad"]'
  ];
  for (const sel of killSelectors) {
    document.querySelectorAll(sel).forEach(el => el.remove());
  }

  const candidates = [
    'main',
    '[role="main"]',
    'article',
    '#content',
    '.content',
    '.article',
    '.post',
    '.entry-content',
    '.rich-media-content',
    '.markdown-body',
    'body'
  ];

  const pick = (el) => {
    const text = (el && el.innerText ? el.innerText : '').replace(/\\s+/g, ' ').trim();
    return { score: text.length, text };
  };

  let best = { score: 0, text: '' };
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    const cur = pick(el);
    if (cur.score > best.score) best = cur;
  }
  return best.text || '';
}
"""
            )
            if txt:
                # Keep paragraph boundaries: try to keep line breaks from block elements.
                txt = str(txt)
                # Filter bad paragraphs then normalize.
                paras = []
                for ln in re.split(r"[\\r\\n]+", txt):
                    ln = re.sub(r"\s+", " ", (ln or "")).strip()
                    if not ln:
                        continue
                    if _is_bad_paragraph(ln):
                        continue
                    paras.append(ln)
                joined = "\n".join(paras).strip()
                if joined:
                    return _normalize_paragraphs(joined, max_chars=max_chars)
        except Exception:
            pass

        try:
            txt = p.locator("body").inner_text(timeout=5_000)
            txt = str(txt or "")
            return _normalize_paragraphs(txt, max_chars=max_chars) if txt else ""
        except Exception:
            return ""

    js = f"""
() => {{
  const out = [];
  const blocks = Array.from(document.querySelectorAll('#content_left .result, #content_left .result-op, #content_left .c-result'));
  for (const b of blocks) {{
    const a = b.querySelector('h3 a') || b.querySelector('a');
    if (!a) continue;
    const title = (a.innerText || '').trim();
    const href = a.getAttribute('href') || '';
    let snippet = '';
    const sn = b.querySelector('.c-abstract') || b.querySelector('[class*="c-abstract"]') || b.querySelector('.content-right') || b.querySelector('[class*="content-right"]');
    if (sn) snippet = (sn.innerText || '').trim();
    if (title && href) out.push({{ title, href, body: snippet }});
    if (out.length >= {int(max_results)}) break;
  }}
  return out;
}}
"""

    def _run(headless: bool, allow_manual_seconds: int) -> list[dict]:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless, args=launch_args)
            context = None
            try:
                if use_cached and os.path.exists(storage_path):
                    context = browser.new_context(storage_state=storage_path, locale="zh-CN")
                else:
                    context = browser.new_context(locale="zh-CN")
                page = context.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=60_000)

                deadline = time.time() + allow_manual_seconds
                title = ""
                while True:
                    try:
                        title = page.title()
                    except Exception:
                        title = ""
                    blocked = False
                    try:
                        blocked = bool(
                            page.evaluate(
                                "() => document.title.includes('百度安全验证') || (document.body && (document.body.innerText || '').includes('百度安全验证'))"
                            )
                        )
                    except Exception:
                        blocked = ("百度安全验证" in title)

                    if not blocked:
                        try:
                            page.wait_for_selector("#content_left", timeout=1_500)
                            break
                        except Exception:
                            pass

                    if time.time() > deadline:
                        break
                    try:
                        page.wait_for_timeout(1500)
                    except Exception:
                        time.sleep(1.5)

                if blocked:
                    return []

                results = page.evaluate(js) or []
                if not results:
                    return []

                max_chars = _get_baidu_page_content_chars()
                enriched: list[dict] = []
                for r in results[:max_results]:
                    title0 = _strip_html(str(r.get("title", "")))
                    href0 = str(r.get("href", ""))
                    if not title0 or not href0:
                        continue
                    if href0.startswith("/"):
                        href0 = "https://www.baidu.com" + href0

                    final_url = href0
                    content = _strip_html(str(r.get("body", "")))

                    if max_chars > 0:
                        try:
                            p2 = context.new_page()
                            p2.goto(href0, wait_until="domcontentloaded", timeout=45_000)
                            try:
                                final_url = p2.url or final_url
                            except Exception:
                                final_url = final_url

                            extracted = _extract_readable_text_from_page(p2, max_chars=max_chars)
                            if extracted.strip():
                                content = extracted
                            try:
                                p2.close()
                            except Exception:
                                pass
                        except Exception:
                            pass
                    # Long-content fallback: direct-fetch page text if still too short.
                    if max_chars > 0 and len((content or "").strip()) < 300:
                        fetched = _fetch_page_text_fallback(final_url, max_chars=max_chars)
                        if len(fetched.strip()) > len((content or "").strip()):
                            content = fetched

                    enriched.append({"title": title0, "href": final_url, "body": content})
                    if len(enriched) >= max_results:
                        break

                try:
                    context.storage_state(path=storage_path)
                except Exception:
                    pass

                return enriched
            except PwTimeoutError:
                return []
            except Exception:
                return []
            finally:
                try:
                    if context is not None:
                        context.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass

    if use_cached:
        r = _run(headless=True, allow_manual_seconds=20)
        if r:
            return r

    return _run(headless=False, allow_manual_seconds=300)


def _search_text(
    query: str,
    max_results: int = 5,
    region: str = "wt-wt",
    safesearch: str = "moderate",
) -> list[dict]:
    """Run Baidu and Bing searches in parallel, then merge results.

    - 优先 Baidu 结果，但不过度偏向百科类页面。
    - Bing 作为补充来源，避免单一搜索源失败时结果为空。
    """
    sources = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {
            executor.submit(_baidu_html_search, query, max_results): "baidu",
            executor.submit(_bing_html_search, query, max_results): "bing",
        }
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                res = fut.result()
            except Exception as e:
                logger.error("Search source %s failed for %r: %s", name, query, e)
                res = []
            sources.append((name, res or []))

    combined: list[dict] = []
    seen_urls: set[str] = set()
    baike_count = 0

    # Merge with simple source priority: Baidu first (if present), then Bing.
    def _iter_sources() -> list[tuple[str, list[dict]]]:
        baidu_src = [s for s in sources if s[0] == "baidu"]
        others = [s for s in sources if s[0] != "baidu"]
        return baidu_src + others

    for name, res_list in _iter_sources():
        for r in res_list:
            href = str(r.get("href") or r.get("link") or "").strip()
            if not href:
                continue
            # Normalise URL key for dedup.
            key = href.split("#", 1)[0]
            if key in seen_urls:
                continue

            # Do not flood with Baidu Baike: keep at most one baike entry.
            try:
                host = urllib.parse.urlparse(href).netloc.lower()
            except Exception:
                host = ""
            if "baike.baidu.com" in host:
                if baike_count >= 1:
                    continue
                baike_count += 1

            seen_urls.add(key)
            combined.append(r)
            if len(combined) >= max_results:
                break
        if len(combined) >= max_results:
            break

    # If everything failed, still return empty list and由上层兜底为非空 JSON。
    return combined


@tool("web_search", parse_docstring=True)
def web_search_tool(query: str, max_results: int = 5) -> str:
    """Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.

    Enhanced with Fast Search V2: Multi-source parallel search (Baidu + Bing), deep content extraction (5000 chars), 
    intelligent scoring system, authority domain evaluation, and quality filtering.

    Args:
        query: Search keywords describing what you want to find. Be specific for better results.
        max_results: Maximum number of results to return. Default is 5.
    """
    import sys
    import os
    
    # 添加 advanced_search 目录到路径
    advanced_search_dir = os.path.join(os.path.dirname(__file__), '..', 'advanced_search')
    if advanced_search_dir not in sys.path:
        sys.path.insert(0, advanced_search_dir)
    
    if get_app_config is not None:
        try:
            config = get_app_config().get_tool_config("web_search")
            if config is not None and "max_results" in config.model_extra:
                max_results = config.model_extra.get("max_results", max_results)
        except Exception:
            pass

    try:
        # 使用新的快速深度搜索 V2（非流式版本）
        from tools_fast_v2 import fast_search_v2
        
        # 调用新搜索接口（HTTP-first 分层策略）
        # standard 级别: 浅层内容提取，5-8秒完成
        search_results = fast_search_v2(
            query=query,
            max_results=max_results,
            max_depth=1,  # standard 模式下只需1层（平衡速度和完整性）
            exclude_domains=['zhihu.com', 'weibo.com', 'tieba.baidu.com'],
            level='standard',  # 使用标准级别，比 deep 快约50%
        )
        
        if not search_results:
            return json.dumps({"error": "No results found", "query": query}, ensure_ascii=False)

        # 转换为原有格式
        normalized_results = []
        for r in search_results:
            title = r.title.strip() if r.title else ""
            url = r.url.strip() if r.url else ""
            
            # 使用提取的完整内容（最多5000字），如果没有则用摘要
            content = r.content[:5000].strip() if r.content else (r.snippet.strip() if r.snippet else "")
            
            # 确保内容不为空
            if not content:
                content = _ensure_non_empty_content(query=query, title=title, url=url, content=content)
            
            normalized_results.append(
                {
                    "title": title,
                    "url": url,
                    "content": content,
                    "_score": round(r.score, 3),  # 额外：智能评分
                    "_authority": round(r.authority_score, 3),  # 额外：权威性评分
                    "_quality": round(r.quality_score, 3),  # 额外：质量评分
                }
            )

        output = {
            "query": query, 
            "total_results": len(normalized_results), 
            "results": normalized_results,
            "_engine_version": "FastSearchV2",  # 标识使用的搜索引擎版本
            "_features": ["multi_source", "deep_extraction", "intelligent_scoring", "authority_filter"]
        }
        return json.dumps(output, indent=2, ensure_ascii=False)
        
    except Exception as e:
        logger.error(f"FastSearchV2 failed, falling back to legacy search: {e}")
        
        # 如果新引擎失败，回退到原来的实现
        results = _search_text(query=query, max_results=max_results)

        if not results:
            return json.dumps({"error": "No results found", "query": query}, ensure_ascii=False)

        normalized_results = []
        for r in results:
            title = str(r.get("title", "") or "").strip()
            url = str(r.get("href", r.get("link", "")) or "").strip()
            raw_content = str(r.get("body", r.get("snippet", "")) or "").strip()
            content = _ensure_non_empty_content(query=query, title=title, url=url, content=raw_content)
            normalized_results.append(
                {
                    "title": title,
                    "url": url,
                    "content": content,
                }
            )

        output = {"query": query, "total_results": len(normalized_results), "results": normalized_results}
        return json.dumps(output, indent=2, ensure_ascii=False)

