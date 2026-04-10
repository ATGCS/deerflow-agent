# -*- coding: utf-8 -*-
"""
正飞记忆提取器 - 从对话中提取记忆候选
移植自 coworkMemoryExtractor.ts
正飞信息技术出品
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Literal
from enum import Enum


class GuardLevel(Enum):
    STRICT = "strict"
    STANDARD = "standard"
    RELAXED = "relaxed"


@dataclass
class ExtractedMemoryChange:
    action: Literal["add", "delete"]
    text: str
    confidence: float
    is_explicit: bool
    reason: str


EXPLICIT_ADD_RE = re.compile(
    r'(?:^|\n)\s*(?:请)?(?:记住|记下|保存到记忆|保存记忆|写入记忆|remember(?:\s+this|\s+that)?|store\s+(?:this|that)\s+in\s+memory)\s*[:：,，]?\s*(.+)$',
    re.MULTILINE | re.IGNORECASE
)

EXPLICIT_DELETE_RE = re.compile(
    r'(?:^|\n)\s*(?:请)?(?:删除记忆|从记忆中删除|忘掉|忘记这条|forget\s+this|remove\s+from\s+memory)\s*[:：,，]?\s*(.+)$',
    re.MULTILINE | re.IGNORECASE
)

CODE_BLOCK_RE = re.compile(r'```[\s\S]*?```', re.MULTILINE)

SMALL_TALK_RE = re.compile(r'^(ok|okay|thanks|thank\s+you|好的|收到|明白|行|嗯|谢谢)[.!? ]*$', re.IGNORECASE)

SHORT_FACT_SIGNAL_RE = re.compile(
    r'(我叫|我是|我的名字是|我名字是|名字叫|我有(?!\s*(?:一个|个)?问题)|我养了|我家有|\bmy\s+name\s+is\b|\bi\s+am\b|\bi[\'’]?m\b|\bi\s+have\b|\bi\s+own\b)',
    re.IGNORECASE
)

NON_DURABLE_TOPIC_RE = re.compile(
    r'(我有\s*(?:一个|个)?问题|有个问题|报错|出现异常|exception|stack\s*trace)',
    re.IGNORECASE
)

PERSONAL_PROFILE_SIGNAL_RE = re.compile(
    r'(我叫|我是|我的名字是|我名字是|名字叫|我住在|我来自|我是做|我的职业|\bmy\s+name\s+is\b|\bi\s+am\b|\bi[\'’]?m\b|\bi\s+live\s+in\b|\bi[\'’]?m\s+from\b|\bi\s+work\s+as\b)',
    re.IGNORECASE
)

PERSONAL_OWNERSHIP_SIGNAL_RE = re.compile(
    r'(我有(?!\s*(?:一个|个)?问题)|我养了|我家有|我女儿|我儿子|我的孩子|我的小狗|我的小猫|\bi\s+have\b|\bi\s+own\b|\bmy\s+(?:daughter|son|child|dog|cat)\b)',
    re.IGNORECASE
)

PERSONAL_PREFERENCE_SIGNAL_RE = re.compile(
    r'(我喜欢|我偏好|我习惯|我常用|我不喜欢|我讨厌|我更喜欢|\bi\s+prefer\b|\bi\s+like\b|\bi\s+usually\b|\bi\s+often\b|\bi\s+don[\'’]?\s*t\s+like\b|\bi\s+hate\b)',
    re.IGNORECASE
)

ASSISTANT_PREFERENCE_SIGNAL_RE = re.compile(
    r'((请|以后|后续|默认|请始终|不要再|请不要|优先|务必).*(回复|回答|语言|中文|英文|格式|风格|语气|简洁|详细|代码|命名|markdown|respond|reply|language|format|style|tone))',
    re.IGNORECASE
)

SOURCE_STYLE_LINE_RE = re.compile(r'^(?:来源|source)\s*[:：]', re.IGNORECASE)

ATTACHMENT_STYLE_LINE_RE = re.compile(r'^(?:输入文件|input\s*file)\s*[:：]', re.IGNORECASE)

TRANSIENT_SIGNAL_RE = re.compile(
    r'(今天|昨日|昨天|刚刚|刚才|本周|本月|news|breaking|快讯|新闻|\b(19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}\b|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)',
    re.IGNORECASE
)

REQUEST_TAIL_SPLIT_RE = re.compile(
    r'[,，。]\s*(?:请|麻烦)?你(?:帮我|帮忙|给我|为我|看下|看一下|查下|查一下)|[,，。]\s*帮我|[,，。]\s*请帮我|[,，。]\s*(?:能|可以)不能?\s*帮我|[,，。]\s*你看|[,，。]\s*请你',
    re.IGNORECASE
)

PROCEDURAL_CANDIDATE_RE = re.compile(
    r'(执行以下命令|run\s+(?:the\s+)?following\s+command|\b(?:cd|npm|pnpm|yarn|node|python|bash|sh|git|curl|wget)\b|\$[A-Z_][A-Z0-9_]*|&&|--[a-z0-9-]+|/tmp/|\.sh\b|\.bat\b|\.ps1\b)',
    re.IGNORECASE
)

ASSISTANT_STYLE_CANDIDATE_RE = re.compile(r'^(?:使用|use)\s+[A-Za-z0-9._-]+\s*(?:技能|skill)', re.IGNORECASE)

CHINESE_QUESTION_PREFIX_RE = re.compile(
    r'^(?:请问|问下|问一下|是否|能否|可否|为什么|为何|怎么|如何|谁|什么|哪(?:里|儿|个)?|几|多少|要不要|会不会|是不是|能不能|可不可以|行不行|对不对|好不好)',
    re.UNICODE
)

ENGLISH_QUESTION_PREFIX_RE = re.compile(
    r'^(?:what|who|why|how|when|where|which|is|are|am|do|does|did|can|could|would|will|should)\b',
    re.IGNORECASE
)

QUESTION_INLINE_RE = re.compile(r'(是不是|能不能|可不可以|要不要|会不会|有没有|对不对|好不好)', re.IGNORECASE)

QUESTION_SUFFIX_RE = re.compile(r'(吗|么|呢|嘛)\s*$', re.UNICODE)


def normalize_text(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


def is_question_like_memory_text(text: str) -> bool:
    normalized = re.sub(r'[。！!]+$', '', normalize_text(text)).strip()
    if not normalized:
        return False
    if re.search(r'[？?]\s*$', normalized):
        return True
    if CHINESE_QUESTION_PREFIX_RE.match(normalized):
        return True
    if ENGLISH_QUESTION_PREFIX_RE.match(normalized):
        return True
    if QUESTION_INLINE_RE.search(normalized):
        return True
    if QUESTION_SUFFIX_RE.search(normalized):
        return True
    return False


def should_keep_candidate(text: str) -> bool:
    trimmed = normalize_text(text)
    if not trimmed:
        return False
    if len(trimmed) < 6 and not SHORT_FACT_SIGNAL_RE.search(trimmed):
        return False
    if SMALL_TALK_RE.match(trimmed):
        return False
    if is_question_like_memory_text(trimmed):
        return False
    if ASSISTANT_STYLE_CANDIDATE_RE.match(trimmed):
        return False
    if PROCEDURAL_CANDIDATE_RE.search(trimmed):
        return False
    return True


def sanitize_implicit_candidate(text: str) -> str:
    normalized = normalize_text(text)
    if not normalized:
        return ''
    tail_match = REQUEST_TAIL_SPLIT_RE.search(normalized)
    if tail_match and tail_match.start() > 0:
        clipped = normalized[:tail_match.start()]
    else:
        clipped = normalized
    return normalize_text(re.sub(r'[，,；;:\-]+$', '', clipped))


def confidence_threshold(level: GuardLevel) -> float:
    if level == GuardLevel.STRICT:
        return 0.85
    if level == GuardLevel.RELAXED:
        return 0.5
    return 0.65


def extract_explicit(
    text: str,
    action: Literal["add", "delete"],
    pattern: re.Pattern,
    reason: str
) -> List[ExtractedMemoryChange]:
    result: List[ExtractedMemoryChange] = []
    seen: set = set()
    
    for match in pattern.finditer(text):
        raw = normalize_text(match.group(1) or '')
        if not should_keep_candidate(raw):
            continue
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(ExtractedMemoryChange(
            action=action,
            text=raw,
            confidence=0.99,
            is_explicit=True,
            reason=reason
        ))
    
    return result


def extract_implicit(
    user_text: str,
    assistant_text: str,
    guard_level: GuardLevel,
    max_implicit_adds: int = 2
) -> List[ExtractedMemoryChange]:
    max_adds = max(0, min(2, max_implicit_adds))
    if max_adds == 0:
        return []
    
    threshold = confidence_threshold(guard_level)
    stripped_user = CODE_BLOCK_RE.sub(' ', user_text).strip()
    stripped_assistant = CODE_BLOCK_RE.sub(' ', assistant_text).strip()
    
    if not stripped_user or not stripped_assistant:
        return []
    
    candidates = [normalize_text(line) for line in re.split(r'[。！？!?；;\n]', stripped_user)]
    candidates = [c for c in candidates if c]
    
    result: List[ExtractedMemoryChange] = []
    seen: set = set()
    
    for raw_candidate in candidates:
        candidate = sanitize_implicit_candidate(raw_candidate)
        if not should_keep_candidate(candidate):
            continue
        
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        
        if NON_DURABLE_TOPIC_RE.search(candidate):
            continue
        
        if SOURCE_STYLE_LINE_RE.search(candidate) or ATTACHMENT_STYLE_LINE_RE.search(candidate):
            continue
        
        if (TRANSIENT_SIGNAL_RE.search(candidate) and
            not PERSONAL_PROFILE_SIGNAL_RE.search(candidate) and
            not PERSONAL_OWNERSHIP_SIGNAL_RE.search(candidate) and
            not ASSISTANT_PREFERENCE_SIGNAL_RE.search(candidate)):
            continue
        
        confidence = 0.0
        reason = ''
        
        if PERSONAL_PROFILE_SIGNAL_RE.search(candidate):
            confidence = 0.93
            reason = 'implicit:personal-profile'
        elif PERSONAL_OWNERSHIP_SIGNAL_RE.search(candidate):
            confidence = 0.9
            reason = 'implicit:personal-ownership'
        elif PERSONAL_PREFERENCE_SIGNAL_RE.search(candidate):
            confidence = 0.88
            reason = 'implicit:personal-preference'
        elif ASSISTANT_PREFERENCE_SIGNAL_RE.search(candidate):
            confidence = 0.86
            reason = 'implicit:assistant-preference'
        
        if confidence == 0:
            continue
        if confidence < threshold:
            continue
        
        result.append(ExtractedMemoryChange(
            action='add',
            text=candidate,
            confidence=confidence,
            is_explicit=False,
            reason=reason
        ))
        
        if len(result) >= max_adds:
            break
    
    return result


def extract_turn_memory_changes(
    user_text: str,
    assistant_text: str,
    guard_level: GuardLevel = GuardLevel.STANDARD,
    max_implicit_adds: int = 2
) -> List[ExtractedMemoryChange]:
    user_text = (user_text or '').strip()
    assistant_text = (assistant_text or '').strip()
    
    if not user_text or not assistant_text:
        return []
    
    explicit_adds = extract_explicit(user_text, 'add', EXPLICIT_ADD_RE, 'explicit:add-command')
    explicit_deletes = extract_explicit(user_text, 'delete', EXPLICIT_DELETE_RE, 'explicit:delete-command')
    implicit_adds = extract_implicit(user_text, assistant_text, guard_level, max_implicit_adds)
    
    merged: List[ExtractedMemoryChange] = []
    seen: set = set()
    
    for entry in explicit_deletes + explicit_adds + implicit_adds:
        key = f"{entry.action}|{entry.text.lower()}"
        if key in seen:
            continue
        seen.add(key)
        merged.append(entry)
    
    return merged


if __name__ == "__main__":
    test_user = "我叫张三，我喜欢用TypeScript开发。请记住：我正在开发正飞进化系统。"
    test_assistant = "好的，我了解了您的偏好。我会帮您改进正飞进化系统。"
    
    changes = extract_turn_memory_changes(test_user, test_assistant, GuardLevel.STANDARD)
    
    print("提取的记忆候选：")
    for change in changes:
        print(f"  [{change.action}] {change.text} (置信度: {change.confidence:.2f}, 原因: {change.reason})")
