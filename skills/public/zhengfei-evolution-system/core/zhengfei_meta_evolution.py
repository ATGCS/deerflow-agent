# -*- coding: utf-8 -*-
"""
正飞元进化引擎 V1.0 - 系统自我优化能力
自动改进记忆提取算法、分类模型、参数调优
正飞信息技术出品
"""

import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, asdict
from collections import defaultdict
import math

META_EVOLUTION_DIR = os.path.dirname(os.path.abspath(__file__))
META_CONFIG_PATH = os.path.join(META_EVOLUTION_DIR, "zhengfei-memory", "meta-evolution.json")
FEEDBACK_PATH = os.path.join(META_EVOLUTION_DIR, "zhengfei-memory", "user-feedback.json")


@dataclass
class ParameterAdjustment:
    parameter_name: str
    old_value: float
    new_value: float
    reason: str
    timestamp: str
    effectiveness_score: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CategoryEvolution:
    category_name: str
    patterns_added: List[str]
    patterns_removed: List[str]
    timestamp: str
    accuracy_improvement: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class UserFeedback:
    feedback_id: str
    memory_text: str
    feedback_type: str
    category: Optional[str]
    importance: Optional[int]
    timestamp: str
    resolved: bool

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MetaEvolutionEngine:
    def __init__(self, memory_dir: Optional[str] = None):
        if memory_dir:
            self.memory_dir = memory_dir
        else:
            self.memory_dir = os.path.join(META_EVOLUTION_DIR, "zhengfei-memory")
        
        self.config_path = os.path.join(self.memory_dir, "meta-evolution.json")
        self.feedback_path = os.path.join(self.memory_dir, "user-feedback.json")
        
        self._ensure_files()
        self._load_data()
    
    def _ensure_files(self) -> None:
        if not os.path.exists(self.memory_dir):
            os.makedirs(self.memory_dir, exist_ok=True)
        
        if not os.path.exists(self.config_path):
            self._create_default_config()
        
        if not os.path.exists(self.feedback_path):
            with open(self.feedback_path, 'w', encoding='utf-8') as f:
                json.dump({"feedbacks": []}, f, ensure_ascii=False, indent=2)
    
    def _create_default_config(self) -> None:
        default_config = {
            "version": "1.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "parameters": {
                "confidence_decay_rate": 0.01,
                "min_confidence_threshold": 0.1,
                "similarity_threshold": 0.3,
                "importance_boost_factor": 1.2,
                "access_count_weight": 0.05,
                "max_memories": 500,
                "cleanup_interval_days": 7
            },
            "category_patterns": {
                "identity": ["我叫", "我是", "我的名字", "我来自", "我住在"],
                "preference": ["我喜欢", "我偏好", "我习惯", "我不喜欢", "我讨厌"],
                "behavior": ["我总是", "我经常", "我通常", "我一般"],
                "knowledge": ["我知道", "我了解", "我学过", "我会"],
                "relationship": ["我的", "我有", "我养了", "我的朋友"],
                "goal": ["我的目标", "我想", "我希望", "我计划"],
                "skill": ["我会", "我擅长", "我精通", "我熟练"],
                "project": ["项目", "工程", "开发", "正在做"],
                "temporal": ["今天", "昨天", "明天", "本周", "这个月"]
            },
            "importance_keywords": {
                "critical": ["必须", "一定要", "绝对", "关键", "核心"],
                "high": ["很重要", "比较重要", "优先", "首选"],
                "low": ["可能", "也许", "大概", "偶尔"],
                "trivial": ["顺便", "随便", "随意", "不太重要"]
            },
            "evolution_history": [],
            "parameter_adjustments": [],
            "category_evolutions": [],
            "statistics": {
                "total_adjustments": 0,
                "total_evolutions": 0,
                "accuracy_improvements": 0,
                "last_evolution": None
            }
        }
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, ensure_ascii=False, indent=2)
    
    def _load_data(self) -> None:
        with open(self.config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        
        with open(self.feedback_path, 'r', encoding='utf-8') as f:
            self.feedback_data = json.load(f)
    
    def _save_config(self) -> None:
        self.config['updated_at'] = datetime.now().isoformat()
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, ensure_ascii=False, indent=2)
    
    def _save_feedback(self) -> None:
        with open(self.feedback_path, 'w', encoding='utf-8') as f:
            json.dump(self.feedback_data, f, ensure_ascii=False, indent=2)

    def record_feedback(
        self,
        memory_text: str,
        feedback_type: str,
        category: Optional[str] = None,
        importance: Optional[int] = None
    ) -> UserFeedback:
        """
        记录用户反馈
        
        :param memory_text: 记忆文本
        :param feedback_type: 反馈类型 (correct/incorrect/missing/irrelevant)
        :param category: 正确的分类（用户指定）
        :param importance: 正确的重要性（用户指定）
        """
        import uuid
        
        feedback = UserFeedback(
            feedback_id=f"FB-{uuid.uuid4().hex[:8].upper()}",
            memory_text=memory_text,
            feedback_type=feedback_type,
            category=category,
            importance=importance,
            timestamp=datetime.now().isoformat(),
            resolved=False
        )
        
        self.feedback_data['feedbacks'].append(feedback.to_dict())
        self._save_feedback()
        
        self._analyze_feedback(feedback)
        
        return feedback

    def _analyze_feedback(self, feedback: UserFeedback) -> None:
        """分析反馈并触发优化"""
        if feedback.feedback_type == "incorrect" and feedback.category:
            self._evolve_category_patterns(feedback.memory_text, feedback.category)
        
        elif feedback.feedback_type == "irrelevant":
            self._adjust_confidence_threshold()
        
        elif feedback.feedback_type == "missing":
            self._adjust_similarity_threshold()

    def _evolve_category_patterns(self, text: str, correct_category: str) -> None:
        """根据反馈演化分类模式"""
        words = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', text)
        
        new_patterns = []
        for word in words:
            if len(word) >= 2:
                existing = False
                for patterns in self.config['category_patterns'].values():
                    if word in patterns:
                        existing = True
                        break
                
                if not existing:
                    new_patterns.append(word)
        
        if new_patterns:
            if correct_category not in self.config['category_patterns']:
                self.config['category_patterns'][correct_category] = []
            
            self.config['category_patterns'][correct_category].extend(new_patterns[:3])
            
            evolution = CategoryEvolution(
                category_name=correct_category,
                patterns_added=new_patterns[:3],
                patterns_removed=[],
                timestamp=datetime.now().isoformat(),
                accuracy_improvement=0.0
            )
            
            self.config['category_evolutions'].append(evolution.to_dict())
            self.config['statistics']['total_evolutions'] += 1
            self.config['statistics']['last_evolution'] = datetime.now().isoformat()
            
            self._save_config()

    def _adjust_confidence_threshold(self) -> None:
        """调整置信度阈值"""
        current = self.config['parameters']['min_confidence_threshold']
        new_value = min(0.3, current + 0.02)
        
        adjustment = ParameterAdjustment(
            parameter_name="min_confidence_threshold",
            old_value=current,
            new_value=new_value,
            reason="用户反馈存在无关记忆，提高阈值过滤低质量记忆",
            timestamp=datetime.now().isoformat()
        )
        
        self.config['parameters']['min_confidence_threshold'] = new_value
        self.config['parameter_adjustments'].append(adjustment.to_dict())
        self.config['statistics']['total_adjustments'] += 1
        
        self._save_config()

    def _adjust_similarity_threshold(self) -> None:
        """调整相似度阈值"""
        current = self.config['parameters']['similarity_threshold']
        new_value = max(0.1, current - 0.05)
        
        adjustment = ParameterAdjustment(
            parameter_name="similarity_threshold",
            old_value=current,
            new_value=new_value,
            reason="用户反馈遗漏记忆，降低阈值增加召回率",
            timestamp=datetime.now().isoformat()
        )
        
        self.config['parameters']['similarity_threshold'] = new_value
        self.config['parameter_adjustments'].append(adjustment.to_dict())
        self.config['statistics']['total_adjustments'] += 1
        
        self._save_config()

    def auto_optimize(self) -> Dict[str, Any]:
        """
        自动优化：基于历史反馈和统计数据自动调整参数
        """
        optimizations = []
        
        recent_feedbacks = self._get_recent_feedbacks(days=7)
        
        if len(recent_feedbacks) >= 5:
            incorrect_ratio = len([f for f in recent_feedbacks if f['feedback_type'] == 'incorrect']) / len(recent_feedbacks)
            
            if incorrect_ratio > 0.2:
                opt = self._optimize_classification()
                if opt:
                    optimizations.append(opt)
            
            irrelevant_ratio = len([f for f in recent_feedbacks if f['feedback_type'] == 'irrelevant']) / len(recent_feedbacks)
            
            if irrelevant_ratio > 0.15:
                opt = self._optimize_relevance_filter()
                if opt:
                    optimizations.append(opt)
        
        decay_opt = self._optimize_decay_rate()
        if decay_opt:
            optimizations.append(decay_opt)
        
        new_categories = self._discover_new_categories()
        if new_categories:
            optimizations.append({
                "type": "new_category_discovery",
                "categories": new_categories,
                "timestamp": datetime.now().isoformat()
            })
        
        return {
            "success": True,
            "optimizations_count": len(optimizations),
            "optimizations": optimizations,
            "timestamp": datetime.now().isoformat()
        }

    def _get_recent_feedbacks(self, days: int = 7) -> List[Dict]:
        """获取最近的反馈"""
        cutoff = datetime.now() - timedelta(days=days)
        
        recent = []
        for fb in self.feedback_data.get('feedbacks', []):
            try:
                fb_time = datetime.fromisoformat(fb['timestamp'])
                if fb_time >= cutoff:
                    recent.append(fb)
            except ValueError:
                pass
        
        return recent

    def _optimize_classification(self) -> Optional[Dict[str, Any]]:
        """优化分类模型"""
        feedbacks = self._get_recent_feedbacks(days=30)
        
        category_errors = defaultdict(list)
        for fb in feedbacks:
            if fb['feedback_type'] == 'incorrect' and fb.get('category'):
                category_errors[fb['category']].append(fb['memory_text'])
        
        improvements = {}
        for category, texts in category_errors.items():
            if len(texts) >= 3:
                new_patterns = self._extract_common_patterns(texts)
                if new_patterns:
                    if category not in self.config['category_patterns']:
                        self.config['category_patterns'][category] = []
                    
                    added = [p for p in new_patterns if p not in self.config['category_patterns'][category]]
                    if added:
                        self.config['category_patterns'][category].extend(added[:5])
                        improvements[category] = added[:5]
        
        if improvements:
            self._save_config()
            return {
                "type": "classification_optimization",
                "improvements": improvements,
                "timestamp": datetime.now().isoformat()
            }
        
        return None

    def _extract_common_patterns(self, texts: List[str]) -> List[str]:
        """从文本中提取共同模式"""
        all_words = []
        for text in texts:
            words = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+', text)
            all_words.extend([w for w in words if len(w) >= 2])
        
        from collections import Counter
        word_counts = Counter(all_words)
        
        return [word for word, count in word_counts.most_common(10) if count >= 2]

    def _optimize_relevance_filter(self) -> Optional[Dict[str, Any]]:
        """优化相关性过滤"""
        current = self.config['parameters']['min_confidence_threshold']
        
        feedbacks = self._get_recent_feedbacks(days=14)
        irrelevant = [f for f in feedbacks if f['feedback_type'] == 'irrelevant']
        
        if len(irrelevant) >= 3:
            new_value = min(0.4, current + 0.03)
            
            adjustment = ParameterAdjustment(
                parameter_name="min_confidence_threshold",
                old_value=current,
                new_value=new_value,
                reason=f"基于{len(irrelevant)}条无关反馈自动调优",
                timestamp=datetime.now().isoformat()
            )
            
            self.config['parameters']['min_confidence_threshold'] = new_value
            self.config['parameter_adjustments'].append(adjustment.to_dict())
            self._save_config()
            
            return {
                "type": "relevance_filter_optimization",
                "old_threshold": current,
                "new_threshold": new_value,
                "timestamp": datetime.now().isoformat()
            }
        
        return None

    def _optimize_decay_rate(self) -> Optional[Dict[str, Any]]:
        """优化置信度衰减率"""
        feedbacks = self._get_recent_feedbacks(days=30)
        
        missing = [f for f in feedbacks if f['feedback_type'] == 'missing']
        
        if len(missing) >= 3:
            current = self.config['parameters']['confidence_decay_rate']
            new_value = max(0.005, current - 0.002)
            
            adjustment = ParameterAdjustment(
                parameter_name="confidence_decay_rate",
                old_value=current,
                new_value=new_value,
                reason=f"基于{len(missing)}条遗漏反馈减缓衰减",
                timestamp=datetime.now().isoformat()
            )
            
            self.config['parameters']['confidence_decay_rate'] = new_value
            self.config['parameter_adjustments'].append(adjustment.to_dict())
            self._save_config()
            
            return {
                "type": "decay_rate_optimization",
                "old_rate": current,
                "new_rate": new_value,
                "timestamp": datetime.now().isoformat()
            }
        
        return None

    def _discover_new_categories(self) -> List[Dict[str, Any]]:
        """发现新的记忆分类"""
        feedbacks = self._get_recent_feedbacks(days=30)
        
        uncategorized = defaultdict(list)
        for fb in feedbacks:
            if fb['feedback_type'] == 'incorrect' and fb.get('category'):
                if fb['category'] not in self.config['category_patterns']:
                    uncategorized[fb['category']].append(fb['memory_text'])
        
        new_categories = []
        for category, texts in uncategorized.items():
            if len(texts) >= 3:
                patterns = self._extract_common_patterns(texts)
                if patterns:
                    self.config['category_patterns'][category] = patterns
                    new_categories.append({
                        "category": category,
                        "patterns": patterns,
                        "sample_count": len(texts)
                    })
        
        if new_categories:
            self._save_config()
        
        return new_categories

    def get_parameters(self) -> Dict[str, Any]:
        """获取当前参数配置"""
        return self.config.get('parameters', {})

    def get_category_patterns(self) -> Dict[str, List[str]]:
        """获取分类模式"""
        return self.config.get('category_patterns', {})

    def get_evolution_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        """获取演化历史"""
        history = self.config.get('evolution_history', [])
        adjustments = self.config.get('parameter_adjustments', [])
        evolutions = self.config.get('category_evolutions', [])
        
        combined = []
        combined.extend([{"type": "evolution", **e} for e in history[-limit:]])
        combined.extend([{"type": "adjustment", **a} for a in adjustments[-limit:]])
        combined.extend([{"type": "category_evolution", **e} for e in evolutions[-limit:]])
        
        combined.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        
        return combined[:limit]

    def get_statistics(self) -> Dict[str, Any]:
        """获取元进化统计"""
        return {
            **self.config.get('statistics', {}),
            "total_feedbacks": len(self.feedback_data.get('feedbacks', [])),
            "recent_feedbacks": len(self._get_recent_feedbacks(days=7)),
            "parameter_count": len(self.config.get('parameters', {})),
            "category_count": len(self.config.get('category_patterns', {}))
        }

    def export_config(self) -> str:
        """导出配置"""
        return json.dumps(self.config, ensure_ascii=False, indent=2)

    def import_config(self, config_json: str) -> bool:
        """导入配置"""
        try:
            imported = json.loads(config_json)
            self.config = imported
            self._save_config()
            return True
        except Exception:
            return False


if __name__ == "__main__":
    engine = MetaEvolutionEngine()
    
    print("=== 正飞元进化引擎 V1.0 测试 ===\n")
    
    print("1. 当前参数配置:")
    params = engine.get_parameters()
    for key, value in params.items():
        print(f"   {key}: {value}")
    
    print("\n2. 模拟用户反馈...")
    engine.record_feedback(
        memory_text="我是一名全栈开发者，擅长React和Node.js",
        feedback_type="incorrect",
        category="skill"
    )
    
    print("\n3. 执行自动优化...")
    result = engine.auto_optimize()
    print(f"   优化数量: {result['optimizations_count']}")
    
    print("\n4. 获取统计信息...")
    stats = engine.get_statistics()
    print(f"   总反馈数: {stats['total_feedbacks']}")
    print(f"   总调整数: {stats['total_adjustments']}")
    print(f"   总演化数: {stats['total_evolutions']}")
