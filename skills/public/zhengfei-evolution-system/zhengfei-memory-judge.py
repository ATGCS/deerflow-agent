# -*- coding: utf-8 -*-
"""
正飞记忆判断器 - 验证记忆候选
移植自 coworkMemoryJudge.ts
正飞信息技术出品
"""

import os
import sys
import re
import json
import hashlib
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional, Literal, Dict, Any, List
from datetime import datetime
from enum import Enum

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()
sys.path.insert(0, SCRIPT_DIR)

import importlib.util
spec = importlib.util.spec_from_file_location(
    "zhengfei_memory_extractor",
    os.path.join(SCRIPT_DIR, "zhengfei-memory-extractor.py")
)
extractor_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor_module)
GuardLevel = extractor_module.GuardLevel
is_question_like_memory_text = extractor_module.is_question_like_memory_text


FACTUAL_PROFILE_RE = re.compile(
    r'(我叫|我是|我的名字|我名字|我来自|我住在|我的职业|我有(?!\s*(?:一个|个)?问题)|我养了|我喜欢|我偏好|我习惯|\bmy\s+name\s+is\b|\bi\s+am\b|\bi[\'’]?m\b|\bi\s+live\s+in\b|\bi[\'’]?m\s+from\b|\bi\s+work\s+as\b|\bi\s+have\b|\bi\s+prefer\b|\bi\s+like\b|\bi\s+usually\b)',
    re.IGNORECASE
)

TRANSIENT_RE = re.compile(
    r'(今天|昨日|昨天|刚刚|刚才|本周|本月|临时|暂时|这次|当前|today|yesterday|this\s+week|this\s+month|temporary|for\s+now)',
    re.IGNORECASE
)

PROCEDURAL_RE = re.compile(
    r'(执行以下命令|run\s+(?:the\s+)?following\s+command|\b(?:cd|npm|pnpm|yarn|node|python|bash|sh|git|curl|wget)\b|\$[A-Z_][A-Z0-9_]*|&&|--[a-z0-9-]+|/tmp/|\.sh\b|\.bat\b|\.ps1\b)',
    re.IGNORECASE
)

REQUEST_STYLE_RE = re.compile(
    r'^(?:请|麻烦|帮我|请你|帮忙|请帮我|use|please|can you|could you|would you)',
    re.IGNORECASE
)

ASSISTANT_STYLE_RE = re.compile(
    r'((请|以后|后续|默认|请始终|不要再|请不要|优先|务必).*(回复|回答|语言|中文|英文|格式|风格|语气|简洁|详细|代码|命名|markdown|respond|reply|language|format|style|tone))',
    re.IGNORECASE
)

LLM_BORDERLINE_MARGIN = 0.08
LLM_MIN_CONFIDENCE = 0.55
LLM_TIMEOUT_MS = 5000
LLM_CACHE_MAX_SIZE = 256
LLM_CACHE_TTL_MS = 10 * 60 * 1000
LLM_INPUT_MAX_CHARS = 280


@dataclass
class MemoryJudgeInput:
    text: str
    is_explicit: bool
    guard_level: GuardLevel
    llm_enabled: bool = False
    api_config: Optional[Dict[str, str]] = None


@dataclass
class MemoryJudgeResult:
    accepted: bool
    score: float
    reason: str
    source: Literal["rule", "llm"]


@dataclass
class CachedLlmJudgeResult:
    value: MemoryJudgeResult
    created_at: float


_llm_judge_cache: Dict[str, CachedLlmJudgeResult] = {}


def threshold_by_guard_level(is_explicit: bool, guard_level: GuardLevel) -> float:
    if is_explicit:
        if guard_level == GuardLevel.STRICT:
            return 0.7
        if guard_level == GuardLevel.RELAXED:
            return 0.52
        return 0.6
    if guard_level == GuardLevel.STRICT:
        return 0.8
    if guard_level == GuardLevel.RELAXED:
        return 0.62
    return 0.72


def normalize_text(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


def clamp01(value: float) -> float:
    if not isinstance(value, (int, float)) or not float('-inf') < value < float('inf'):
        return 0.0
    return max(0.0, min(1.0, float(value)))


def should_call_llm_for_boundary_case(score: float, threshold: float, reason: str) -> bool:
    if reason in ('empty', 'question-like', 'procedural-like'):
        return False
    return abs(score - threshold) <= LLM_BORDERLINE_MARGIN


def build_llm_cache_key(input_obj: MemoryJudgeInput) -> str:
    return f"{input_obj.guard_level.value}|{1 if input_obj.is_explicit else 0}|{normalize_text(input_obj.text)}"


def get_cached_llm_result(key: str) -> Optional[MemoryJudgeResult]:
    cached = _llm_judge_cache.get(key)
    if not cached:
        return None
    if (datetime.now().timestamp() * 1000 - cached.created_at) > LLM_CACHE_TTL_MS:
        del _llm_judge_cache[key]
        return None
    return cached.value


def set_cached_llm_result(key: str, value: MemoryJudgeResult) -> None:
    _llm_judge_cache[key] = CachedLlmJudgeResult(
        value=value,
        created_at=datetime.now().timestamp() * 1000
    )
    while len(_llm_judge_cache) > LLM_CACHE_MAX_SIZE:
        oldest_key = next(iter(_llm_judge_cache.keys()), None)
        if oldest_key:
            del _llm_judge_cache[oldest_key]
        else:
            break


def score_memory_text(text: str) -> tuple[float, str]:
    normalized = normalize_text(text)
    if not normalized:
        return 0.0, 'empty'
    if is_question_like_memory_text(normalized):
        return 0.05, 'question-like'
    
    score = 0.5
    strongest_reason = 'neutral'
    
    if FACTUAL_PROFILE_RE.search(normalized):
        score += 0.28
        strongest_reason = 'factual-personal'
    
    if ASSISTANT_STYLE_RE.search(normalized):
        score += 0.1
        if strongest_reason == 'neutral':
            strongest_reason = 'assistant-preference'
    
    if REQUEST_STYLE_RE.search(normalized):
        score -= 0.14
        if strongest_reason == 'neutral':
            strongest_reason = 'request-like'
    
    if TRANSIENT_RE.search(normalized):
        score -= 0.18
        if strongest_reason == 'neutral':
            strongest_reason = 'transient-like'
    
    if PROCEDURAL_RE.search(normalized):
        score -= 0.4
        strongest_reason = 'procedural-like'
    
    if len(normalized) < 6:
        score -= 0.2
    elif len(normalized) <= 120:
        score += 0.06
    elif len(normalized) > 240:
        score -= 0.08
    
    return clamp01(score), strongest_reason


def build_anthropic_messages_url(base_url: str) -> str:
    normalized = base_url.rstrip('/')
    if not normalized:
        return '/v1/messages'
    if normalized.endswith('/v1/messages'):
        return normalized
    if normalized.endswith('/v1'):
        return f"{normalized}/messages"
    return f"{normalized}/v1/messages"


def extract_text_from_anthropic_response(payload: Dict[str, Any]) -> str:
    if not payload or not isinstance(payload, dict):
        return ''
    
    content = payload.get('content')
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get('text'), str):
                texts.append(item['text'])
        return '\n'.join(texts).strip()
    
    if isinstance(content, str):
        return content.strip()
    
    if isinstance(payload.get('output_text'), str):
        return payload['output_text'].strip()
    
    return ''


def parse_llm_judge_payload(text: str) -> Optional[Dict[str, Any]]:
    if not text.strip():
        return None
    
    trimmed = text.strip()
    fenced = re.search(r'```(?:json)?\s*([\s\S]*?)```', trimmed, re.IGNORECASE)
    candidate = fenced.group(1).strip() if fenced else trimmed
    
    first_brace = candidate.find('{')
    last_brace = candidate.rfind('}')
    if first_brace < 0 or last_brace <= first_brace:
        return None
    
    try:
        parsed = json.loads(candidate[first_brace:last_brace + 1])
        
        accepted_raw = parsed.get('accepted')
        decision_raw = parsed.get('decision')
        confidence_raw = parsed.get('confidence')
        reason_raw = parsed.get('reason')
        
        if isinstance(accepted_raw, bool):
            accepted = accepted_raw
        elif isinstance(decision_raw, str):
            accepted = bool(re.search(r'(accept|allow|yes|true|pass)', decision_raw, re.IGNORECASE))
        else:
            accepted = False
        
        if isinstance(confidence_raw, (int, float)):
            confidence = clamp01(float(confidence_raw))
        elif isinstance(confidence_raw, str):
            confidence = clamp01(float(confidence_raw))
        else:
            confidence = 0.0
        
        reason = str(reason_raw).strip() if isinstance(reason_raw, str) else 'llm'
        
        return {'accepted': accepted, 'confidence': confidence, 'reason': reason}
    except (json.JSONDecodeError, ValueError):
        return None


def judge_with_llm(
    input_obj: MemoryJudgeInput,
    rule_score: float,
    threshold: float,
    rule_reason: str
) -> Optional[MemoryJudgeResult]:
    api_config = input_obj.api_config
    if not api_config:
        return None
    
    base_url = api_config.get('baseURL', '')
    api_key = api_config.get('apiKey', '')
    model = api_config.get('model', 'claude-3-5-sonnet-20241022')
    
    if not api_key:
        return None
    
    url = build_anthropic_messages_url(base_url)
    normalized_text = normalize_text(input_obj.text)[:LLM_INPUT_MAX_CHARS]
    if not normalized_text:
        return None
    
    system_prompt = (
        'You classify whether a sentence is durable long-term user memory. '
        'Accept only stable personal facts or stable assistant preferences. '
        'Reject questions, temporary context, one-off tasks, and procedural command text. '
        'Return JSON only: {"accepted":boolean,"confidence":number,"reason":string}'
    )
    
    user_prompt = json.dumps({
        'text': normalized_text,
        'is_explicit': input_obj.is_explicit,
        'guard_level': input_obj.guard_level.value,
        'rule_score': round(rule_score, 3),
        'threshold': round(threshold, 3),
        'rule_reason': rule_reason,
    }, ensure_ascii=False)
    
    request_body = {
        'model': model,
        'max_tokens': 120,
        'temperature': 0,
        'system': system_prompt,
        'messages': [{'role': 'user', 'content': user_prompt}],
    }
    
    try:
        req = urllib.request.Request(
            url if url.startswith('http') else f"https://api.anthropic.com{url}",
            data=json.dumps(request_body).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT_MS / 1000) as response:
            payload = json.loads(response.read().decode('utf-8'))
        
        text = extract_text_from_anthropic_response(payload)
        parsed = parse_llm_judge_payload(text)
        
        if not parsed or parsed['confidence'] < LLM_MIN_CONFIDENCE:
            return None
        
        return MemoryJudgeResult(
            accepted=parsed['accepted'],
            score=parsed['confidence'],
            reason=f"llm:{parsed['reason'] or 'boundary'}",
            source='llm'
        )
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, ValueError, TimeoutError):
        return None


def judge_memory_candidate(input_obj: MemoryJudgeInput) -> MemoryJudgeResult:
    score, reason = score_memory_text(input_obj.text)
    threshold = threshold_by_guard_level(input_obj.is_explicit, input_obj.guard_level)
    
    rule_result = MemoryJudgeResult(
        accepted=score >= threshold,
        score=score,
        reason=reason,
        source='rule'
    )
    
    if not should_call_llm_for_boundary_case(score, threshold, reason):
        return rule_result
    
    if not input_obj.llm_enabled:
        return rule_result
    
    cache_key = build_llm_cache_key(input_obj)
    cached = get_cached_llm_result(cache_key)
    if cached:
        return cached
    
    llm_result = judge_with_llm(input_obj, score, threshold, reason)
    if not llm_result:
        return rule_result
    
    set_cached_llm_result(cache_key, llm_result)
    return llm_result


if __name__ == "__main__":
    test_cases = [
        ("我叫张三，是正飞信息技术的开发者", False, GuardLevel.STANDARD),
        ("今天天气怎么样？", False, GuardLevel.STANDARD),
        ("请记住我喜欢用TypeScript", True, GuardLevel.STANDARD),
        ("执行以下命令: npm install", False, GuardLevel.STANDARD),
    ]
    
    print("记忆判断测试：")
    for text, is_explicit, guard_level in test_cases:
        input_obj = MemoryJudgeInput(text=text, is_explicit=is_explicit, guard_level=guard_level)
        result = judge_memory_candidate(input_obj)
        status = "✓ 接受" if result.accepted else "✗ 拒绝"
        print(f"  {status} | 分数: {result.score:.2f} | 原因: {result.reason} | 文本: {text[:30]}...")
