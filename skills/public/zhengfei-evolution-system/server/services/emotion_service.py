# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 情绪服务
"""

import os
import sys
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.config import settings


class EmotionService:
    def __init__(self):
        self._engine = None
        self._ensure_initialized()
    
    def _ensure_initialized(self):
        if self._engine is None:
            try:
                from core.zhengfei_knowledge_graph import KnowledgeGraphEngine
                self._engine = KnowledgeGraphEngine(settings.data_dir)
            except ImportError:
                self._engine = None
    
    def analyze(self, text: str) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "情绪感知模块不可用"}
        
        emotion = self._engine.analyze_emotion(text)
        
        return {
            "emotion_type": emotion.emotion_type.value,
            "intensity": emotion.intensity.value,
            "confidence": emotion.confidence,
            "valence": emotion.valence,
            "triggers": emotion.triggers,
            "secondary_emotions": [e.value for e in emotion.secondary_emotions] if emotion.secondary_emotions else []
        }
    
    def track(self, text: str) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "情绪感知模块不可用"}
        
        emotion = self._engine.track_emotion(text)
        
        return {
            "emotion_type": emotion.emotion_type.value,
            "intensity": emotion.intensity.value,
            "confidence": emotion.confidence,
            "valence": emotion.valence,
            "triggers": emotion.triggers
        }
    
    def get_trend(self, days: int = 7) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "情绪感知模块不可用"}
        return self._engine.get_emotion_trend(days=days)
    
    def get_distribution(self) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "情绪感知模块不可用"}
        return self._engine.get_emotion_distribution()
    
    def get_context(self, text: str) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "情绪感知模块不可用"}
        return self._engine.get_emotion_aware_context(text)


emotion_service = EmotionService()
