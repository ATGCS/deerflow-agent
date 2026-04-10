# -*- coding: utf-8 -*-
"""
正飞智能上下文组装器 V4.0
根据任务需求智能组装最相关的记忆上下文
正飞信息技术出品
"""

import os
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from collections import Counter

import importlib.util
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()

spec = importlib.util.spec_from_file_location(
    "zhengfei_memory_core",
    os.path.join(SCRIPT_DIR, "zhengfei-memory-core.py")
)
core_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core_module)

EnhancedMemoryManager = core_module.EnhancedMemoryManager
MemoryCategory = core_module.MemoryCategory
MemoryImportance = core_module.MemoryImportance
MemoryRelationType = core_module.MemoryRelationType
extract_keywords = core_module.extract_keywords


@dataclass
class ContextConfig:
    max_total_tokens: int = 2000
    max_identity_items: int = 3
    max_preference_items: int = 5
    max_goal_items: int = 3
    max_project_items: int = 3
    max_related_memories: int = 10
    min_confidence: float = 0.3
    min_importance: int = 2
    include_relations: bool = True
    prioritize_recent: bool = True
    recency_days: int = 30


@dataclass
class AssembledContext:
    sections: Dict[str, List[str]]
    total_items: int
    total_tokens: int
    categories_included: List[str]
    importance_range: Tuple[int, int]
    confidence_range: Tuple[float, float]
    assembly_time: str
    
    def to_markdown(self) -> str:
        lines = ["## 用户上下文\n"]
        
        section_names = {
            'identity': '用户身份',
            'preferences': '用户偏好',
            'skills': '用户技能',
            'relationships': '人际关系',
            'current_goals': '当前目标',
            'active_projects': '活跃项目',
            'recent_activities': '近期活动',
            'related_memories': '相关记忆'
        }
        
        for section, items in self.sections.items():
            if items:
                name = section_names.get(section, section)
                lines.append(f"### {name}")
                for item in items:
                    lines.append(f"- {item}")
                lines.append("")
        
        return '\n'.join(lines)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'sections': self.sections,
            'total_items': self.total_items,
            'total_tokens': self.total_tokens,
            'categories_included': self.categories_included,
            'importance_range': self.importance_range,
            'confidence_range': self.confidence_range,
            'assembly_time': self.assembly_time
        }


class TaskAnalyzer:
    TASK_TYPE_PATTERNS = {
        'coding': [
            r'(代码|编写|开发|实现|编程|code|develop|implement|programming)',
            r'(函数|类|模块|组件|function|class|module|component)',
            r'(bug|修复|fix|debug)',
        ],
        'documentation': [
            r'(文档|说明|readme|document|doc)',
            r'(注释|comment|说明)',
        ],
        'analysis': [
            r'(分析|评估|检查|analysis|analyze|evaluate|check)',
            r'(报告|总结|report|summary)',
        ],
        'planning': [
            r'(计划|规划|安排|plan|schedule|arrange)',
            r'(目标|里程碑|goal|milestone)',
        ],
        'communication': [
            r'(回复|回答|邮件|消息|reply|answer|email|message)',
            r'(通知|公告|notify|announcement)',
        ],
        'learning': [
            r'(学习|教程|教程|learn|tutorial|guide)',
            r'(解释|讲解|explain)',
        ],
    }
    
    CATEGORY_RELEVANCE = {
        'coding': {
            MemoryCategory.PREFERENCE: 1.0,
            MemoryCategory.SKILL: 0.9,
            MemoryCategory.PROJECT: 0.85,
            MemoryCategory.IDENTITY: 0.7,
            MemoryCategory.GOAL: 0.6,
            MemoryCategory.KNOWLEDGE: 0.5,
        },
        'documentation': {
            MemoryCategory.PREFERENCE: 0.9,
            MemoryCategory.PROJECT: 0.85,
            MemoryCategory.IDENTITY: 0.8,
            MemoryCategory.SKILL: 0.7,
            MemoryCategory.GOAL: 0.6,
        },
        'analysis': {
            MemoryCategory.PROJECT: 0.9,
            MemoryCategory.GOAL: 0.85,
            MemoryCategory.IDENTITY: 0.7,
            MemoryCategory.PREFERENCE: 0.6,
            MemoryCategory.KNOWLEDGE: 0.5,
        },
        'planning': {
            MemoryCategory.GOAL: 1.0,
            MemoryCategory.PROJECT: 0.9,
            MemoryCategory.IDENTITY: 0.7,
            MemoryCategory.PREFERENCE: 0.6,
            MemoryCategory.BEHAVIOR: 0.5,
        },
        'communication': {
            MemoryCategory.IDENTITY: 1.0,
            MemoryCategory.RELATIONSHIP: 0.9,
            MemoryCategory.PREFERENCE: 0.8,
            MemoryCategory.GOAL: 0.6,
        },
        'learning': {
            MemoryCategory.SKILL: 1.0,
            MemoryCategory.KNOWLEDGE: 0.9,
            MemoryCategory.PREFERENCE: 0.8,
            MemoryCategory.GOAL: 0.7,
            MemoryCategory.IDENTITY: 0.6,
        },
    }
    
    @classmethod
    def analyze_task(cls, task_description: str) -> Tuple[str, Dict[MemoryCategory, float]]:
        task_lower = task_description.lower()
        
        best_type = 'general'
        best_score = 0
        
        for task_type, patterns in cls.TASK_TYPE_PATTERNS.items():
            score = 0
            for pattern in patterns:
                if re.search(pattern, task_lower, re.IGNORECASE):
                    score += 1
            
            if score > best_score:
                best_score = score
                best_type = task_type
        
        relevance = cls.CATEGORY_RELEVANCE.get(best_type, {})
        default_relevance = {
            MemoryCategory.IDENTITY: 0.7,
            MemoryCategory.PREFERENCE: 0.7,
            MemoryCategory.GOAL: 0.6,
            MemoryCategory.PROJECT: 0.6,
            MemoryCategory.SKILL: 0.5,
        }
        
        for cat, rel in default_relevance.items():
            if cat not in relevance:
                relevance[cat] = rel
        
        return best_type, relevance


class ContextAssembler:
    def __init__(
        self,
        memory_manager: Optional[EnhancedMemoryManager] = None,
        config: Optional[ContextConfig] = None
    ):
        self.manager = memory_manager or EnhancedMemoryManager()
        self.config = config or ContextConfig()
    
    def assemble_context(
        self,
        task_description: str,
        custom_config: Optional[ContextConfig] = None
    ) -> AssembledContext:
        config = custom_config or self.config
        
        task_type, category_relevance = TaskAnalyzer.analyze_task(task_description)
        
        sections: Dict[str, List[str]] = {}
        total_items = 0
        total_tokens = 0
        categories_included = set()
        importance_values = []
        confidence_values = []
        
        identity_items = self._get_identity_items(config)
        if identity_items:
            sections['identity'] = identity_items
            total_items += len(identity_items)
            total_tokens += sum(len(item) for item in identity_items)
            categories_included.add('identity')
        
        preference_items = self._get_preference_items(task_description, config, category_relevance)
        if preference_items:
            sections['preferences'] = preference_items
            total_items += len(preference_items)
            total_tokens += sum(len(item) for item in preference_items)
            categories_included.add('preference')
        
        goal_items = self._get_goal_items(config)
        if goal_items:
            sections['current_goals'] = goal_items
            total_items += len(goal_items)
            total_tokens += sum(len(item) for item in goal_items)
            categories_included.add('goal')
        
        project_items = self._get_project_items(config)
        if project_items:
            sections['active_projects'] = project_items
            total_items += len(project_items)
            total_tokens += sum(len(item) for item in project_items)
            categories_included.add('project')
        
        remaining_tokens = config.max_total_tokens - total_tokens
        if remaining_tokens > 100:
            related_items = self._get_related_memories(
                task_description,
                config,
                remaining_tokens,
                category_relevance
            )
            if related_items:
                sections['related_memories'] = related_items
                total_items += len(related_items)
                total_tokens += sum(len(item) for item in related_items)
        
        importance_range = (min(importance_values) if importance_values else 1,
                          max(importance_values) if importance_values else 5)
        confidence_range = (min(confidence_values) if confidence_values else 0.0,
                          max(confidence_values) if confidence_values else 1.0)
        
        return AssembledContext(
            sections=sections,
            total_items=total_items,
            total_tokens=total_tokens,
            categories_included=list(categories_included),
            importance_range=importance_range,
            confidence_range=confidence_range,
            assembly_time=datetime.now().isoformat()
        )
    
    def _get_identity_items(self, config: ContextConfig) -> List[str]:
        items = []
        
        static = self.manager.profile_data.get('static', {})
        identities = static.get('identity', [])
        
        for item in identities[:config.max_identity_items]:
            text = item.get('text', '')
            if text:
                items.append(text)
        
        return items
    
    def _get_preference_items(
        self,
        task_description: str,
        config: ContextConfig,
        category_relevance: Dict[MemoryCategory, float]
    ) -> List[str]:
        items = []
        
        relevance = category_relevance.get(MemoryCategory.PREFERENCE, 0.7)
        if relevance < 0.5:
            return items
        
        results = self.manager.search(
            task_description,
            top_k=config.max_preference_items,
            categories=[MemoryCategory.PREFERENCE],
            min_confidence=config.min_confidence
        )
        
        for r in results[:config.max_preference_items]:
            items.append(r['text'])
        
        return items
    
    def _get_goal_items(self, config: ContextConfig) -> List[str]:
        items = []
        
        dynamic = self.manager.profile_data.get('dynamic', {})
        goals = dynamic.get('current_goals', [])
        
        for item in goals[:config.max_goal_items]:
            text = item.get('text', '')
            if text:
                items.append(text)
        
        return items
    
    def _get_project_items(self, config: ContextConfig) -> List[str]:
        items = []
        
        dynamic = self.manager.profile_data.get('dynamic', {})
        projects = dynamic.get('active_projects', [])
        
        for item in projects[:config.max_project_items]:
            text = item.get('text', '')
            if text:
                items.append(text)
        
        return items
    
    def _get_related_memories(
        self,
        task_description: str,
        config: ContextConfig,
        max_tokens: int,
        category_relevance: Dict[MemoryCategory, float]
    ) -> List[str]:
        items = []
        used_tokens = 0
        
        results = self.manager.search(
            task_description,
            top_k=config.max_related_memories * 2,
            min_confidence=config.min_confidence,
            include_relations=config.include_relations
        )
        
        seen_texts = set()
        
        for r in results:
            text = r.get('text', '')
            if not text or text in seen_texts:
                continue
            
            category_str = r.get('category', 'context')
            try:
                category = MemoryCategory(category_str)
            except ValueError:
                category = MemoryCategory.CONTEXT
            
            relevance = category_relevance.get(category, 0.5)
            if relevance < 0.3:
                continue
            
            item_tokens = len(text)
            if used_tokens + item_tokens > max_tokens:
                break
            
            items.append(text)
            seen_texts.add(text)
            used_tokens += item_tokens
            
            if len(items) >= config.max_related_memories:
                break
        
        return items
    
    def get_context_for_query(
        self,
        query: str,
        max_items: int = 15
    ) -> str:
        config = ContextConfig(
            max_total_tokens=3000,
            max_related_memories=max_items
        )
        
        context = self.assemble_context(query, config)
        return context.to_markdown()
    
    def get_quick_context(self) -> str:
        lines = ["## 快速上下文\n"]
        
        static = self.manager.profile_data.get('static', {})
        dynamic = self.manager.profile_data.get('dynamic', {})
        
        identities = static.get('identity', [])
        if identities:
            lines.append("用户身份:")
            for item in identities[:2]:
                lines.append(f"  - {item.get('text', '')}")
        
        preferences = static.get('preferences', [])
        if preferences:
            lines.append("\n用户偏好:")
            for item in preferences[:3]:
                lines.append(f"  - {item.get('text', '')}")
        
        goals = dynamic.get('current_goals', [])
        if goals:
            lines.append("\n当前目标:")
            for item in goals[:2]:
                lines.append(f"  - {item.get('text', '')}")
        
        return '\n'.join(lines)


def assemble_context_for_task(
    task_description: str,
    max_tokens: int = 2000
) -> str:
    assembler = ContextAssembler()
    config = ContextConfig(max_total_tokens=max_tokens)
    context = assembler.assemble_context(task_description, config)
    return context.to_markdown()


if __name__ == "__main__":
    print("=== 正飞智能上下文组装器 V4.0 测试 ===\n")
    
    assembler = ContextAssembler()
    
    test_tasks = [
        "帮我写一个TypeScript函数来处理用户数据",
        "创建一个项目文档说明如何使用这个系统",
        "分析当前项目的进度和下一步计划",
    ]
    
    for task in test_tasks:
        print(f"任务: {task}")
        print("-" * 50)
        
        task_type, relevance = TaskAnalyzer.analyze_task(task)
        print(f"任务类型: {task_type}")
        print(f"分类相关性: {[(k.value, v) for k, v in relevance.items()]}")
        
        context = assembler.assemble_context(task)
        print(f"\n组装的上下文:")
        print(context.to_markdown())
        print(f"统计: {context.total_items} 项, {context.total_tokens} 字符")
        print("\n" + "=" * 50 + "\n")
