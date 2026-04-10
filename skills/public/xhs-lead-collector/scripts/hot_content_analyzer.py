#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多平台热门内容分析器 - Playwright实现
支持抖音、小红书、视频号、B站等平台的关键词热门内容采集和分析
"""

import json
import csv
import os
import sys
import time
import random
import argparse
import asyncio
import re
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict, field
from typing import List, Optional, Dict, Any
from enum import Enum

try:
    from playwright.async_api import async_playwright, Page, Browser
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("警告: Playwright未安装，请运行: pip install playwright && playwright install chromium")


class Platform(Enum):
    XIAOHONGSHU = "小红书"
    DOUYIN = "抖音"
    WECHAT_VIDEO = "视频号"
    BILIBILI = "B站"


@dataclass
class HotContent:
    platform: str
    content_id: str
    title: str
    content: str
    author: str
    author_id: str
    likes: int
    comments: int
    shares: int
    collects: int
    views: int
    publish_time: str
    collected_at: str
    content_type: str
    content_url: str
    cover_url: str = ""
    tags: List[str] = field(default_factory=list)


@dataclass
class ContentAnalysis:
    content: HotContent
    summary: str
    key_points: List[str]
    writing_style: str
    presentation_style: str
    engagement_score: float
    viral_factors: List[str]


@dataclass
class CollectConfig:
    keywords: List[str] = field(default_factory=list)
    platforms: List[str] = field(default_factory=lambda: ["小红书", "抖音", "视频号", "B站"])
    min_likes: int = 100
    days_range: int = 7
    max_content_per_keyword: int = 20
    output_dir: str = "./hot_content"
    export_format: str = "both"
    headless: bool = True
    cookie_file: str = ""


class PlaywrightCollector:
    """基于Playwright的多平台采集器"""

    def __init__(self, config: Optional[CollectConfig] = None):
        if not PLAYWRIGHT_AVAILABLE:
            raise RuntimeError("Playwright未安装，请运行: pip install playwright && playwright install chromium")

        self.config = config or CollectConfig()
        self.contents: List[HotContent] = []
        self.analyses: List[ContentAnalysis] = []
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        os.makedirs(self.config.output_dir, exist_ok=True)

    async def init_browser(self):
        """初始化浏览器"""
        playwright = await async_playwright().start()
        self.browser = await playwright.chromium.launch(
            headless=self.config.headless,
            args=['--disable-blink-features=AutomationControlled']
        )
        context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        self.page = await context.new_page()

        if self.config.cookie_file and os.path.exists(self.config.cookie_file):
            cookies = json.load(open(self.config.cookie_file, 'r', encoding='utf-8'))
            await context.add_cookies(cookies)

    async def close_browser(self):
        """关闭浏览器"""
        if self.browser:
            await self.browser.close()

    async def random_delay(self, min_sec: float = 1.0, max_sec: float = 3.0):
        """随机延迟"""
        await asyncio.sleep(random.uniform(min_sec, max_sec))

    async def scroll_page(self, times: int = 3):
        """滚动页面加载更多内容"""
        for _ in range(times):
            await self.page.evaluate('window.scrollBy(0, window.innerHeight)')
            await self.random_delay(0.5, 1.5)

    async def search_xiaohongshu(self, keyword: str) -> List[Dict[str, Any]]:
        """搜索小红书热门内容"""
        print(f"[小红书] 搜索关键词: {keyword}")
        results = []

        try:
            url = f"https://www.xiaohongshu.com/search_result?keyword={keyword}&type=note"
            await self.page.goto(url, wait_until='networkidle', timeout=30000)
            await self.random_delay(2, 4)
            await self.scroll_page(3)

            notes = await self.page.query_selector_all('section.note-item, div[data-v-note-item]')
            print(f"[小红书] 找到 {len(notes)} 条笔记")

            for i, note in enumerate(notes[:self.config.max_content_per_keyword]):
                try:
                    title_el = await note.query_selector('a.title, div.title')
                    title = await title_el.inner_text() if title_el else ""

                    author_el = await note.query_selector('a.author-name, span.name')
                    author = await author_el.inner_text() if author_el else ""

                    likes_el = await note.query_selector('span.count, span.like-count')
                    likes_text = await likes_el.inner_text() if likes_el else "0"
                    likes = self._parse_number(likes_text)

                    if likes >= self.config.min_likes:
                        link_el = await note.query_selector('a')
                        href = await link_el.get_attribute('href') if link_el else ""
                        content_id = href.split('/')[-1] if href else f"xhs_{int(time.time())}_{i}"

                        results.append({
                            'id': content_id,
                            'title': title.strip(),
                            'content': title.strip(),
                            'author': author.strip(),
                            'author_id': '',
                            'likes': likes,
                            'comments': 0,
                            'shares': 0,
                            'collects': 0,
                            'views': 0,
                            'publish_time': '',
                            'type': '图文',
                            'url': f"https://www.xiaohongshu.com{href}" if href.startswith('/') else href,
                            'tags': []
                        })
                except Exception as e:
                    print(f"[小红书] 解析笔记失败: {e}")
                    continue

        except Exception as e:
            print(f"[小红书] 搜索失败: {e}")

        return results

    async def search_douyin(self, keyword: str) -> List[Dict[str, Any]]:
        """搜索抖音热门视频"""
        print(f"[抖音] 搜索关键词: {keyword}")
        results = []

        try:
            url = f"https://www.douyin.com/search/{keyword}?type=video"
            await self.page.goto(url, wait_until='networkidle', timeout=30000)
            await self.random_delay(3, 5)
            await self.scroll_page(4)

            videos = await self.page.query_selector_all('li[data-e2e="search-common-video"], div[data-e2e="search-video-item"]')
            print(f"[抖音] 找到 {len(videos)} 条视频")

            for i, video in enumerate(videos[:self.config.max_content_per_keyword]):
                try:
                    title_el = await video.query_selector('a[data-e2e="search-common-video-title"], div[data-e2e="video-title"]')
                    title = await title_el.inner_text() if title_el else ""

                    author_el = await video.query_selector('span[data-e2e="search-common-video-author-name"], a.author-name')
                    author = await author_el.inner_text() if author_el else ""

                    likes_el = await video.query_selector('span[data-e2e="search-common-video-like-count"], span.like-count')
                    likes_text = await likes_el.inner_text() if likes_el else "0"
                    likes = self._parse_number(likes_text)

                    if likes >= self.config.min_likes:
                        link_el = await video.query_selector('a')
                        href = await link_el.get_attribute('href') if link_el else ""
                        content_id = href.split('/')[-1] if href else f"dy_{int(time.time())}_{i}"

                        results.append({
                            'id': content_id,
                            'title': title.strip(),
                            'content': title.strip(),
                            'author': author.strip(),
                            'author_id': '',
                            'likes': likes,
                            'comments': 0,
                            'shares': 0,
                            'collects': 0,
                            'views': 0,
                            'publish_time': '',
                            'type': '视频',
                            'url': f"https://www.douyin.com{href}" if href.startswith('/') else href,
                            'tags': []
                        })
                except Exception as e:
                    print(f"[抖音] 解析视频失败: {e}")
                    continue

        except Exception as e:
            print(f"[抖音] 搜索失败: {e}")

        return results

    async def search_bilibili(self, keyword: str) -> List[Dict[str, Any]]:
        """搜索B站热门视频"""
        print(f"[B站] 搜索关键词: {keyword}")
        results = []

        try:
            url = f"https://search.bilibili.com/all?keyword={keyword}&search_source=1"
            await self.page.goto(url, wait_until='domcontentloaded', timeout=30000)
            await self.random_delay(2, 4)
            await self.scroll_page(3)

            videos = await self.page.query_selector_all('div.bili-video-card, li[data-mod="search_list"]')
            print(f"[B站] 找到 {len(videos)} 条视频")

            for i, video in enumerate(videos[:self.config.max_content_per_keyword]):
                try:
                    title_el = await video.query_selector('h3.title a, a.bili-video-card__info--tit, h3 a, .bili-video-card__info--tit')
                    title = await title_el.inner_text() if title_el else ""
                    title = title.strip().replace('\n', '').replace('\t', '')

                    author_el = await video.query_selector('span.bili-video-card__info--author, a.up-name, .bili-video-card__info--author')
                    author = await author_el.inner_text() if author_el else ""
                    author = author.strip().replace('\n', '').replace('\t', '')

                    stats_els = await video.query_selector_all('span.bili-video-card__stats--item, span.data-box, .bili-video-card__stats--item')
                    likes = 0
                    for stats_el in stats_els:
                        text = await stats_el.inner_text()
                        if text:
                            likes = max(likes, self._parse_number(text))

                    if likes >= self.config.min_likes and title:
                        link_el = await video.query_selector('a')
                        href = await link_el.get_attribute('href') if link_el else ""
                        content_id = href.split('/')[-1].split('?')[0] if href else f"bili_{int(time.time())}_{i}"

                        results.append({
                            'id': content_id,
                            'title': title,
                            'content': title,
                            'author': author,
                            'author_id': '',
                            'likes': likes,
                            'comments': 0,
                            'shares': 0,
                            'collects': 0,
                            'views': 0,
                            'publish_time': '',
                            'type': '视频',
                            'url': href if href.startswith('http') else f"https:{href}" if href.startswith('//') else href,
                            'tags': []
                        })
                        print(f"[B站] 解析成功: {title[:30]}... 点赞:{likes}")
                except Exception as e:
                    print(f"[B站] 解析视频失败: {e}")
                    continue

        except Exception as e:
            print(f"[B站] 搜索失败: {e}")

        return results

    async def search_wechat_video(self, keyword: str) -> List[Dict[str, Any]]:
        """搜索视频号热门内容（通过微信搜一搜）"""
        print(f"[视频号] 搜索关键词: {keyword}")
        print("[视频号] 提示: 视频号需要微信扫码登录，当前返回空结果")
        return []

    def _parse_number(self, text: str) -> int:
        """解析数字文本（如 1.2万 -> 12000）"""
        text = text.strip().lower()
        if not text:
            return 0

        multipliers = {'万': 10000, 'w': 10000, 'k': 1000, '千': 1000}

        for suffix, mult in multipliers.items():
            if suffix in text:
                num_str = text.replace(suffix, '').strip()
                try:
                    return int(float(num_str) * mult)
                except:
                    return 0

        try:
            return int(re.sub(r'[^\d]', '', text) or 0)
        except:
            return 0

    async def collect_keyword(self, keyword: str) -> List[HotContent]:
        """采集单个关键词的热门内容"""
        print(f"\n开始采集关键词: {keyword}")
        collected = []

        searchers = {
            "小红书": self.search_xiaohongshu,
            "抖音": self.search_douyin,
            "B站": self.search_bilibili,
            "视频号": self.search_wechat_video
        }

        for platform in self.config.platforms:
            searcher = searchers.get(platform)
            if not searcher:
                continue

            try:
                results = await searcher(keyword)
                for item in results:
                    if item.get("likes", 0) >= self.config.min_likes:
                        content = HotContent(
                            platform=platform,
                            content_id=item.get("id", ""),
                            title=item.get("title", ""),
                            content=item.get("content", ""),
                            author=item.get("author", ""),
                            author_id=item.get("author_id", ""),
                            likes=item.get("likes", 0),
                            comments=item.get("comments", 0),
                            shares=item.get("shares", 0),
                            collects=item.get("collects", 0),
                            views=item.get("views", 0),
                            publish_time=item.get("publish_time", ""),
                            collected_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            content_type=item.get("type", "图文"),
                            content_url=item.get("url", ""),
                            cover_url=item.get("cover_url", ""),
                            tags=item.get("tags", [])
                        )
                        collected.append(content)
                        self.contents.append(content)

            except Exception as e:
                print(f"[{platform}] 采集异常: {e}")

            await self.random_delay(2, 5)

        print(f"关键词 '{keyword}' 采集到 {len(collected)} 条热门内容")
        return collected

    async def collect_all(self) -> List[HotContent]:
        """批量采集所有关键词"""
        if not self.config.keywords:
            print("错误: 未指定采集关键词")
            return []

        await self.init_browser()
        all_contents = []

        try:
            for keyword in self.config.keywords:
                contents = await self.collect_keyword(keyword)
                all_contents.extend(contents)
                await self.random_delay(3, 6)
        finally:
            await self.close_browser()

        return all_contents

    def analyze_content(self, content: HotContent) -> ContentAnalysis:
        """分析单条内容（由AI判断）"""
        return ContentAnalysis(
            content=content,
            summary="需要AI分析生成摘要",
            key_points=["需要AI提取关键要点"],
            writing_style="需要AI分析写作风格",
            presentation_style="需要AI分析展现形式",
            engagement_score=0.0,
            viral_factors=["需要AI分析爆款因素"]
        )

    def analyze_all(self) -> List[ContentAnalysis]:
        """分析所有采集的内容"""
        for content in self.contents:
            analysis = self.analyze_content(content)
            self.analyses.append(analysis)
        return self.analyses

    def generate_optimal_copy(self) -> Dict[str, Any]:
        """生成最优文案（由AI判断）"""
        return {
            "optimal_copy": "需要AI基于热门内容分析生成最优文案",
            "presentation_styles": ["需要AI分析推荐展现形式"],
            "keyword_suggestions": ["需要AI分析关键词使用建议"],
            "engagement_strategies": ["需要AI分析互动引导策略"],
            "reference_contents": [
                {
                    "platform": c.platform,
                    "title": c.title,
                    "likes": c.likes,
                    "style": "需要AI分析"
                }
                for c in sorted(self.contents, key=lambda x: x.likes, reverse=True)[:5]
            ]
        }

    def export_to_csv(self, filename: Optional[str] = None) -> str:
        """导出为CSV文件"""
        if not self.contents:
            print("没有数据可导出")
            return ""

        filename = filename or f"hot_content_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        filepath = os.path.join(self.config.output_dir, filename)

        with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow([
                "平台", "内容ID", "标题", "内容", "作者", "作者ID",
                "点赞数", "评论数", "分享数", "收藏数", "播放量",
                "发布时间", "采集时间", "内容类型", "内容链接", "标签"
            ])
            for content in self.contents:
                writer.writerow([
                    content.platform, content.content_id, content.title,
                    content.content, content.author, content.author_id,
                    content.likes, content.comments, content.shares,
                    content.collects, content.views, content.publish_time,
                    content.collected_at, content.content_type,
                    content.content_url, ",".join(content.tags)
                ])

        print(f"CSV文件已导出: {filepath}")
        return filepath

    def export_to_json(self, filename: Optional[str] = None) -> str:
        """导出为JSON文件"""
        if not self.contents:
            print("没有数据可导出")
            return ""

        filename = filename or f"hot_content_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(self.config.output_dir, filename)

        data = {
            "meta": {
                "total": len(self.contents),
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "keywords": self.config.keywords,
                "platforms": self.config.platforms,
                "config": {
                    "min_likes": self.config.min_likes,
                    "days_range": self.config.days_range
                }
            },
            "contents": [asdict(c) for c in self.contents],
            "analyses": [
                {
                    "content_id": a.content.content_id,
                    "platform": a.content.platform,
                    "summary": a.summary,
                    "key_points": a.key_points,
                    "writing_style": a.writing_style,
                    "presentation_style": a.presentation_style,
                    "engagement_score": a.engagement_score,
                    "viral_factors": a.viral_factors
                }
                for a in self.analyses
            ],
            "optimal_copy": self.generate_optimal_copy()
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"JSON文件已导出: {filepath}")
        return filepath

    def export(self) -> List[str]:
        """根据配置导出数据"""
        files = []
        if self.config.export_format in ["csv", "both"]:
            files.append(self.export_to_csv())
        if self.config.export_format in ["json", "both"]:
            files.append(self.export_to_json())
        return files

    def get_statistics(self) -> Dict[str, Any]:
        """获取采集统计信息"""
        if not self.contents:
            return {"total": 0, "keywords": self.config.keywords}

        platform_distribution = {}
        total_likes = 0

        for content in self.contents:
            platform_distribution[content.platform] = platform_distribution.get(content.platform, 0) + 1
            total_likes += content.likes

        return {
            "total": len(self.contents),
            "keywords": self.config.keywords,
            "platforms": self.config.platforms,
            "platform_distribution": platform_distribution,
            "total_likes": total_likes,
            "avg_likes": total_likes / len(self.contents) if self.contents else 0,
            "top_contents": [
                {"platform": c.platform, "title": c.title[:30], "likes": c.likes}
                for c in sorted(self.contents, key=lambda x: x.likes, reverse=True)[:5]
            ]
        }


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="多平台热门内容分析器")
    parser.add_argument("-k", "--keywords", nargs="+", required=True, help="采集关键词列表")
    parser.add_argument("-p", "--platforms", nargs="+",
        default=["小红书", "抖音", "视频号", "B站"],
        choices=["小红书", "抖音", "视频号", "B站"], help="采集平台列表")
    parser.add_argument("-l", "--min-likes", type=int, default=100, help="最小点赞数过滤")
    parser.add_argument("-d", "--days", type=int, default=7, help="采集最近几天的内容")
    parser.add_argument("-m", "--max-content", type=int, default=20, help="每个关键词最大采集数量")
    parser.add_argument("-o", "--output", default="./hot_content", help="输出目录")
    parser.add_argument("-f", "--format", choices=["csv", "json", "both"], default="both", help="导出格式")
    parser.add_argument("--headed", action="store_true", help="显示浏览器窗口")
    parser.add_argument("--cookies", default="", help="Cookie文件路径")
    return parser.parse_args()


async def async_main():
    """异步主函数"""
    args = parse_args()

    print("=" * 50)
    print("多平台热门内容分析器 v2.0.0 (Playwright)")
    print("=" * 50)
    print()
    print("注意: 本工具仅供学习和研究使用")
    print("请遵守各平台规则和法律法规")
    print()

    config = CollectConfig(
        keywords=args.keywords,
        platforms=args.platforms,
        min_likes=args.min_likes,
        days_range=args.days,
        max_content_per_keyword=args.max_content,
        output_dir=args.output,
        export_format=args.format,
        headless=not args.headed,
        cookie_file=args.cookies
    )

    print(f"采集关键词: {', '.join(config.keywords)}")
    print(f"采集平台: {', '.join(config.platforms)}")
    print(f"最小点赞数: {config.min_likes}")
    print(f"时间范围: 最近{config.days_range}天")
    print(f"输出目录: {config.output_dir}")
    print()

    collector = PlaywrightCollector(config)
    await collector.collect_all()
    collector.analyze_all()
    collector.export()

    stats = collector.get_statistics()
    print()
    print(f"采集统计: {json.dumps(stats, ensure_ascii=False, indent=2)}")


def main():
    """主函数入口"""
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
