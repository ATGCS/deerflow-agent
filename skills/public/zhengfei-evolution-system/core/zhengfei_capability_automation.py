# -*- coding: utf-8 -*-
# 正飞能力自动化引擎 V1.0 - 能力识别、生成与复用
# 自动识别和生成能力卡片，自动应用到相似任务
# 正飞信息技术出品

import os
import json
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, asdict
from collections import defaultdict
import hashlib

CAPABILITIES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zhengfei-capabilities")
MATERIALS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zhengfei-materials")
EFFECTIVENESS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zhengfei-memory", "capability-effectiveness.json")


@dataclass
class CapabilityCard:
    id: str
    name: str
    description: str
    trigger_conditions: List[str]
    core_value: str
    implementation: str
    scope: List[str]
    risks: List[str]
    created_at: str
    updated_at: str
    usage_count: int
    effectiveness_score: float
    auto_generated: bool
    source_material: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CapabilityCard':
        return cls(
            id=data.get('id', ''),
            name=data.get('name', ''),
            description=data.get('description', ''),
            trigger_conditions=data.get('trigger_conditions', []),
            core_value=data.get('core_value', ''),
            implementation=data.get('implementation', ''),
            scope=data.get('scope', []),
            risks=data.get('risks', []),
            created_at=data.get('created_at', datetime.now().isoformat()),
            updated_at=data.get('updated_at', datetime.now().isoformat()),
            usage_count=data.get('usage_count', 0),
            effectiveness_score=data.get('effectiveness_score', 0.5),
            auto_generated=data.get('auto_generated', False),
            source_material=data.get('source_material')
        )


@dataclass
class TaskMatch:
    capability_id: str
    capability_name: str
    match_score: float
    matched_conditions: List[str]
    suggested_actions: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CapabilityAutomationEngine:
    def __init__(self, base_dir: Optional[str] = None):
        if base_dir:
            self.capabilities_dir = os.path.join(base_dir, "zhengfei-capabilities")
            self.materials_dir = os.path.join(base_dir, "zhengfei-materials")
        else:
            self.capabilities_dir = CAPABILITIES_DIR
            self.materials_dir = MATERIALS_DIR
        
        self.effectiveness_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "zhengfei-memory",
            "capability-effectiveness.json"
        )
        
        self.capabilities: Dict[str, CapabilityCard] = {}
        self.effectiveness_data: Dict[str, Any] = {}
        
        self._ensure_directories()
        self._load_data()
    
    def _ensure_directories(self) -> None:
        os.makedirs(self.capabilities_dir, exist_ok=True)
        os.makedirs(self.materials_dir, exist_ok=True)
        
        memory_dir = os.path.dirname(self.effectiveness_path)
        if not os.path.exists(memory_dir):
            os.makedirs(memory_dir, exist_ok=True)
        
        if not os.path.exists(self.effectiveness_path):
            with open(self.effectiveness_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "version": "1.0",
                    "records": [],
                    "statistics": {}
                }, f, ensure_ascii=False, indent=2)
    
    def _load_data(self) -> None:
        for filename in os.listdir(self.capabilities_dir):
            if filename.startswith("CAP-") and filename.endswith(".md"):
                capability = self._parse_capability_file(
                    os.path.join(self.capabilities_dir, filename)
                )
                if capability:
                    self.capabilities[capability.id] = capability
        
        if os.path.exists(self.effectiveness_path):
            with open(self.effectiveness_path, 'r', encoding='utf-8') as f:
                self.effectiveness_data = json.load(f)
    
    def _parse_capability_file(self, filepath: str) -> Optional[CapabilityCard]:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            cap_id = os.path.basename(filepath).replace("CAP-", "").replace(".md", "")
            
            name_match = re.search(r'^#\s*(.+)$', content, re.MULTILINE)
            name = name_match.group(1) if name_match else cap_id
            
            trigger_match = re.search(r'##\s*触发条件\s*\n([\s\S]+?)(?=\n##|$)', content)
            triggers = []
            if trigger_match:
                triggers = [l.strip('- ') for l in trigger_match.group(1).strip().split('\n') if l.strip().startswith('-')]
            
            value_match = re.search(r'##\s*核心价值\s*\n([\s\S]+?)(?=\n##|$)', content)
            core_value = value_match.group(1).strip() if value_match else ""
            
            impl_match = re.search(r'##\s*实施方案\s*\n([\s\S]+?)(?=\n##|$)', content)
            implementation = impl_match.group(1).strip() if impl_match else ""
            
            scope_match = re.search(r'##\s*适用范围\s*\n([\s\S]+?)(?=\n##|$)', content)
            scope = []
            if scope_match:
                scope = [l.strip('- ') for l in scope_match.group(1).strip().split('\n') if l.strip().startswith('-')]
            
            risk_match = re.search(r'##\s*风险边界\s*\n([\s\S]+?)(?=\n##|$)', content)
            risks = []
            if risk_match:
                risks = [l.strip('- ') for l in risk_match.group(1).strip().split('\n') if l.strip().startswith('-')]
            
            return CapabilityCard(
                id=cap_id,
                name=name,
                description=f"能力卡片: {name}",
                trigger_conditions=triggers,
                core_value=core_value,
                implementation=implementation,
                scope=scope,
                risks=risks,
                created_at=datetime.now().isoformat(),
                updated_at=datetime.now().isoformat(),
                usage_count=0,
                effectiveness_score=0.5,
                auto_generated=False,
                source_material=filepath
            )
        except Exception:
            return None

    def auto_generate_capability(
        self,
        task_description: str,
        execution_result: str,
        success: bool = True
    ) -> Optional[CapabilityCard]:
        """
        自动生成能力卡片
        
        :param task_description: 任务描述
        :param execution_result: 执行结果
        :param success: 是否成功
        :return: 生成的能力卡片
        """
        if not success:
            return None
        
        keywords = self._extract_keywords(task_description + " " + execution_result)
        
        trigger_conditions = self._infer_trigger_conditions(task_description, keywords)
        
        core_value = self._extract_core_value(execution_result)
        
        implementation = self._extract_implementation(execution_result)
        
        scope = self._infer_scope(keywords)
        
        risks = self._infer_risks(task_description, execution_result)
        
        import uuid
        cap_id = uuid.uuid4().hex[:8].upper()
        
        capability = CapabilityCard(
            id=cap_id,
            name=self._generate_name(keywords),
            description=f"自动生成的能力: {task_description[:50]}",
            trigger_conditions=trigger_conditions,
            core_value=core_value,
            implementation=implementation,
            scope=scope,
            risks=risks,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
            usage_count=0,
            effectiveness_score=0.5,
            auto_generated=True,
            source_material=task_description
        )
        
        self._save_capability_file(capability)
        self.capabilities[capability.id] = capability
        
        return capability

    def _extract_keywords(self, text: str) -> List[str]:
        keywords = []
        
        chinese = re.findall(r'[\u4e00-\u9fa5]+', text)
        english = re.findall(r'[a-zA-Z]+', text)
        
        keywords.extend([w for w in chinese if len(w) >= 2])
        keywords.extend([w.lower() for w in english if len(w) >= 3])
        
        return list(set(keywords))[:10]

    def _infer_trigger_conditions(self, task: str, keywords: List[str]) -> List[str]:
        conditions = []
        
        task_lower = task.lower()
        
        patterns = [
            (r'写|创建|生成|制作', '需要创建或生成内容'),
            (r'分析|评估|审查', '需要分析或评估'),
            (r'修复|解决|处理', '需要解决问题'),
            (r'优化|改进|提升', '需要优化改进'),
            (r'转换|格式化|处理', '需要数据处理'),
        ]
        
        for pattern, condition in patterns:
            if re.search(pattern, task_lower):
                conditions.append(condition)
        
        for kw in keywords[:3]:
            conditions.append(f"涉及 {kw} 相关内容")
        
        return conditions[:5]

    def _extract_core_value(self, result: str) -> str:
        sentences = re.split(r'[。！？\n]', result)
        
        for sentence in sentences:
            if len(sentence) >= 10 and len(sentence) <= 100:
                return sentence.strip()
        
        return result[:100] if len(result) > 100 else result

    def _extract_implementation(self, result: str) -> str:
        steps = re.findall(r'\d+[\.、]\s*(.+?)(?=\d+[\.、]|$)', result, re.DOTALL)
        
        if steps:
            return '\n'.join([f"- {s.strip()}" for s in steps[:5]])
        
        return result[:200] if len(result) > 200 else result

    def _infer_scope(self, keywords: List[str]) -> List[str]:
        scopes = []
        
        tech_keywords = ['python', 'javascript', 'react', 'typescript', 'node', 'electron']
        doc_keywords = ['文档', '报告', '文章', 'markdown', 'word']
        data_keywords = ['数据', 'excel', 'csv', 'json', '分析']
        
        for kw in keywords:
            if kw.lower() in tech_keywords:
                scopes.append("技术开发场景")
            elif kw in doc_keywords:
                scopes.append("文档处理场景")
            elif kw in data_keywords:
                scopes.append("数据处理场景")
        
        if not scopes:
            scopes.append("通用场景")
        
        return list(set(scopes))

    def _infer_risks(self, task: str, result: str) -> List[str]:
        risks = []
        
        if '删除' in task or '移除' in task:
            risks.append("操作不可逆，需谨慎执行")
        
        if '生产' in task or '线上' in task:
            risks.append("影响生产环境，需充分测试")
        
        if '用户' in task or '客户' in task:
            risks.append("涉及用户数据，注意隐私保护")
        
        if not risks:
            risks.append("建议在测试环境先验证")
        
        return risks

    def _generate_name(self, keywords: List[str]) -> str:
        if keywords:
            return f"{'-'.join(keywords[:3])}能力"
        return "通用能力"

    def _save_capability_file(self, capability: CapabilityCard) -> None:
        filename = f"CAP-{capability.id}-{capability.name[:20].replace(' ', '-')}.md"
        filepath = os.path.join(self.capabilities_dir, filename)
        
        content = f"""# {capability.name}

## 触发条件
{chr(10).join([f'- {c}' for c in capability.trigger_conditions])}

## 核心价值
{capability.core_value}

## 实施方案
{capability.implementation}

## 适用范围
{chr(10).join([f'- {s}' for s in capability.scope])}

## 风险边界
{chr(10).join([f'- {r}' for r in capability.risks])}

---
*自动生成: {capability.auto_generated}*
*创建时间: {capability.created_at}*
"""
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

    def find_matching_capabilities(
        self,
        task_description: str
    ) -> List[TaskMatch]:
        """
        查找匹配的能力
        
        :param task_description: 任务描述
        :return: 匹配的能力列表
        """
        matches = []
        task_lower = task_description.lower()
        task_keywords = set(self._extract_keywords(task_description))
        
        for cap_id, capability in self.capabilities.items():
            score = 0.0
            matched_conditions = []
            
            for condition in capability.trigger_conditions:
                condition_keywords = set(self._extract_keywords(condition))
                overlap = task_keywords & condition_keywords
                
                if overlap:
                    score += len(overlap) * 0.2
                    matched_conditions.append(condition)
                
                condition_lower = condition.lower()
                if condition_lower in task_lower:
                    score += 0.3
                    matched_conditions.append(condition)
            
            for scope in capability.scope:
                scope_keywords = set(self._extract_keywords(scope))
                overlap = task_keywords & scope_keywords
                if overlap:
                    score += len(overlap) * 0.1
            
            score += capability.effectiveness_score * 0.2
            score += min(0.2, capability.usage_count * 0.02)
            
            if score >= 0.3:
                suggested_actions = self._generate_suggested_actions(capability, task_description)
                
                matches.append(TaskMatch(
                    capability_id=cap_id,
                    capability_name=capability.name,
                    match_score=min(1.0, score),
                    matched_conditions=matched_conditions,
                    suggested_actions=suggested_actions
                ))
        
        matches.sort(key=lambda x: x.match_score, reverse=True)
        
        return matches[:5]

    def _generate_suggested_actions(
        self,
        capability: CapabilityCard,
        task: str
    ) -> List[str]:
        actions = []
        
        actions.append(f"参考 [{capability.name}] 能力的实施方案")
        
        if capability.implementation:
            steps = capability.implementation.split('\n')[:3]
            actions.extend([s.strip('- ') for s in steps if s.strip()])
        
        for risk in capability.risks[:2]:
            actions.append(f"注意: {risk}")
        
        return actions[:5]

    def record_effectiveness(
        self,
        capability_id: str,
        task_description: str,
        success: bool,
        user_feedback: Optional[str] = None
    ) -> None:
        """
        记录能力使用效果
        
        :param capability_id: 能力ID
        :param task_description: 任务描述
        :param success: 是否成功
        :param user_feedback: 用户反馈
        """
        record = {
            "capability_id": capability_id,
            "task_description": task_description,
            "success": success,
            "user_feedback": user_feedback,
            "timestamp": datetime.now().isoformat()
        }
        
        self.effectiveness_data['records'].append(record)
        
        cap_records = [
            r for r in self.effectiveness_data['records']
            if r['capability_id'] == capability_id
        ]
        
        success_count = sum(1 for r in cap_records if r['success'])
        total_count = len(cap_records)
        
        if capability_id in self.capabilities:
            self.capabilities[capability_id].usage_count = total_count
            self.capabilities[capability_id].effectiveness_score = success_count / total_count if total_count > 0 else 0.5
        
        self.effectiveness_data['statistics'] = {
            cap_id: {
                "usage_count": len([r for r in self.effectiveness_data['records'] if r['capability_id'] == cap_id]),
                "success_rate": sum(1 for r in self.effectiveness_data['records'] if r['capability_id'] == cap_id and r['success']) / max(1, len([r for r in self.effectiveness_data['records'] if r['capability_id'] == cap_id]))
            }
            for cap_id in set(r['capability_id'] for r in self.effectiveness_data['records'])
        }
        
        with open(self.effectiveness_path, 'w', encoding='utf-8') as f:
            json.dump(self.effectiveness_data, f, ensure_ascii=False, indent=2)

    def get_top_capabilities(self, limit: int = 10) -> List[CapabilityCard]:
        """获取最有效的能力"""
        sorted_caps = sorted(
            self.capabilities.values(),
            key=lambda c: (c.effectiveness_score * 0.6 + min(1.0, c.usage_count * 0.05) * 0.4),
            reverse=True
        )
        return sorted_caps[:limit]

    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            "total_capabilities": len(self.capabilities),
            "auto_generated": sum(1 for c in self.capabilities.values() if c.auto_generated),
            "total_usage": sum(c.usage_count for c in self.capabilities.values()),
            "average_effectiveness": sum(c.effectiveness_score for c in self.capabilities.values()) / max(1, len(self.capabilities)),
            "top_capabilities": [
                {"name": c.name, "score": c.effectiveness_score, "usage": c.usage_count}
                for c in self.get_top_capabilities(5)
            ]
        }


if __name__ == "__main__":
    engine = CapabilityAutomationEngine()
    
    print("=== 正飞能力自动化引擎 V1.0 测试 ===\n")
    
    print("1. 自动生成能力...")
    cap = engine.auto_generate_capability(
        task_description="使用Python处理Excel文件，提取数据并生成报告",
        execution_result="成功使用pandas读取Excel，处理数据后生成Markdown报告",
        success=True
    )
    if cap:
        print(f"   生成能力: {cap.name}")
        print(f"   触发条件: {cap.trigger_conditions}")
    
    print("\n2. 查找匹配能力...")
    matches = engine.find_matching_capabilities("处理Excel数据文件")
    for m in matches[:3]:
        print(f"   {m.capability_name} (匹配度: {m.match_score:.2f})")
    
    print("\n3. 获取统计信息...")
    stats = engine.get_statistics()
    print(f"   总能力数: {stats['total_capabilities']}")
    print(f"   自动生成: {stats['auto_generated']}")
    print(f"   平均效果: {stats['average_effectiveness']:.2f}")
