# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 记忆服务
"""

import os
import sys
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.config import settings


class MemoryService:
    def __init__(self):
        self._manager = None
        self._ensure_initialized()
    
    def _ensure_initialized(self):
        if self._manager is None:
            try:
                from core.zhengfei_memory_core import EnhancedMemoryManager, MemoryCategory, MemoryImportance
                self._manager = EnhancedMemoryManager(settings.data_dir)
                self._MemoryCategory = MemoryCategory
                self._MemoryImportance = MemoryImportance
            except ImportError:
                self._manager = None
    
    def add_memory(
        self,
        text: str,
        confidence: float = 0.8,
        source: str = "conversation",
        category: Optional[str] = None,
        importance: Optional[int] = None,
        tags: Optional[List[str]] = None,
        ttl_days: Optional[int] = None
    ) -> Dict[str, Any]:
        if not self._manager:
            return {"error": "记忆模块不可用"}
        
        memory = self._manager.add_memory(
            text=text,
            confidence=confidence,
            source=source,
            tags=tags or [],
            ttl_days=ttl_days
        )
        
        if category and hasattr(self._MemoryCategory, category.upper()):
            memory.category = self._MemoryCategory(category.upper())
        
        if importance:
            try:
                memory.importance = self._MemoryImportance(importance)
            except ValueError:
                pass
        
        return {
            "id": memory.id,
            "text": memory.text,
            "category": memory.category.value,
            "importance": memory.importance.value,
            "confidence": memory.current_confidence,
            "source": memory.source,
            "created_at": memory.created_at,
            "tags": memory.tags
        }
    
    def search(
        self,
        query: str,
        top_k: int = 10,
        categories: Optional[List[str]] = None,
        min_importance: Optional[int] = None,
        min_confidence: float = 0.0
    ) -> List[Dict[str, Any]]:
        if not self._manager:
            return []
        
        cat_filter = None
        if categories:
            cat_filter = [self._MemoryCategory(c) for c in categories if hasattr(self._MemoryCategory, c.upper())]
        
        imp_filter = None
        if min_importance:
            try:
                imp_filter = self._MemoryImportance(min_importance)
            except ValueError:
                pass
        
        results = self._manager.search(
            query,
            top_k=top_k,
            categories=cat_filter,
            min_importance=imp_filter,
            min_confidence=min_confidence,
            include_relations=True
        )
        
        return [
            {
                "id": r.get("id"),
                "text": r.get("text"),
                "category": r.get("category"),
                "importance": r.get("importance"),
                "confidence": r.get("current_confidence", r.get("confidence")),
                "source": r.get("source"),
                "created_at": r.get("created_at"),
                "tags": r.get("tags", [])
            }
            for r in results
        ]
    
    def get_statistics(self) -> Dict[str, Any]:
        if not self._manager:
            return {"error": "记忆模块不可用"}
        
        return self._manager.get_statistics()
    
    def delete_memory(self, memory_id: str) -> bool:
        if not self._manager:
            return False
        return self._manager.delete_memory(memory_id)
    
    def get_context(self, task: str, max_tokens: int = 2000) -> str:
        if not self._manager:
            return "记忆模块不可用"
        return self._manager.get_context_for_task(task, max_tokens=max_tokens)
    
    def detect_conflicts(self, text: str) -> List[Dict[str, Any]]:
        if not self._manager:
            return []
        return self._manager.detect_potential_conflicts(text)
    
    def get_conflict_suggestion(self, new_text: str, conflict: Dict[str, Any]) -> Dict[str, Any]:
        if not self._manager:
            return {"error": "记忆模块不可用"}
        return self._manager.get_conflict_resolution_suggestion(new_text, conflict)


memory_service = MemoryService()
