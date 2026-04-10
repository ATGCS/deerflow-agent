---
name: zhengfei-evolution-system
description: "Do NOT use. Do NOT invoke. This is an automatic background service that runs on app startup. 正飞技能进化系统 V6.0 - 后台自动运行服务，无需手动调用。"
---

# 正飞技能进化系统 V6.0

## 技能ID
zhengfei-evolution-system

## 技能名称
正飞技能进化系统 V6.0

## 技能描述
正飞信息技术出品的技能进化系统，通过持续学习用户需求、沉淀最佳实践、优化执行能力，让AI助手越来越专业。V6.0 采用双后端架构，支持 HTTP API、直接调用、CLI 三种使用方式。

## 适用场景
- 每次完成任务后，记录执行素材
- 自动提取用户记忆，构建用户画像
- 智能组装上下文，为任务提供相关信息
- 提炼通用能力，形成能力库
- 自动化维护，持续优化能力
- 全链路追溯，查看进化历史

## V4.0 核心特性

### 🧠 增强记忆系统

#### 10种语义分类
- **identity** - 用户身份（姓名、职业、住址）
- **preference** - 用户偏好（喜欢、讨厌、习惯）
- **behavior** - 行为模式（经常、总是、通常）
- **knowledge** - 知识技能（会、懂、学过）
- **relationship** - 人际关系（家人、朋友、同事）
- **goal** - 目标计划（想要、计划、打算）
- **skill** - 技能专长（擅长、精通、熟练）
- **project** - 项目信息（正在开发、项目名）
- **temporal** - 时间相关（今天、本周、本月）
- **context** - 通用上下文

#### 记忆关联图谱
- **similar** - 相似记忆
- **contradicts** - 矛盾记忆
- **supersedes** - 替代记忆
- **depends_on** - 依赖关系
- **related_to** - 相关关系
- **part_of** - 包含关系
- **causes** - 因果关系
- **follows** - 顺序关系

#### 5级重要性评估
- **CRITICAL (5)** - 关键记忆，永不遗忘
- **HIGH (4)** - 重要记忆，长期保留
- **MEDIUM (3)** - 普通记忆，标准保留
- **LOW (2)** - 低优先级，可能遗忘
- **TRIVIAL (1)** - 琐碎记忆，快速遗忘

#### 置信度衰减机制
- 基于时间的指数衰减
- 重要性影响衰减速度
- 访问次数延缓衰减
- 低置信度自动清理

### 🔍 智能上下文组装

#### 任务类型识别
自动识别任务类型并调整上下文优先级：
- **coding** - 代码开发任务
- **documentation** - 文档创建任务
- **analysis** - 分析评估任务
- **planning** - 计划规划任务
- **communication** - 沟通交流任务
- **learning** - 学习教程任务

#### 智能组装策略
- 按任务类型调整分类权重
- 按重要性排序记忆
- 按置信度过滤记忆
- 控制总Token数量

### 📊 记忆版本控制
- 记录每次修改历史
- 保存修改原因
- 支持版本回溯

### 💾 导入导出功能
- JSON格式导出
- Markdown格式导出
- 批量导入恢复

## 快速开始

### 方式一：HTTP API（推荐）

```bash
# 启动后端服务
pip install -r requirements.txt
python start-server.py --port 8765

# 访问 API 文档
# http://localhost:8765/docs
```

```python
# 调用 API
import requests

# 添加记忆
response = requests.post('http://localhost:8765/api/memory/add', json={
    'text': '用户偏好TypeScript开发',
    'confidence': 0.9
})

# 搜索记忆
response = requests.post('http://localhost:8765/api/memory/search', json={
    'query': 'TypeScript',
    'top_k': 5
})

# 获取技能上下文
response = requests.get('http://localhost:8765/api/linker/context/article-writer?task=写一篇关于React的文章')
```

### 方式二：直接 Python 调用

```python
from server.services.memory_service import memory_service
from server.services.inference_service import inference_service

# 添加记忆
result = memory_service.add_memory(
    text='用户偏好TypeScript开发',
    confidence=0.9
)

# 推理查询
results = inference_service.infer('React')
```

### 方式三：CLI 命令

```bash
python cli/zhengfei-commands.py 搜索 "TypeScript"
python cli/zhengfei-commands.py 统计
python cli/zhengfei-commands.py 可视化
```

### 第1步：初始化系统
```bash
python zhengfei-init.py
```

### 第2步：完成任务后触发进化
```bash
# 基础用法
python zhengfei-trigger.py "任务名称" "执行结果"

# 带记忆提取（通过环境变量传递对话内容）
set ZHENGFEI_USER_TEXT=我叫张三，我喜欢用TypeScript开发
set ZHENGFEI_ASSISTANT_TEXT=好的，我了解了您的偏好
python zhengfei-trigger.py "代码生成" "成功"

# 指定守卫级别
python zhengfei-trigger.py "代码审查" "成功" --guard=strict

# 禁用记忆提取
python zhengfei-trigger.py "文档创建" "成功" --no-memory
```

### 第3步：（可选）启动后台服务
```bash
# 心跳保活
start /B python zhengfei-heartbeat.py > zhengfei-logs\heartbeat.log 2>&1

# 定时任务
start /B python zhengfei-scheduler.py > zhengfei-logs\scheduler.log 2>&1
```

## 文件结构

```
zhengfei-evolution-system/
├── server/                     # 后端服务 (V6.0 新增)
│   ├── main.py                 # FastAPI 主入口
│   ├── config.py               # 配置管理
│   ├── routers/                # API 路由
│   │   ├── memory.py           # 记忆服务路由
│   │   ├── inference.py        # 推理服务路由
│   │   ├── emotion.py          # 情绪服务路由
│   │   ├── evolution.py        # 进化服务路由
│   │   ├── capability.py       # 能力服务路由
│   │   └── linker.py           # 联动服务路由
│   ├── services/               # 业务逻辑层
│   │   ├── memory_service.py
│   │   ├── inference_service.py
│   │   ├── emotion_service.py
│   │   ├── evolution_service.py
│   │   ├── capability_service.py
│   │   └── linker_service.py
│   └── models/                 # 数据模型
│       └── schemas.py
├── core/                       # 核心引擎
│   ├── zhengfei-memory-core.py
│   ├── zhengfei-knowledge-graph.py
│   ├── zhengfei-meta-evolution.py
│   ├── zhengfei-capability-automation.py
│   └── zhengfei-cross-skill-linker.py
├── cli/                        # 命令行工具
│   └── zhengfei-commands.py
├── SKILL.md                    # 本技能说明文档
├── ARCHITECTURE.md             # 架构设计文档
├── DESIGN-PHILOSOPHY.md        # 设计哲学文档
├── start-server.py             # 启动脚本
├── requirements.txt            # Python 依赖
├── zhengfei-heartbeat.py       # 心跳保活引擎
├── zhengfei-scheduler.py       # 定时任务引擎
├── zhengfei-trigger.py         # 进化触发引擎
├── zhengfei-init.py            # 系统初始化引擎
├── zhengfei-memory-context.py  # 智能上下文组装器
├── zhengfei-memory-extractor.py # 记忆提取器
├── zhengfei-memory-judge.py    # 记忆判断器
├── zhengfei-materials/         # 素材库
├── zhengfei-capabilities/      # 能力库
├── zhengfei-archived/          # 归档库
├── zhengfei-memory/            # 记忆库
│   ├── enhanced-index.json
│   ├── enhanced-profile.json
│   ├── memory-graph.json
│   ├── knowledge-graph.json
│   ├── meta-evolution.json
│   ├── capability-effectiveness.json
│   └── visualization.html
└── zhengfei-logs/              # 日志库
```

## 核心功能

### 1. 增强记忆系统 (V4.0)

#### 记忆核心模块 (zhengfei-memory-core.py)
- **EnhancedMemory** - 增强记忆数据结构
- **MemoryGraph** - 记忆关联图谱
- **EnhancedMemoryManager** - 增强记忆管理器

#### 智能上下文组装 (zhengfei-memory-context.py)
- **TaskAnalyzer** - 任务类型分析器
- **ContextAssembler** - 上下文组装器
- **ContextConfig** - 组装配置

### 2. 自动化引擎
- **心跳保活引擎**（zhengfei-heartbeat.py）：确保系统持续在线
- **定时任务引擎**（zhengfei-scheduler.py）：每日凌晨3点自动维护
- **进化触发引擎**（zhengfei-trigger.py）：任务完成后自动记录素材、提取记忆
- **系统初始化引擎**（zhengfei-init.py）：一键搭建完整系统

### 3. 5维能力模型
1. **触发条件**：什么时候用这个能力
2. **核心价值**：这个能力解决什么问题
3. **实施方案**：具体怎么实现
4. **适用范围**：可以用在哪些场景
5. **风险边界**：什么时候不能用

### 4. 全链路追溯
- 素材库：记录所有任务执行素材
- 能力库：存储所有沉淀的能力
- 日志库：完整追溯进化历史
- 记忆库：长期记忆与用户画像

## API 参考

### 快捷命令 (V4.1 新增)

```bash
# 记忆搜索
python zhengfei-commands.py 搜索 "TypeScript" 10

# 查看统计
python zhengfei-commands.py 统计

# 查看最近记忆
python zhengfei-commands.py 最近 7

# 导出记忆
python zhengfei-commands.py 导出 json

# 添加记忆
python zhengfei-commands.py 添加 "我喜欢用React开发" preference 4

# 删除记忆
python zhengfei-commands.py 删除 MEM-12345678

# 获取任务上下文
python zhengfei-commands.py 上下文 "开发用户认证模块"

# 查看冲突
python zhengfei-commands.py 冲突

# 生成可视化
python zhengfei-commands.py 可视化
```

### 冲突检测 API (V4.1 新增)

```python
from zhengfei_memory_core import EnhancedMemoryManager

manager = EnhancedMemoryManager()

# 检测潜在冲突
conflicts = manager.detect_potential_conflicts("我不喜欢JavaScript")
for conflict in conflicts:
    print(f"冲突记忆: {conflict['text']}")
    print(f"冲突类型: {conflict['conflict_type']}")
    
    # 获取解决建议
    suggestion = manager.get_conflict_resolution_suggestion(
        "我不喜欢JavaScript",
        conflict
    )
    print(f"建议操作: {suggestion['recommended_action']}")
```

### 元进化引擎 API (V5.0 新增)

```python
from zhengfei_meta_evolution import MetaEvolutionEngine

engine = MetaEvolutionEngine()

# 记录用户反馈
engine.record_feedback(
    memory_text="我是一名全栈开发者",
    feedback_type="incorrect",  # correct/incorrect/missing/irrelevant
    category="skill"  # 用户指定的正确分类
)

# 执行自动优化
result = engine.auto_optimize()
print(f"优化数量: {result['optimizations_count']}")

# 获取当前参数
params = engine.get_parameters()
print(f"置信度衰减率: {params['confidence_decay_rate']}")
print(f"相似度阈值: {params['similarity_threshold']}")

# 获取演化历史
history = engine.get_evolution_history()
for h in history:
    print(f"{h['type']}: {h.get('reason', h.get('category_name', ''))}")
```

### 知识图谱 API (V5.0 新增)

```python
from zhengfei_knowledge_graph import KnowledgeGraphEngine

engine = KnowledgeGraphEngine()

# 添加知识节点
n1 = engine.add_node("React", node_type="technology")
n2 = engine.add_node("前端开发", node_type="skill")
n3 = engine.add_node("TypeScript", node_type="technology")

# 添加关系
engine.add_edge(n1.id, n2.id, "used_for", evidence="React用于前端开发")
engine.add_edge(n3.id, n1.id, "used_with", evidence="TypeScript常与React配合")

# 推理查询
results = engine.infer("React")
for r in results:
    print(f"结论: {r.conclusion}")
    print(f"路径: {' '.join(r.reasoning_path)}")
    print(f"置信度: {r.confidence:.2f}")

# 查找路径
paths = engine.find_path("TypeScript", "前端开发")
print(f"发现 {len(paths)} 条路径")

# 获取相关概念
related = engine.get_related_concepts("React")
for r in related:
    print(f"{r['text']} --[{r['relation']}]--")
```

### 能力自动化 API (V5.0 新增)

```python
from zhengfei_capability_automation import CapabilityAutomationEngine

engine = CapabilityAutomationEngine()

# 自动生成能力卡片
cap = engine.auto_generate_capability(
    task_description="使用Python处理Excel文件",
    execution_result="成功使用pandas读取Excel并生成报告",
    success=True
)
print(f"生成能力: {cap.name}")

# 查找匹配的能力
matches = engine.find_matching_capabilities("处理Excel数据")
for m in matches:
    print(f"{m.capability_name} (匹配度: {m.match_score:.2f})")
    print(f"建议操作: {m.suggested_actions}")

# 记录能力效果
engine.record_effectiveness(
    capability_id=cap.id,
    task_description="处理Excel数据",
    success=True,
    user_feedback="效果很好"
)

# 获取最有效的能力
top_caps = engine.get_top_capabilities(5)
for c in top_caps:
    print(f"{c.name}: 效果 {c.effectiveness_score:.2f}, 使用 {c.usage_count} 次")
```

### 跨技能联动 API (V5.0 新增)

```python
from zhengfei_cross_skill_linker import CrossSkillLinker, get_context_for_skill

# 便捷函数：获取技能上下文
context = get_context_for_skill("article-writer", "写一篇关于React的文章")
print(context)

# 完整API
linker = CrossSkillLinker()

# 获取技能上下文（包含详细信息）
ctx = linker.get_context_for_skill("frontend-design", "设计后台管理界面")
print(f"推断风格: {ctx.user_style}")
print(f"用户偏好: {ctx.user_preferences}")
print(f"相关记忆: {len(ctx.relevant_memories)} 条")

# 获取所有技能上下文
all_contexts = linker.get_all_skill_contexts()
for skill_name, ctx in all_contexts.items():
    print(f"{skill_name}: {ctx.user_style or '未推断'}")

# 注册新的技能映射
linker.register_skill_mapping(
    skill_name="my-custom-skill",
    memory_categories=["preference", "skill"],
    context_type="custom",
    keywords=["自定义", "关键词"],
    default_context={"style": "默认风格"}
)
```

### Python API

```python
from zhengfei_trigger import (
    trigger_evolution,
    get_context_for_task,
    search_memories,
    get_memory_statistics,
    export_memories,
    import_memories
)

# 触发进化（带记忆提取）
result = trigger_evolution(
    skill_name="代码生成",
    execution_result="成功",
    conversation_context={
        "user": "我叫张三，我喜欢用TypeScript开发",
        "assistant": "好的，我了解了您的偏好"
    },
    guard_level="standard"
)

# 获取智能组装的上下文
context = get_context_for_task("开发新功能", max_tokens=2000)

# 搜索记忆（支持分类过滤）
results = search_memories(
    "TypeScript",
    top_k=5,
    categories=["preference", "skill"],
    min_importance=3
)

# 获取统计信息
stats = get_memory_statistics()

# 导出记忆
json_data = export_memories(format="json")

# 导入记忆
count = import_memories(json_data, format="json")
```

### 记忆核心 API

```python
from zhengfei_memory_core import (
    EnhancedMemoryManager,
    MemoryCategory,
    MemoryImportance
)

manager = EnhancedMemoryManager()

# 添加记忆（自动分类和评估重要性）
memory = manager.add_memory(
    "我喜欢用TypeScript开发",
    confidence=0.9,
    source="conversation",
    is_explicit=False
)
print(f"分类: {memory.category.value}")
print(f"重要性: {memory.importance.value}")

# 搜索记忆
results = manager.search(
    "开发",
    top_k=10,
    categories=[MemoryCategory.PREFERENCE, MemoryCategory.SKILL],
    min_importance=MemoryImportance.MEDIUM,
    include_relations=True
)

# 获取任务上下文
context = manager.get_context_for_task("开发新功能")

# 更新记忆（带版本控制）
manager.update_memory(
    memory_id="MEM-XXXXX",
    new_text="我喜欢用TypeScript和React开发",
    modification_reason="用户更新偏好"
)

# 更新置信度衰减
updated_count = manager.update_confidence_decay()

# 清理过期记忆
expired_count = manager.cleanup_expired_memories()
```

### 上下文组装 API

```python
from zhengfei_memory_context import (
    ContextAssembler,
    ContextConfig,
    TaskAnalyzer,
    assemble_context_for_task
)

# 快速获取上下文
context = assemble_context_for_task("帮我写一个Python函数", max_tokens=2000)

# 自定义配置
config = ContextConfig(
    max_total_tokens=3000,
    max_preference_items=5,
    min_confidence=0.5,
    include_relations=True
)

assembler = ContextAssembler()
result = assembler.assemble_context("开发新功能", config)
print(result.to_markdown())

# 分析任务类型
task_type, relevance = TaskAnalyzer.analyze_task("帮我写代码")
print(f"任务类型: {task_type}")
print(f"分类相关性: {relevance}")
```

## 使用示例

### 场景1：代码生成任务
```bash
set ZHENGFEI_USER_TEXT=请帮我写一个Python脚本，我喜欢用函数式风格
set ZHENGFEI_ASSISTANT_TEXT=好的，我将为您编写函数式风格的Python脚本
python zhengfei-trigger.py "Python代码生成" "成功"
```

**记忆提取结果：**
- 分类: `preference`
- 重要性: `HIGH`
- 关键词: `Python`, `函数式`, `风格`

### 场景2：获取开发上下文
```python
from zhengfei_trigger import get_context_for_task

context = get_context_for_task("开发用户认证模块")
print(context)
```

**输出示例：**
```markdown
## 用户上下文

### 用户身份
- 我是张三，正飞信息技术的开发者

### 用户偏好
- 我喜欢用TypeScript开发
- 偏好函数式编程风格

### 相关记忆
- 正在开发zhengfeiClaw项目
- 使用Electron + React技术栈
```

### 场景3：记忆管理
```python
from zhengfei_memory_core import EnhancedMemoryManager, MemoryImportance

manager = EnhancedMemoryManager()

# 添加关键记忆
manager.add_memory(
    "项目使用SQLite数据库，路径在用户数据目录",
    confidence=0.95,
    source="project",
    is_explicit=True
)

# 搜索项目相关记忆
results = manager.search("数据库", categories=["project"])

# 导出备份
backup = manager.export_memories(format="json")
with open("memory-backup.json", "w", encoding="utf-8") as f:
    f.write(backup)
```

## 记忆提取规则

### 显式记忆命令
- 中文：`记住: xxx`、`请记住: xxx`、`保存到记忆: xxx`
- 英文：`remember this: xxx`、`store in memory: xxx`
- 删除：`删除记忆: xxx`、`forget this: xxx`

### 隐式记忆信号
- **个人信息**：`我叫...`、`我是...`、`我来自...`
- **所有权**：`我有...`、`我养了...`、`我的...`
- **偏好**：`我喜欢...`、`我偏好...`、`我习惯...`
- **助手偏好**：`以后请用中文回复`、`默认使用简洁风格`

### 守卫级别
- **strict**：高精度，只提取高置信度记忆
- **standard**：平衡模式（默认）
- **relaxed**：宽松模式，提取更多候选

## 技术支持

- 系统文档：zhengfei-evolution-system.md
- 安装指南：README.md
- 能力库：zhengfei-capabilities/
- 日志库：zhengfei-logs/
- 记忆库：zhengfei-memory/

## 注意事项

1. 所有文件使用UTF-8编码
2. Windows系统需要控制台编码支持
3. Python版本要求：3.6+
4. 每次任务后建议触发进化
5. V4.0与V3.0数据格式兼容

## 更新日志

### V6.0 (2026-04-02)
- ✅ 全新双后端架构
- ✅ FastAPI 后端服务
- ✅ 6 大服务 API（记忆/推理/情绪/进化/能力/联动）
- ✅ 支持 HTTP API / 直接调用 / CLI 三种方式
- ✅ OpenAPI 文档自动生成
- ✅ 服务层与核心引擎解耦

### V5.0 (2026-04-02)
- ✅ 元进化引擎 - 系统自我优化能力
- ✅ 根据用户反馈自动调整参数
- ✅ 自动发现新的记忆分类
- ✅ 知识图谱引擎 - 支持复杂推理
- ✅ 传递推理、规则推理、路径查找
- ✅ 能力自动化引擎 - 自动识别和生成能力卡片
- ✅ 能力效果自动评估和优化
- ✅ 跨技能联动引擎 - 上下文共享机制
- ✅ 为 article-writer、frontend-design 等技能提供用户偏好上下文

### V4.1 (2026-04-02)
- ✅ 新增快捷命令模块 (zhengfei-commands.py)
- ✅ 记忆搜索、统计、导出快捷命令
- ✅ 记忆可视化页面生成 (D3.js 交互式图谱)
- ✅ 增强冲突检测功能
- ✅ 冲突类型分类 (preference/identity/possession/usage/ability)
- ✅ 冲突解决建议机制
- ✅ 冲突记录追踪

### V4.0 (2026-04-02)
- ✅ 全新增强记忆核心系统
- ✅ 10种语义分类自动识别
- ✅ 记忆关联图谱（8种关系类型）
- ✅ 5级重要性评估
- ✅ 置信度衰减机制
- ✅ 智能上下文组装器
- ✅ 任务类型识别
- ✅ 记忆版本控制
- ✅ 导入导出功能
- ✅ 与V3.0数据格式兼容

### V3.0 (2026-03-25)
- ✅ 智能记忆提取系统
- ✅ 用户画像维护（静态/动态）
- ✅ 时间感知与矛盾处理
- ✅ 本地搜索能力
- ✅ 三级守卫模式
- ✅ TTL 过期清理机制

### V2.0 (2026-03-22)
- ✅ 完整的自动化引擎（4个）
- ✅ 正飞品牌化命名
- ✅ 5维能力模型
- ✅ 每日自动维护机制
- ✅ 完整的追溯体系
- ✅ 6个已验证的能力

## 出品方

正飞信息技术

---

*技能版本：V6.0*
*更新时间：2026-04-02*
*出品方：正飞信息技术*

正飞出品 | 持续进化 | 专业服务
