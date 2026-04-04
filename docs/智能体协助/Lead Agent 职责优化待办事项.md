# Lead Agent 职责优化待办事项

## 📋 当前问题分析

### 当前 Lead Agent 的职责

1. **需求确认** - 与用户沟通，明确任务范围
2. **任务规划** - 拆解成子任务
3. **任务分配** - 分配给子智能体
4. **进度监督** - 查看执行状态
5. **结果汇总** - 交付最终结果

### 缺失的能力

❌ **智能体进化** - 无法动态创建或优化智能体  
❌ **灵活配置** - 无法为子智能体添加工具/技能  
❌ **模型分配** - 所有智能体使用相同模型  
❌ **资源调度** - 无法根据任务复杂度分配不同资源  

---

## 🎯 优化目标

### Lead Agent 的新定位

**Lead Agent = 监督者 + 调度员 + 进化者**

```
┌─────────────────────────────────────────┐
│          Lead Agent                      │
│  (监督 + 调度 + 进化)                     │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌────────┐   ┌────────┐   ┌────────┐
│任务分配 │   │资源调度 │   │智能体进化│
│        │   │        │   │        │
│• 规划  │   │• 模型  │   │• 创建  │
│• 监督  │   │• 配置  │   │• 优化  │
│• 汇总  │   │• 约束  │   │• 增强  │
└────────┘   └────────┘   └────────┘
```

---

## 📝 待办事项清单

### 阶段 1：Lead Agent 提示词优化

#### 1.1 更新系统提示词

- [ ] **重新定义职责**
  ```markdown
  # 你的角色

  你是 Lead Agent（主智能体），负责监督和协调多智能体协作任务。

  ## 核心职责

  1. **需求分析** - 理解用户需求，明确任务范围
  2. **任务规划** - 拆解为可执行的子任务
  3. **智能体选择** - 为每个子任务选择合适的智能体
  4. **资源调度** - 为每个子任务分配适当的模型和工具
  5. **进度监督** - 监控子任务执行进度
  6. **智能体进化** - 根据需要创建或优化智能体
  7. **结果汇总** - 聚合所有子任务结果，交付用户

  ## 可用工具

  - `supervisor` - 任务规划和监督
  - `task` - 启动子智能体执行
  - `task_memory` - 查看任务记忆
  - （可选）`create_agent` - 创建新智能体

  ## 重要原则

  1. **不要直接执行具体任务** - 所有具体工作交给子智能体
  2. **合理分配资源** - 根据任务复杂度选择模型
  3. **灵活配置智能体** - 可以为子智能体添加工具/技能
  4. **持续优化** - 根据执行情况调整策略
  ```

- [ ] **添加资源调度指南**
  ```markdown
  ## 资源调度指南

  ### 模型选择策略

  | 任务类型 | 推荐模型 | 说明 |
  |--------|---------|------|
  | 简单任务 | 闪速/经济型 | 快速响应，成本低 |
  | 复杂推理 | 思考/Pro | 深度分析，准确率高 |
  | 代码开发 | Pro/Ultra | 代码能力强 |
  | 创意写作 | Pro | 创造性好 |
  | 数据分析 | Pro | 逻辑性强 |

  ### 工具分配策略

  - 前端开发：`read_file`, `write_file`, `bash`
  - 后端开发：`read_file`, `write_file`, `bash`, `database`
  - 测试：`bash`, `read_file`
  - 研究：`web_search`, `read_file`
  ```

- [ ] **添加工具/技能覆盖指南**
  ```markdown
  ## 工具/技能覆盖

  当默认配置不足时，你可以：

  1. **添加工具**
     ```
     worker_profile: {
       base_subagent: "general-purpose",
       tools: ["read_file", "write_file", "bash", "database"],
       instruction: "你需要访问数据库..."
     }
     ```

  2. **添加技能**
     ```
     worker_profile: {
       base_subagent: "general-purpose",
       skills: ["react", "typescript", "tailwind"],
       instruction: "使用 Tailwind CSS..."
     }
     ```

  3. **指定模型**
     ```
     worker_profile: {
       base_subagent: "general-purpose",
       model: "gpt-4",  // 覆盖默认模型
       instruction: "..."
     }
     ```
  ```

#### 1.2 添加智能体进化能力

- [ ] **创建智能体的场景**
  ```markdown
  ## 何时创建新智能体

  当现有智能体无法满足需求时：

  1. **专业领域缺失**
     - 需要法律专家，但只有通用智能体
     - 需要医疗专家，但没有相关智能体

  2. **工具组合特殊**
     - 需要同时使用数据库和图形生成
     - 现有智能体的工具组合不匹配

  3. **性能要求特殊**
     - 需要超高速响应
     - 需要超高准确率

  4. **成本优化**
     - 简单任务使用经济型模型
     - 复杂任务使用高级模型
  ```

- [ ] **智能体创建流程**
  ```python
  # Lead Agent 调用
  supervisor(
      action="create_agent",
      name="legal-expert",
      agent_type="subagent",
      description="法律专家，负责合同审查和法律咨询",
      system_prompt="你是一位资深律师，擅长合同法...",
      tools=["read_file", "write_file", "web_search"],
      skills=["contract-law", "legal-research"],
      model="gpt-4",  # 指定模型
      max_turns=100,
      timeout_seconds=1800
  )
  ```

---

### 阶段 2：WorkerProfile 扩展

#### 2.1 添加模型分配

- [ ] **修改 WorkerProfile 数据结构**
  ```python
  class WorkerProfile(BaseModel):
      base_subagent: str              # 子智能体模板名（必填）
      model: str | None = None        # 覆盖默认模型（可选）
      instruction: str | None = None  # 附加系统指令（可选）
      tools: list[str] | None = None  # 覆盖默认工具（可选）
      skills: list[str] | None = None # 覆盖默认技能（可选）
      depends_on: list[str] = []      # 依赖关系
      max_turns: int | None = None    # 覆盖最大轮次（可选）
      timeout: int | None = None      # 覆盖超时时间（可选）
  ```

- [ ] **说明覆盖逻辑**
  ```python
  # Task Tool 内部逻辑
  def task_tool(...):
      # 1. 加载 AgentConfig（默认配置）
      agent_config = get_subagent_config(worker_profile.base_subagent)
      
      # 2. 应用 WorkerProfile 的覆盖（优先级更高）
      final_model = worker_profile.model or agent_config.model
      final_tools = worker_profile.tools or agent_config.tools
      final_skills = worker_profile.skills or agent_config.skills
      final_max_turns = worker_profile.max_turns or agent_config.max_turns
      final_timeout = worker_profile.timeout or agent_config.timeout_seconds
      
      # 3. 应用 instruction 覆盖
      if worker_profile.instruction:
          final_system_prompt = worker_profile.instruction
      else:
          final_system_prompt = agent_config.system_prompt
  ```

#### 2.2 添加工具/技能动态扩展

- [ ] **工具扩展机制**
  ```python
  # Lead Agent 可以临时添加工具
  worker_profile = {
      "base_subagent": "general-purpose",
      "tools": [
          # 默认工具（从 AgentConfig 继承）
          "inherit",  # 特殊标记，表示继承默认
          
          # 额外工具
          "database_query",
          "generate_chart"
      ],
      "instruction": "你需要查询数据库并生成图表..."
  }
  ```

- [ ] **技能扩展机制**
  ```python
  # Lead Agent 可以临时添加技能
  worker_profile = {
      "base_subagent": "general-purpose",
      "skills": [
          "inherit",  # 继承默认技能
          "domain-expert",  # 添加领域专家技能
          "multi-lingual"   # 添加多语言技能
      ],
      "instruction": "你需要使用医学专业知识..."
  }
  ```

---

### 阶段 3：Supervisor Tool 扩展

#### 3.1 添加智能体管理 Actions

- [ ] **create_agent** - 创建新智能体
  ```python
  supervisor(
      action="create_agent",
      name: str,                    # 智能体名称
      agent_type: str,              # custom | subagent | acp
      description: str,             # 描述
      system_prompt: str,           # 系统提示
      tools: list[str],             # 工具列表
      skills: list[str],            # 技能列表
      model: str,                   # 使用的模型
      max_turns: int,               # 最大轮次
      timeout_seconds: int          # 超时时间
  )
  ```

- [ ] **update_agent** - 更新智能体配置
  ```python
  supervisor(
      action="update_agent",
      name: str,                    # 智能体名称
      description: str | None,      # 更新描述
      tools: list[str] | None,      # 更新工具
      skills: list[str] | None,     # 更新技能
      model: str | None,            # 更新模型
      system_prompt: str | None     # 更新提示词
  )
  ```

- [ ] **list_available_models** - 查询可用模型
  ```python
  supervisor(
      action="list_available_models"
  )
  # 返回：["gpt-4", "gpt-3.5-turbo", "claude-3", ...]
  ```

#### 3.2 添加资源调度 Actions

- [ ] **get_resource_recommendations** - 获取资源推荐
  ```python
  supervisor(
      action="get_resource_recommendations",
      task_description: str,        # 任务描述
      complexity: str,              # simple | medium | complex
      budget: str | None            # low | medium | high
  )
  # 返回推荐的模型、工具、技能组合
  ```

---

### 阶段 4：AgentConfig 扩展

#### 4.1 添加模型配置

- [ ] **修改 AgentConfig 数据结构**
  ```python
  class AgentConfig(BaseModel):
      name: str
      description: str
      agent_type: Literal["custom", "subagent", "acp"]
      
      # 模型配置
      model: str = "gpt-3.5-turbo"         # 默认模型
      model_fallback: list[str] = []       # 备选模型列表
      model_per_task: dict[str, str] = {}  # 按任务类型指定模型
      
      # Subagent 特有字段
      system_prompt: str | None = None
      tools: list[str] = []
      skills: list[str] = []
      disallowed_tools: list[str] = []
      max_turns: int = 50
      timeout_seconds: int = 900
      
      # 资源约束
      max_tokens: int = 4096               # 最大 token 数
      temperature: float = 0.7             # 温度参数
  ```

#### 4.2 添加模型路由逻辑

- [ ] **模型选择策略**
  ```python
  class ModelRouter:
      """根据任务类型选择模型"""
      
      def select_model(
          self,
          agent_config: AgentConfig,
          task_type: str,
          complexity: str,
          budget: str
      ) -> str:
          # 1. 检查任务特定模型
          if task_type in agent_config.model_per_task:
              return agent_config.model_per_task[task_type]
          
          # 2. 根据复杂度选择
          if complexity == "simple":
              return "gpt-3.5-turbo"
          elif complexity == "medium":
              return "gpt-4"
          elif complexity == "complex":
              return "claude-3-opus"
          
          # 3. 根据预算选择
          if budget == "low":
              return "gpt-3.5-turbo"
          elif budget == "high":
              return "claude-3-opus"
          
          # 4. 使用默认模型
          return agent_config.model
  ```

---

### 阶段 5：执行器扩展

#### 5.1 SubagentExecutor 支持模型切换

- [ ] **修改执行器初始化**
  ```python
  class SubagentExecutor:
      def __init__(
          self,
          config: AgentConfig,
          tools: list,
          model: str | None = None,  # 可选覆盖模型
          ...
      ):
          # 使用传入的模型，或默认模型
          self.model = model or config.model
          self.config = config
          self.tools = tools
  ```

- [ ] **添加模型切换日志**
  ```python
  logger.info(
      f"Subagent '{config.name}' using model: {self.model} "
      f"(default: {config.model})"
  )
  ```

---

### 阶段 6：文档更新

#### 6.1 更新现有文档

- [ ] **更新 `底层数据结构分析.md`**
  - 更新 `WorkerProfile` 结构（添加 model 字段）
  - 更新 `AgentConfig` 结构（添加模型配置）
  - 添加模型路由说明

- [ ] **更新 `Subagent 协作流程工具列表.md`**
  - 添加 `create_agent` 工具说明
  - 添加 `update_agent` 工具说明
  - 添加 `list_available_models` 工具说明
  - 更新工具使用矩阵

- [ ] **更新 `WorkerProfile 优化待办事项.md`**
  - 添加模型分配说明
  - 添加工具/技能覆盖说明

#### 6.2 创建新文档

- [ ] **创建 `Lead Agent 职责说明.md`**
  - 文件：`docs/智能体协助/Lead Agent 职责说明.md`
  - 内容：
    - Lead Agent 的角色定位
    - 核心职责
    - 可用工具
    - 最佳实践
    - 示例场景

- [ ] **创建 `智能体进化指南.md`**
  - 文件：`docs/智能体协助/智能体进化指南.md`
  - 内容：
    - 何时创建新智能体
    - 如何设计智能体配置
    - 如何选择模型
    - 如何分配工具/技能
    - 示例配置

- [ ] **创建 `模型分配策略.md`**
  - 文件：`docs/智能体协助/模型分配策略.md`
  - 内容：
    - 可用模型列表
    - 模型选择指南
    - 成本优化策略
    - 性能优化策略
    - 示例配置

---

## 🎯 使用场景示例

### 场景 1：为不同任务分配不同模型

```python
# Lead Agent 规划
supervisor(action="create_subtask",
    task_id="task_001",
    name="简单数据收集",
    worker_profile={
        "base_subagent": "general-purpose",
        "model": "gpt-3.5-turbo",  # 简单任务用经济模型
        "instruction": "快速收集信息即可"
    }
)

supervisor(action="create_subtask",
    task_id="task_002",
    name="复杂代码重构",
    worker_profile={
        "base_subagent": "general-purpose",
        "model": "gpt-4",  # 复杂任务用高级模型
        "tools": ["read_file", "write_file", "bash", "git"],
        "instruction": "仔细分析代码结构，确保重构安全"
    }
)

supervisor(action="create_subtask",
    task_id="task_003",
    name="创意文案写作",
    worker_profile={
        "base_subagent": "general-purpose",
        "model": "claude-3-opus",  # 创意任务用创意强的模型
        "skills": ["creative-writing", "marketing"],
        "instruction": "发挥创意，写出吸引人的文案"
    }
)
```

### 场景 2：临时创建专业智能体

```python
# Lead Agent 发现现有智能体无法满足需求
if task_requires_legal_expertise and no_lawyer_agent:
    # 创建法律专家智能体
    supervisor(
        action="create_agent",
        name="legal-expert",
        agent_type="subagent",
        description="法律专家，负责合同审查",
        system_prompt="""你是一位资深律师，擅长：
        - 合同审查和起草
        - 法律风险评估
        - 法律研究
        
        请仔细分析合同条款，识别潜在风险。""",
        tools=["read_file", "write_file", "web_search"],
        skills=["contract-law", "legal-research"],
        model="gpt-4",
        max_turns=100,
        timeout_seconds=1800
    )
    
    # 分配任务给新创建的智能体
    supervisor(
        action="create_subtask",
        task_id="task_001",
        name="合同审查",
        worker_profile={
            "base_subagent": "legal-expert",  # 使用新智能体
            "instruction": "审查这份合同，识别风险条款"
        }
    )
```

### 场景 3：为特定任务添加工具

```python
# 需要数据库访问
supervisor(action="create_subtask",
    task_id="task_001",
    name="数据分析报告",
    worker_profile={
        "base_subagent": "general-purpose",
        "tools": [
            "inherit",  # 继承默认工具
            "database_query",  # 添加数据库工具
            "generate_chart"   # 添加图表工具
        ],
        "instruction": "查询数据库，生成可视化报告"
    }
)
```

---

## 📊 影响评估

### 正面影响

✅ **灵活性大幅提升** - 可以为每个任务定制资源配置  
✅ **成本优化** - 简单任务用便宜模型，复杂任务用高级模型  
✅ **性能提升** - 专业任务用专业智能体  
✅ **可扩展性强** - 随时创建新智能体应对新需求  

### 潜在风险

⚠️ **复杂度增加** - Lead Agent 需要更多决策  
⚠️ **提示词变长** - 需要更多指导说明  
⚠️ **测试成本** - 需要测试各种配置组合  

### 缓解措施

- 提供清晰的决策指南和最佳实践
- 提供默认配置，减少决策负担
- 提供资源推荐工具，辅助决策

---

## 🚀 实施优先级

### 高优先级（核心能力）

1. ✅ Lead Agent 提示词优化（职责重新定义）
2. ✅ WorkerProfile 添加 model 字段
3. ✅ SubagentExecutor 支持模型切换
4. ✅ 向后兼容处理

### 中优先级（增强能力）

5. ✅ Supervisor Tool 添加 create_agent
6. ✅ AgentConfig 添加模型配置
7. ✅ 文档更新

### 低优先级（优化能力）

8. ✅ 模型路由自动选择
9. ✅ 资源推荐工具
10. ✅ 智能体进化自动化

---

## 📚 相关文档索引

- [`底层数据结构分析.md`](d:\github\deerflaw\docs\智能体协助\底层数据结构分析.md)
- [`Subagent 协作流程工具列表.md`](d:\github\deerflaw\docs\智能体协助\Subagent 协作流程工具列表.md)
- [`WorkerProfile 优化待办事项.md`](d:\github\deerflaw\docs\智能体协助\WorkerProfile 优化待办事项.md)

---

**文档版本**: 1.0  
**创建时间**: 2026-04-04  
**状态**: 📝 待评审
