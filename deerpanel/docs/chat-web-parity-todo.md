# DeerPanel 实时聊天 Web 对齐清单

更新时间：2026-04-01
范围：`deerpanel/src/pages/chat.js`、`deerpanel/src/lib/ws-client.js`、`deerpanel/src/style/chat.css`
跟老版本像一点吧 下次不要问我了 我就是把老版本重构了 转换为新版本 只是UI不一样，参考老版本接口调用

## 1) 代办事项与进度清单

- [x] 流式链路从旧 WS 切到 HTTP SSE（`/api/langgraph/threads/{id}/runs/stream`）
- [x] `values` / `AIMessageChunk` 解析与增量拼接
- [x] 修复 CRLF SSE 分帧导致“转圈无输出”
- [x] 修复 `values` 误取上一轮 assistant 导致“串台”
- [x] 会话列表刷新后可恢复（对齐 `threads/search` 回填本地映射）
- [x] 点击会话后历史不再“闪一下变空白”（role/type 归一 + 异步竞态防护）
- [x] 线程状态面板（标题/进行状态/思考/待确认/todos）移动到输入框上方
- [x] 输入区“思考”选项合并进“推理”下拉（减少控件数量）
- [x] 输入区新增“模式”下拉（单选）
- [x] `reasoning_effort` 独立下拉（推理强度，和“思考/模式”解耦）
- [x] 输入区控件高度统一（上传/思考/模式/发送/托管/输入框）

## 2) 未完成项（当前缺口）

- [x] AI 回复后“后续建议问题（suggestions）”稳定性（已支持后台静默生成、120s 超时、失败重试与结果过滤）
- [x] 模式下拉菜单中当前项勾选态（已补齐勾选+高亮）
- [x] 模型能力驱动的模式/推理选项可见性（根据模型能力动态展示）
- [x] 输入区键盘交互完善（Esc/方向键/Enter 的菜单操作）
- [x] 新会话欢迎态（输入框上方 Welcome）的轻量实现（新对话空态展示快捷开始，首条消息后自动隐藏）

## 3) 实施建议：先看老代码，再改新代码

### 步骤 A：先看老代码（Web 参考）

1. 页面布局与输入区挂载位置  
   - `frontend/src/app/workspace/chats/[thread_id]/page.tsx`
2. 输入区完整交互（模式、推理强度、建议问题触发）  
   - `frontend/src/components/workspace/input-box.tsx`
3. Todo 展示形态  
   - `frontend/src/components/workspace/todo-list.tsx`
4. 线程与消息数据结构  
   - `frontend/src/core/threads/types.ts`
   - `frontend/src/core/threads/utils.ts`

### 步骤 B：再改新代码（桌面版 DeerPanel）

1. 数据与事件层  
   - `deerpanel/src/lib/ws-client.js`
   - 若加 suggestions：`deerpanel/src/lib/tauri-api.js`（增加代理接口）
2. 页面层（渲染与事件）  
   - `deerpanel/src/pages/chat.js`
3. 样式层（输入区/菜单/状态）  
   - `deerpanel/src/style/chat.css`

## 4) 建议执行顺序（最小风险）

1. **Suggestions**（只增功能，不改现有主流程）  
2. **模式菜单勾选态**（纯 UI 状态）  
3. **Reasoning Effort 独立下拉**（和“思考”解耦）  
4. **能力可见性判断**（避免出现不可用选项）  
5. **键盘交互与 Welcome**（体验增强）

## 5) 验收口径（简版）

- 发送“你好”后，流式输出稳定，无串台、无空白闪烁
- 刷新页面后会话可见、历史可加载
- 输入区按钮高度一致，无上下错位
- “思考”与“模式”互不串改
-（完成后）出现可点击的后续建议问题

