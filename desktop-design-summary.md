# DeerFlow Desktop 设计方案总结

## 概述

本文档是 DeerFlow Desktop 桌面端应用的完整设计方案总结，基于：
1. 现有设计文档 `desktop-design-final.md`
2. 参考项目 ClawPanel 的架构设计
3. 与 DeerFlow 后端系统的集成需求

---

## 一、核心架构

### 1.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Tauri v2 | 轻量级，安全，体积小 |
| 前端框架 | React 18 + TypeScript 5 | 组件化开发 |
| 样式 | Tailwind CSS 3 | 原子化CSS |
| 状态管理 | Zustand 4 | 轻量状态管理 |
| 数据获取 | TanStack Query 5 | 缓存和实时更新 |
| 路由 | React Router 6 | 声明式路由 |

### 1.2 项目结构

```
deerflow-desktop/
├── src-tauri/              # Tauri Rust 代码
│   ├── src/main.rs         # 主入口
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
│
├── src/
│   ├── main.tsx            # React 入口
│   ├── App.tsx             # 根组件
│   ├── router.tsx          # 路由配置
│   │
│   ├── api/                # API 客户端
│   ├── components/         # 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── stores/             # Zustand Stores
│   ├── types/              # TypeScript 类型
│   ├── utils/              # 工具函数
│   └── styles/             # 全局样式
│
├── public/                 # 静态资源
├── docs/                   # 文档
└── tests/                  # 测试
```

---

## 二、核心功能模块

### 2.1 快速启动 (Quick Launch)

**功能**: 全局快捷键唤起，快速创建任务

**界面元素**:
- 任务描述输入框
- 快捷模板按钮 (代码分析/文档生成/Bug修复等)
- 最近任务列表
- 文件拖拽区域

**唤起方式**:
- 全局快捷键: `Cmd/Ctrl + Shift + D`
- 托盘图标右键菜单
- 主界面快捷入口

### 2.2 项目与任务

**功能**: 项目管理和任务编排

**主要界面**:
1. **项目列表页**
   - 网格/列表视图切换
   - 进度可视化
   - 状态筛选

2. **项目详情页**
   - 项目概览卡片
   - 任务列表 (支持拖拽排序)
   - 执行时间线
   - 依赖关系图

3. **任务编排页**
   - 可视化任务编辑器
   - 依赖关系设置
   - 执行策略配置

### 2.3 Supervisor 人机协作

**功能**: AI 指挥官与人工决策的协作

**核心组件**:
1. **Supervisor 面板**
   - 当前状态显示
   - 思考过程展示
   - 决策统计

2. **决策卡片**
   - 决策类型标识
   - 情况描述
   - 选项列表 (带风险等级)
   - 倒计时 (如有时限)

3. **对话界面**
   - 与 Supervisor 的实时对话
   - 历史消息记录
   - 快捷操作按钮

**决策类型**:
- 目标澄清
- 任务拆解
- 策略选择
- 人工确认
- 异常恢复
- 计划调整

### 2.4 技能中心

**功能**: 技能管理和技能市场

**主要界面**:
1. **我的技能**
   - 技能卡片网格
   - 启用/禁用切换
   - 版本更新提示

2. **技能详情**
   - 技能信息展示
   - 配置参数
   - 使用文档

3. **技能市场**
   - 分类筛选
   - 搜索功能
   - 排序选项 (热门/最新/评分)
   - 一键安装

4. **技能编辑器**
   - Markdown/YAML 编辑器
   - 实时预览
   - 语法检查
   - 模板选择

---

## 三、数据流与状态管理

### 3.1 Store 结构

```
┌─────────────────────────────────────────┐
│         Zustand Store (全局)            │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐  ┌─────────────┐      │
│  │ projectStore│  │  taskStore  │      │
│  │             │  │             │      │
│  │ - projects  │  │ - tasks    │      │
│  │ - current   │  │ - selected │      │
│  │ - loading   │  │ - loading  │      │
│  │ - error     │  │ - error    │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
│  ┌─────────────┐  ┌─────────────┐      │
│  │  skillStore │  │supervisorStore     │
│  │             │  │             │      │
│  │ - skills    │  │ - current   │      │
│  │ - market    │  │ - decisions │      │
│  │ - loading   │  │ - pending   │      │
│  │ - error     │  │ - chat      │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
│  ┌─────────────┐  ┌─────────────┐      │
│  │  agentStore │  │   uiStore   │      │
│  │             │  │             │      │
│  │ - agents    │  │ - sidebar   │      │
│  │ - status    │  │ - theme     │      │
│  │ - loading   │  │ - modal     │      │
│  │ - error     │  │ - toast     │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
│  ┌─────────────┐                       │
│  │settingsStore│                       │
│  │             │  (持久化到本地存储)       │
│  │ - general   │                       │
│  │ - shortcuts │                       │
│  │ - api       │                       │
│  │ - notifications                    │
│  └─────────────┘                       │
│                                         │
└─────────────────────────────────────────┘
```

### 3.2 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                        数据流架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   UI 组件                                                    │
│      │                                                       │
│      ▼                                                       │
│   ┌─────────────┐                                            │
│   │   Hooks     │  useProjects(), useTasks(), etc.            │
│   │             │  - 封装数据获取逻辑                         │
│   │             │  - 处理 loading/error 状态                  │
│   └──────┬──────┘                                            │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                            │
│   │   Store     │  Zustand Stores                             │
│   │             │  - 全局状态管理                               │
│   │             │  - Actions 处理业务逻辑                       │
│   └──────┬──────┘                                            │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                            │
│   │  TanStack   │  React Query                                │
│   │   Query     │  - 服务端状态缓存                            │
│   │             │  - 自动重试、轮询、刷新                        │
│   └──────┬──────┘                                            │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                            │
│   │ API Client  │  Axios / Fetch                               │
│   │             │  - 请求/响应拦截器                           │
│   │             │  - 错误处理                                   │
│   └──────┬──────┘                                            │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────┐                                            │
│   │   DeerFlow  │  后端 API                                    │
│   │   Backend   │  - Gateway (8001)                            │
│   │             │  - LangGraph (2024)                          │
│   │             │  - SSE 实时流                                │
│   └─────────────┘                                            │
│                                                              │
│   数据持久化:                                                │
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐    │
   │ Zustand     │────▶│ IndexedDB   │     │ LocalStorage│    │
   │ Persist     │     │ (大数据)     │     │ (配置)       │    │
   └─────────────┘     └─────────────┘     └─────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. 开发计划与里程碑

### 10.1 里程碑规划

```
总工期: 10 周

M1: 基础架构 (第1-2周) ████
├── 项目初始化和环境配置
├── Tauri + React 项目搭建
├── 设计系统 (Tailwind + 变量)
├── 基础组件库 (Button, Input, Card等)
├── 路由系统配置
└── 布局框架 (Sidebar, Header, Layout)

M2: 核心功能 - 项目与任务 (第3-4周) ████
├── API 客户端封装
├── 项目列表页面
├── 项目详情页面
├── 任务列表与拖拽排序
├── 任务编排界面
├── AI 规划集成
├── 执行监控与状态同步
└── SSE 实时更新

M3: Supervisor 人机协作 (第5-6周) ████
├── Supervisor 面板设计
├── 决策卡片组件
├── 人机确认流程
├── 对话界面
├── 决策历史记录
├── 干预级别设置
└── 通知系统

M4: 技能中心 (第7周) ██
├── 技能列表与卡片
├── 技能详情页面
├── 技能市场浏览
├── 技能安装/更新
├── 技能编辑器
└── 分类与搜索

M5: Tauri 集成与优化 (第8周) ██
├── 系统托盘集成
├── 全局快捷键
├── 快速启动窗口
├── 通知系统集成
├── 自动更新
└── 打包与签名

M6: 测试与发布 (第9-10周) ██
├── 单元测试
├── 集成测试
├── E2E 测试
├── 性能测试
├── 文档完善
├── Windows/Mac 打包
└── 发布
```

### 10.2 详细任务分解

#### M1: 基础架构 (第1-2周)

**Week 1:**
- [x] 项目初始化: Tauri + React + TypeScript + Vite
- [x] 配置 Tailwind CSS + PostCSS
- [x] 配置 ESLint + Prettier
- [x] 配置路径别名 (@/components, @/utils, etc.)
- [x] 创建基础目录结构
- [x] 定义 TypeScript 类型系统
- [x] 配置 Zustand store 结构
- [x] 配置 React Query

**Week 2:**
- [ ] 设计系统: CSS 变量定义 (颜色、间距、字体等)
- [ ] 基础组件开发:
  - [ ] Button (变体: primary, secondary, ghost, danger)
  - [ ] Input (支持 prefix/suffix, validation)
  - [ ] Select (单选/多选, 搜索)
  - [ ] Card (多种变体)
  - [ ] Badge (状态徽章)
  - [ ] Progress (进度条/环形)
  - [ ] Tooltip/Popover
  - [ ] Modal/Drawer
  - [ ] Toast 通知
  - [ ] Tabs/Accordion
  - [ ] Skeleton 加载占位
- [ ] 布局组件:
  - [ ] AppLayout (主布局框架)
  - [ ] Sidebar (可折叠侧边栏)
  - [ ] Header (顶部栏)
  - [ ] PageHeader (页面标题区)

---

## 11. 关键技术决策

### 11.1 为什么选择 Tauri?

| 特性 | Tauri | Electron |
|------|-------|----------|
| 包大小 | ~3MB | ~150MB |
| 内存占用 | 低 | 高 |
| 启动速度 | 快 | 慢 |
| 安全性 | 高 (Rust) | 中 |
| 前端自由度 | 高 | 高 |
| 生态成熟度 | 成长中 | 成熟 |

**结论**: 对于 DeerFlow Desktop 这种注重性能和体积的开发者工具，Tauri 是更好的选择。

### 11.2 状态管理: Zustand vs Redux

选择 **Zustand** 的原因:
1. 更轻量 (~1KB)
2. TypeScript 支持更好
3. 无需 Provider 包裹
4. 简洁的 API 设计
5. 支持中间件 (persist, immer, devtools)

### 11.3 样式方案: Tailwind CSS

优势:
- 原子化 CSS，避免样式冲突
- 高度可定制
- 开发效率高
- 体积小 (按需生成)
- 与 React 完美配合

---

## 12. 风险与挑战

### 12.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Tauri 生态不成熟 | 中 | 准备 fallback 方案，关注社区动态 |
| SSE 实时同步不稳定 | 高 | 实现轮询 fallback，断线重连 |
| 大量数据渲染性能 | 中 | 虚拟列表，分页加载，懒加载 |
| 跨平台兼容性 | 中 | 持续集成测试，虚拟机验证 |

### 12.2 项目风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 后端 API 变动 | 高 | 保持与后端团队密切沟通，使用 API 版本控制 |
| 开发时间超期 | 中 | 采用 MVP 策略，优先级排序，敏捷开发 |
| 用户接受度 | 中 | 早期用户测试，收集反馈，快速迭代 |

---

## 13. 下一步行动

### 立即开始 (本周)
- [ ] 初始化 Tauri + React 项目
- [ ] 配置开发环境
- [ ] 创建基础目录结构
- [ ] 定义 TypeScript 类型

### 第一周结束
- [ ] 完成基础组件库 (Button, Input, Card, etc.)
- [ ] 完成布局框架 (Sidebar, Header, Layout)
- [ ] 实现项目列表页面 (静态)

### 第一个里程碑 (M1 结束)
- [ ] 可运行的基础应用
- [ ] 项目 CRUD 功能
- [ ] 基础样式系统

---

## 附录

### A. 参考资源

- [Tauri 文档](https://tauri.app/)
- [React 文档](https://react.dev/)
- [Tailwind CSS 文档](https://tailwindcss.com/)
- [Zustand 文档](https://docs.pmnd.rs/zustand/)
- [ClawPanel 参考项目](D:/gh/git/java/github/clawpanel)

### B. 设计文档列表

1. `desktop-design-final.md` - 产品设计文档
2. `desktop-implementation-design.md` - 详细实施设计 Part 1
3. `desktop-implementation-part2.md` - 详细实施设计 Part 2
4. `desktop-design-summary.md` - 本总结文档

---

**文档结束**

*最后更新: 2024-03-31*
