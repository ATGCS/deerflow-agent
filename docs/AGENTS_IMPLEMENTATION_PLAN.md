# 智能体模块实施计划

> 范围：智能体（Agent）管理模块的功能完善与优化
> 前置条件：技能模块已完成，基础框架已搭建

---

## 1. 产品目标

- **核心功能**
  - 智能体列表展示（卡片式布局）✅ 已实现
  - 智能体详情查看（描述、模型、工具组、SOUL）✅ 已实现
  - 智能体编辑功能（描述、模型、工具组、SOUL）✅ 已实现
  - 智能体创建功能 ⏳ 待实现
  - 智能体删除功能 ✅ 已实现
  - 智能体备份功能 ✅ 已实现

- **增强功能**
  - 智能体运行状态监控（idle/busy/failed）
  - 智能体运行时日志查看
  - 智能体性能指标展示
  - 智能体版本管理

---

## 2. 与后端 API 的映射

| 功能 | API 端点 | 状态 |
|------|----------|------|
| 列表 | `GET /api/agents` | ✅ 已对接 |
| 详情 | `GET /api/agents/{name}` | ✅ 已对接 |
| 创建 | `POST /api/agents` | ⏳ 待实现 |
| 更新 | `PUT /api/agents/{name}` | ✅ 已对接 |
| 删除 | `DELETE /api/agents/{name}` | ✅ 已对接 |
| 备份 | `POST /api/agents/{name}/backup` | ✅ 已对接 |

---

## 3. 任务清单

### 3.1 基础功能完善

- [ ] **A-01：创建智能体功能**
  - 实现 `POST /api/agents` 前端调用
  - 创建智能体表单（名称、描述、模型、工具组、SOUL）
  - 表单验证：名称必填、不能重复
  - 创建成功后自动刷新列表

- [ ] **A-02：智能体创建表单优化**
  - 模型选择器从已配置的 providers 中获取
  - 工具组支持多选（而不是逗号分隔输入）
  - SOUL 编辑器支持代码高亮或格式化

- [ ] **A-03：智能体列表优化**
  - 添加运行状态指示器
  - 添加最后活跃时间显示
  - 支持排序（名称、创建时间、最后活跃）
  - 支持批量操作（批量删除、批量启用/禁用）

### 3.2 详情查看增强

- [ ] **B-01：完整详情弹窗**
  - 显示完整 SOUL 内容（可滚动）
  - 显示工具组详细配置
  - 显示创建/更新时间
  - 支持复制配置信息

- [ ] **B-02：运行时状态展示**
  - 查看 Agent 当前状态（idle/busy/failed）
  - 显示当前对话数量
  - 显示内存使用情况（如果有）

### 3.3 运行时日志与调试

- [ ] **C-01：Agent 执行日志**
  - 查看 Agent 最近执行的日志
  - 支持日志级别过滤（info/warn/error）
  - 支持日志搜索

- [ ] **C-02：对话历史**
  - 查看 Agent 的对话历史
  - 支持对话搜索
  - 支持导出对话记录

### 3.4 高级功能

- [ ] **D-01：Agent 模板**
  - 保存当前 Agent 配置为模板
  - 从模板创建新 Agent
  - 内置常用模板（翻译助手、写作助手、代码助手等）

- [ ] **D-02：Agent 导入/导出**
  - 导出 Agent 配置为 JSON 文件
  - 从 JSON 文件导入 Agent
  - 支持批量导入

- [ ] **D-03：Agent 技能绑定**
  - 在编辑页面直接选择绑定的技能
  - 查看 Agent 已启用的技能列表
  - 快速启用/禁用 Agent 的技能

---

## 4. 优先级排序

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | A-01 | 创建智能体功能 - 核心缺失功能 |
| P1 | A-02 | 优化创建表单体验 |
| P1 | B-01 | 增强详情查看 |
| P2 | A-03 | 列表优化（排序、状态） |
| P2 | D-03 | Agent 技能绑定 |
| P3 | C-01 | 执行日志查看 |
| P3 | D-01 | Agent 模板功能 |

---

## 5. 技术细节

### 5.1 创建 Agent API 调用

```javascript
// tauri-api.js 中添加
createAgent: async (agentData) => {
  const response = await fetch(`${getBackendBaseURL()}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agentData),
  });
  if (!response.ok) throw new Error(`Failed to create agent: ${response.statusText}`);
  return response.json();
}
```

### 5.2 Agent 数据结构

```typescript
interface Agent {
  name: string;           // 唯一标识
  description?: string;  // 描述
  model?: string;         // 模型标识 (provider/model_id)
  tool_groups?: string[]; // 工具组列表
  soul?: string;          // Agent 个性配置
  isDefault?: boolean;    // 是否默认 Agent
  created_at?: string;    // 创建时间
  updated_at?: string;    // 更新时间
}
```

### 5.3 创建表单字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | text | 是 | 唯一名称，小写字母、数字、下划线 |
| description | text | 否 | 描述信息 |
| model | select | 否 | 从已配置模型中选择 |
| tool_groups | multiselect | 否 | 选择启用的工具组 |
| soul | textarea | 否 | Agent 个性配置 |

---

## 6. 注意事项

1. **名称唯一性**：创建时需检查名称是否已存在
2. **模型可用性**：下拉选择时应只显示已配置的模型
3. **SOUL 内容**：大型 SOUL 内容需要支持滚动和搜索
4. **操作反馈**：所有操作需有 Toast 提示成功/失败
5. **数据一致性**：操作后需及时刷新列表并更新 UI 状态

---

## 7. 后续扩展

- Agent 运行时指标收集与展示
- Agent 协同工作流配置
- Agent 性能分析与优化建议
- 与 Supervisor 角色的深度集成
