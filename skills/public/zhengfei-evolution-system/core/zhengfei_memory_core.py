# -*- coding: utf-8 -*-
"""
正飞记忆核心系统 V4.0 - 特殊强大的记忆系统
整合记忆分类、关联图谱、重要性评估、智能检索
正飞信息技术出品
"""

import os
import json
import re
import uuid
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple, Set
from dataclasses import dataclass, asdict, field
from enum import Enum
from collections import defaultdict
import math


class MemoryCategory(Enum):
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


class MemoryImportance(Enum):
    CRITICAL = 5
    HIGH = 4
    MEDIUM = 3
    LOW = 2
    TRIVIAL = 1


class MemoryRelationType(Enum):
    SIMILAR = "similar"
    CONTRADICTS = "contradicts"
    SUPERSEDES = "supersedes"
    DEPENDS_ON = "depends_on"
    RELATED_TO = "related_to"
    PART_OF = "part_of"
    CAUSES = "causes"
    FOLLOWS = "follows"


@dataclass
class MemoryRelation:
    source_id: str
    target_id: str
    relation_type: MemoryRelationType
    weight: float
    created_at: str
    evidence: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            'source_id': self.source_id,
            'target_id': self.target_id,
            'relation_type': self.relation_type.value,
            'weight': self.weight,
            'created_at': self.created_at,
            'evidence': self.evidence
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MemoryRelation':
        return cls(
            source_id=data['source_id'],
            target_id=data['target_id'],
            relation_type=MemoryRelationType(data['relation_type']),
            weight=data.get('weight', 1.0),
            created_at=data.get('created_at', datetime.now().isoformat()),
            evidence=data.get('evidence', '')
        )


@dataclass
class MemoryVersion:
    version: int
    text: str
    modified_at: str
    modification_reason: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MemoryVersion':
        return cls(**data)


@dataclass
class EnhancedMemory:
    id: str
    text: str
    normalized_text: str
    text_hash: str
    
    category: MemoryCategory
    importance: MemoryImportance
    base_confidence: float
    current_confidence: float
    
    source: str
    extraction_method: str
    is_explicit: bool
    
    created_at: str
    last_accessed: str
    last_modified: str
    access_count: int
    
    expires_at: Optional[str]
    ttl_days: Optional[int]
    
    tags: List[str]
    entities: List[str]
    keywords: List[str]
    
    embedding_hash: Optional[str]
    
    version: int
    history: List[MemoryVersion]
    
    parent_id: Optional[str]
    child_ids: List[str]
    
    metadata: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'text': self.text,
            'normalized_text': self.normalized_text,
            'text_hash': self.text_hash,
            'category': self.category.value,
            'importance': self.importance.value,
            'base_confidence': self.base_confidence,
            'current_confidence': self.current_confidence,
            'source': self.source,
            'extraction_method': self.extraction_method,
            'is_explicit': self.is_explicit,
            'created_at': self.created_at,
            'last_accessed': self.last_accessed,
            'last_modified': self.last_modified,
            'access_count': self.access_count,
            'expires_at': self.expires_at,
            'ttl_days': self.ttl_days,
            'tags': self.tags,
            'entities': self.entities,
            'keywords': self.keywords,
            'embedding_hash': self.embedding_hash,
            'version': self.version,
            'history': [h.to_dict() for h in self.history],
            'parent_id': self.parent_id,
            'child_ids': self.child_ids,
            'metadata': self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EnhancedMemory':
        history = [MemoryVersion.from_dict(h) for h in data.get('history', [])]
        return cls(
            id=data.get('id', str(uuid.uuid4())),
            text=data.get('text', ''),
            normalized_text=data.get('normalized_text', ''),
            text_hash=data.get('text_hash', ''),
            category=MemoryCategory(data.get('category', 'context')),
            importance=MemoryImportance(data.get('importance', 3)),
            base_confidence=data.get('base_confidence', 0.5),
            current_confidence=data.get('current_confidence', 0.5),
            source=data.get('source', 'unknown'),
            extraction_method=data.get('extraction_method', 'unknown'),
            is_explicit=data.get('is_explicit', False),
            created_at=data.get('created_at', datetime.now().isoformat()),
            last_accessed=data.get('last_accessed', datetime.now().isoformat()),
            last_modified=data.get('last_modified', datetime.now().isoformat()),
            access_count=data.get('access_count', 0),
            expires_at=data.get('expires_at'),
            ttl_days=data.get('ttl_days'),
            tags=data.get('tags', []),
            entities=data.get('entities', []),
            keywords=data.get('keywords', []),
            embedding_hash=data.get('embedding_hash'),
            version=data.get('version', 1),
            history=history,
            parent_id=data.get('parent_id'),
            child_ids=data.get('child_ids', []),
            metadata=data.get('metadata', {})
        )


CATEGORY_PATTERNS = {
    MemoryCategory.IDENTITY: [
        r'(我叫|我是|我的名字|我名字|姓名|名字叫|我来自|我住在|我的职业|我是做|\bmy\s+name\s+is\b|\bi\s+am\b|\bi[\'’]?m\b|\bi\s+live\s+in\b|\bi\s+work\s+as\b)',
    ],
    MemoryCategory.PREFERENCE: [
        r'(我喜欢|我偏好|我习惯|我常用|我不喜欢|我讨厌|我更喜欢|以后请|默认|优先|\bi\s+prefer\b|\bi\s+like\b|\bi\s+usually\b|\bi\s+don[\'’]?\s*t\s+like\b|\bi\s+hate\b)',
    ],
    MemoryCategory.BEHAVIOR: [
        r'(我总是|我经常|我通常|我一般|我习惯于|我的做法|\bi\s+always\b|\bi\s+often\b|\bi\s+usually\b)',
    ],
    MemoryCategory.KNOWLEDGE: [
        r'(我知道|我了解|我学过|我会|我掌握|我的专业|\bi\s+know\b|\bi\s+learned\b|\bi\s+studied\b)',
    ],
    MemoryCategory.RELATIONSHIP: [
        r'(我的|我有|我养了|我家有|我女儿|我儿子|我的孩子|我的小狗|我的小猫|我的朋友|我的同事|\bmy\s+(?:daughter|son|child|dog|cat|friend|colleague)\b)',
    ],
    MemoryCategory.GOAL: [
        r'(我的目标|我想|我希望|我计划|我打算|我要|我正在|我将要|\bmy\s+goal\b|\bi\s+want\s+to\b|\bi\s+plan\s+to\b|\bi\s+will\b)',
    ],
    MemoryCategory.SKILL: [
        r'(我会|我擅长|我精通|我熟练|我的技能|\bi\s+can\b|\bi\s+am\s+good\s+at\b|\bi\s+mastered\b)',
    ],
    MemoryCategory.PROJECT: [
        r'(项目|工程|开发|正在做|正在开发|我的项目|\bproject\b|\bdeveloping\b|\bworking\s+on\b)',
    ],
    MemoryCategory.TEMPORAL: [
        r'(今天|昨天|明天|本周|下周|这个月|下个月|今年|明年|\btoday\b|\byesterday\b|\btomorrow\b|\bthis\s+week\b|\bnext\s+month\b)',
    ],
}

IMPORTANCE_PATTERNS = {
    MemoryImportance.CRITICAL: [
        r'(必须|一定要|绝对|关键|核心|重要|紧急|\bmust\b|\bcritical\b|\bessential\b|\burgent\b)',
    ],
    MemoryImportance.HIGH: [
        r'(很重要|比较重要|优先|首选|主要|\bimportant\b|\bpriority\b|\bprimary\b)',
    ],
    MemoryImportance.LOW: [
        r'(可能|也许|大概|偶尔|有时|\bmaybe\b|\bsometimes\b|\boccasionally\b)',
    ],
    MemoryImportance.TRIVIAL: [
        r'(顺便|随便|随意|不太重要|\bjust\b|\bminor\b|\btrivial\b)',
    ],
}


def normalize_text(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip().lower()


def compute_text_hash(text: str) -> str:
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:16]


def extract_keywords(text: str) -> List[str]:
    chinese_words = re.findall(r'[\u4e00-\u9fa5]+', text)
    english_words = re.findall(r'[a-zA-Z]+', text)
    
    keywords = []
    for word in chinese_words:
        if len(word) >= 2:
            keywords.append(word)
    for word in english_words:
        if len(word) >= 3:
            keywords.append(word.lower())
    
    return list(set(keywords))


def extract_entities(text: str) -> List[str]:
    entities = []
    
    name_patterns = [
        r'(?:我叫|我是|我的名字是|名字叫)\s*([^\s，。！？,]+)',
        r'(?:项目名|项目名称)\s*[是为：:]\s*([^\s，。！？,]+)',
    ]
    
    for pattern in name_patterns:
        matches = re.findall(pattern, text)
        entities.extend(matches)
    
    tech_patterns = [
        r'\b(TypeScript|JavaScript|Python|React|Vue|Node\.js|Electron|Java|Go|Rust)\b',
        r'\b(Windows|Linux|macOS|Android|iOS)\b',
    ]
    
    for pattern in tech_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        entities.extend([m for m in matches])
    
    return list(set(entities))


def classify_memory(text: str) -> MemoryCategory:
    text_lower = text.lower()
    
    scores = {}
    for category, patterns in CATEGORY_PATTERNS.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                score += 1
        scores[category] = score
    
    max_score = max(scores.values()) if scores else 0
    if max_score == 0:
        return MemoryCategory.CONTEXT
    
    for category, score in scores.items():
        if score == max_score:
            return category
    
    return MemoryCategory.CONTEXT


def assess_importance(text: str, is_explicit: bool, confidence: float) -> MemoryImportance:
    if is_explicit and confidence >= 0.9:
        return MemoryImportance.HIGH
    
    text_lower = text.lower()
    
    for importance, patterns in IMPORTANCE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return importance
    
    if confidence >= 0.9:
        return MemoryImportance.HIGH
    elif confidence >= 0.75:
        return MemoryImportance.MEDIUM
    elif confidence >= 0.6:
        return MemoryImportance.LOW
    else:
        return MemoryImportance.TRIVIAL


def calculate_confidence_decay(
    base_confidence: float,
    created_at: str,
    access_count: int,
    importance: MemoryImportance,
    decay_rate: float = 0.01
) -> float:
    try:
        created = datetime.fromisoformat(created_at)
        days_elapsed = (datetime.now() - created).days
    except ValueError:
        days_elapsed = 0
    
    importance_factor = importance.value / 5.0
    
    access_factor = min(1.0, 1.0 + access_count * 0.05)
    
    decay = math.exp(-decay_rate * days_elapsed * (1 - importance_factor))
    
    current_confidence = base_confidence * decay * access_factor
    
    return max(0.1, min(1.0, current_confidence))


class MemoryGraph:
    def __init__(self):
        self.nodes: Dict[str, EnhancedMemory] = {}
        self.edges: Dict[str, List[MemoryRelation]] = defaultdict(list)
        self.reverse_edges: Dict[str, List[MemoryRelation]] = defaultdict(list)
    
    def add_memory(self, memory: EnhancedMemory) -> None:
        self.nodes[memory.id] = memory
    
    def remove_memory(self, memory_id: str) -> None:
        if memory_id in self.nodes:
            del self.nodes[memory_id]
        
        if memory_id in self.edges:
            for relation in self.edges[memory_id]:
                if relation.target_id in self.reverse_edges:
                    self.reverse_edges[relation.target_id] = [
                        r for r in self.reverse_edges[relation.target_id]
                        if r.source_id != memory_id
                    ]
            del self.edges[memory_id]
        
        if memory_id in self.reverse_edges:
            for relation in self.reverse_edges[memory_id]:
                if relation.source_id in self.edges:
                    self.edges[relation.source_id] = [
                        r for r in self.edges[relation.source_id]
                        if r.target_id != memory_id
                    ]
            del self.reverse_edges[memory_id]
    
    def add_relation(self, relation: MemoryRelation) -> None:
        self.edges[relation.source_id].append(relation)
        self.reverse_edges[relation.target_id].append(relation)
    
    def get_related_memories(
        self,
        memory_id: str,
        relation_types: Optional[List[MemoryRelationType]] = None,
        max_depth: int = 2
    ) -> List[Tuple[EnhancedMemory, int, MemoryRelation]]:
        result: List[Tuple[EnhancedMemory, int, MemoryRelation]] = []
        visited: Set[str] = {memory_id}
        queue: List[Tuple[str, int, Optional[MemoryRelation]]] = [(memory_id, 0, None)]
        
        while queue:
            current_id, depth, incoming_relation = queue.pop(0)
            
            if depth > 0 and current_id in self.nodes:
                memory = self.nodes[current_id]
                if incoming_relation:
                    result.append((memory, depth, incoming_relation))
            
            if depth < max_depth:
                for relation in self.edges.get(current_id, []):
                    if relation_types and relation.relation_type not in relation_types:
                        continue
                    if relation.target_id not in visited:
                        visited.add(relation.target_id)
                        queue.append((relation.target_id, depth + 1, relation))
                
                for relation in self.reverse_edges.get(current_id, []):
                    if relation_types and relation.relation_type not in relation_types:
                        continue
                    if relation.source_id not in visited:
                        visited.add(relation.source_id)
                        queue.append((relation.source_id, depth + 1, relation))
        
        return result
    
    def find_similar_memories(
        self,
        memory: EnhancedMemory,
        similarity_threshold: float = 0.5
    ) -> List[Tuple[EnhancedMemory, float]]:
        similar: List[Tuple[EnhancedMemory, float]] = []
        
        memory_keywords = set(memory.keywords)
        
        for other_id, other in self.nodes.items():
            if other_id == memory.id:
                continue
            
            other_keywords = set(other.keywords)
            
            if not memory_keywords or not other_keywords:
                continue
            
            intersection = memory_keywords & other_keywords
            union = memory_keywords | other_keywords
            
            jaccard = len(intersection) / len(union) if union else 0
            
            if jaccard >= similarity_threshold:
                similar.append((other, jaccard))
        
        similar.sort(key=lambda x: x[1], reverse=True)
        return similar
    
    def to_dict(self) -> Dict[str, Any]:
        relations = []
        for source_id, rels in self.edges.items():
            relations.extend([r.to_dict() for r in rels])
        
        return {
            'nodes': {mid: m.to_dict() for mid, m in self.nodes.items()},
            'relations': relations
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MemoryGraph':
        graph = cls()
        
        for mid, mdata in data.get('nodes', {}).items():
            graph.nodes[mid] = EnhancedMemory.from_dict(mdata)
        
        for rdata in data.get('relations', []):
            relation = MemoryRelation.from_dict(rdata)
            graph.edges[relation.source_id].append(relation)
            graph.reverse_edges[relation.target_id].append(relation)
        
        return graph


class EnhancedMemoryManager:
    def __init__(self, memory_dir: Optional[str] = None):
        if memory_dir:
            self.memory_dir = memory_dir
        else:
            self.memory_dir = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "zhengfei-memory"
            )
        
        self.index_path = os.path.join(self.memory_dir, "enhanced-index.json")
        self.profile_path = os.path.join(self.memory_dir, "enhanced-profile.json")
        self.graph_path = os.path.join(self.memory_dir, "memory-graph.json")
        
        self.graph = MemoryGraph()
        self.profile_data: Dict[str, Any] = {}
        
        self._ensure_directories()
        self._load_data()
    
    def _ensure_directories(self) -> None:
        if not os.path.exists(self.memory_dir):
            os.makedirs(self.memory_dir, exist_ok=True)
        
        if not os.path.exists(self.index_path):
            self._create_default_index()
        
        if not os.path.exists(self.profile_path):
            self._create_default_profile()
    
    def _create_default_index(self) -> None:
        default = {
            "version": "4.0",
            "system": "正飞记忆核心系统 V4.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "statistics": {
                "total_memories": 0,
                "by_category": {},
                "by_importance": {},
                "total_relations": 0,
                "total_contradictions_resolved": 0,
                "last_extraction": None,
                "last_cleanup": None,
                "last_decay_update": None
            }
        }
        with open(self.index_path, 'w', encoding='utf-8') as f:
            json.dump(default, f, ensure_ascii=False, indent=2)
    
    def _create_default_profile(self) -> None:
        default = {
            "version": "4.0",
            "system": "正飞记忆核心系统 V4.0",
            "static": {
                "identity": [],
                "preferences": [],
                "skills": [],
                "relationships": []
            },
            "dynamic": {
                "recent_activities": [],
                "current_goals": [],
                "active_projects": []
            },
            "updated_at": datetime.now().isoformat()
        }
        with open(self.profile_path, 'w', encoding='utf-8') as f:
            json.dump(default, f, ensure_ascii=False, indent=2)
    
    def _load_data(self) -> None:
        with open(self.index_path, 'r', encoding='utf-8') as f:
            self.index_data = json.load(f)
        
        with open(self.profile_path, 'r', encoding='utf-8') as f:
            self.profile_data = json.load(f)
        
        if os.path.exists(self.graph_path):
            with open(self.graph_path, 'r', encoding='utf-8') as f:
                graph_data = json.load(f)
            self.graph = MemoryGraph.from_dict(graph_data)
    
    def _save_index(self) -> None:
        self.index_data['updated_at'] = datetime.now().isoformat()
        self._update_statistics()
        with open(self.index_path, 'w', encoding='utf-8') as f:
            json.dump(self.index_data, f, ensure_ascii=False, indent=2)
    
    def _save_profile(self) -> None:
        self.profile_data['updated_at'] = datetime.now().isoformat()
        with open(self.profile_path, 'w', encoding='utf-8') as f:
            json.dump(self.profile_data, f, ensure_ascii=False, indent=2)
    
    def _save_graph(self) -> None:
        with open(self.graph_path, 'w', encoding='utf-8') as f:
            json.dump(self.graph.to_dict(), f, ensure_ascii=False, indent=2)
    
    def _update_statistics(self) -> None:
        stats = self.index_data['statistics']
        stats['total_memories'] = len(self.graph.nodes)
        
        by_category: Dict[str, int] = defaultdict(int)
        by_importance: Dict[str, int] = defaultdict(int)
        
        for memory in self.graph.nodes.values():
            by_category[memory.category.value] += 1
            by_importance[memory.importance.value] += 1
        
        stats['by_category'] = dict(by_category)
        stats['by_importance'] = dict(by_importance)
        
        total_relations = sum(len(rels) for rels in self.graph.edges.values())
        stats['total_relations'] = total_relations
    
    def add_memory(
        self,
        text: str,
        confidence: float = 0.8,
        source: str = "conversation",
        extraction_method: str = "implicit",
        is_explicit: bool = False,
        tags: Optional[List[str]] = None,
        ttl_days: Optional[int] = None,
        parent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> EnhancedMemory:
        now = datetime.now()
        
        normalized = normalize_text(text)
        text_hash = compute_text_hash(text)
        
        category = classify_memory(text)
        importance = assess_importance(text, is_explicit, confidence)
        
        keywords = extract_keywords(text)
        entities = extract_entities(text)
        
        expires_at = None
        if ttl_days:
            expires_at = (now + timedelta(days=ttl_days)).isoformat()
        
        memory = EnhancedMemory(
            id=f"MEM-{uuid.uuid4().hex[:8].upper()}",
            text=text,
            normalized_text=normalized,
            text_hash=text_hash,
            category=category,
            importance=importance,
            base_confidence=confidence,
            current_confidence=confidence,
            source=source,
            extraction_method=extraction_method,
            is_explicit=is_explicit,
            created_at=now.isoformat(),
            last_accessed=now.isoformat(),
            last_modified=now.isoformat(),
            access_count=0,
            expires_at=expires_at,
            ttl_days=ttl_days,
            tags=tags or [],
            entities=entities,
            keywords=keywords,
            embedding_hash=None,
            version=1,
            history=[],
            parent_id=parent_id,
            child_ids=[],
            metadata=metadata or {}
        )
        
        contradiction = self._check_contradiction(memory)
        if contradiction:
            self._resolve_contradiction(contradiction, memory)
        else:
            self.graph.add_memory(memory)
            self._auto_link_memory(memory)
        
        self._update_profile_from_memory(memory)
        
        self._save_index()
        self._save_graph()
        self._save_profile()
        
        return memory
    
    def _check_contradiction(self, new_memory: EnhancedMemory) -> Optional[EnhancedMemory]:
        for memory in self.graph.nodes.values():
            if memory.id == new_memory.id:
                continue
            
            if self._is_contradictory(new_memory.text, memory.text):
                if new_memory.category == memory.category:
                    return memory
        
        return None
    
    def _is_contradictory(self, text1: str, text2: str) -> bool:
        contradiction_patterns = [
            (r'喜欢|偏好|习惯|常用', r'不喜欢|讨厌|不用'),
            (r'是|叫|名为', r'不是|不叫|不名为'),
            (r'有|拥有', r'没有|无'),
            (r'使用|用|采用', r'不使用|不用|不采用'),
            (r'会|能|可以', r'不会|不能|不可以'),
        ]
        
        text1_lower = text1.lower()
        text2_lower = text2.lower()
        
        for positive, negative in contradiction_patterns:
            pos_re = re.compile(positive)
            neg_re = re.compile(negative)
            
            text1_has_pos = pos_re.search(text1_lower) and not neg_re.search(text1_lower)
            text1_has_neg = neg_re.search(text1_lower)
            text2_has_pos = pos_re.search(text2_lower) and not neg_re.search(text2_lower)
            text2_has_neg = neg_re.search(text2_lower)
            
            if (text1_has_pos and text2_has_neg) or (text1_has_neg and text2_has_pos):
                if self._same_topic(text1_lower, text2_lower):
                    return True
        
        return False
    
    def _same_topic(self, text1: str, text2: str) -> bool:
        words1 = set(re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', text1))
        words2 = set(re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', text2))
        
        common = words1 & words2
        return len(common) >= 2
    
    def _resolve_contradiction(
        self,
        old_memory: EnhancedMemory,
        new_memory: EnhancedMemory
    ) -> None:
        relation = MemoryRelation(
            source_id=new_memory.id,
            target_id=old_memory.id,
            relation_type=MemoryRelationType.SUPERSEDES,
            weight=1.0,
            created_at=datetime.now().isoformat(),
            evidence="newer_evidence_overrides"
        )

        self.graph.add_memory(new_memory)
        self.graph.add_relation(relation)

        self.graph.remove_memory(old_memory.id)

        self.index_data['statistics']['total_contradictions_resolved'] = \
            self.index_data['statistics'].get('total_contradictions_resolved', 0) + 1

        if 'contradictions_resolved' not in self.index_data:
            self.index_data['contradictions_resolved'] = []
        
        self.index_data['contradictions_resolved'].append({
            'old_text': old_memory.text,
            'new_text': new_memory.text,
            'old_id': old_memory.id,
            'new_id': new_memory.id,
            'resolved_at': datetime.now().isoformat(),
            'reason': 'newer_evidence_overrides',
            'category': new_memory.category.value
        })

    def detect_potential_conflicts(self, text: str) -> List[Dict[str, Any]]:
        """
        检测潜在的记忆冲突，返回可能冲突的记忆列表
        
        :param text: 待检测的文本
        :return: 冲突记忆列表
        """
        conflicts = []
        text_lower = text.lower()
        
        for memory in self.graph.nodes.values():
            if self._is_contradictory(text, memory.text):
                conflicts.append({
                    'memory_id': memory.id,
                    'text': memory.text,
                    'category': memory.category.value,
                    'importance': memory.importance.value,
                    'confidence': memory.current_confidence,
                    'created_at': memory.created_at,
                    'conflict_type': self._get_conflict_type(text, memory.text)
                })
        
        return conflicts

    def _get_conflict_type(self, text1: str, text2: str) -> str:
        """判断冲突类型"""
        patterns = {
            'preference': (r'喜欢|偏好|习惯|常用', r'不喜欢|讨厌|不用'),
            'identity': (r'是|叫|名为', r'不是|不叫|不名为'),
            'possession': (r'有|拥有', r'没有|无'),
            'usage': (r'使用|用|采用', r'不使用|不用|不采用'),
            'ability': (r'会|能|可以', r'不会|不能|不可以'),
        }
        
        text1_lower = text1.lower()
        text2_lower = text2.lower()
        
        for conflict_type, (positive, negative) in patterns.items():
            pos_re = re.compile(positive)
            neg_re = re.compile(negative)
            
            text1_has_pos = pos_re.search(text1_lower) and not neg_re.search(text1_lower)
            text1_has_neg = neg_re.search(text1_lower)
            text2_has_pos = pos_re.search(text2_lower) and not neg_re.search(text2_lower)
            text2_has_neg = neg_re.search(text2_lower)
            
            if (text1_has_pos and text2_has_neg) or (text1_has_neg and text2_has_pos):
                return conflict_type
        
        return 'unknown'

    def get_conflict_resolution_suggestion(
        self,
        new_text: str,
        conflicting_memory: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        获取冲突解决建议
        
        :param new_text: 新记忆文本
        :param conflicting_memory: 冲突的记忆
        :return: 解决建议
        """
        conflict_type = conflicting_memory.get('conflict_type', 'unknown')
        
        suggestions = {
            'preference': {
                'action': 'update',
                'reason': '用户偏好可能已改变，建议用新偏好覆盖旧偏好',
                'priority': 'high'
            },
            'identity': {
                'action': 'update',
                'reason': '身份信息冲突，建议以最新信息为准',
                'priority': 'critical'
            },
            'possession': {
                'action': 'update',
                'reason': '所有权状态变化，建议更新为当前状态',
                'priority': 'medium'
            },
            'usage': {
                'action': 'update',
                'reason': '使用习惯变化，建议更新为最新习惯',
                'priority': 'medium'
            },
            'ability': {
                'action': 'merge',
                'reason': '能力描述可能需要合并或更新',
                'priority': 'low'
            }
        }
        
        suggestion = suggestions.get(conflict_type, {
            'action': 'ask',
            'reason': '未知冲突类型，需要用户确认',
            'priority': 'medium'
        })
        
        return {
            'conflict_type': conflict_type,
            'suggestion': suggestion,
            'old_memory': conflicting_memory,
            'new_text': new_text,
            'recommended_action': suggestion['action']
        }
    
    def _auto_link_memory(self, memory: EnhancedMemory) -> None:
        similar = self.graph.find_similar_memories(memory, similarity_threshold=0.3)
        
        for other, similarity in similar[:5]:
            relation = MemoryRelation(
                source_id=memory.id,
                target_id=other.id,
                relation_type=MemoryRelationType.SIMILAR,
                weight=similarity,
                created_at=datetime.now().isoformat(),
                evidence="auto_similarity_detection"
            )
            self.graph.add_relation(relation)
        
        if memory.parent_id and memory.parent_id in self.graph.nodes:
            relation = MemoryRelation(
                source_id=memory.id,
                target_id=memory.parent_id,
                relation_type=MemoryRelationType.PART_OF,
                weight=1.0,
                created_at=datetime.now().isoformat(),
                evidence="explicit_parent_link"
            )
            self.graph.add_relation(relation)
            
            parent = self.graph.nodes[memory.parent_id]
            if memory.id not in parent.child_ids:
                parent.child_ids.append(memory.id)
    
    def _update_profile_from_memory(self, memory: EnhancedMemory) -> None:
        if memory.category == MemoryCategory.IDENTITY:
            self._add_to_profile_section('static', 'identity', memory)
        elif memory.category == MemoryCategory.PREFERENCE:
            self._add_to_profile_section('static', 'preferences', memory)
        elif memory.category == MemoryCategory.SKILL:
            self._add_to_profile_section('static', 'skills', memory)
        elif memory.category == MemoryCategory.RELATIONSHIP:
            self._add_to_profile_section('static', 'relationships', memory)
        elif memory.category == MemoryCategory.GOAL:
            self._add_to_profile_section('dynamic', 'current_goals', memory)
        elif memory.category == MemoryCategory.PROJECT:
            self._add_to_profile_section('dynamic', 'active_projects', memory)
    
    def _add_to_profile_section(
        self,
        profile_type: str,
        section: str,
        memory: EnhancedMemory
    ) -> None:
        if profile_type not in self.profile_data:
            return
        if section not in self.profile_data[profile_type]:
            return
        
        existing_texts = [
            item.get('text', '').lower()
            for item in self.profile_data[profile_type][section]
        ]
        
        if memory.text.lower() not in existing_texts:
            self.profile_data[profile_type][section].append({
                'text': memory.text,
                'memory_id': memory.id,
                'confidence': memory.current_confidence,
                'importance': memory.importance.value,
                'created_at': memory.created_at
            })
    
    def get_memory(self, memory_id: str) -> Optional[EnhancedMemory]:
        memory = self.graph.nodes.get(memory_id)
        if memory:
            memory.last_accessed = datetime.now().isoformat()
            memory.access_count += 1
            self._save_graph()
        return memory
    
    def update_memory(
        self,
        memory_id: str,
        new_text: Optional[str] = None,
        new_tags: Optional[List[str]] = None,
        new_importance: Optional[MemoryImportance] = None,
        modification_reason: str = "user_update"
    ) -> Optional[EnhancedMemory]:
        memory = self.graph.nodes.get(memory_id)
        if not memory:
            return None
        
        if new_text and new_text != memory.text:
            version = MemoryVersion(
                version=memory.version,
                text=memory.text,
                modified_at=datetime.now().isoformat(),
                modification_reason=modification_reason
            )
            memory.history.append(version)
            
            memory.text = new_text
            memory.normalized_text = normalize_text(new_text)
            memory.text_hash = compute_text_hash(new_text)
            memory.keywords = extract_keywords(new_text)
            memory.entities = extract_entities(new_text)
            memory.version += 1
        
        if new_tags is not None:
            memory.tags = new_tags
        
        if new_importance is not None:
            memory.importance = new_importance
        
        memory.last_modified = datetime.now().isoformat()
        
        self._save_index()
        self._save_graph()
        
        return memory
    
    def delete_memory(self, memory_id: str) -> bool:
        if memory_id not in self.graph.nodes:
            return False
        
        self.graph.remove_memory(memory_id)
        
        self._save_index()
        self._save_graph()
        
        return True
    
    def delete_memory_by_text(self, text: str) -> int:
        text_lower = text.lower()
        to_delete = []
        
        for memory_id, memory in self.graph.nodes.items():
            if text_lower in memory.text.lower():
                to_delete.append(memory_id)
        
        for memory_id in to_delete:
            self.graph.remove_memory(memory_id)
        
        if to_delete:
            self._save_index()
            self._save_graph()
        
        return len(to_delete)
    
    def search(
        self,
        query: str,
        top_k: int = 10,
        categories: Optional[List[MemoryCategory]] = None,
        min_importance: Optional[MemoryImportance] = None,
        min_confidence: float = 0.0,
        include_relations: bool = False
    ) -> List[Dict[str, Any]]:
        query_terms = set(extract_keywords(query))
        
        if not query_terms:
            return []
        
        results: List[Tuple[float, EnhancedMemory]] = []
        
        for memory in self.graph.nodes.values():
            if categories and memory.category not in categories:
                continue
            if min_importance and memory.importance.value < min_importance.value:
                continue
            if memory.current_confidence < min_confidence:
                continue
            
            memory_keywords = set(memory.keywords)
            matching = query_terms & memory_keywords
            
            if not matching:
                continue
            
            coverage = len(matching) / len(query_terms)
            keyword_score = len(matching) / len(memory_keywords) if memory_keywords else 0
            
            importance_boost = memory.importance.value / 5.0
            confidence_boost = memory.current_confidence
            
            score = coverage * 0.4 + keyword_score * 0.3 + importance_boost * 0.15 + confidence_boost * 0.15
            
            results.append((score, memory))
        
        results.sort(key=lambda x: x[0], reverse=True)
        
        output = []
        for score, memory in results[:top_k]:
            item = memory.to_dict()
            item['search_score'] = score
            
            if include_relations:
                related = self.graph.get_related_memories(memory.id, max_depth=1)
                item['related_memories'] = [
                    {'id': r.id, 'text': r.text, 'relation': rel.relation_type.value}
                    for r, _, rel in related[:3]
                ]
            
            output.append(item)
        
        return output
    
    def get_context_for_task(
        self,
        task_description: str,
        max_memories: int = 10,
        max_tokens: int = 2000
    ) -> str:
        results = self.search(task_description, top_k=max_memories * 2)
        
        if not results:
            return self._get_default_context()
        
        context_parts = ["## 用户上下文\n"]
        
        identity_memories = [r for r in results if r.get('category') == 'identity'][:2]
        if identity_memories:
            context_parts.append("### 用户身份")
            for m in identity_memories:
                context_parts.append(f"- {m['text']}")
        
        preference_memories = [r for r in results if r.get('category') == 'preference'][:3]
        if preference_memories:
            context_parts.append("\n### 用户偏好")
            for m in preference_memories:
                context_parts.append(f"- {m['text']}")
        
        other_memories = [
            r for r in results
            if r.get('category') not in ('identity', 'preference')
        ][:max_memories - len(identity_memories) - len(preference_memories)]
        
        if other_memories:
            context_parts.append("\n### 相关记忆")
            for m in other_memories:
                context_parts.append(f"- {m['text']}")
        
        context = '\n'.join(context_parts)
        
        if len(context) > max_tokens:
            context = context[:max_tokens] + "..."
        
        return context
    
    def _get_default_context(self) -> str:
        context_parts = ["## 用户上下文\n"]
        
        static = self.profile_data.get('static', {})
        dynamic = self.profile_data.get('dynamic', {})
        
        identities = static.get('identity', [])
        if identities:
            context_parts.append("### 用户身份")
            for item in identities[:3]:
                context_parts.append(f"- {item['text']}")
        
        preferences = static.get('preferences', [])
        if preferences:
            context_parts.append("\n### 用户偏好")
            for item in preferences[:3]:
                context_parts.append(f"- {item['text']}")
        
        goals = dynamic.get('current_goals', [])
        if goals:
            context_parts.append("\n### 当前目标")
            for item in goals[:2]:
                context_parts.append(f"- {item['text']}")
        
        return '\n'.join(context_parts)
    
    def update_confidence_decay(self) -> int:
        updated_count = 0
        
        for memory in self.graph.nodes.values():
            old_confidence = memory.current_confidence
            memory.current_confidence = calculate_confidence_decay(
                memory.base_confidence,
                memory.created_at,
                memory.access_count,
                memory.importance
            )
            
            if abs(old_confidence - memory.current_confidence) > 0.01:
                updated_count += 1
        
        self.index_data['statistics']['last_decay_update'] = datetime.now().isoformat()
        
        self._save_index()
        self._save_graph()
        
        return updated_count
    
    def cleanup_expired_memories(self) -> int:
        now = datetime.now()
        expired_ids = []
        
        for memory_id, memory in self.graph.nodes.items():
            if memory.expires_at:
                try:
                    expires_at = datetime.fromisoformat(memory.expires_at)
                    if expires_at < now:
                        expired_ids.append(memory_id)
                except ValueError:
                    pass
            
            if memory.current_confidence < 0.1:
                expired_ids.append(memory_id)
        
        for memory_id in expired_ids:
            self.graph.remove_memory(memory_id)
        
        self.index_data['statistics']['last_cleanup'] = now.isoformat()
        
        self._save_index()
        self._save_graph()
        
        return len(expired_ids)
    
    def get_statistics(self) -> Dict[str, Any]:
        stats = self.index_data.get('statistics', {})
        
        stats['total_memories'] = len(self.graph.nodes)
        stats['total_relations'] = sum(len(rels) for rels in self.graph.edges.values())
        
        return stats
    
    def export_memories(self, format: str = "json") -> str:
        if format == "json":
            data = {
                "version": "4.0",
                "exported_at": datetime.now().isoformat(),
                "memories": [m.to_dict() for m in self.graph.nodes.values()],
                "relations": [r.to_dict() for rels in self.graph.edges.values() for r in rels],
                "profile": self.profile_data
            }
            return json.dumps(data, ensure_ascii=False, indent=2)
        elif format == "markdown":
            lines = ["# 记忆导出\n\n"]
            lines.append(f"导出时间: {datetime.now().isoformat()}\n\n")
            
            lines.append("## 用户画像\n\n")
            static = self.profile_data.get('static', {})
            for section, items in static.items():
                if items:
                    lines.append(f"### {section}\n")
                    for item in items:
                        lines.append(f"- {item['text']}\n")
                    lines.append("\n")
            
            lines.append("## 记忆列表\n\n")
            for memory in self.graph.nodes.values():
                lines.append(f"- [{memory.category.value}] {memory.text}\n")
            
            return ''.join(lines)
        else:
            raise ValueError(f"Unsupported format: {format}")
    
    def import_memories(self, data: str, format: str = "json") -> int:
        if format == "json":
            imported = json.loads(data)
            count = 0
            
            for memory_data in imported.get('memories', []):
                memory = EnhancedMemory.from_dict(memory_data)
                
                if memory.id not in self.graph.nodes:
                    self.graph.add_memory(memory)
                    count += 1
            
            for relation_data in imported.get('relations', []):
                relation = MemoryRelation.from_dict(relation_data)
                self.graph.add_relation(relation)
            
            self._save_index()
            self._save_graph()
            
            return count
        else:
            raise ValueError(f"Unsupported format: {format}")
    
    def sync_to_memory_md(self, memory_md_path: str) -> int:
        existing_lines = set()
        if os.path.exists(memory_md_path):
            try:
                with open(memory_md_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                for line in content.split('\n'):
                    stripped = line.strip()
                    if stripped.startswith('- '):
                        text = stripped[2:].strip()
                        normalized = re.sub(r'\s+', ' ', text.lower())
                        existing_lines.add(normalized)
            except Exception:
                pass

        new_lines = []
        for memory in self.graph.nodes.values():
            if memory.importance.value >= MemoryImportance.MEDIUM.value:
                text = memory.text.strip()
                if not text:
                    continue
                normalized = re.sub(r'\s+', ' ', text.lower())
                if normalized not in existing_lines:
                    new_lines.append(f"- {text}")
                    existing_lines.add(normalized)

        if not new_lines:
            return 0

        header = "# User Memories\n"
        if not os.path.exists(memory_md_path):
            os.makedirs(os.path.dirname(memory_md_path), exist_ok=True)
            with open(memory_md_path, 'w', encoding='utf-8') as f:
                f.write(header)
                f.write('\n')
                for line in new_lines:
                    f.write(line + '\n')
                f.write('\n')
        else:
            with open(memory_md_path, 'a', encoding='utf-8') as f:
                f.write('\n')
                for line in new_lines:
                    f.write(line + '\n')

        return len(new_lines)


if __name__ == "__main__":
    manager = EnhancedMemoryManager()
    
    print("=== 正飞记忆核心系统 V4.0 测试 ===\n")
    
    print("1. 添加记忆...")
    m1 = manager.add_memory(
        "我叫张三，是正飞信息技术的开发者",
        confidence=0.95,
        source="identity",
        is_explicit=True
    )
    print(f"   添加记忆: {m1.id} - {m1.category.value} - {m1.importance.value}")
    
    m2 = manager.add_memory(
        "我喜欢用TypeScript开发，偏好函数式编程风格",
        confidence=0.9,
        source="preference",
        is_explicit=False
    )
    print(f"   添加记忆: {m2.id} - {m2.category.value} - {m2.importance.value}")
    
    print("\n2. 搜索记忆...")
    results = manager.search("TypeScript 开发", top_k=5)
    for r in results:
        print(f"   [{r['category']}] {r['text']} (分数: {r['search_score']:.2f})")
    
    print("\n3. 获取任务上下文...")
    context = manager.get_context_for_task("开发新功能")
    print(context)
    
    print("\n4. 获取统计信息...")
    stats = manager.get_statistics()
    print(f"   总记忆数: {stats['total_memories']}")
    print(f"   总关联数: {stats['total_relations']}")
    print(f"   分类统计: {stats['by_category']}")
