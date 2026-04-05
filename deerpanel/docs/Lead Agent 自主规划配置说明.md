# Lead Agent 自主规划能力 - 配置修改说明

## 📋 修改概述

将 Lead Agent 的默认行为从"被动执行"改为"自主规划和分配"，使其能够根据任务复杂度自动判断是否需要分解和分配给子代理。

## 🔧 修改内容

### 文件位置
`backend/packages/harness/deerflow/agents/lead_agent/agent.py`

### 修改行号
第 287-290 行

### 修改代码

```python
# 修改前：
is_plan_mode = cfg.get("is_plan_mode", False)
subagent_enabled = cfg.get("subagent_enabled", False)

# 修改后：
is_plan_mode = cfg.get("is_plan_mode", True)  # 默认启用规划模式，让 Lead Agent 自主判断和规划
subagent_enabled = cfg.get("subagent_enabled", True)  # 默认启用子代理，让 Lead Agent 能够分配任务
```

## 🎯 修改目标

### 原行为（修改前）
- ❌ 默认不启用规划模式
- ❌ 默认不启用子代理
- ❌ 所有任务都直接执行
- ❌ 用户需要手动输入 `/collab` 才能启用任务规划
- ❌ 复杂任务不会被自动分解

### 新行为（修改后）
- ✅ 默认启用规划模式
- ✅ 默认启用子代理
- ✅ 根据任务复杂度自主判断
- ✅ 用户无需手动切换模式
- ✅ 复杂任务自动分解并并行执行

## 🤖 智能判断逻辑

Lead Agent 会根据以下规则自主判断：

### 复杂任务 → 自动分解
**特征**:
- 包含多个方面/维度
- 需要多种技能
- 需要并行执行
- 需要综合分析

**示例**:
```
用户："研究 DeerFlow 架构，包括核心组件、技术栈、工作流程"
→ Lead Agent 思考：这是复杂任务，需要分解
→ 创建 3 个子任务（并行）：
   1. 分析核心组件
   2. 分析技术栈
   3. 分析工作流程
→ 分配给子代理执行
→ 汇总结果
```

### 简单任务 → 直接执行
**特征**:
- 单一步骤
- 明确的操作
- 无需分解
- 立即可执行

**示例**:
```
用户："帮我写入一个文件"
→ Lead Agent 思考：这是简单任务，直接执行
→ 直接调用 write_file 工具
→ 完成任务
```

**注意**: 即使直接执行，也会创建任务记录并在页面显示进度。

## 📊 预期效果

### 用户体验提升

**修改前**:
```
用户："研究竞品分析"
→ Lead Agent 直接开始搜索（单线程）
→ 手动收集信息
→ 简单汇总
```

**修改后**:
```
用户："研究竞品分析"
→ Lead Agent 自动创建主任务
→ 分解为 5 个子任务：
   1. 竞品 A 分析
   2. 竞品 B 分析
   3. 竞品 C 分析
   4. 市场趋势分析
   5. 用户评价分析
→ 分配 3 个子代理并行执行（第一批 3 个）
→ 等待完成后分配剩余 2 个
→ 汇总所有结果
→ 生成 comprehensive 报告
→ 页面实时显示进度
```

### 性能提升

- **并行执行**: 3 个子代理同时工作
- **智能批处理**: 自动分批处理超过并发限制的任务
- **实时反馈**: 页面实时显示每个子任务的进度

## 🔍 技术细节

### 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `is_plan_mode` | bool | `True` | 是否启用规划模式 |
| `subagent_enabled` | bool | `True` | 是否启用子代理功能 |
| `max_concurrent_subagents` | int | `3` | 最大并发子代理数 |

### Prompt 控制逻辑

即使启用了 subagent，Lead Agent 仍会根据 Prompt 中的规则判断：

```python
# prompt.py 中的规则
❌ DO NOT use subagents when:
- Task cannot be decomposed (不能分解为 2+ 并行子任务)
- Ultra-simple actions (超简单操作)
- Need immediate clarification (需要澄清)
- Sequential dependencies (顺序依赖)
```

### 并发控制

```python
# 硬性限制：每次响应最多调用 max_concurrent_subagents 个 task
# 如果任务数 > limit，自动分批执行
Turn 1: 子任务 1-3（并行）
Turn 2: 子任务 4-5（并行）
Turn 3: 汇总所有结果
```

## ✅ 验证方法

### 1. 检查后端日志

启动后端后，查看日志中的配置信息：

```bash
Create Agent(default) -> 
  thinking_enabled: True, 
  is_plan_mode: True,              # ← 应该是 True
  subagent_enabled: True,          # ← 应该是 True
  max_concurrent_subagents: 3
```

### 2. 测试复杂任务

输入："研究 DeerFlow 项目，包括架构、功能、技术栈"

**预期**:
- ✅ 创建主任务
- ✅ 分解为 3 个子任务
- ✅ 并行执行
- ✅ 页面显示进度

### 3. 测试简单任务

输入："帮我写个文件"

**预期**:
- ✅ 直接执行
- ✅ 仍创建任务记录
- ✅ 页面显示进度

## ⚠️ 注意事项

### 1. 向后兼容性

修改默认值不会影响显式指定参数的调用：

```javascript
// 前端仍可显式禁用
api.chatSend(sessionKey, message, {
  subagent_enabled: false,  // 显式禁用
  is_plan_mode: false
})
```

### 2. 性能考虑

- 默认并发数：3 个子代理
- 可根据服务器性能调整
- 过多并发可能导致资源竞争

### 3. 成本考虑

- 并行执行会使用更多 Token
- 简单任务仍会直接执行（由 Prompt 控制）
- 可在配置中调整默认行为

## 🔧 进阶配置

### 调整并发数

在调用时指定：

```python
api.chatSend(sessionKey, message, {
  subagent_enabled: True,
  is_plan_mode: True,
  max_concurrent_subagents: 5  # 增加到 5 个
})
```

### 完全禁用子代理

在配置文件中设置全局默认值：

```yaml
# config.yaml
agents:
  lead_agent:
    subagent_enabled: false
    is_plan_mode: false
```

## 📈 监控指标

### 推荐监控的指标

1. **任务分解率**: 多少任务被分解为子任务
2. **平均子任务数**: 每个主任务的平均子任务数
3. **并行度**: 同时执行的子代理数量
4. **完成时间**: 从任务创建到完成的时间
5. **用户满意度**: 任务质量评分

## 📚 相关文档

- [问题修复报告](./问题修复报告%20-%20任务可视化集成.md)
- [测试指南](./测试指南%20-%20Lead%20Agent%20自主规划.md)
- [Lead Agent 实现](../../backend/packages/harness/deerflow/agents/lead_agent/agent.py)
- [Lead Agent Prompt](../../backend/packages/harness/deerflow/agents/lead_agent/prompt.py)

## 📅 修改日期

2026-04-05

## 👨‍💻 修改人员

AI Assistant
