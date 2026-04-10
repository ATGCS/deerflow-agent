# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 推理服务
"""

import os
import sys
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.config import settings


class InferenceService:
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
    
    def infer(self, query: str, max_depth: int = 3) -> List[Dict[str, Any]]:
        if not self._engine:
            return []
        
        results = self._engine.infer(query, max_depth=max_depth)
        
        return [
            {
                "conclusion": r.conclusion,
                "confidence": r.confidence,
                "reasoning_path": r.reasoning_path,
                "evidence": r.evidence
            }
            for r in results
        ]
    
    def find_path(self, start: str, end: str, max_depth: int = 5) -> List[List[str]]:
        if not self._engine:
            return []
        return self._engine.find_path(start, end, max_depth=max_depth)
    
    def get_related(self, text: str, depth: int = 2) -> List[Dict[str, Any]]:
        if not self._engine:
            return []
        return self._engine.get_related_concepts(text, depth=depth)
    
    def add_node(self, text: str, node_type: str = "entity", attributes: Optional[Dict] = None) -> Optional[Dict]:
        if not self._engine:
            return None
        
        node = self._engine.add_node(text, node_type=node_type, attributes=attributes)
        return {
            "id": node.id,
            "text": node.text,
            "node_type": node.node_type,
            "confidence": node.confidence
        }
    
    def add_edge(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        evidence: str = "",
        confidence: float = 0.8
    ) -> Optional[Dict]:
        if not self._engine:
            return None
        
        edge = self._engine.add_edge(source_id, target_id, relation_type, evidence=evidence, confidence=confidence)
        if edge:
            return {
                "source_id": edge.source_id,
                "target_id": edge.target_id,
                "relation_type": edge.relation_type,
                "confidence": edge.confidence
            }
        return None
    
    def get_statistics(self) -> Dict[str, Any]:
        if not self._engine:
            return {"error": "知识图谱模块不可用"}
        return self._engine.get_statistics()


inference_service = InferenceService()
