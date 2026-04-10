# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 能力服务
"""

import os
import sys
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.config import settings


class CapabilityService:
    def __init__(self):
        self._engine = None
        self._ensure_initialized()
    
    def _ensure_initialized(self):
        if self._engine is None:
            try:
                from core.zhengfei_capability_automation import CapabilityAutomationEngine
                self._engine = CapabilityAutomationEngine(settings.data_dir)
            except ImportError:
                self._engine = None
    
    def auto_generate(
        self,
        task_description: str,
        execution_result: str,
        success: bool = True
    ) -> Optional[Dict[str, Any]]:
        if not self._engine:
            return None
        
        cap = self._engine.auto_generate_capability(task_description, execution_result, success)
        if cap:
            return {
                "id": cap.id,
                "name": cap.name,
                "trigger_conditions": cap.trigger_conditions,
                "core_value": cap.core_value,
                "auto_generated": cap.auto_generated
            }
        return None
    
    def match(self, task_description: str) -> List[Dict[str, Any]]:
        if not self._engine:
            return []
        
        matches = self._engine.find_matching_capabilities(task_description)
        
        return [
            {
                "capability_id": m.capability_id,
                "capability_name": m.capability_name,
                "match_score": m.match_score,
                "matched_conditions": m.matched_conditions,
                "suggested_actions": m.suggested_actions
            }
            for m in matches
        ]
    
    def record_effectiveness(
        self,
        capability_id: str,
        task_description: str,
        success: bool,
        user_feedback: Optional[str] = None
    ) -> bool:
        if not self._engine:
            return False
        
        self._engine.record_effectiveness(capability_id, task_description, success, user_feedback)
        return True
    
    def get_top(self, limit: int = 10) -> List[Dict[str, Any]]:
        if not self._engine:
            return []
        
        caps = self._engine.get_top_capabilities(limit)
        
        return [
            {
                "id": c.id,
                "name": c.name,
                "effectiveness_score": c.effectiveness_score,
                "usage_count": c.usage_count,
                "auto_generated": c.auto_generated
            }
            for c in caps
        ]
    
    def get_statistics(self) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "能力自动化模块不可用"}
        return self._engine.get_statistics()


capability_service = CapabilityService()
