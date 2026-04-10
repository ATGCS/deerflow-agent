# -*- coding: utf-8 -*-
"""
正飞知识图谱引擎 V2.0 - 增强推理能力 + 情绪感知
支持复杂的推理和逻辑判断，具备情绪识别与追踪能力
正飞信息技术出品
"""

import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple, Set
from dataclasses import dataclass, asdict, field
from collections import defaultdict
from enum import Enum

MEMORY_DIR = os.path.dirname(os.path.abspath(__file__))
GRAPH_PATH = os.path.join(MEMORY_DIR, "zhengfei-memory", "knowledge-graph.json")
EMOTION_PATH = os.path.join(MEMORY_DIR, "zhengfei-memory", "emotion-history.json")


class RelationType(Enum):
    IS_A = "is_a"
    HAS_A = "has_a"
    PART_OF = "part_of"
    CAUSES = "causes"
    IMPLIES = "implies"
    CONTRADICTS = "contradicts"
    SIMILAR_TO = "similar_to"
    RELATED_TO = "related_to"
    DEPENDS_ON = "depends_on"
    PRECEDES = "precedes"
    FOLLOWS = "follows"
    LOCATED_AT = "located_at"
    USED_FOR = "used_for"
    CREATED_BY = "created_by"
    BELONGS_TO = "belongs_to"
    FEELS = "feels"
    TRIGGERS_EMOTION = "triggers_emotion"


class EmotionType(Enum):
    JOY = "joy"
    SADNESS = "sadness"
    ANGER = "anger"
    FEAR = "fear"
    SURPRISE = "surprise"
    DISGUST = "disgust"
    TRUST = "trust"
    ANTICIPATION = "anticipation"
    NEUTRAL = "neutral"
    FRUSTRATION = "frustration"
    EXCITEMENT = "excitement"
    ANXIETY = "anxiety"
    SATISFACTION = "satisfaction"
    CONFUSION = "confusion"
    GRATITUDE = "gratitude"


class EmotionIntensity(Enum):
    VERY_LOW = 1
    LOW = 2
    MODERATE = 3
    HIGH = 4
    VERY_HIGH = 5


EMOTION_PATTERNS = {
    EmotionType.JOY: {
        'keywords': [
            '开心', '高兴', '快乐', '幸福', '愉快', '欣喜', '喜悦', '欢乐', '满意', '兴奋',
            '太好了', '棒极了', '太棒了', '好开心', '好高兴', '哈哈', '嘻嘻', '谢谢',
            'happy', 'joy', 'glad', 'pleased', 'delighted', 'wonderful', 'great', 'awesome',
            'love it', 'fantastic', 'amazing', 'thank you', 'thanks', 'lol', 'haha'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.SADNESS: {
        'keywords': [
            '难过', '伤心', '悲伤', '痛苦', '失落', '沮丧', '郁闷', '忧愁', '哀伤', '心痛',
            '不开心', '心情不好', '好难过', '好伤心', '唉', '呜呜', '哭',
            'sad', 'unhappy', 'depressed', 'down', 'upset', 'heartbroken', 'sorrow',
            'miss', 'lonely', 'grief', 'crying', 'tears'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.ANGER: {
        'keywords': [
            '生气', '愤怒', '恼火', '烦躁', '气愤', '火大', '不爽', '讨厌', '恨', '恼怒',
            '真烦', '气死', '可恶', '混蛋', '滚', '闭嘴',
            'angry', 'mad', 'furious', 'annoyed', 'irritated', 'frustrated', 'hate',
            'pissed', 'rage', 'upset', 'damn', 'hell', 'stupid'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.FEAR: {
        'keywords': [
            '害怕', '恐惧', '担心', '焦虑', '紧张', '不安', '惊恐', '惶恐', '忧虑', '胆怯',
            '好怕', '吓死', '可怕', '危险',
            'afraid', 'scared', 'fear', 'worried', 'anxious', 'nervous', 'terrified',
            'panic', 'horror', 'dread', 'scary', 'dangerous'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.SURPRISE: {
        'keywords': [
            '惊讶', '惊奇', '意外', '吃惊', '震惊', '没想到', '居然', '竟然', '天哪', '哇',
            '真的吗', '不会吧', '什么', '啊',
            'surprised', 'shocked', 'amazed', 'astonished', 'unexpected', 'wow',
            'really', 'omg', 'oh my', 'unbelievable', 'incredible'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.DISGUST: {
        'keywords': [
            '恶心', '厌恶', '反感', '讨厌', '嫌弃', '鄙视', '看不惯', '受不了', '烦人',
            'disgusting', 'gross', 'nasty', 'hate', 'repulsive', 'awful', 'terrible',
            'yuck', 'eww', 'sick'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.TRUST: {
        'keywords': [
            '信任', '相信', '信赖', '放心', '安心', '可靠', '靠谱', '肯定', '确定',
            'trust', 'believe', 'confident', 'reliable', 'sure', 'certain', 'safe'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.ANTICIPATION: {
        'keywords': [
            '期待', '盼望', '希望', '想要', '渴望', '憧憬', '向往', '等着', '盼着',
            'excited', 'looking forward', 'expect', 'hope', 'want', 'eager', 'anticipate'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.FRUSTRATION: {
        'keywords': [
            '挫败', '沮丧', '灰心', '气馁', '无奈', '无语', '崩溃', '抓狂', '头疼',
            '搞不定', '太难了', '不行', '失败',
            'frustrated', 'defeated', 'discouraged', 'hopeless', 'stuck', 'give up',
            'can\'t', 'impossible', 'failed', 'annoying'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.EXCITEMENT: {
        'keywords': [
            '激动', '兴奋', '热血', '澎湃', '迫不及待', '跃跃欲试', '激动人心',
            '太期待了', '等不及', '刺激',
            'excited', 'thrilled', 'pumped', 'eager', 'enthusiastic', 'can\'t wait',
            'exhilarating', 'electrifying'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.ANXIETY: {
        'keywords': [
            '焦虑', '焦虑', '担忧', '忐忑', '不安', '心慌', '心神不宁', '坐立不安',
            '压力', '紧张', '烦躁',
            'anxious', 'worried', 'stressed', 'nervous', 'uneasy', 'restless',
            'tense', 'pressure', 'overwhelmed'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.SATISFACTION: {
        'keywords': [
            '满意', '满足', '欣慰', '舒适', '惬意', '舒心', '圆满', '完美',
            '不错', '很好', '成功了', '搞定了',
            'satisfied', 'content', 'pleased', 'fulfilled', 'accomplished', 'done',
            'perfect', 'great', 'nice'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.CONFUSION: {
        'keywords': [
            '困惑', '迷茫', '不解', '疑惑', '糊涂', '搞不懂', '不明白', '什么意思',
            '为什么', '怎么回事', '怎么', '不懂',
            'confused', 'puzzled', 'lost', 'unclear', 'don\'t understand', 'what',
            'why', 'how', 'uncertain', 'clueless'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    },
    EmotionType.GRATITUDE: {
        'keywords': [
            '感谢', '感激', '谢谢', '多谢', '辛苦了', '麻烦了', '劳驾', '拜托',
            '太感谢', '非常感谢', '谢谢你', '谢谢您',
            'thank', 'thanks', 'grateful', 'appreciate', 'gratitude', 'thankful',
            'much appreciated', 'cheers'
        ],
        'intensity_modifiers': {
            'very_low': ['有点', '稍微', '一点', 'a bit', 'slightly'],
            'low': ['还算', '比较', 'quite', 'fairly'],
            'moderate': ['很', '挺', 'very', 'pretty'],
            'high': ['非常', '特别', '超级', 'extremely', 'super', 'really'],
            'very_high': ['太', '极其', '无比', 'so', 'incredibly', 'absolutely']
        }
    }
}

EMOTION_VALENCE = {
    EmotionType.JOY: 1.0,
    EmotionType.SADNESS: -1.0,
    EmotionType.ANGER: -0.8,
    EmotionType.FEAR: -0.7,
    EmotionType.SURPRISE: 0.0,
    EmotionType.DISGUST: -0.6,
    EmotionType.TRUST: 0.8,
    EmotionType.ANTICIPATION: 0.3,
    EmotionType.NEUTRAL: 0.0,
    EmotionType.FRUSTRATION: -0.5,
    EmotionType.EXCITEMENT: 0.9,
    EmotionType.ANXIETY: -0.4,
    EmotionType.SATISFACTION: 0.7,
    EmotionType.CONFUSION: -0.2,
    EmotionType.GRATITUDE: 0.9,
}


@dataclass
class KnowledgeNode:
    id: str
    text: str
    node_type: str
    attributes: Dict[str, Any]
    confidence: float
    source: str
    created_at: str
    updated_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class KnowledgeEdge:
    source_id: str
    target_id: str
    relation_type: str
    weight: float
    evidence: str
    confidence: float
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class InferenceResult:
    conclusion: str
    confidence: float
    reasoning_path: List[str]
    evidence: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EmotionState:
    emotion_type: EmotionType
    intensity: EmotionIntensity
    confidence: float
    triggers: List[str]
    context: str
    timestamp: str
    valence: float = 0.0
    secondary_emotions: List[EmotionType] = field(default_factory=list)

    def __post_init__(self):
        self.valence = EMOTION_VALENCE.get(self.emotion_type, 0.0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'emotion_type': self.emotion_type.value,
            'intensity': self.intensity.value,
            'confidence': self.confidence,
            'triggers': self.triggers,
            'context': self.context,
            'timestamp': self.timestamp,
            'valence': self.valence,
            'secondary_emotions': [e.value for e in self.secondary_emotions]
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EmotionState':
        return cls(
            emotion_type=EmotionType(data['emotion_type']),
            intensity=EmotionIntensity(data['intensity']),
            confidence=data['confidence'],
            triggers=data.get('triggers', []),
            context=data.get('context', ''),
            timestamp=data.get('timestamp', datetime.now().isoformat()),
            secondary_emotions=[EmotionType(e) for e in data.get('secondary_emotions', [])]
        )


@dataclass
class EmotionHistoryEntry:
    emotion_state: EmotionState
    source_text: str
    session_id: Optional[str]
    metadata: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'emotion_state': self.emotion_state.to_dict(),
            'source_text': self.source_text,
            'session_id': self.session_id,
            'metadata': self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EmotionHistoryEntry':
        return cls(
            emotion_state=EmotionState.from_dict(data['emotion_state']),
            source_text=data['source_text'],
            session_id=data.get('session_id'),
            metadata=data.get('metadata', {})
        )


class EmotionAnalyzer:
    def __init__(self):
        self.negation_patterns = [
            '不', '没有', '没', '不是', '不会', '不想', '不要', '别', '无',
            'not', "don't", "doesn't", "didn't", "won't", "wouldn't", 'no', 'never'
        ]
        self.intensifier_patterns = [
            '很', '非常', '特别', '超级', '太', '极其', '相当', '比较', '有点',
            'very', 'really', 'so', 'extremely', 'quite', 'pretty', 'super', 'absolutely'
        ]

    def analyze(self, text: str) -> EmotionState:
        text_lower = text.lower()
        emotion_scores: Dict[EmotionType, float] = {}
        detected_triggers: Dict[EmotionType, List[str]] = defaultdict(list)

        for emotion_type, patterns in EMOTION_PATTERNS.items():
            score = 0.0
            triggers = []

            for keyword in patterns['keywords']:
                if keyword.lower() in text_lower:
                    keyword_score = 1.0

                    for negation in self.negation_patterns:
                        neg_pattern = f'{negation}\\s*{re.escape(keyword)}'
                        if re.search(neg_pattern, text_lower):
                            keyword_score = -0.5
                            break

                    for intensifier in self.intensifier_patterns:
                        int_pattern = f'{re.escape(intensifier)}\\s*{re.escape(keyword)}'
                        if re.search(int_pattern, text_lower):
                            keyword_score *= 1.5
                            break

                    score += keyword_score
                    triggers.append(keyword)

            if score > 0:
                emotion_scores[emotion_type] = score
                detected_triggers[emotion_type] = triggers

        if not emotion_scores:
            return EmotionState(
                emotion_type=EmotionType.NEUTRAL,
                intensity=EmotionIntensity.MODERATE,
                confidence=0.9,
                triggers=[],
                context=text,
                timestamp=datetime.now().isoformat()
            )

        sorted_emotions = sorted(emotion_scores.items(), key=lambda x: x[1], reverse=True)
        primary_emotion = sorted_emotions[0][0]
        primary_score = sorted_emotions[0][1]

        secondary_emotions = [e for e, s in sorted_emotions[1:4] if s > primary_score * 0.3]

        intensity = self._determine_intensity(text, primary_emotion, primary_score)
        confidence = min(1.0, primary_score / 3.0)

        return EmotionState(
            emotion_type=primary_emotion,
            intensity=intensity,
            confidence=confidence,
            triggers=detected_triggers[primary_emotion],
            context=text,
            timestamp=datetime.now().isoformat(),
            secondary_emotions=secondary_emotions
        )

    def _determine_intensity(
        self,
        text: str,
        emotion_type: EmotionType,
        score: float
    ) -> EmotionIntensity:
        text_lower = text.lower()
        patterns = EMOTION_PATTERNS.get(emotion_type, {})
        intensity_modifiers = patterns.get('intensity_modifiers', {})

        for modifier in intensity_modifiers.get('very_high', []):
            if modifier in text_lower:
                return EmotionIntensity.VERY_HIGH

        for modifier in intensity_modifiers.get('high', []):
            if modifier in text_lower:
                return EmotionIntensity.HIGH

        for modifier in intensity_modifiers.get('moderate', []):
            if modifier in text_lower:
                return EmotionIntensity.MODERATE

        for modifier in intensity_modifiers.get('low', []):
            if modifier in text_lower:
                return EmotionIntensity.LOW

        for modifier in intensity_modifiers.get('very_low', []):
            if modifier in text_lower:
                return EmotionIntensity.VERY_LOW

        if score >= 3.0:
            return EmotionIntensity.HIGH
        elif score >= 2.0:
            return EmotionIntensity.MODERATE
        elif score >= 1.0:
            return EmotionIntensity.LOW
        else:
            return EmotionIntensity.VERY_LOW

    def get_emotion_summary(self, text: str) -> Dict[str, Any]:
        state = self.analyze(text)
        return {
            'primary_emotion': state.emotion_type.value,
            'intensity': state.intensity.value,
            'valence': state.valence,
            'confidence': state.confidence,
            'is_positive': state.valence > 0,
            'is_negative': state.valence < 0,
            'is_neutral': state.valence == 0,
            'triggers': state.triggers,
            'secondary_emotions': [e.value for e in state.secondary_emotions]
        }


class EmotionTracker:
    def __init__(self, memory_dir: Optional[str] = None):
        self.memory_dir = memory_dir or os.path.join(MEMORY_DIR, "zhengfei-memory")
        self.history_path = os.path.join(self.memory_dir, "emotion-history.json")
        self.analyzer = EmotionAnalyzer()
        self.history: List[EmotionHistoryEntry] = []
        self._ensure_file()
        self._load_history()

    def _ensure_file(self) -> None:
        if not os.path.exists(self.memory_dir):
            os.makedirs(self.memory_dir, exist_ok=True)

        if not os.path.exists(self.history_path):
            default = {
                "version": "1.0",
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "history": [],
                "statistics": {
                    "total_entries": 0,
                    "emotion_distribution": {},
                    "average_valence": 0.0,
                    "dominant_emotion": None
                }
            }
            with open(self.history_path, 'w', encoding='utf-8') as f:
                json.dump(default, f, ensure_ascii=False, indent=2)

    def _load_history(self) -> None:
        with open(self.history_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for entry_data in data.get('history', []):
            self.history.append(EmotionHistoryEntry.from_dict(entry_data))

    def _save_history(self) -> None:
        data = {
            "version": "1.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "history": [e.to_dict() for e in self.history],
            "statistics": self._calculate_statistics()
        }
        with open(self.history_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _calculate_statistics(self) -> Dict[str, Any]:
        if not self.history:
            return {
                "total_entries": 0,
                "emotion_distribution": {},
                "average_valence": 0.0,
                "dominant_emotion": None
            }

        emotion_counts: Dict[str, int] = defaultdict(int)
        total_valence = 0.0

        for entry in self.history:
            emotion_counts[entry.emotion_state.emotion_type.value] += 1
            total_valence += entry.emotion_state.valence

        dominant_emotion = max(emotion_counts.items(), key=lambda x: x[1])[0] if emotion_counts else None

        return {
            "total_entries": len(self.history),
            "emotion_distribution": dict(emotion_counts),
            "average_valence": total_valence / len(self.history),
            "dominant_emotion": dominant_emotion
        }

    def track(
        self,
        text: str,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> EmotionState:
        emotion_state = self.analyzer.analyze(text)

        entry = EmotionHistoryEntry(
            emotion_state=emotion_state,
            source_text=text,
            session_id=session_id,
            metadata=metadata or {}
        )

        self.history.append(entry)
        self._save_history()

        return emotion_state

    def get_recent_emotions(self, count: int = 10) -> List[EmotionState]:
        return [e.emotion_state for e in self.history[-count:]]

    def get_emotion_trend(self, window_size: int = 5) -> Dict[str, Any]:
        if len(self.history) < window_size:
            window_size = len(self.history)

        if window_size == 0:
            return {
                "trend": "unknown",
                "average_valence": 0.0,
                "emotion_changes": 0
            }

        recent = self.history[-window_size:]
        valences = [e.emotion_state.valence for e in recent]

        avg_valence = sum(valences) / len(valences)

        emotion_changes = 0
        for i in range(1, len(recent)):
            if recent[i].emotion_state.emotion_type != recent[i-1].emotion_state.emotion_type:
                emotion_changes += 1

        if len(valences) >= 2:
            first_half = sum(valences[:len(valences)//2]) / (len(valences)//2 or 1)
            second_half = sum(valences[len(valences)//2:]) / (len(valences) - len(valences)//2 or 1)

            if second_half > first_half + 0.2:
                trend = "improving"
            elif second_half < first_half - 0.2:
                trend = "declining"
            else:
                trend = "stable"
        else:
            trend = "stable"

        return {
            "trend": trend,
            "average_valence": avg_valence,
            "emotion_changes": emotion_changes,
            "window_size": window_size
        }

    def get_emotion_distribution(self, days: int = 7) -> Dict[str, Any]:
        cutoff = datetime.now() - timedelta(days=days)
        distribution: Dict[str, int] = defaultdict(int)
        total_valence = 0.0
        count = 0

        for entry in self.history:
            try:
                entry_time = datetime.fromisoformat(entry.emotion_state.timestamp)
                if entry_time >= cutoff:
                    distribution[entry.emotion_state.emotion_type.value] += 1
                    total_valence += entry.emotion_state.valence
                    count += 1
            except ValueError:
                continue

        return {
            "period_days": days,
            "distribution": dict(distribution),
            "total_entries": count,
            "average_valence": total_valence / count if count > 0 else 0.0
        }

    def get_dominant_emotion(self, days: int = 7) -> Optional[Dict[str, Any]]:
        dist = self.get_emotion_distribution(days)
        distribution = dist.get('distribution', {})

        if not distribution:
            return None

        dominant = max(distribution.items(), key=lambda x: x[1])
        return {
            "emotion": dominant[0],
            "count": dominant[1],
            "percentage": dominant[1] / dist['total_entries'] * 100 if dist['total_entries'] > 0 else 0
        }

    def clear_old_history(self, days: int = 30) -> int:
        cutoff = datetime.now() - timedelta(days=days)
        original_count = len(self.history)

        self.history = [
            entry for entry in self.history
            if datetime.fromisoformat(entry.emotion_state.timestamp) >= cutoff
        ]

        removed_count = original_count - len(self.history)
        if removed_count > 0:
            self._save_history()

        return removed_count


class KnowledgeGraphEngine:
    def __init__(self, memory_dir: Optional[str] = None):
        if memory_dir:
            self.memory_dir = memory_dir
        else:
            self.memory_dir = os.path.join(MEMORY_DIR, "zhengfei-memory")
        
        self.graph_path = os.path.join(self.memory_dir, "knowledge-graph.json")
        
        self.nodes: Dict[str, KnowledgeNode] = {}
        self.edges: Dict[str, List[KnowledgeEdge]] = defaultdict(list)
        self.reverse_edges: Dict[str, List[KnowledgeEdge]] = defaultdict(list)
        
        self.emotion_tracker = EmotionTracker(self.memory_dir)
        self.emotion_analyzer = EmotionAnalyzer()
        
        self._ensure_file()
        self._load_data()
    
    def _ensure_file(self) -> None:
        if not os.path.exists(self.memory_dir):
            os.makedirs(self.memory_dir, exist_ok=True)
        
        if not os.path.exists(self.graph_path):
            default = {
                "version": "1.0",
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "nodes": [],
                "edges": [],
                "statistics": {
                    "total_nodes": 0,
                    "total_edges": 0,
                    "node_types": {},
                    "relation_types": {}
                }
            }
            with open(self.graph_path, 'w', encoding='utf-8') as f:
                json.dump(default, f, ensure_ascii=False, indent=2)
    
    def _load_data(self) -> None:
        with open(self.graph_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        for node_data in data.get('nodes', []):
            node = KnowledgeNode(
                id=node_data['id'],
                text=node_data['text'],
                node_type=node_data.get('node_type', 'entity'),
                attributes=node_data.get('attributes', {}),
                confidence=node_data.get('confidence', 0.5),
                source=node_data.get('source', 'unknown'),
                created_at=node_data.get('created_at', datetime.now().isoformat()),
                updated_at=node_data.get('updated_at', datetime.now().isoformat())
            )
            self.nodes[node.id] = node
        
        for edge_data in data.get('edges', []):
            edge = KnowledgeEdge(
                source_id=edge_data['source_id'],
                target_id=edge_data['target_id'],
                relation_type=edge_data['relation_type'],
                weight=edge_data.get('weight', 1.0),
                evidence=edge_data.get('evidence', ''),
                confidence=edge_data.get('confidence', 0.5),
                created_at=edge_data.get('created_at', datetime.now().isoformat())
            )
            self.edges[edge.source_id].append(edge)
            self.reverse_edges[edge.target_id].append(edge)
    
    def _save_data(self) -> None:
        data = {
            "version": "1.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for edges in self.edges.values() for e in edges],
            "statistics": self._calculate_statistics()
        }
        with open(self.graph_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    def _calculate_statistics(self) -> Dict[str, Any]:
        node_types: Dict[str, int] = defaultdict(int)
        for node in self.nodes.values():
            node_types[node.node_type] += 1
        
        relation_types: Dict[str, int] = defaultdict(int)
        for edges in self.edges.values():
            for edge in edges:
                relation_types[edge.relation_type] += 1
        
        return {
            "total_nodes": len(self.nodes),
            "total_edges": sum(len(e) for e in self.edges.values()),
            "node_types": dict(node_types),
            "relation_types": dict(relation_types)
        }

    def add_node(
        self,
        text: str,
        node_type: str = "entity",
        attributes: Optional[Dict[str, Any]] = None,
        confidence: float = 0.8,
        source: str = "user_input"
    ) -> KnowledgeNode:
        """添加知识节点"""
        import uuid
        
        node = KnowledgeNode(
            id=f"KN-{uuid.uuid4().hex[:8].upper()}",
            text=text,
            node_type=node_type,
            attributes=attributes or {},
            confidence=confidence,
            source=source,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat()
        )
        
        self.nodes[node.id] = node
        self._save_data()
        
        return node

    def add_edge(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        weight: float = 1.0,
        evidence: str = "",
        confidence: float = 0.8
    ) -> Optional[KnowledgeEdge]:
        """添加知识边"""
        if source_id not in self.nodes or target_id not in self.nodes:
            return None
        
        edge = KnowledgeEdge(
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            weight=weight,
            evidence=evidence,
            confidence=confidence,
            created_at=datetime.now().isoformat()
        )
        
        self.edges[source_id].append(edge)
        self.reverse_edges[target_id].append(edge)
        self._save_data()
        
        return edge

    def infer(self, query: str, max_depth: int = 3) -> List[InferenceResult]:
        """
        推理查询
        
        :param query: 查询问题
        :param max_depth: 最大推理深度
        :return: 推理结果列表
        """
        results = []
        
        query_nodes = self._find_nodes_by_text(query)
        
        for node in query_nodes:
            direct_inferences = self._direct_inference(node)
            results.extend(direct_inferences)
            
            transitive_inferences = self._transitive_inference(node, max_depth)
            results.extend(transitive_inferences)
        
        rule_based = self._rule_based_inference(query)
        results.extend(rule_based)
        
        seen_conclusions = set()
        unique_results = []
        for r in results:
            if r.conclusion not in seen_conclusions:
                seen_conclusions.add(r.conclusion)
                unique_results.append(r)
        
        unique_results.sort(key=lambda x: x.confidence, reverse=True)
        
        return unique_results[:10]

    def _find_nodes_by_text(self, text: str) -> List[KnowledgeNode]:
        """通过文本查找节点"""
        text_lower = text.lower()
        results = []
        
        for node in self.nodes.values():
            if text_lower in node.text.lower():
                results.append(node)
        
        return results

    def _direct_inference(self, node: KnowledgeNode) -> List[InferenceResult]:
        """直接推理"""
        results = []
        
        for edge in self.edges.get(node.id, []):
            target = self.nodes.get(edge.target_id)
            if target:
                results.append(InferenceResult(
                    conclusion=target.text,
                    confidence=edge.confidence * node.confidence,
                    reasoning_path=[node.text, f"--[{edge.relation_type}]-->", target.text],
                    evidence=[edge.evidence] if edge.evidence else []
                ))
        
        for edge in self.reverse_edges.get(node.id, []):
            source = self.nodes.get(edge.source_id)
            if source:
                results.append(InferenceResult(
                    conclusion=source.text,
                    confidence=edge.confidence * node.confidence,
                    reasoning_path=[source.text, f"--[{edge.relation_type}]-->", node.text],
                    evidence=[edge.evidence] if edge.evidence else []
                ))
        
        return results

    def _transitive_inference(
        self,
        node: KnowledgeNode,
        max_depth: int
    ) -> List[InferenceResult]:
        """传递推理"""
        results = []
        visited: Set[str] = {node.id}
        
        def traverse(current_id: str, path: List[str], confidence: float, depth: int):
            if depth > max_depth:
                return
            
            for edge in self.edges.get(current_id, []):
                if edge.target_id in visited:
                    continue
                
                target = self.nodes.get(edge.target_id)
                if not target:
                    continue
                
                visited.add(edge.target_id)
                new_path = path + [f"--[{edge.relation_type}]-->", target.text]
                new_confidence = confidence * edge.confidence * 0.9
                
                results.append(InferenceResult(
                    conclusion=target.text,
                    confidence=new_confidence,
                    reasoning_path=new_path,
                    evidence=[edge.evidence] if edge.evidence else []
                ))
                
                traverse(edge.target_id, new_path, new_confidence, depth + 1)
        
        traverse(node.id, [node.text], node.confidence, 1)
        
        return results

    def _rule_based_inference(self, query: str) -> List[InferenceResult]:
        """基于规则的推理"""
        results = []
        
        rules = [
            self._rule_if_then(query),
            self._rule_cause_effect(query),
            self._rule_part_whole(query),
        ]
        
        for rule_results in rules:
            results.extend(rule_results)
        
        return results

    def _rule_if_then(self, query: str) -> List[InferenceResult]:
        """如果-那么规则"""
        results = []
        
        implies_edges = []
        for edges in self.edges.values():
            implies_edges.extend([e for e in edges if e.relation_type == "implies"])
        
        for edge in implies_edges:
            source = self.nodes.get(edge.source_id)
            target = self.nodes.get(edge.target_id)
            
            if source and target:
                if source.text.lower() in query.lower():
                    results.append(InferenceResult(
                        conclusion=f"如果 {source.text}，那么 {target.text}",
                        confidence=edge.confidence,
                        reasoning_path=[source.text, "--[implies]-->", target.text],
                        evidence=[edge.evidence] if edge.evidence else []
                    ))
        
        return results

    def _rule_cause_effect(self, query: str) -> List[InferenceResult]:
        """因果规则"""
        results = []
        
        causes_edges = []
        for edges in self.edges.values():
            causes_edges.extend([e for e in edges if e.relation_type == "causes"])
        
        for edge in causes_edges:
            source = self.nodes.get(edge.source_id)
            target = self.nodes.get(edge.target_id)
            
            if source and target:
                if source.text.lower() in query.lower():
                    results.append(InferenceResult(
                        conclusion=f"{source.text} 会导致 {target.text}",
                        confidence=edge.confidence,
                        reasoning_path=[source.text, "--[causes]-->", target.text],
                        evidence=[edge.evidence] if edge.evidence else []
                    ))
        
        return results

    def _rule_part_whole(self, query: str) -> List[InferenceResult]:
        """部分-整体规则"""
        results = []
        
        part_of_edges = []
        for edges in self.reverse_edges.values():
            part_of_edges.extend([e for e in edges if e.relation_type == "part_of"])
        
        for edge in part_of_edges:
            source = self.nodes.get(edge.source_id)
            target = self.nodes.get(edge.target_id)
            
            if source and target:
                if source.text.lower() in query.lower():
                    results.append(InferenceResult(
                        conclusion=f"{source.text} 是 {target.text} 的一部分",
                        confidence=edge.confidence,
                        reasoning_path=[source.text, "--[part_of]-->", target.text],
                        evidence=[edge.evidence] if edge.evidence else []
                    ))
        
        return results

    def find_path(
        self,
        start_text: str,
        end_text: str,
        max_depth: int = 5
    ) -> List[List[str]]:
        """查找两个节点之间的路径"""
        start_nodes = self._find_nodes_by_text(start_text)
        end_nodes = self._find_nodes_by_text(end_text)
        
        if not start_nodes or not end_nodes:
            return []
        
        end_ids = {n.id for n in end_nodes}
        paths = []
        
        for start_node in start_nodes:
            visited: Set[str] = {start_node.id}
            
            def dfs(current_id: str, path: List[str]):
                if current_id in end_ids:
                    paths.append(path.copy())
                    return
                
                if len(path) > max_depth * 2:
                    return
                
                for edge in self.edges.get(current_id, []):
                    if edge.target_id in visited:
                        continue
                    
                    target = self.nodes.get(edge.target_id)
                    if not target:
                        continue
                    
                    visited.add(edge.target_id)
                    path.append(f"--[{edge.relation_type}]-->")
                    path.append(target.text)
                    
                    dfs(edge.target_id, path)
                    
                    path.pop()
                    path.pop()
                    visited.remove(edge.target_id)
            
            dfs(start_node.id, [start_node.text])
        
        return paths

    def get_related_concepts(self, text: str, depth: int = 2) -> List[Dict[str, Any]]:
        """获取相关概念"""
        nodes = self._find_nodes_by_text(text)
        
        related = []
        visited: Set[str] = set()
        
        for node in nodes:
            visited.add(node.id)
            
            for edge in self.edges.get(node.id, []):
                target = self.nodes.get(edge.target_id)
                if target and target.id not in visited:
                    related.append({
                        "text": target.text,
                        "relation": edge.relation_type,
                        "confidence": edge.confidence,
                        "distance": 1
                    })
                    visited.add(target.id)
            
            for edge in self.reverse_edges.get(node.id, []):
                source = self.nodes.get(edge.source_id)
                if source and source.id not in visited:
                    related.append({
                        "text": source.text,
                        "relation": edge.relation_type,
                        "confidence": edge.confidence,
                        "distance": 1
                    })
                    visited.add(source.id)
        
        related.sort(key=lambda x: x['confidence'], reverse=True)
        
        return related[:20]

    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息"""
        return self._calculate_statistics()

    def analyze_emotion(self, text: str) -> EmotionState:
        """分析文本情绪"""
        return self.emotion_analyzer.analyze(text)

    def track_emotion(
        self,
        text: str,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> EmotionState:
        """追踪情绪并记录到历史"""
        return self.emotion_tracker.track(text, session_id, metadata)

    def get_emotion_trend(self, window_size: int = 5) -> Dict[str, Any]:
        """获取情绪趋势"""
        return self.emotion_tracker.get_emotion_trend(window_size)

    def get_emotion_distribution(self, days: int = 7) -> Dict[str, Any]:
        """获取情绪分布统计"""
        return self.emotion_tracker.get_emotion_distribution(days)

    def get_dominant_emotion(self, days: int = 7) -> Optional[Dict[str, Any]]:
        """获取主导情绪"""
        return self.emotion_tracker.get_dominant_emotion(days)

    def get_recent_emotions(self, count: int = 10) -> List[EmotionState]:
        """获取最近的情绪记录"""
        return self.emotion_tracker.get_recent_emotions(count)

    def add_emotion_node(
        self,
        text: str,
        emotion_state: Optional[EmotionState] = None,
        session_id: Optional[str] = None
    ) -> KnowledgeNode:
        """添加情绪节点到知识图谱"""
        if emotion_state is None:
            emotion_state = self.analyze_emotion(text)

        attributes = {
            'emotion_type': emotion_state.emotion_type.value,
            'intensity': emotion_state.intensity.value,
            'valence': emotion_state.valence,
            'confidence': emotion_state.confidence,
            'triggers': emotion_state.triggers,
            'secondary_emotions': [e.value for e in emotion_state.secondary_emotions],
            'session_id': session_id
        }

        node = self.add_node(
            text=text,
            node_type="emotion",
            attributes=attributes,
            confidence=emotion_state.confidence,
            source="emotion_detection"
        )

        return node

    def link_emotion_to_entity(
        self,
        emotion_node_id: str,
        entity_node_id: str,
        evidence: str = ""
    ) -> Optional[KnowledgeEdge]:
        """将情绪节点链接到实体节点"""
        if emotion_node_id not in self.nodes or entity_node_id not in self.nodes:
            return None

        return self.add_edge(
            source_id=entity_node_id,
            target_id=emotion_node_id,
            relation_type=RelationType.TRIGGERS_EMOTION.value,
            evidence=evidence
        )

    def get_emotions_for_entity(self, entity_text: str) -> List[Dict[str, Any]]:
        """获取与实体相关的情绪"""
        entity_nodes = self._find_nodes_by_text(entity_text)
        emotions = []

        for node in entity_nodes:
            for edge in self.edges.get(node.id, []):
                if edge.relation_type == RelationType.TRIGGERS_EMOTION.value:
                    target = self.nodes.get(edge.target_id)
                    if target and target.node_type == "emotion":
                        emotions.append({
                            'entity': node.text,
                            'emotion': target.text,
                            'emotion_attributes': target.attributes,
                            'confidence': edge.confidence,
                            'evidence': edge.evidence
                        })

        return emotions

    def get_emotion_aware_context(self, query: str) -> Dict[str, Any]:
        """获取情绪感知的上下文"""
        current_emotion = self.analyze_emotion(query)
        recent_emotions = self.get_recent_emotions(5)
        emotion_trend = self.get_emotion_trend(5)
        dominant_emotion = self.get_dominant_emotion(7)

        related_emotions = self.get_emotions_for_entity(query)

        return {
            'current_emotion': current_emotion.to_dict(),
            'recent_emotions': [e.to_dict() for e in recent_emotions],
            'emotion_trend': emotion_trend,
            'dominant_emotion': dominant_emotion,
            'related_emotions': related_emotions,
            'suggestions': self._generate_emotion_suggestions(current_emotion, emotion_trend)
        }

    def _generate_emotion_suggestions(
        self,
        current_emotion: EmotionState,
        trend: Dict[str, Any]
    ) -> List[str]:
        """根据情绪状态生成建议"""
        suggestions = []

        if current_emotion.valence < -0.5:
            suggestions.append("用户当前情绪较为负面，建议以更加温和、支持性的方式回应")
            if current_emotion.emotion_type == EmotionType.FRUSTRATION:
                suggestions.append("用户可能遇到困难，主动提供帮助和解决方案")
            elif current_emotion.emotion_type == EmotionType.ANGER:
                suggestions.append("用户情绪激动，避免争辩，先表示理解再引导")
            elif current_emotion.emotion_type == EmotionType.ANXIETY:
                suggestions.append("用户可能感到焦虑，提供清晰、有条理的信息")

        if trend.get('trend') == 'declining':
            suggestions.append("用户情绪呈下降趋势，建议关注用户状态")

        if current_emotion.emotion_type == EmotionType.CONFUSION:
            suggestions.append("用户可能感到困惑，考虑提供更详细的解释")

        if current_emotion.emotion_type == EmotionType.GRATITUDE:
            suggestions.append("用户表示感激，可以简洁回应")

        if not suggestions:
            suggestions.append("用户情绪状态正常，保持自然的对话风格")

        return suggestions


if __name__ == "__main__":
    engine = KnowledgeGraphEngine()
    
    print("=== 正飞知识图谱引擎 V2.0 测试 ===\n")
    
    print("1. 添加节点...")
    n1 = engine.add_node("React", node_type="technology", attributes={"type": "framework"})
    n2 = engine.add_node("前端开发", node_type="skill")
    n3 = engine.add_node("TypeScript", node_type="technology")
    
    print("2. 添加边...")
    engine.add_edge(n1.id, n2.id, "used_for", evidence="React用于前端开发")
    engine.add_edge(n3.id, n1.id, "used_with", evidence="TypeScript常与React配合使用")
    
    print("3. 推理查询...")
    results = engine.infer("React")
    for r in results[:3]:
        print(f"   结论: {r.conclusion} (置信度: {r.confidence:.2f})")
        print(f"   路径: {' '.join(r.reasoning_path)}")
    
    print("\n4. 获取相关概念...")
    related = engine.get_related_concepts("React")
    for r in related[:5]:
        print(f"   {r['text']} --[{r['relation']}]-- (置信度: {r['confidence']:.2f})")
    
    print("\n5. 情绪感知测试...")
    test_texts = [
        "我今天太开心了！终于解决了这个bug！",
        "这个功能怎么这么难用，真烦人！",
        "谢谢你的帮助，非常感谢！",
        "我有点担心这个项目的进度..."
    ]
    
    for text in test_texts:
        emotion = engine.track_emotion(text)
        print(f"   文本: {text}")
        print(f"   情绪: {emotion.emotion_type.value} (强度: {emotion.intensity.value})")
        print(f"   效价: {emotion.valence:.2f}, 置信度: {emotion.confidence:.2f}")
        print()
    
    print("6. 情绪趋势分析...")
    trend = engine.get_emotion_trend()
    print(f"   趋势: {trend['trend']}")
    print(f"   平均效价: {trend['average_valence']:.2f}")
    
    print("\n7. 情绪分布统计...")
    dist = engine.get_emotion_distribution()
    print(f"   分布: {dist['distribution']}")
    
    print("\n8. 情绪感知上下文...")
    context = engine.get_emotion_aware_context("这个bug让我很头疼")
    print(f"   当前情绪: {context['current_emotion']['emotion_type']}")
    print(f"   建议: {context['suggestions']}")
