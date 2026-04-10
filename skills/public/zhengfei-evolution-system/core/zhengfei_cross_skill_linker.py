# -*- coding: utf-8 -*-
"""
正飞跨技能联动引擎 V1.0 - 上下文共享机制
为其他技能提供记忆上下文支持
正飞信息技术出品
"""

import os
import json
import re
from datetime import datetime
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict

SKILLS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEMORY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zhengfei-memory")


@dataclass
class SkillContext:
    skill_name: str
    relevant_memories: List[Dict[str, Any]]
    user_preferences: List[Dict[str, Any]]
    user_style: Optional[str]
    context_summary: str
    timestamp: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CrossSkillLinker:
    """
    跨技能联动引擎
    
    为其他技能提供上下文支持，例如：
    - article-writer: 自动带入用户偏好的写作风格
    - frontend-design: 自动带入用户喜欢的设计风格
    - docx: 自动带入用户偏好的文档格式
    """
    
    SKILL_CONTEXT_MAPPING = {
        "article-writer": {
            "memory_categories": ["preference", "behavior", "goal"],
            "context_type": "writing_style",
            "keywords": ["写作", "文章", "风格", "偏好", "喜欢"],
            "default_context": {
                "preferred_style": "深度分析",
                "tone": "专业",
                "length_preference": "中等"
            }
        },
        "frontend-design": {
            "memory_categories": ["preference", "skill"],
            "context_type": "design_style",
            "keywords": ["设计", "UI", "界面", "颜色", "风格", "字体"],
            "default_context": {
                "preferred_style": "现代简约",
                "color_preference": "蓝色系",
                "layout_preference": "响应式"
            }
        },
        "docx": {
            "memory_categories": ["preference", "project"],
            "context_type": "document_format",
            "keywords": ["文档", "格式", "排版", "字体", "模板"],
            "default_context": {
                "font_preference": "微软雅黑",
                "format_style": "正式",
                "template_preference": "报告"
            }
        },
        "pdf": {
            "memory_categories": ["preference", "project"],
            "context_type": "pdf_handling",
            "keywords": ["PDF", "文档", "阅读", "编辑"],
            "default_context": {
                "default_action": "阅读",
                "output_format": "保持原样"
            }
        },
        "pptx": {
            "memory_categories": ["preference", "skill"],
            "context_type": "presentation_style",
            "keywords": ["PPT", "演示", "幻灯片", "汇报"],
            "default_context": {
                "style": "商务简约",
                "color_theme": "蓝色",
                "animation": "简洁"
            }
        },
        "xlsx": {
            "memory_categories": ["preference", "skill"],
            "context_type": "spreadsheet_style",
            "keywords": ["Excel", "表格", "数据", "分析"],
            "default_context": {
                "format_style": "标准",
                "chart_preference": "柱状图"
            }
        },
        "content-planner": {
            "memory_categories": ["goal", "project", "preference"],
            "context_type": "content_strategy",
            "keywords": ["内容", "计划", "选题", "发布"],
            "default_context": {
                "content_focus": "技术教程",
                "publish_frequency": "每周2篇"
            }
        },
        "legal-proposal-generator": {
            "memory_categories": ["identity", "project", "skill"],
            "context_type": "legal_context",
            "keywords": ["法律", "合同", "提案", "法规"],
            "default_context": {
                "document_type": "法律意见书",
                "formality_level": "正式"
            }
        }
    }
    
    def __init__(self, memory_dir: Optional[str] = None):
        if memory_dir:
            self.memory_dir = memory_dir
        else:
            self.memory_dir = MEMORY_DIR
        
        self._load_memory_data()
    
    def _load_memory_data(self) -> None:
        """加载记忆数据"""
        self.memories = []
        self.profile = {}
        
        index_path = os.path.join(self.memory_dir, "enhanced-index.json")
        if os.path.exists(index_path):
            with open(index_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.memories = data.get('memories', [])
        
        profile_path = os.path.join(self.memory_dir, "enhanced-profile.json")
        if os.path.exists(profile_path):
            with open(profile_path, 'r', encoding='utf-8') as f:
                self.profile = json.load(f)
    
    def reload_memory(self) -> None:
        """重新加载记忆数据"""
        self._load_memory_data()
    
    def get_context_for_skill(
        self,
        skill_name: str,
        task_description: Optional[str] = None
    ) -> SkillContext:
        """
        为指定技能获取上下文
        
        :param skill_name: 技能名称
        :param task_description: 任务描述（可选，用于更精确的上下文匹配）
        :return: 技能上下文
        """
        mapping = self.SKILL_CONTEXT_MAPPING.get(skill_name, {
            "memory_categories": ["preference"],
            "context_type": "general",
            "keywords": [],
            "default_context": {}
        })
        
        relevant_memories = self._find_relevant_memories(
            categories=mapping.get("memory_categories", []),
            keywords=mapping.get("keywords", []),
            task_description=task_description
        )
        
        user_preferences = self._extract_preferences(relevant_memories)
        
        user_style = self._infer_user_style(skill_name, relevant_memories)
        
        context_summary = self._build_context_summary(
            skill_name,
            relevant_memories,
            user_preferences,
            user_style
        )
        
        return SkillContext(
            skill_name=skill_name,
            relevant_memories=relevant_memories[:10],
            user_preferences=user_preferences,
            user_style=user_style,
            context_summary=context_summary,
            timestamp=datetime.now().isoformat()
        )
    
    def _find_relevant_memories(
        self,
        categories: List[str],
        keywords: List[str],
        task_description: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """查找相关记忆"""
        results = []
        
        for memory in self.memories:
            memory_category = memory.get('category', 'context')
            memory_text = memory.get('text', '').lower()
            
            if memory_category in categories:
                score = memory.get('importance', 3) * 0.3 + memory.get('confidence', 0.5) * 0.3
                
                keyword_matches = sum(1 for kw in keywords if kw.lower() in memory_text)
                score += keyword_matches * 0.2
                
                if task_description:
                    task_keywords = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', task_description.lower())
                    task_matches = sum(1 for kw in task_keywords if kw in memory_text)
                    score += task_matches * 0.1
                
                memory['_relevance_score'] = score
                results.append(memory)
        
        results.sort(key=lambda x: x.get('_relevance_score', 0), reverse=True)
        
        return results
    
    def _extract_preferences(self, memories: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """从记忆中提取偏好"""
        preferences = []
        
        for memory in memories:
            text = memory.get('text', '')
            category = memory.get('category', '')
            
            if category == 'preference':
                pref = self._parse_preference(text)
                if pref:
                    preferences.append(pref)
        
        return preferences
    
    def _parse_preference(self, text: str) -> Optional[Dict[str, Any]]:
        """解析偏好文本"""
        patterns = [
            (r'我喜欢(.+?)(?:风格|方式|格式)', 'likes'),
            (r'我偏好(.+?)(?:风格|方式|格式)', 'prefers'),
            (r'我习惯(.+?)(?:方式|做法)', 'habit'),
            (r'我常用(.+?)(?:工具|方法)', 'frequently_uses'),
            (r'我不喜欢(.+?)(?:风格|方式)', 'dislikes'),
        ]
        
        for pattern, pref_type in patterns:
            match = re.search(pattern, text)
            if match:
                return {
                    "type": pref_type,
                    "value": match.group(1).strip(),
                    "source_text": text
                }
        
        return {
            "type": "general",
            "value": text,
            "source_text": text
        }
    
    def _infer_user_style(
        self,
        skill_name: str,
        memories: List[Dict[str, Any]]
    ) -> Optional[str]:
        """推断用户风格"""
        style_keywords = {
            "article-writer": {
                "深度分析": ["深度", "分析", "严谨", "数据"],
                "实用指南": ["实用", "教程", "步骤", "指南"],
                "故事驱动": ["故事", "案例", "经历", "感受"],
                "观点评论": ["观点", "评论", "看法", "争议"],
                "新闻简报": ["新闻", "简报", "快讯", "资讯"]
            },
            "frontend-design": {
                "现代简约": ["简约", "现代", "简洁", "干净"],
                "复古风格": ["复古", "怀旧", "经典", "vintage"],
                "科技感": ["科技", "未来", "赛博", "科技感"],
                "自然清新": ["自然", "清新", "绿色", "生态"],
                "商务正式": ["商务", "正式", "专业", "企业"]
            }
        }
        
        skill_styles = style_keywords.get(skill_name, {})
        if not skill_styles:
            return None
        
        style_scores = {style: 0 for style in skill_styles}
        
        for memory in memories:
            text = memory.get('text', '').lower()
            for style, keywords in skill_styles.items():
                for keyword in keywords:
                    if keyword in text:
                        style_scores[style] += 1
        
        max_style = max(style_scores.items(), key=lambda x: x[1])
        if max_style[1] > 0:
            return max_style[0]
        
        return None
    
    def _build_context_summary(
        self,
        skill_name: str,
        memories: List[Dict[str, Any]],
        preferences: List[Dict[str, Any]],
        style: Optional[str]
    ) -> str:
        """构建上下文摘要"""
        parts = [f"## {skill_name} 技能上下文\n"]
        
        if style:
            parts.append(f"### 推断风格\n{style}\n")
        
        if preferences:
            parts.append("### 用户偏好")
            for pref in preferences[:5]:
                parts.append(f"- {pref.get('value', '')}")
            parts.append("")
        
        if memories:
            parts.append("### 相关记忆")
            for memory in memories[:5]:
                parts.append(f"- [{memory.get('category', 'context')}] {memory.get('text', '')}")
        
        return '\n'.join(parts)
    
    def get_all_skill_contexts(self) -> Dict[str, SkillContext]:
        """获取所有已配置技能的上下文"""
        contexts = {}
        for skill_name in self.SKILL_CONTEXT_MAPPING.keys():
            contexts[skill_name] = self.get_context_for_skill(skill_name)
        return contexts
    
    def register_skill_mapping(
        self,
        skill_name: str,
        memory_categories: List[str],
        context_type: str,
        keywords: List[str],
        default_context: Dict[str, Any]
    ) -> None:
        """注册新的技能映射"""
        self.SKILL_CONTEXT_MAPPING[skill_name] = {
            "memory_categories": memory_categories,
            "context_type": context_type,
            "keywords": keywords,
            "default_context": default_context
        }
    
    def export_context_for_skill(self, skill_name: str, format: str = "markdown") -> str:
        """导出技能上下文"""
        context = self.get_context_for_skill(skill_name)
        
        if format == "markdown":
            return context.context_summary
        elif format == "json":
            return json.dumps(context.to_dict(), ensure_ascii=False, indent=2)
        else:
            return context.context_summary


def get_context_for_skill(skill_name: str, task_description: Optional[str] = None) -> str:
    """
    便捷函数：获取技能上下文
    
    :param skill_name: 技能名称
    :param task_description: 任务描述
    :return: 上下文摘要（Markdown格式）
    """
    linker = CrossSkillLinker()
    context = linker.get_context_for_skill(skill_name, task_description)
    return context.context_summary


def get_user_preference_for_skill(skill_name: str) -> List[Dict[str, Any]]:
    """
    便捷函数：获取用户对特定技能的偏好
    
    :param skill_name: 技能名称
    :return: 偏好列表
    """
    linker = CrossSkillLinker()
    context = linker.get_context_for_skill(skill_name)
    return context.user_preferences


if __name__ == "__main__":
    print("=== 正飞跨技能联动引擎 V1.0 测试 ===\n")
    
    linker = CrossSkillLinker()
    
    print("1. 获取 article-writer 上下文:")
    context = linker.get_context_for_skill("article-writer", "写一篇关于React的文章")
    print(context.context_summary)
    
    print("\n2. 获取 frontend-design 上下文:")
    context = linker.get_context_for_skill("frontend-design", "设计一个后台管理界面")
    print(context.context_summary)
    
    print("\n3. 获取所有技能上下文:")
    all_contexts = linker.get_all_skill_contexts()
    for skill_name, ctx in all_contexts.items():
        print(f"   {skill_name}: {len(ctx.relevant_memories)} 条相关记忆")
