#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小红书潜在客户采集器
自动化采集小红书平台上的潜在客户数据
支持自定义关键词和AI意向度判断
"""

import json
import csv
import os
import sys
import time
import random
import argparse
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import List, Optional, Dict, Any


@dataclass
class Lead:
    user_id: str
    nickname: str
    keyword: str
    content: str
    intent_level: int
    intent_reason: str
    likes: int
    comments: int
    collected_at: str
    source_note: str
    note_url: str = ""


@dataclass
class CollectConfig:
    keywords: List[str] = field(default_factory=list)
    max_leads_per_keyword: int = 20
    max_notes_per_keyword: int = 10
    min_intent_level: int = 3
    output_dir: str = "./leads"
    export_format: str = "both"


class XiaohongshuCollector:
    """小红书潜在客户采集器"""

    def __init__(self, config: Optional[CollectConfig] = None):
        self.config = config or CollectConfig()
        self.leads: List[Lead] = []
        os.makedirs(self.config.output_dir, exist_ok=True)

    def search_notes(self, keyword: str) -> List[Dict[str, Any]]:
        """
        搜索笔记（需要接入Playwright/Selenium实现）
        实际实现需要：
        1. 使用Playwright打开小红书搜索页面
        2. 登录账号获取更多数据
        3. 解析搜索结果页面
        """
        print(f"[搜索] 关键词: {keyword}, 最大笔记数: {self.config.max_notes_per_keyword}")
        return []

    def get_note_comments(self, note_id: str) -> List[Dict[str, Any]]:
        """
        获取笔记评论（需要接入Playwright/Selenium实现）
        """
        print(f"[获取评论] 笔记ID: {note_id}")
        return []

    def analyze_intent(self, content: str, keyword: str) -> tuple[int, str]:
        """
        分析用户意向度（由AI判断）
        返回: (意向等级, 判断理由)
        
        意向等级说明：
        5 - 高意向：明确表达购买/咨询意愿
        4 - 中高意向：有较强兴趣，询问细节
        3 - 中等意向：有初步兴趣，想了解更多
        2 - 低意向：只是浏览或随意评论
        1 - 无意向：无关内容
        
        注意：此方法应由AI来调用并判断，不要硬编码关键词
        """
        return 3, "需要AI分析判断"

    def collect_leads(self, keyword: str) -> List[Lead]:
        """采集单个关键词的潜在客户"""
        print(f"开始采集关键词: {keyword}")
        notes = self.search_notes(keyword)

        collected = []
        for note in notes:
            comments = self.get_note_comments(note.get("id", ""))
            for comment in comments:
                content = comment.get("content", "")
                intent_level, intent_reason = self.analyze_intent(content, keyword)

                if intent_level >= self.config.min_intent_level:
                    lead = Lead(
                        user_id=comment.get("user_id", ""),
                        nickname=comment.get("nickname", ""),
                        keyword=keyword,
                        content=content,
                        intent_level=intent_level,
                        intent_reason=intent_reason,
                        likes=comment.get("likes", 0),
                        comments=comment.get("comments", 0),
                        collected_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        source_note=note.get("title", ""),
                        note_url=note.get("url", "")
                    )
                    collected.append(lead)
                    self.leads.append(lead)

                    if len(collected) >= self.config.max_leads_per_keyword:
                        break

            time.sleep(random.uniform(1, 3))

        print(f"关键词 '{keyword}' 采集到 {len(collected)} 个潜在客户")
        return collected

    def collect_all(self) -> List[Lead]:
        """批量采集所有关键词"""
        if not self.config.keywords:
            print("错误: 未指定采集关键词")
            return []

        all_leads = []
        for keyword in self.config.keywords:
            leads = self.collect_leads(keyword)
            all_leads.extend(leads)
            time.sleep(random.uniform(2, 5))

        return all_leads

    def export_to_csv(self, filename: Optional[str] = None) -> str:
        """导出为CSV文件"""
        if not self.leads:
            print("没有数据可导出")
            return ""

        filename = filename or f"xhs_leads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        filepath = os.path.join(self.config.output_dir, filename)

        with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow([
                "序号", "用户ID", "昵称", "关键词", "内容",
                "意向等级", "意向理由", "点赞数", "评论数",
                "采集时间", "来源笔记", "笔记链接"
            ])
            for i, lead in enumerate(self.leads, 1):
                writer.writerow([
                    i, lead.user_id, lead.nickname, lead.keyword,
                    lead.content, lead.intent_level, lead.intent_reason,
                    lead.likes, lead.comments, lead.collected_at,
                    lead.source_note, lead.note_url
                ])

        print(f"CSV文件已导出: {filepath}")
        return filepath

    def export_to_json(self, filename: Optional[str] = None) -> str:
        """导出为JSON文件"""
        if not self.leads:
            print("没有数据可导出")
            return ""

        filename = filename or f"xhs_leads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(self.config.output_dir, filename)

        data = {
            "meta": {
                "total": len(self.leads),
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "keywords": self.config.keywords,
                "config": {
                    "max_leads_per_keyword": self.config.max_leads_per_keyword,
                    "min_intent_level": self.config.min_intent_level
                }
            },
            "leads": [asdict(lead) for lead in self.leads]
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
        if not self.leads:
            return {"total": 0, "keywords": self.config.keywords}

        intent_distribution = {}
        keyword_distribution = {}

        for lead in self.leads:
            level = lead.intent_level
            intent_distribution[level] = intent_distribution.get(level, 0) + 1
            keyword_distribution[lead.keyword] = keyword_distribution.get(lead.keyword, 0) + 1

        return {
            "total": len(self.leads),
            "keywords": self.config.keywords,
            "intent_distribution": intent_distribution,
            "keyword_distribution": keyword_distribution,
            "high_intent_count": intent_distribution.get(5, 0) + intent_distribution.get(4, 0)
        }


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="小红书潜在客户采集器")
    parser.add_argument(
        "-k", "--keywords",
        nargs="+",
        required=True,
        help="采集关键词列表"
    )
    parser.add_argument(
        "-m", "--max-leads",
        type=int,
        default=20,
        help="每个关键词最大采集数量 (默认: 20)"
    )
    parser.add_argument(
        "-n", "--max-notes",
        type=int,
        default=10,
        help="每个关键词最大搜索笔记数 (默认: 10)"
    )
    parser.add_argument(
        "-l", "--min-intent",
        type=int,
        default=3,
        choices=[1, 2, 3, 4, 5],
        help="最小意向等级过滤 (1-5, 默认: 3)"
    )
    parser.add_argument(
        "-o", "--output",
        default="./leads",
        help="输出目录 (默认: ./leads)"
    )
    parser.add_argument(
        "-f", "--format",
        choices=["csv", "json", "both"],
        default="both",
        help="导出格式 (默认: both)"
    )
    return parser.parse_args()


def main():
    """主函数"""
    args = parse_args()

    print("=" * 50)
    print("小红书潜在客户采集器 v2.0.0")
    print("=" * 50)
    print()
    print("注意: 本工具仅供学习和研究使用")
    print("请遵守小红书平台规则和法律法规")
    print()

    config = CollectConfig(
        keywords=args.keywords,
        max_leads_per_keyword=args.max_leads,
        max_notes_per_keyword=args.max_notes,
        min_intent_level=args.min_intent,
        output_dir=args.output,
        export_format=args.format
    )

    print(f"采集关键词: {', '.join(config.keywords)}")
    print(f"每个关键词最大采集数: {config.max_leads_per_keyword}")
    print(f"最小意向等级: {config.min_intent_level}")
    print(f"输出目录: {config.output_dir}")
    print()

    collector = XiaohongshuCollector(config)
    collector.collect_all()
    collector.export()

    stats = collector.get_statistics()
    print()
    print(f"采集统计: {json.dumps(stats, ensure_ascii=False, indent=2)}")


if __name__ == "__main__":
    main()
