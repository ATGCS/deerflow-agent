# DeerPanel 聊天页 React 化：准备清单与开发计划

本文档说明：**为何**要上 React、**迁之前**要理清什么、以及**分阶段**怎么落地。当前实现以 `src/pages/chat.js`（约 4000+ 行）+ `src/lib/ws-client.js` 为主，与 Tauri / Web 共用 `tauri-api.js`。

---

## 一、背景与目标

| 现状 | 目标 |
|------|------|
| 单文件巨型页面，状态分散在模块级变量 | 可维护的组件树 + 可测试的状态层 |
| DOM 手写（`innerHTML`、节流渲染） | 声明式 UI，流式与工具块可独立迭代 |
| 与 LangGraph SSE 紧耦合在 `ws-client` | UI 只消费「结构化事件」，便于换实现或双轨运行 |

**非目标（第一阶段）**：不改变后端 LangGraph / Gateway 协议；不强制全站 React，允许与现有 `router.js` 并存。

---

## 二、上 React 前要列清楚的事项（准备清单）

### 2.1 工程与构建

1. **接入 React 运行时**：`react`、`react-dom`；Vite 使用 `@vitejs/plugin-react`。
2. **入口策略**：新聊天页与旧页**并行**（如路由 `/chat` 旧、`/chat-v2` 新，或环境变量开关），避免大爆炸替换。
3. **TypeScript（推荐）**：新代码用 `.tsx`；为 `ws-client` 事件、`api` 入参出参逐步补类型，减少迁移时隐性 bug。
4. **路径别名**：如 `@/components`、`@/hooks`、`@/lib`，降低深层相对路径成本。

### 2.2 状态与数据流

5. **单一数据源**：将 `_currentAiBubble`、`_isStreaming`、`_currentAiText`、`_currentAiTools`、`_sessionKey` 等从「散落全局」收拢到 **store**（Zustand / Jotai / Redux Toolkit 等任选）或 **React Context + useReducer**（小规模可先这样）。
6. **ws-client 边界**：保留 `fetch` / SSE 解析在 `ws-client`（或 `lib/langgraph-stream.ts`），对外只暴露：
   - `subscribeChat(sessionKey, callback)`，或
   - Hook：`useLangGraphChatSend()` / `useChatEvents()`  
   避免在组件里直接拼 SSE 帧。
7. **消息模型统一**：定义 `Message` 联合类型，例如：`user | assistant | system | tool_call | tool_result`（名称可按现有 `extractChatContent`、`upsertTool` 对齐），**历史加载**与**流式增量**共用同一结构。

### 2.3 组件边界（对照现有 `chat.js`）

8. **布局**：侧栏 + 主内容 + 顶栏 → `ChatLayout`。
9. **会话列表**：对应 `renderSessionList`、`switchSession` → `SessionList` + `SessionCard`。
10. **消息列表**：对应 `loadHistory`、`dedupeHistory`、滚动 → `MessageList`；长列表建议 **虚拟列表**（`@tanstack/react-virtual` / `react-window`）。
11. **单条助手消息**：Markdown + 附件 + **工具折叠块** → `AssistantMessage` + `ToolCallBlock`（状态：进行中 / 完成 / 失败）。
12. **输入区**：对应发送、停止、附件、模式 → `Composer`，内部调用 `api.chatSend` / `api.chatAbort`。
13. **协作 / Token / 托管 Agent 等**：各自独立组件，禁止再堆进单文件。

### 2.4 流式与性能

14. **流式正文**：减少整段 `innerHTML` 替换；采用「按 runId/messageId 合并文本」+ **rAF 节流**或受控片段更新。
15. **Markdown**：`react-markdown` + `remark-gfm`；代码高亮与安全策略（sanitize / 禁用 raw HTML）需单独定规范。
16. **工具事件**：与现有 `state: 'tool'` / `delta` / `final` 对齐；**同一 `toolCallId` 上合并 input/output**（等价于当前 `upsertTool`）。

### 2.5 路由与双端（Tauri / Web）

17. **路由**：`react-router` 或 TanStack Router；与现有 `src/router.js` 并存，通过「默认进旧页或新页」开关切换。
18. **API 层**：继续通过 `tauri-api.js` 统一 Web `fetch` 与 Tauri `invoke`，React 层不直接依赖 `window.__TAURI__`。

### 2.6 质量与发布

19. **单元测试**：工具解析、消息归一、reducer/store 逻辑用 Vitest。
20. **E2E（可选）**：Playwright 覆盖「发送 → 流式出字 → 工具块展开」。
21. **功能开关**：如 `VITE_USE_REACT_CHAT=0` 回退经典 `/chat`，或面板配置项，便于灰度。

---

## 三、`chat.js` 职责 → 未来模块对照（便于拆任务）

| 现有区域（概念） | 建议 React 归属 |
|------------------|-----------------|
| `handleEvent` / `handleChatEvent` | `useChatEvents` + store actions |
| `loadHistory` / `dedupeHistory` | `useThreadHistory` + `messageNormalizer` |
| `createStreamBubble` / `doRender` / `throttledRender` | `StreamingAssistant` 或 store + 子组件 |
| `appendToolsToEl` / `upsertTool` | `ToolCallBlock` + `toolStore` slice |
| `switchSession` / `refreshSessionList` | `SessionList` + `useSessionSwitch` |
| `connectGateway` / `wsClient.onReady` | `useGatewayConnection`（可保留在 layout） |
| 协作抽屉、托管 Agent | `CollabDrawer`、`HostedAgentPanel` |

（函数名以当前仓库为准，迁移时以实际 grep 结果更新本表。）

---

## 四、详细开发计划（分阶段，每步做什么）

### 阶段 0：脚手架与验证（约 0.5～1 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 0.1 | 安装 `react`、`react-dom`、`@vitejs/plugin-react`，改 `vite.config.js` | `npm run dev` 正常，能解析 JSX/TSX |
| 0.2 | 新增最小入口：例如 `src/react-main.jsx` 挂载 `<App />` 到某 `#react-root` | 页面能渲染「Hello React」 |
| 0.3 | 配置路径别名 `@/`（可选 TS `paths`） | import 路径统一 |
| 0.4 | 与现有 `main.js` / `router.js` 并存：点击某菜单或 URL 进入 React 页 | 不破坏现有聊天入口 |

### 阶段 1：壳与路由（约 1～2 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 1.1 | 引入 `react-router`，定义 `/chat-react`（名称自定） | 路由可切换 |
| 1.2 | 实现 `ChatLayout`：占位侧栏 + 空消息区 + 底栏输入框（先不接 API） | 布局与现有 chat 视觉大致一致（可后调样式） |
| 1.3 | 从 `tauri-api` 拉一次 `chatSessionsList` 填侧栏静态列表 | 证明跨 Tauri/Web 调用链通畅 |

### 阶段 2：只读历史（约 2～3 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 2.1 | 定义 `Message` 类型与 `normalizeLangGraphMessage()`（对齐 `normalizeHistoryRole`、`extractContent` 逻辑） | 单测覆盖典型 human/ai/tool |
| 2.2 | `useThreadHistory(sessionKey)`：调用 `api.chatHistory`，写入 store | 选中会话后列表展示历史 |
| 2.3 | `UserMessage` / `AssistantMessage`：纯展示，助手走 `react-markdown` | 无流式，仅静态 |
| 2.4 | 历史中的工具：用 `ToolCallBlock` 只读展示（折叠参数/结果） | 与现网 checkpoint 里工具展示一致 |

### 阶段 3：发送与流式（约 3～5 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 3.1 | 封装 `useChatStream()`：内部仍用现有 `wsClient.chatSend` 或抽一层 `startThreadStream()` | 发送后能看到打字/流式文本 |
| 3.2 | 将 `ws-client` 的 `chat` 事件转为 `dispatch({ type: 'delta' \| 'tool' \| 'final' \| 'error', ... })` | 组件不直接依赖 SSE 字符串 |
| 3.3 | 流式助手气泡：合并 `delta` 文本，节流渲染；`final` 固化消息并入历史列表 | 行为与当前 `handleChatEvent` 一致 |
| 3.4 | 工具流式：`tool` 事件更新 `ToolCallBlock`（进行中 → 有结果） | 与现网 `state === 'tool'` 行为一致 |
| 3.5 | 停止生成：`api.chatAbort` 绑定按钮 | 中断后 UI 状态正确 |

### 阶段 4：会话操作与边缘功能（约 3～5 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 4.1 | 新建会话、切换会话、删除会话：对齐现有 `switchSession`、`chatSessionsDelete` 等 | 侧栏完整 |
| 4.2 | 附件上传、图片展示（若有）：对齐现 `Composer` 能力 | 与现网一致 |
| 4.3 | Gateway 就绪、`onReady` 拉会话：抽 `useGatewayBootstrap` | 刷新后行为一致 |
| 4.4 | Token 统计、模型选择等顶栏控件迁移 | 功能 parity |
| 4.5 | 协作抽屉、托管 Agent（若需）：按模块迁入 | 可排在 4.x 后期 |

### 阶段 5：性能与体验（约 2～4 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 5.1 | 消息列表虚拟化 | 千条消息仍流畅 |
| 5.2 | Markdown 与安全策略定稿 | 无 XSS 回归 |
| 5.3 | 与 `chat.css` 对齐或迁移到 CSS Modules / Tailwind（团队选型） | 视觉验收 |
| 5.4 | 关键路径 Vitest + 可选 Playwright | CI 可跑 |

### 阶段 6：切换默认与下线旧页（约 1～2 天）

| 步骤 | 做什么 | 产出 / 完成标准 |
|------|--------|-------------------|
| 6.1 | 默认路由改为 React 聊天；保留 `?legacy=1` 或配置回退旧页 | 可灰度 |
| 6.2 | 删除或归档 `chat.js` 中已迁移代码，减少重复维护 | 单一真相 |
| 6.3 | 更新 README / 贡献指南：说明 React 入口与目录结构 | 新人可上手 |

---

## 五、工时与风险（粗略）

- **合计**：约 **15～25 人日**（视协作/设计/是否全量迁移托管与协作为浮动上限）。
- **风险**：流式与工具事件顺序、历史与流式去重、Tauri 与 Web 行为差、样式回归。
- **缓解**：阶段 0～2 尽快可演示；阶段 3 用同一套后端事件做对比测试（旧页 vs 新页并排）。

---

## 六、文档维护

- 迁移过程中若 `ws-client` 或 `chat.js` 大改，请更新 **第三节对照表** 与 **阶段 3** 的事件名。
- 建议在 PR 描述中引用本文件对应阶段编号（如「完成 3.2」）。

---

*文档版本：与仓库同步维护；首次写入随 DeerPanel React 化讨论创建。*

---

## 七、实施进度（仓库落地记录）

| 阶段 | 状态 | 说明 |
|------|------|------|
| 0～1 | 已完成 | 见上文；`src/pages/chat-react.js` + `src/react/*.tsx`；`main.js` **静态导入** `chat-react`（避免 dev 下动态 chunk `Failed to fetch`）；样式 `src/style/react-chat.css`。 |
| 2 | 已完成 | `src/lib/chat-normalize.js`（`messagesToDisplayRows` / `extractContent` 等与 `chat.js` 对齐）；`useThreadHistory` → `api.chatHistory`；`MarkdownHtml` 复用 `lib/markdown.js`；`ToolCallList` 只读折叠块。 |
| 3 | 已完成 | `wsClient.onEvent` 消费 `chat` 事件：`delta` / `tool` / `final` / `aborted` / `error`；流式与 `upsertTool` 合并；`api.chatAbort`；`requestAnimationFrame` 节流刷新。 |
| 4 | 大部分 | 新会话、删除、刷新历史、图片附件、`onReady` 拉会话；**未迁**：顶栏模型/模式/Token 全量 parity、协作抽屉（请用 `#/chat-legacy` 经典页）。 |
| 5 | 大部分 | `@tanstack/react-virtual` 消息列表；助手 Markdown 与经典页同一渲染器；`npm test` → `tests/chat-normalize.test.js`（Vitest）；未加 Playwright。 |
| 6 | 已完成 | **默认** `#/chat` → React；`#/chat-legacy` → `chat.js`；`VITE_USE_REACT_CHAT=0` 或 `false` 时 `#/chat` 仍走经典；未删 `chat.js`（双轨维护）。 |

**本地验证**

- `npm run dev`，默认：`#/chat` 为 React，`#/chat-legacy` 为经典；`#/chat-react` 仍指向 React（兼容书签）。  
- 构建前设置 `VITE_USE_REACT_CHAT=0`：可将 `#/chat` 改回经典实现。  
- 单测：`cd deerpanel && npm test`  

**结构**：`src/react/`（`ChatApp.tsx`、`components/*.tsx`、`hooks/*.ts`）、`src/lib/chat-normalize.js`。
