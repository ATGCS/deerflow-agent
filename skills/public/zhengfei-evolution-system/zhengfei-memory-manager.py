# -*- coding: utf-8 -*-
"""
正飞记忆管理器 - 时间感知、矛盾处理、过期清理
正飞信息技术出品
"""

import os
import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum

MEMORY_DIR = os.path.dirname(os.path.abspath(__file__))
MEMORY_INDEX_PATH = os.path.join(MEMORY_DIR, "zhengfei-memory", "index.json")
PROFILE_PATH = os.path.join(MEMORY_DIR, "zhengfei-memory", "profile.json")

DEFAULT_DYNAMIC_TTL_DAYS = 7
MAX_DYNAMIC_ITEMS = 10
MAX_MEMORIES = 500


@dataclass
class Memory:
    id: str
    text: str
    confidence: float
    source: str
    created_at: str
    last_accessed: str
    access_count: int
    expires_at: Optional[str]
    tags: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Memory':
        return cls(
            id=data.get('id', str(uuid.uuid4())),
            text=data.get('text', ''),
            confidence=data.get('confidence', 0.5),
            source=data.get('source', 'unknown'),
            created_at=data.get('created_at', datetime.now().isoformat()),
            last_accessed=data.get('last_accessed', datetime.now().isoformat()),
            access_count=data.get('access_count', 0),
            expires_at=data.get('expires_at'),
            tags=data.get('tags', [])
        )


@dataclass
class ProfileItem:
    text: str
    confidence: float
    source: str
    created_at: str
    ttl_days: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProfileItem':
        return cls(
            text=data.get('text', ''),
            confidence=data.get('confidence', 0.5),
            source=data.get('source', 'unknown'),
            created_at=data.get('created_at', datetime.now().isoformat()),
            ttl_days=data.get('ttl_days')
        )


@dataclass
class ContradictionRecord:
    old_text: str
    new_text: str
    resolved_at: str
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MemoryManager:
    def __init__(self, memory_dir: Optional[str] = None):
        if memory_dir:
            self.memory_dir = memory_dir
            self.index_path = os.path.join(memory_dir, "index.json")
            self.profile_path = os.path.join(memory_dir, "profile.json")
        else:
            self.memory_dir = MEMORY_DIR
            self.index_path = MEMORY_INDEX_PATH
            self.profile_path = PROFILE_PATH
        
        self._ensure_directories()
        self._load_data()
    
    def _ensure_directories(self) -> None:
        memory_dir = os.path.dirname(self.index_path)
        if not os.path.exists(memory_dir):
            os.makedirs(memory_dir, exist_ok=True)
        
        if not os.path.exists(self.index_path):
            self._create_default_index()
        
        if not os.path.exists(self.profile_path):
            self._create_default_profile()
    
    def _create_default_index(self) -> None:
        default_index = {
            "version": "3.0",
            "system": "正飞技能进化系统 V3.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "profile": {"static": [], "dynamic": []},
            "memories": [],
            "contradictions_resolved": [],
            "statistics": {
                "total_memories": 0,
                "total_contradictions_resolved": 0,
                "last_extraction": None,
                "last_cleanup": None
            }
        }
        with open(self.index_path, 'w', encoding='utf-8') as f:
            json.dump(default_index, f, ensure_ascii=False, indent=2)
    
    def _create_default_profile(self) -> None:
        default_profile = {
            "version": "3.0",
            "static": [],
            "dynamic": [],
            "updated_at": datetime.now().isoformat()
        }
        with open(self.profile_path, 'w', encoding='utf-8') as f:
            json.dump(default_profile, f, ensure_ascii=False, indent=2)
    
    def _load_data(self) -> None:
        with open(self.index_path, 'r', encoding='utf-8') as f:
            self.index_data = json.load(f)
        
        with open(self.profile_path, 'r', encoding='utf-8') as f:
            self.profile_data = json.load(f)
    
    def _save_index(self) -> None:
        self.index_data['updated_at'] = datetime.now().isoformat()
        with open(self.index_path, 'w', encoding='utf-8') as f:
            json.dump(self.index_data, f, ensure_ascii=False, indent=2)
    
    def _save_profile(self) -> None:
        self.profile_data['updated_at'] = datetime.now().isoformat()
        with open(self.profile_path, 'w', encoding='utf-8') as f:
            json.dump(self.profile_data, f, ensure_ascii=False, indent=2)
    
    def add_memory(
        self,
        text: str,
        confidence: float = 0.8,
        source: str = "conversation",
        tags: Optional[List[str]] = None,
        expires_in_days: Optional[int] = None
    ) -> Memory:
        now = datetime.now()
        expires_at = None
        if expires_in_days:
            expires_at = (now + timedelta(days=expires_in_days)).isoformat()
        
        memory = Memory(
            id=f"MEM-{uuid.uuid4().hex[:8].upper()}",
            text=text,
            confidence=confidence,
            source=source,
            created_at=now.isoformat(),
            last_accessed=now.isoformat(),
            access_count=0,
            expires_at=expires_at,
            tags=tags or []
        )
        
        contradiction = self._check_contradiction(memory)
        if contradiction:
            self._resolve_contradiction(contradiction, memory)
        else:
            self.index_data['memories'].append(memory.to_dict())
            self.index_data['statistics']['total_memories'] = len(self.index_data['memories'])
        
        self._save_index()
        return memory
    
    def _check_contradiction(self, new_memory: Memory) -> Optional[Dict[str, Any]]:
        new_text_lower = new_memory.text.lower()
        
        for existing in self.index_data['memories']:
            existing_text_lower = existing['text'].lower()
            
            if self._is_contradictory(new_text_lower, existing_text_lower):
                return existing
        
        return None
    
    def _is_contradictory(self, text1: str, text2: str) -> bool:
        contradiction_patterns = [
            (r'喜欢|偏好|习惯', r'不喜欢|讨厌'),
            (r'是|叫', r'不是|不叫'),
            (r'有', r'没有'),
            (r'使用|用', r'不使用|不用'),
        ]
        
        for positive, negative in contradiction_patterns:
            pos_re = re.compile(positive)
            neg_re = re.compile(negative)
            
            text1_has_pos = pos_re.search(text1) and not neg_re.search(text1)
            text1_has_neg = neg_re.search(text1)
            text2_has_pos = pos_re.search(text2) and not neg_re.search(text2)
            text2_has_neg = neg_re.search(text2)
            
            if (text1_has_pos and text2_has_neg) or (text1_has_neg and text2_has_pos):
                if self._same_topic(text1, text2):
                    return True
        
        return False
    
    def _same_topic(self, text1: str, text2: str) -> bool:
        words1 = set(re.findall(r'[\u4e00-\u9fa5]|[a-zA-Z]+', text1))
        words2 = set(re.findall(r'[\u4e00-\u9fa5]|[a-zA-Z]+', text2))
        
        common = words1 & words2
        if len(common) >= 2:
            return True
        
        return False
    
    def _resolve_contradiction(self, old_memory: Dict[str, Any], new_memory: Memory) -> None:
        contradiction_record = ContradictionRecord(
            old_text=old_memory['text'],
            new_text=new_memory.text,
            resolved_at=datetime.now().isoformat(),
            reason="newer_evidence_overrides"
        )
        
        self.index_data['memories'] = [
            m for m in self.index_data['memories']
            if m['id'] != old_memory['id']
        ]
        
        self.index_data['memories'].append(new_memory.to_dict())
        self.index_data['contradictions_resolved'].append(contradiction_record.to_dict())
        self.index_data['statistics']['total_contradictions_resolved'] = \
            len(self.index_data['contradictions_resolved'])
    
    def delete_memory(self, memory_id: str) -> bool:
        original_count = len(self.index_data['memories'])
        self.index_data['memories'] = [
            m for m in self.index_data['memories'] if m['id'] != memory_id
        ]
        
        if len(self.index_data['memories']) < original_count:
            self.index_data['statistics']['total_memories'] = len(self.index_data['memories'])
            self._save_index()
            return True
        return False
    
    def delete_memory_by_text(self, text: str) -> int:
        text_lower = text.lower()
        original_count = len(self.index_data['memories'])
        
        self.index_data['memories'] = [
            m for m in self.index_data['memories']
            if text_lower not in m['text'].lower()
        ]
        
        deleted_count = original_count - len(self.index_data['memories'])
        if deleted_count > 0:
            self.index_data['statistics']['total_memories'] = len(self.index_data['memories'])
            self._save_index()
        
        return deleted_count
    
    def cleanup_expired_memories(self) -> int:
        now = datetime.now()
        expired_ids = []
        
        for memory in self.index_data['memories']:
            if memory.get('expires_at'):
                try:
                    expires_at = datetime.fromisoformat(memory['expires_at'])
                    if expires_at < now:
                        expired_ids.append(memory['id'])
                except ValueError:
                    pass
        
        for memory_id in expired_ids:
            self.delete_memory(memory_id)
        
        self.index_data['statistics']['last_cleanup'] = now.isoformat()
        self._save_index()
        
        return len(expired_ids)
    
    def update_static_profile(self, items: List[Dict[str, Any]]) -> None:
        self.profile_data['static'] = items
        self._save_profile()
    
    def add_static_profile_item(self, text: str, confidence: float = 0.9, source: str = "extracted") -> None:
        item = ProfileItem(
            text=text,
            confidence=confidence,
            source=source,
            created_at=datetime.now().isoformat()
        )
        self.profile_data['static'].append(item.to_dict())
        self._save_profile()
    
    def update_dynamic_profile(self, new_activity: str, ttl_days: int = DEFAULT_DYNAMIC_TTL_DAYS) -> None:
        now = datetime.now()
        expires_at = now + timedelta(days=ttl_days)
        
        new_item = ProfileItem(
            text=new_activity,
            confidence=1.0,
            source="activity",
            created_at=now.isoformat(),
            ttl_days=ttl_days
        )
        
        self.profile_data['dynamic'].insert(0, new_item.to_dict())
        
        self.profile_data['dynamic'] = self.profile_data['dynamic'][:MAX_DYNAMIC_ITEMS]
        
        self._cleanup_expired_dynamic()
        self._save_profile()
    
    def _cleanup_expired_dynamic(self) -> None:
        now = datetime.now()
        valid_items = []
        
        for item in self.profile_data['dynamic']:
            if item.get('ttl_days'):
                created_at = datetime.fromisoformat(item['created_at'])
                expires_at = created_at + timedelta(days=item['ttl_days'])
                if expires_at > now:
                    valid_items.append(item)
            else:
                valid_items.append(item)
        
        self.profile_data['dynamic'] = valid_items
    
    def get_profile_summary(self) -> Dict[str, Any]:
        return {
            "static": self.profile_data.get('static', []),
            "dynamic": self.profile_data.get('dynamic', []),
            "total_memories": len(self.index_data.get('memories', [])),
            "last_updated": self.profile_data.get('updated_at')
        }
    
    def get_context_for_task(self, task_description: str) -> str:
        context_parts = []
        
        context_parts.append("## 用户画像")
        
        static_items = self.profile_data.get('static', [])
        if static_items:
            context_parts.append("### 稳定事实")
            for item in static_items[:5]:
                context_parts.append(f"- {item['text']}")
        
        dynamic_items = self.profile_data.get('dynamic', [])
        if dynamic_items:
            context_parts.append("### 近期活动")
            for item in dynamic_items[:5]:
                context_parts.append(f"- {item['text']}")
        
        relevant_memories = self._search_memories(task_description, top_k=5)
        if relevant_memories:
            context_parts.append("## 相关记忆")
            for memory in relevant_memories:
                context_parts.append(f"- {memory['text']}")
        
        return '\n'.join(context_parts)
    
    def _search_memories(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        query_terms = set(re.findall(r'[\u4e00-\u9fa5a-zA-Z]+', query.lower()))
        
        if not query_terms:
            return []
        
        scored = []
        for memory in self.index_data['memories']:
            text = memory['text'].lower()
            score = sum(1 for term in query_terms if term in text)
            if score > 0:
                scored.append((score, memory))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        return [m for _, m in scored[:top_k]]
    
    def get_statistics(self) -> Dict[str, Any]:
        return {
            "total_memories": len(self.index_data.get('memories', [])),
            "static_profile_items": len(self.profile_data.get('static', [])),
            "dynamic_profile_items": len(self.profile_data.get('dynamic', [])),
            "contradictions_resolved": len(self.index_data.get('contradictions_resolved', [])),
            "last_extraction": self.index_data.get('statistics', {}).get('last_extraction'),
            "last_cleanup": self.index_data.get('statistics', {}).get('last_cleanup')
        }

    def sync_to_memory_md(self, memory_md_path: str) -> int:
        """
        Sync memories to MEMORY.md format for OpenClaw/WeChat plugin.
        Returns the number of memories synced.
        """
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
        for memory in self.index_data.get('memories', []):
            text = memory.get('text', '').strip()
            if not text:
                continue
            normalized = re.sub(r'\s+', ' ', text.lower())
            if normalized not in existing_lines:
                new_lines.append(f"- {text}")
                existing_lines.add(normalized)

        for item in self.profile_data.get('static', []):
            text = item.get('text', '').strip()
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
    manager = MemoryManager()
    
    print("=== 正飞记忆管理器测试 ===\n")
    
    print("1. 添加记忆...")
    manager.add_memory("用户偏好 TypeScript 开发", confidence=0.9, source="conversation")
    manager.add_memory("用户是正飞信息技术开发者", confidence=0.95, source="identity")
    
    print("2. 更新动态画像...")
    manager.update_dynamic_profile("正在改进正飞进化系统到 V3.0")
    
    print("3. 测试矛盾处理...")
    manager.add_memory("用户不喜欢 JavaScript", confidence=0.85, source="preference")
    
    print("4. 获取统计信息...")
    stats = manager.get_statistics()
    print(f"   总记忆数: {stats['total_memories']}")
    print(f"   静态画像项: {stats['static_profile_items']}")
    print(f"   动态画像项: {stats['dynamic_profile_items']}")
    print(f"   已解决矛盾: {stats['contradictions_resolved']}")
    
    print("\n5. 获取任务上下文...")
    context = manager.get_context_for_task("开发正飞进化系统")
    print(context)
