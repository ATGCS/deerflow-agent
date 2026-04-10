# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 跨技能联动服务
"""

import os
import sys
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.config import settings


class LinkerService:
    def __init__(self):
        self._linker = None
        self._ensure_initialized()
    
    def _ensure_initialized(self):
        if self._linker is None:
            try:
                from core.zhengfei_cross_skill_linker import CrossSkillLinker
                self._linker = CrossSkillLinker(settings.data_dir)
            except ImportError:
                self._linker = None
    
    def get_context(self, skill_name: str, task_description: Optional[str] = None) -> Dict[str, Any]:
        if not self._linker:
            return {"error": "跨技能联动模块不可用"}
        
        context = self._linker.get_context_for_skill(skill_name, task_description)
        
        return {
            "skill_name": context.skill_name,
            "user_style": context.user_style,
            "user_preferences": context.user_preferences,
            "relevant_memories": context.relevant_memories[:10],
            "context_summary": context.context_summary
        }
    
    def get_all_contexts(self) -> Dict[str, Dict[str, Any]]:
        if not self._linker:
            return {}
        
        all_contexts = self._linker.get_all_skill_contexts()
        
        return {
            skill_name: {
                "user_style": ctx.user_style,
                "preferences_count": len(ctx.user_preferences),
                "memories_count": len(ctx.relevant_memories)
            }
            for skill_name, ctx in all_contexts.items()
        }
    
    def register_skill(
        self,
        skill_name: str,
        memory_categories: List[str],
        context_type: str,
        keywords: List[str],
        default_context: Dict[str, Any]
    ) -> bool:
        if not self._linker:
            return False
        
        self._linker.register_skill_mapping(
            skill_name=skill_name,
            memory_categories=memory_categories,
            context_type=context_type,
            keywords=keywords,
            default_context=default_context
        )
        return True
    
    def reload(self) -> bool:
        if not self._linker:
            return False
        self._linker.reload_memory()
        return True


linker_service = LinkerService()
