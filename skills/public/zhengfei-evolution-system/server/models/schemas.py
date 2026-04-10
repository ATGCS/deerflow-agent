# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 数据模型
"""

from datetime import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from enum import Enum


class MemoryCategory(str, Enum):
    IDENTITY = "identity"
    PREFERENCE = "preference"
    BEHAVIOR = "behavior"
    KNOWLEDGE = "knowledge"
    RELATIONSHIP = "relationship"
    GOAL = "goal"
    CONTEXT = "context"
    SKILL = "skill"
    PROJECT = "project"
    TEMPORAL = "temporal"


class MemoryImportance(int, Enum):
    CRITICAL = 5
    HIGH = 4
    MEDIUM = 3
    LOW = 2
    TRIVIAL = 1


class MemoryAddRequest(BaseModel):
    text: str
    confidence: float = 0.8
    source: str = "conversation"
    category: Optional[str] = None
    importance: Optional[int] = 3
    tags: Optional[List[str]] = []
    ttl_days: Optional[int] = None


class MemorySearchRequest(BaseModel):
    query: str
    top_k: int = 10
    categories: Optional[List[str]] = None
    min_importance: Optional[int] = None
    min_confidence: float = 0.0


class MemoryResponse(BaseModel):
    id: str
    text: str
    category: str
    importance: int
    confidence: float
    source: str
    created_at: str
    tags: List[str]


class MemoryStatsResponse(BaseModel):
    total_memories: int
    total_relations: int
    by_category: Dict[str, int]
    by_importance: Dict[str, int]
    last_extraction: Optional[str]
    last_cleanup: Optional[str]


class InferenceRequest(BaseModel):
    query: str
    max_depth: int = 3


class InferenceResponse(BaseModel):
    conclusion: str
    confidence: float
    reasoning_path: List[str]
    evidence: List[str]


class EmotionAnalyzeRequest(BaseModel):
    text: str


class EmotionResponse(BaseModel):
    emotion_type: str
    intensity: str
    confidence: float
    valence: float
    triggers: List[str]


class EvolutionTriggerRequest(BaseModel):
    skill_name: str
    execution_result: str
    user_text: Optional[str] = None
    assistant_text: Optional[str] = None
    guard_level: str = "standard"


class EvolutionFeedbackRequest(BaseModel):
    memory_text: str
    feedback_type: str
    category: Optional[str] = None
    importance: Optional[int] = None


class CapabilityMatchRequest(BaseModel):
    task_description: str


class CapabilityResponse(BaseModel):
    capability_id: str
    capability_name: str
    match_score: float
    matched_conditions: List[str]
    suggested_actions: List[str]


class SkillContextResponse(BaseModel):
    skill_name: str
    user_style: Optional[str]
    user_preferences: List[Dict[str, Any]]
    relevant_memories: List[Dict[str, Any]]
    context_summary: str


class ApiResponse(BaseModel):
    success: bool = True
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
