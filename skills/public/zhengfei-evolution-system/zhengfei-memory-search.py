# -*- coding: utf-8 -*-
"""
正飞记忆搜索 - 本地搜索功能
正飞信息技术出品
"""

import os
import json
import re
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from collections import Counter

MEMORY_DIR = os.path.dirname(os.path.abspath(__file__))
MEMORY_INDEX_PATH = os.path.join(MEMORY_DIR, "zhengfei-memory", "index.json")
PROFILE_PATH = os.path.join(MEMORY_DIR, "zhengfei-memory", "profile.json")


@dataclass
class SearchResult:
    text: str
    score: float
    source: str
    memory_id: Optional[str]
    created_at: str
    highlights: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'text': self.text,
            'score': self.score,
            'source': self.source,
            'memory_id': self.memory_id,
            'created_at': self.created_at,
            'highlights': self.highlights
        }


class MemorySearch:
    def __init__(self, memory_dir: Optional[str] = None):
        if memory_dir:
            self.memory_dir = memory_dir
            self.index_path = os.path.join(memory_dir, "index.json")
            self.profile_path = os.path.join(memory_dir, "profile.json")
        else:
            self.memory_dir = MEMORY_DIR
            self.index_path = MEMORY_INDEX_PATH
            self.profile_path = PROFILE_PATH
        
        self._load_data()
    
    def _load_data(self) -> None:
        self.index_data = {}
        self.profile_data = {}
        
        if os.path.exists(self.index_path):
            with open(self.index_path, 'r', encoding='utf-8') as f:
                self.index_data = json.load(f)
        
        if os.path.exists(self.profile_path):
            with open(self.profile_path, 'r', encoding='utf-8') as f:
                self.profile_data = json.load(f)
    
    def _tokenize(self, text: str) -> List[str]:
        tokens = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+|[0-9]+', text.lower())
        return tokens
    
    def _highlight_matches(self, text: str, query_terms: set) -> Tuple[str, List[str]]:
        highlights = []
        highlighted_text = text
        
        for term in query_terms:
            pattern = re.compile(re.escape(term), re.IGNORECASE)
            if pattern.search(text):
                highlights.append(term)
        
        return highlighted_text, highlights
    
    def search(
        self,
        query: str,
        top_k: int = 10,
        include_profile: bool = True,
        include_memories: bool = True,
        min_score: float = 0.1
    ) -> List[SearchResult]:
        query_terms = set(self._tokenize(query))
        
        if not query_terms:
            return []
        
        results: List[SearchResult] = []
        
        if include_profile:
            results.extend(self._search_profile(query_terms))
        
        if include_memories:
            results.extend(self._search_memories(query_terms))
        
        results.sort(key=lambda x: x.score, reverse=True)
        
        filtered = [r for r in results if r.score >= min_score]
        
        return filtered[:top_k]
    
    def _search_profile(self, query_terms: set) -> List[SearchResult]:
        results: List[SearchResult] = []
        
        static_items = self.profile_data.get('static', [])
        for item in static_items:
            text = item.get('text', '')
            score = self._calculate_score(text, query_terms)
            
            if score > 0:
                _, highlights = self._highlight_matches(text, query_terms)
                results.append(SearchResult(
                    text=text,
                    score=score * 1.2,
                    source='profile:static',
                    memory_id=None,
                    created_at=item.get('created_at', ''),
                    highlights=highlights
                ))
        
        dynamic_items = self.profile_data.get('dynamic', [])
        for item in dynamic_items:
            text = item.get('text', '')
            score = self._calculate_score(text, query_terms)
            
            if score > 0:
                _, highlights = self._highlight_matches(text, query_terms)
                results.append(SearchResult(
                    text=text,
                    score=score,
                    source='profile:dynamic',
                    memory_id=None,
                    created_at=item.get('created_at', ''),
                    highlights=highlights
                ))
        
        return results
    
    def _search_memories(self, query_terms: set) -> List[SearchResult]:
        results: List[SearchResult] = []
        
        memories = self.index_data.get('memories', [])
        for memory in memories:
            text = memory.get('text', '')
            score = self._calculate_score(text, query_terms)
            
            if score > 0:
                _, highlights = self._highlight_matches(text, query_terms)
                
                confidence = memory.get('confidence', 0.5)
                access_count = memory.get('access_count', 0)
                
                adjusted_score = score * (0.8 + 0.2 * confidence)
                adjusted_score += min(0.1, access_count * 0.01)
                
                results.append(SearchResult(
                    text=text,
                    score=adjusted_score,
                    source=f"memory:{memory.get('source', 'unknown')}",
                    memory_id=memory.get('id'),
                    created_at=memory.get('created_at', ''),
                    highlights=highlights
                ))
        
        return results
    
    def _calculate_score(self, text: str, query_terms: set) -> float:
        text_tokens = self._tokenize(text)
        text_token_set = set(text_tokens)
        
        matching_terms = query_terms & text_token_set
        
        if not matching_terms:
            return 0.0
        
        term_frequency = Counter(text_tokens)
        total_terms = len(text_tokens)
        
        score = 0.0
        for term in matching_terms:
            tf = term_frequency.get(term, 0) / total_terms if total_terms > 0 else 0
            score += tf
        
        coverage = len(matching_terms) / len(query_terms)
        score = score * 0.5 + coverage * 0.5
        
        return min(1.0, score)
    
    def search_by_tag(self, tag: str, top_k: int = 10) -> List[SearchResult]:
        results: List[SearchResult] = []
        
        memories = self.index_data.get('memories', [])
        for memory in memories:
            tags = memory.get('tags', [])
            if tag.lower() in [t.lower() for t in tags]:
                results.append(SearchResult(
                    text=memory.get('text', ''),
                    score=1.0,
                    source=f"memory:{memory.get('source', 'unknown')}",
                    memory_id=memory.get('id'),
                    created_at=memory.get('created_at', ''),
                    highlights=[tag]
                ))
        
        return results[:top_k]
    
    def search_by_source(self, source: str, top_k: int = 10) -> List[SearchResult]:
        results: List[SearchResult] = []
        
        memories = self.index_data.get('memories', [])
        for memory in memories:
            if memory.get('source', '').lower() == source.lower():
                results.append(SearchResult(
                    text=memory.get('text', ''),
                    score=1.0,
                    source=f"memory:{memory.get('source', 'unknown')}",
                    memory_id=memory.get('id'),
                    created_at=memory.get('created_at', ''),
                    highlights=[]
                ))
        
        return results[:top_k]
    
    def get_recent_memories(self, days: int = 7, top_k: int = 10) -> List[SearchResult]:
        from datetime import datetime, timedelta
        
        cutoff = datetime.now() - timedelta(days=days)
        results: List[SearchResult] = []
        
        memories = self.index_data.get('memories', [])
        for memory in memories:
            created_at_str = memory.get('created_at', '')
            try:
                created_at = datetime.fromisoformat(created_at_str)
                if created_at >= cutoff:
                    results.append(SearchResult(
                        text=memory.get('text', ''),
                        score=1.0,
                        source=f"memory:{memory.get('source', 'unknown')}",
                        memory_id=memory.get('id'),
                        created_at=created_at_str,
                        highlights=[]
                    ))
            except ValueError:
                pass
        
        results.sort(key=lambda x: x.created_at, reverse=True)
        return results[:top_k]
    
    def get_context_for_query(self, query: str, max_items: int = 10) -> str:
        results = self.search(query, top_k=max_items)
        
        if not results:
            return ""
        
        context_parts = ["## 相关上下文\n"]
        
        profile_results = [r for r in results if r.source.startswith('profile:')]
        memory_results = [r for r in results if r.source.startswith('memory:')]
        
        if profile_results:
            context_parts.append("### 用户画像")
            for r in profile_results[:3]:
                context_parts.append(f"- {r.text}")
        
        if memory_results:
            context_parts.append("\n### 相关记忆")
            for r in memory_results[:5]:
                context_parts.append(f"- {r.text}")
        
        return '\n'.join(context_parts)
    
    def suggest_queries(self, prefix: str = "") -> List[str]:
        all_terms: set = set()
        
        memories = self.index_data.get('memories', [])
        for memory in memories:
            text = memory.get('text', '')
            tokens = self._tokenize(text)
            all_terms.update(tokens)
        
        static_items = self.profile_data.get('static', [])
        dynamic_items = self.profile_data.get('dynamic', [])
        
        for item in static_items + dynamic_items:
            text = item.get('text', '')
            tokens = self._tokenize(text)
            all_terms.update(tokens)
        
        suggestions = [t for t in all_terms if len(t) >= 2]
        
        if prefix:
            suggestions = [s for s in suggestions if s.startswith(prefix.lower())]
        
        return sorted(suggestions)[:20]


if __name__ == "__main__":
    search = MemorySearch()
    
    print("=== 正飞记忆搜索测试 ===\n")
    
    print("1. 搜索测试...")
    results = search.search("TypeScript 开发", top_k=5)
    for r in results:
        print(f"   [{r.source}] {r.text} (分数: {r.score:.2f})")
    
    print("\n2. 获取上下文...")
    context = search.get_context_for_query("开发")
    print(context)
    
    print("\n3. 搜索建议...")
    suggestions = search.suggest_queries("开")
    print(f"   建议词: {', '.join(suggestions[:10])}")
