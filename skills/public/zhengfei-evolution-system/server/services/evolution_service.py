# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 进化服务
"""

import os
import sys
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.config import settings


class EvolutionService:
    def __init__(self):
        self._meta_engine = None
        self._trigger = None
        self._ensure_initialized()
    
    def _ensure_initialized(self):
        if self._meta_engine is None:
            try:
                from core.zhengfei_meta_evolution import MetaEvolutionEngine
                self._meta_engine = MetaEvolutionEngine(settings.data_dir)
            except ImportError:
                pass
        
        if self._trigger is None:
            try:
                import importlib.util
                trigger_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "zhengfei-trigger.py")
                spec = importlib.util.spec_from_file_location("zhengfei_trigger", trigger_path)
                trigger_module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(trigger_module)
                self._trigger = trigger_module.trigger_evolution
            except Exception:
                pass
    
    def trigger(
        self,
        skill_name: str,
        execution_result: str,
        user_text: Optional[str] = None,
        assistant_text: Optional[str] = None,
        guard_level: str = "standard"
    ) -> Dict[str, Any]:
        if not self._trigger:
            return {"error": "进化触发模块不可用"}
        
        conversation_context = None
        if user_text and assistant_text:
            conversation_context = {
                "user": user_text,
                "assistant": assistant_text
            }
        
        result = self._trigger(
            skill_name=skill_name,
            execution_result=execution_result,
            conversation_context=conversation_context,
            guard_level=guard_level
        )
        
        return result
    
    def record_feedback(
        self,
        memory_text: str,
        feedback_type: str,
        category: Optional[str] = None,
        importance: Optional[int] = None
    ) -> Dict[str, Any]:
        if not self._meta_engine:
            return {"error": "元进化模块不可用"}
        
        feedback = self._meta_engine.record_feedback(
            memory_text=memory_text,
            feedback_type=feedback_type,
            category=category,
            importance=importance
        )
        
        return {
            "feedback_id": feedback.feedback_id,
            "feedback_type": feedback.feedback_type,
            "resolved": feedback.resolved
        }
    
    def auto_optimize(self) -> Dict[str, Any]:
        if not self._meta_engine:
            return {"error": "元进化模块不可用"}
        return self._meta_engine.auto_optimize()
    
    def get_parameters(self) -> Dict[str, Any]:
        if not self._meta_engine:
            return {"error": "元进化模块不可用"}
        return self._meta_engine.get_parameters()
    
    def get_evolution_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        if not self._meta_engine:
            return []
        return self._meta_engine.get_evolution_history(limit=limit)
    
    def get_statistics(self) -> Dict[str, Any]:
        if not self._meta_engine:
            return {"error": "元进化模块不可用"}
        return self._meta_engine.get_statistics()


evolution_service = EvolutionService()
