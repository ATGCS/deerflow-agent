# DeerFlow Desktop 实施计划（供 AI 助手使用）

> 目的：把桌面版要做的细节拆成清晰的小任务，方便后续 AI 助手按步骤实现和修改。  
> 范围：**不修改后端能力的前提下**，优先实现一个可用的 MVP，再预留后端扩展点。

---

## 1. 产品目标与约束（简版）

- **核心目标**
  - 可以在桌面端 **编辑智能体/技能**（组合技能、模型、开关能力）；
  - 能看到 **多个智能体的运行状态**（idle/busy/失败等）；
  - 在一个任务/项目中，看到 **多个 Agent 协同执行的流程与进度**；
  - 有一个“**像人一样的 Supervisor**”角色：你只和它说话，它帮你协调和指挥其他 Agent。

- **关键约束**
  - 尽量复用现有 DeerFlow 后端：Gateway（8001）、LangGraph（2024）、Skills/MCP、Plan Mode 等；
  - `deerpanel` 侧边栏不再保留“初始设置（setup）”入口，默认直接进入业务菜单（含“智能体”“技能”）；
  - **前端/桌面 UI 部分优先“站在别人肩膀上”**：
    - `clawpanel/` 目录是参考用的第三方面板工程，只用于**抄界面结构、交互和配置方式**；
    - 桌面版允许在代码层面**大量借鉴/搬运** `clawpanel` 的前端实现（布局、组件、菜单、对话框等），再按需删减；
    - 但 **绝不直接把 `clawpanel/` 目录自身提交进仓库**，也不把它的二进制大文件（dll / .pdb / 其他构建产物）搬进 `desktop/`；
  - 第一阶段 **不强依赖新建后端 Project/Task REST API**，通过约定 + 桌面端存储实现；
  - 桌面应用技术栈：Tauri v2 + React + TS + Tailwind + Zustand + TanStack Query（见 `desktop-design-final.md`）。

---

## 2. 与现有后端能力的映射

> 供 AI 助手快速了解“能直接用什么，哪些是桌面端自己做一层”的对照表。

- **Skills / 智能体能力**
  - 现有接口：
    - `GET /api/skills`：获取全部技能（包括 enabled 状态）；
    - `GET /api/skills/{name}`：技能详情；
    - `PUT /api/skills/{name}`：更新启用状态等；
    - `POST /api/skills/install`：从 `.skill` 包安装新技能。
  - 在桌面端映射为：
    - “技能中心 / 我的技能 / 技能市场”页面的数据源；
    - “编辑智能体能力”的基础（通过选择 Skills 组合来定义一个 Agent Preset）。

- **Models / 模型配置**
  - 现有接口：
    - `GET /api/models`：列出可用模型；
    - `GET /api/models/{name}`：模型详情。
  - 在桌面端映射为：
    - Agent Preset 的“模型选择”、“温度”等参数来源。

- **LangGraph / Agent 执行**
  - 通过 nginx 或直连：
    - SSE 流：`/api/langgraph/*`（或直连 `http://localhost:2024`）；
    - 支持 plan mode / subagents / ask_clarification 等机制。
  - 在桌面端映射为：
    - “项目/任务执行监控”、“多 Agent 协同流程图”、“Supervisor 对话”的实时数据源。

- **目前不存在的部分（由桌面端先自己实现）**
  - 显式的 `Project` / `Task` REST：
    - `/api/projects`、`/api/projects/:id`、`/api/projects/:id/plan` 等；
  - 显式的 `SupervisorDecision` REST：
    - 列决策历史、结构化 options/risk。
  - 第一阶段由 Desktop 通过：
    - 本地存储（IndexedDB / 文件）+ thread_id 映射；
    - 约定好的 JSON Schema（任务计划、决策）；
    - 利用现有对话 + SSE，实现类似能力。

---

## 3. 阶段划分概览

> 便于 AI 助手按阶段工作，每个阶段可以单独执行/回滚。

- **Phase 1：基础壳 + 与后端连通**
  - 初始化 Tauri + React + Tailwind 项目；
  - 实现统一的 Gateway / LangGraph 客户端封装；
  - 实现简单的“健康检查 + 模型/技能列表”页，验证连通。

- **Phase 2：Skills & Agent Presets 管理**
  - 做出“技能中心”；
  - 基于 Skills + Models 定义可编辑的 “Agent Preset” 概念；
  - 允许保存/切换不同的 Preset 组合。

- **Phase 3：任务 / 项目视图（不改后端版）**
  - 定义 Desktop 自己的 `Project`/`Task` 数据结构（参考 `desktop-design-final.md`）；
  - 基于 LangGraph 线程 + 约定好的 JSON 规划输出，实现“AI 任务拆解 + 任务列表 + 依赖关系”；
  - 通过 SSE 映射任务执行状态、进度和相关 Agent。

- **Phase 4：Supervisor 角色与人机协作**
  - 固定一个 “Supervisor 会话线程”；
  - 设计 system prompt，让它扮演“人类协调者”角色；
  - 实现“Supervisor 控制台 + 决策卡片 + 与 Supervisor 对话”。

- **Phase 5：多 Agent 状态总览 + UX 打磨**
  - 汇总来自 SSE / Subagent 事件的信息，在一个视图中看多 Agent 状态；
  - 补充快捷键、托盘、多窗口行为、错误提示等细节。

---

## 4. 任务清单（供 AI 助手逐项执行）

> 说明：所有任务用 `- [ ]`/`- [x]` 标注。AI 助手实现某项后，可以在 PR 或后续修改中勾选。

### 4.1 Phase 1：基础壳 + 后端连通（含 clawpanel 代码引入）

- [ ] **P1-00：分析并筛选 clawpanel 代码**
  - 通读 `clawpanel/` 工程的目录结构、主要页面（菜单、AI 对话、模型配置、计划视图等）；
  - 明确哪些模块/组件可以直接复用（例如布局、侧边栏、对话框、路由结构），哪些只是做视觉参考；
  - 记录 **需要排除的文件类型和目录**（特别是 dll / .pdb / `.cache` / `dist` / `build` 等体积巨大的构建产物），避免拷贝进 `desktop/`。

- [ ] **P1-01：创建 `desktop/` Tauri + React 项目骨架**
  - 在 `desktop/` 下初始化 Tauri v2 + React 18 + TS + Vite 项目；
  - 配置 Tailwind、基础 dark theme 变量，与 `desktop-design-final.md` 的配色对齐。

- [ ] **P1-01a：从 clawpanel 迁移 UI 结构（不含二进制文件）**
  - 在保证 `clawpanel/` 目录本身**不加入 git 版本控制**的前提下：
    - 将选定的 React 组件 / 布局 / 菜单 / 路由配置等，迁移或改写到 `desktop/src`；
    - 对应调整为适配 Tauri + 本项目的 API 客户端封装；
  - 拷贝时 **显式忽略**：
    - 所有 dll / .pdb / `.exe` / `.dll` / `.so` 等二进制；
    - `.git`、`node_modules`、`dist`、`build`、`.turbo` 等构建或缓存目录；
    - 任何与 clawpanel 私有配置/密钥相关的文件。

- [ ] **P1-01：创建 `desktop/` Tauri + React 项目骨架**
  - 在 `desktop/` 下初始化 Tauri v2 + React 18 + TS + Vite 项目；
  - 配置 Tailwind、基础 dark theme 变量，与 `desktop-design-final.md` 的配色对齐。

- [ ] **P1-02：实现统一的配置读取**
  - 从环境变量 / 配置文件中读取 Gateway 基地址（默认 `http://localhost:8001`）；
  - 预留 `DEERFLOW_DESKTOP_GATEWAY_URL` 之类的变量覆盖。

- [ ] **P1-03：实现 Gateway API 客户端封装**
  - 封装基础 GET/POST/PUT 请求；
  - 统一处理错误格式 `{ code, message, details? }`；
  - 预留鉴权 Token 注入（从本地安全存储读取，详见 `desktop-design-final.md` “鉴权与账户”部分）。

- [ ] **P1-04：实现“健康检查 + 模型/技能列表”测试页**
  - 简单页面：
    - 展示 `/health` 状态；
    - 展示 `/api/models`、`/api/skills` 返回内容；
  - 作为后续开发的“连通性自检面板”。

### 4.2 Phase 2：Skills & Agent Presets 管理

- [ ] **P2-01：Skill 列表页（只读）**
  - 使用 `/api/skills` 渲染技能卡片（名称、描述、enabled 状态、来自 public/custom）；
  - 支持搜索 / 筛选。

- [ ] **P2-02：Skill 启用/禁用操作**
  - 调用 `PUT /api/skills/{name}` 切换 enabled；
  - 做好乐观更新 + 回滚。

- [ ] **P2-03：Skill 安装入口（MVP 可只支持本地文件导入）**
  - 通过 `POST /api/skills/install` 上传 `.skill` 包；
  - 安装成功后刷新列表。

- [ ] **P2-04：定义本地 Agent Preset 结构与存储**
  - 设计 `AgentPreset` 接口：名称、描述、绑定的 skills 列表、模型名、温度等；
  - 将 Preset 存在 IndexedDB 或配置文件中，不需要后端支持；
  - 在 UI 上提供 Preset 的创建/编辑/删除/选择。

### 4.3 Phase 3：任务 / 项目视图（Desktop 自己维护 Project/Task）

- [ ] **P3-01：定义 Project/Task 本地模型和存储方案**
  - 复用/调整 `desktop-design-final.md` 中的 `Project` / `Task` 接口；
  - 采用 `project_id` ↔ `thread_id` 的映射；
  - 存储在 IndexedDB 中，并提供简单的版本号用于将来迁移。

- [ ] **P3-02：项目列表页（基于本地 Project + Thread 状态）**
  - 展示本地所有 Project；
  - 通过 LangGraph 线程状态（或最近活动时间）推断运行中/已完成等状态。

- [ ] **P3-03：AI 任务规划（只规划不执行）**
  - 与 `lead_agent` 建立一个“规划对话模板”：
    - 约定它返回一个 JSON 结构（任务列表 + 依赖 + 粗略时间估算）；
  - Desktop 解析 JSON → 转成 `Task[]`，存入 Project；
  - 提供 UI 编辑 Task 名称/描述/依赖。

- [ ] **P3-04：执行项目时与 LangGraph 的协议**
  - 约定一个 prompt 模板：将本地 `Task` 计划传给 `lead_agent`，请它按任务 ID 执行；
  - 约定在执行时，`lead_agent` 在日志/事件中主动带上 `task_id`（例如在 tool 调用描述中嵌入）；
  - 为后续 SSE → Task 映射打基础。

- [ ] **P3-05：任务执行监控 + 进度展示（基于 SSE）**
  - 订阅 LangGraph SSE 事件；
  - 根据事件中的内容/约定的 `task_id` 更新本地 `Task.status` / `Task.progress`；
  - 在 UI 中渲染任务列表 + 简单依赖关系图。

### 4.4 Phase 4：Supervisor 角色与人机协作

- [ ] **P4-01：为 Supervisor 定义专用 System Prompt**
  - 在 Desktop 端准备一个 Supervisor 专用 prompt：
    - 角色：像产品经理/技术负责人一样，帮用户拆解任务、安排子任务给 Agent；
    - 约束：对高风险操作要征求确认，尽量给出结构化决策选项。

- [ ] **P4-02：创建“Supervisor 会话”入口**
  - 在 UI 中提供一个固定入口“与 Supervisor 对话”；
  - 所有 Supervisor 对话复用同一个 LangGraph 线程（便于积累上下文）。

- [ ] **P4-03：设计“决策请求”JSON Schema**
  - 约定 Supervisor 在需要你选择时，输出一个结构化 JSON（例如 `type`, `situation`, `options[]` 等）；
  - Desktop 检测到这种 JSON 时，渲染为决策卡片而不是普通对话；
  - 你的选择再被包装成指令发回 Supervisor 线程。

- [ ] **P4-04：Supervisor 控制台视图**
  - 汇总当前项目的关键决策、最近 N 条决策历史；
  - 展示“当前思考”、“自动 vs 询问你的次数”等摘要数据。

### 4.5 Phase 5：多 Agent 状态总览 + UX

- [ ] **P5-01：Agent 状态模型（前端推断版）**
  - 根据近期 subagent 执行事件，推断每个 Agent Preset 的状态（idle/busy/failed）；
  - 定义一个简单的 `AgentRuntimeStatus` 接口（名称、最近任务、最近错误等）。

- [ ] **P5-02：多 Agent 状态面板**
  - 一个总览页面：列出所有 Preset + 推断状态；
  - 可以点击跳转到相关项目/任务/日志。

- [ ] **P5-03：快捷键 / 托盘 / 悬浮窗行为**
  - 按 `desktop-design-final.md` 实现：
    - 快速启动面板；
    - 托盘菜单；
    - 全局快捷键（如 `Cmd/Ctrl+Shift+D`）；
  - 验证在 Win/Mac 上的最小可用性。

---

## 5. 后端扩展建议（第二阶段，可选）

> 这些不是 MVP 必需，但可以大幅简化后续逻辑，方便 AI 助手在后端侧继续演进。

- [ ] **B-01：新增 Project/Task REST API（后端）**
  - 在 Gateway 增加 `/api/projects`、`/api/projects/:id`、`/api/projects/:id/run`、`/api/projects/:id/plan` 等；
  - 将 Desktop 现在的本地 Project/Task 结构迁移到服务端。

- [ ] **B-02：结构化 SupervisorDecision 存储 + 查询**
  - 定义 `SupervisorDecision` 表/集合；
  - 暴露简单的列表/详情接口，供 Desktop 查询和分页。

- [ ] **B-03：Agent 运行时状态 API（可选）**
  - 基于 subagent 执行器，在后端聚合并暴露简化的 `/api/agents` 状态视图；
  - Desktop 无需自行推断，直接调用即可。

---

> 使用说明：  
> - 后续每次让 AI 助手改桌面端代码或设计时，可以指派它“完成 P3-03 / P4-02 这样的具体编号任务”；  
> - AI 助手在修改时，只需在相关 PR 或文档中标注哪些任务已完成，方便你跟进进度。  
> - 如需调整拆分粒度，可以直接编辑本文件，保持任务编号稳定即可。

