# DeerFlow Desktop 详细实施设计文档

## 版本信息
- **版本**: v1.0
- **日期**: 2024-03-31
- **状态**: 详细设计阶段

---

## 1. 项目架构设计

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DeerFlow Desktop (Tauri + React)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        表现层 (UI Layer)                         │   │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │   │
│   │  │ 快速启动 │ │项目/任务 │ │Supervisor│ │ 技能中心 │           │   │
│   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        业务逻辑层 (Business Layer)               │   │
│   │                                                                  │   │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │   │
│   │  │ 任务规划引擎 │  │ Supervisor  │  │ 技能管理器  │             │   │
│   │  │             │  │ 协调器       │  │             │             │   │
│   │  │ • AI拆解    │  │             │  │ • 本地管理   │             │   │
│   │  │ • 依赖分析  │  │ • 任务派发   │  │ • 市场安装   │             │   │
│   │  │ • 时间估算  │  │ • 人机决策   │  │ • 版本控制   │             │   │
│   │  └─────────────┘  │ • 异常恢复   │  └─────────────┘             │   │
│   │                   │ • 结果汇总   │                              │   │
│   │                   └─────────────┘                              │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        数据层 (Data Layer)                       │   │
│   │  Zustand Store + TanStack Query + IndexedDB                     │   │
│   │                                                                  │   │
│   │  projectStore │ taskStore │ skillStore │ supervisorStore        │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        通信层 (Communication Layer)              │   │
│   │  REST API ──→ Gateway (8001)                                    │   │
│   │  SSE Stream ─→ LangGraph (2024) 实时状态                        │   │
│   │  WebSocket ──→ 系统通知                                        │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈选型

| 层级 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| 桌面框架 | Tauri | v2.x | 轻量级，安全，小体积 |
| 前端框架 | React | v18.x | 组件化，生态丰富 |
| 语言 | TypeScript | v5.x | 类型安全 |
| 样式 | Tailwind CSS | v3.x | 原子化CSS |
| UI组件 | Radix UI + 自定义 | - | 无障碍，可定制 |
| 状态管理 | Zustand | v4.x | 轻量，TypeScript友好 |
| 数据获取 | TanStack Query | v5.x | 缓存，实时更新 |
| 路由 | React Router | v6.x | 声明式路由 |
| 图标 | Lucide React | - | 现代图标 |
| 构建 | Vite | v5.x | 快速开发 |

### 1.3 项目目录结构

```
deerflow-desktop/
├── src-tauri/                      # Tauri Rust 代码
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── gen/
│   └── src/
│       └── main.rs
│
├── src/                           # React 前端代码
│   ├── main.tsx                   # 入口
│   ├── App.tsx                    # 根组件
│   ├── router.tsx                 # 路由配置
│   │
│   ├── api/                       # API 客户端
│   │   ├── client.ts              # axios 实例
│   │   ├── projects.ts            # 项目 API
│   │   ├── tasks.ts               # 任务 API
│   │   ├── skills.ts              # 技能 API
│   │   ├── supervisor.ts          # Supervisor API
│   │   └── agents.ts              # Agent API
│   │
│   ├── components/                # 组件库
│   │   ├── layout/                # 布局组件
│   │   │   ├── AppLayout.tsx      # 主布局
│   │   │   ├── Sidebar.tsx        # 侧边栏
│   │   │   ├── Header.tsx         # 顶部栏
│   │   │   └── QuickAccess.tsx    # 快速访问
│   │   │
│   │   ├── common/                # 通用组件
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Progress.tsx
│   │   │   ├── Tooltip.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Drawer.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   ├── Tabs.tsx
│   │   │   ├── Accordion.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   ├── Empty.tsx
│   │   │   ├── StatusIcon.tsx
│   │   │   └── AgentAvatar.tsx
│   │   │
│   │   ├── project/               # 项目相关组件
│   │   │   ├── ProjectCard.tsx
│   │   │   ├── ProjectList.tsx
│   │   │   ├── ProjectForm.tsx
│   │   │   ├── TaskList.tsx
│   │   │   ├── TaskItem.tsx
│   │   │   ├── TaskForm.tsx
│   │   │   ├── DependencyGraph.tsx
│   │   │   ├── GanttChart.tsx
│   │   │   ├── ExecutionTimeline.tsx
│   │   │   └── ProjectTemplates.tsx
│   │   │
│   │   ├── supervisor/            # Supervisor 组件
│   │   │   ├── SupervisorPanel.tsx
│   │   │   ├── DecisionCard.tsx
│   │   │   ├── DecisionHistory.tsx
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── ThinkingProcess.tsx
│   │   │   ├── AgentStatusGrid.tsx
│   │   │   ├── InterventionModal.tsx
│   │   │   └── StrategySelector.tsx
│   │   │
│   │   ├── skill/                 # 技能相关组件
│   │   │   ├── SkillCard.tsx
│   │   │   ├── SkillGrid.tsx
│   │   │   ├── SkillDetail.tsx
│   │   │   ├── SkillForm.tsx
│   │   │   ├── SkillMarket.tsx
│   │   │   ├── SkillInstaller.tsx
│   │   │   ├── SkillEditor.tsx
│   │   │   ├── CategoryFilter.tsx
│   │   │   └── VersionSelector.tsx
│   │   │
│   │   ├── quicklaunch/           # 快速启动组件
│   │   │   ├── QuickLaunch.tsx
│   │   │   ├── QuickInput.tsx
│   │   │   ├── RecentTasks.tsx
│   │   │   ├── QuickTemplates.tsx
│   │   │   ├── FileDropZone.tsx
│   │   │   └── FloatingWindow.tsx
│   │   │
│   │   └── visualization/         # 可视化组件
│   │       ├── FlowChart.tsx
│   │       ├── ProgressRing.tsx
│   │       ├── StatusTimeline.tsx
│   │       ├── AgentActivityLog.tsx
│   │       └── MetricCards.tsx
│   │
│   ├── hooks/                     # 自定义 Hooks
│   │   ├── useProjects.ts
│   │   ├── useTasks.ts
│   │   ├── useSkills.ts
│   │   ├── useSupervisor.ts
│   │   ├── useAgents.ts
│   │   ├── useSSE.ts
│   │   ├── useShortcut.ts
│   │   ├── useNotification.ts
│   │   ├── useLocalStorage.ts
│   │   └── useTheme.ts
│   │
│   ├── stores/                    # Zustand Stores
│   │   ├── index.ts
│   │   ├── projectStore.ts
│   │   ├── taskStore.ts
│   │   ├── skillStore.ts
│   │   ├── supervisorStore.ts
│   │   ├── agentStore.ts
│   │   ├── uiStore.ts
│   │   └── settingsStore.ts
│   │
│   ├── types/                     # TypeScript 类型
│   │   ├── index.ts
│   │   ├── project.ts
│   │   ├── task.ts
│   │   ├── skill.ts
│   │   ├── supervisor.ts
│   │   ├── agent.ts
│   │   ├── api.ts
│   │   └── common.ts
│   │
│   ├── utils/                     # 工具函数
│   │   ├── index.ts
│   │   ├── format.ts
│   │   ├── date.ts
│   │   ├── validation.ts
│   │   ├── storage.ts
│   │   ├── sse.ts
│   │   ├── graph.ts
│   │   └── helpers.ts
│   │
│   └── styles/                    # 全局样式
│       ├── index.css
│       ├── variables.css
│       ├── animations.css
│       └── components.css
│
├── public/                        # 静态资源
│   ├── icons/
│   ├── images/
│   └── fonts/
│
├── docs/                          # 文档
│   ├── api/
│   ├── components/
│   └── guides/
│
├── tests/                         # 测试
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── scripts/                       # 脚本
│   ├── build.js
│   ├── dev.js
│   └── release.js
│
├── .github/                       # GitHub 配置
│   └── workflows/
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── eslint.config.js
├── prettier.config.js
├── tauri.conf.json
└── README.md
```

---

## 2. 组件详细设计

### 2.1 布局组件

#### AppLayout
```typescript
interface AppLayoutProps {
  children: React.ReactNode;
  sidebar?: boolean;
  header?: boolean;
  compact?: boolean;
}

// 布局结构
// ┌─────────────────────────────────────────┐
// │              Header (56px)              │
// ├──────────┬──────────────────────────────┤
// │          │                              │
// │ Sidebar  │       Main Content           │
// │ (64px    │       (flex: 1)              │
// │  - 200px)│                              │
// │          │                              │
// │          │                              │
// └──────────┴──────────────────────────────┘
```

#### Sidebar
```typescript
interface SidebarProps {
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  items: NavItem[];
  activeItem?: string;
}

interface NavItem {
  id: string;
  icon: IconType;
  label: string;
  badge?: number;
  children?: NavItem[];
}
```

### 2.2 通用组件

#### Button 变体
```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconType;
  iconPosition?: 'left' | 'right';
  children: React.ReactNode;
  onClick?: () => void;
}
```

#### StatusBadge
```typescript
interface StatusBadgeProps {
  status: 'idle' | 'running' | 'pending' | 'completed' | 'failed' | 'paused';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  showLabel?: boolean;
}
```

### 2.3 项目相关组件

#### ProjectCard
```typescript
interface ProjectCardProps {
  project: Project;
  view?: 'grid' | 'list';
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

// 卡片展示信息
// - 项目名称 + 状态徽章
// - 进度条 (百分比 + 视觉)
// - 统计: 总任务 | 进行中 | 已完成
// - 当前活动: Supervisor状态/Agent状态
// - 时间: 创建时间/预计完成时间
// - 操作按钮
```

#### TaskList with Drag & Drop
```typescript
interface TaskListProps {
  tasks: Task[];
  onReorder?: (tasks: Task[]) => void;
  onTaskClick?: (task: Task) => void;
  onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
}

// 功能
// - 拖拽排序
// - 展开/折叠任务详情
// - 快速编辑任务状态
// - 显示依赖关系指示器
```

#### DependencyGraph
```typescript
interface DependencyGraphProps {
  tasks: Task[];
  layout?: 'horizontal' | 'vertical';
  interactive?: boolean;
  onNodeClick?: (taskId: string) => void;
}

// 使用 D3.js 或 React Flow 渲染
// - 节点 = 任务 (颜色表示状态)
// - 边 = 依赖关系
// - 支持缩放和平移
```

### 2.4 Supervisor 组件

#### SupervisorPanel
```typescript
interface SupervisorPanelProps {
  projectId: string;
  compact?: boolean;
}

// 面板内容
// ┌─────────────────────────────────────────┐
// │ 🧠 Supervisor: coordinator-agent       │
// │ ─────────────────────────────────────   │
// │                                         │
// │ 状态: 🟢 主动监控中                      │
// │ 信心分: 87%                            │
// │ 已做决策: 15次 (自动10 | 询问5)         │
// │                                         │
// │ 💭 当前思考:                            │
// │ ┌─────────────────────────────────────┐ │
// │ │ "任务进度良好。已自动调整执行顺序"  │ │
// │ └─────────────────────────────────────┘ │
// │                                         │
// │ 📋 最近决策:                            │
// │ • 2分钟前: 批准重命名方案 ✓            │
// │ • 5分钟前: 询问是否删除legacyAuth()    │
// │                                         │
// │ [查看历史] [调整策略] [💬 对话]          │
// └─────────────────────────────────────────┘
```

#### DecisionCard
```typescript
interface DecisionCardProps {
  decision: SupervisorDecision;
  onSelect?: (optionId: string) => void;
  onAskForHelp?: () => void;
  onPostpone?: () => void;
}

// 决策卡展示
// - 决策类型图标 + 标题
// - 情况描述
// - 选项列表 (带风险标识)
// - 倒计时 (如果有时限)
// - 操作按钮
```

#### ChatInterface
```typescript
interface ChatInterfaceProps {
  projectId: string;
  agentId?: string;
  initialMessages?: Message[];
}

// 聊天界面
// - 消息列表 (用户/AI)
// - 输入框 + 发送按钮
// - 快捷操作按钮
// - 代码块渲染
```

### 2.5 技能中心组件

#### SkillCard
```typescript
interface SkillCardProps {
  skill: Skill;
  variant?: 'grid' | 'list' | 'compact';
  onEnable?: () => void;
  onDisable?: () => void;
  onEdit?: () => void;
  onUpdate?: () => void;
  onUninstall?: () => void;
}
```

#### SkillMarket
```typescript
interface SkillMarketProps {
  categories?: string[];
  onInstall?: (skillId: string) => void;
  onPreview?: (skill: Skill) => void;
}

// 技能市场功能
// - 分类筛选
// - 搜索
// - 排序 (热门/最新/评分)
// - 技能卡片网格
// - 详情抽屉/弹窗
```

#### SkillEditor
```typescript
interface SkillEditorProps {
  skill?: Skill;  // undefined = 新建
  onSave?: (skill: Skill) => void;
  onValidate?: (content: string) => ValidationResult;
}

// 编辑器功能
// - Markdown/YAML 编辑器
// - 实时预览
// - 语法检查
// - 模板选择
// - 版本历史
```

### 2.6 快速启动组件

#### QuickLaunch
```typescript
interface QuickLaunchProps {
  isOpen: boolean;
  onClose: () => void;
  recentProjects?: Project[];
  templates?: QuickTemplate[];
}

// 快速启动界面
// - 输入框 (自然语言任务描述)
// - 快捷模板按钮
// - 最近任务列表
// - 文件拖拽区域
// - 项目选择
```

#### FloatingWindow
```typescript
interface FloatingWindowProps {
  position: { x: number; y: number };
  size: { width: number; height: number };
  content: React.ReactNode;
  onMove?: (position: { x: number; y: number }) => void;
  onResize?: (size: { width: number; height: number }) => void;
  onClose?: () => void;
}
```

---

## 3. 状态管理设计

### 3.1 Store 结构

```typescript
// stores/index.ts
import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// 组合所有 stores
export const useBoundStore = create(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set, get, api) => ({
          // 合并所有 store slices
          ...createProjectSlice(set, get, api),
          ...createTaskSlice(set, get, api),
          ...createSkillSlice(set, get, api),
          ...createSupervisorSlice(set, get, api),
          ...createAgentSlice(set, get, api),
          ...createUISlice(set, get, api),
          ...createSettingsSlice(set, get, api),
        }))
      ),
      {
        name: 'deerflow-desktop-storage',
        partialize: (state) => ({
          // 只持久化这些字段
          settings: state.settings,
          recentProjects: state.recentProjects,
          quickTemplates: state.quickTemplates,
        }),
      }
    ),
    { name: 'DeerFlowStore' }
  )
);
```

### 3.2 各 Store Slice 设计

#### ProjectStore
```typescript
interface ProjectState {
  // 数据
  projects: Project[];
  currentProject: Project | null;
  recentProjects: string[]; // IDs
  
  // 加载状态
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<void>;
  createProject: (data: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  runProject: (id: string) => Promise<void>;
  pauseProject: (id: string) => Promise<void>;
  resumeProject: (id: string) => Promise<void>;
}

const createProjectSlice = (set, get, api): ProjectState => ({
  projects: [],
  currentProject: null,
  recentProjects: [],
  isLoading: false,
  error: null,
  
  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await apiClient.projects.list();
      set({ projects, isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  // ... 其他 actions
});
```

#### TaskStore
```typescript
interface TaskState {
  tasks: Map<string, Task[]>; // projectId -> tasks
  selectedTasks: string[];
  isPlanning: boolean;
  
  fetchTasks: (projectId: string) => Promise<void>;
  createTask: (projectId: string, data: CreateTaskInput) => Promise<Task>;
  updateTask: (projectId: string, taskId: string, data: UpdateTaskInput) => Promise<void>;
  deleteTask: (projectId: string, taskId: string) => Promise<void>;
  reorderTasks: (projectId: string, tasks: Task[]) => void;
  setTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => Promise<void>;
  planTasks: (projectId: string, goal: string) => Promise<Task[]>;
  selectTask: (taskId: string, selected: boolean) => void;
  selectAll: (projectId: string, selected: boolean) => void;
}
```

#### SkillStore
```typescript
interface SkillState {
  skills: Skill[];
  marketSkills: MarketSkill[];
  categories: string[];
  installedFilter: 'all' | 'enabled' | 'disabled';
  searchQuery: string;
  selectedCategory: string | null;
  
  fetchSkills: () => Promise<void>;
  fetchMarketSkills: (params?: MarketParams) => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  updateSkill: (skillId: string, data: UpdateSkillInput) => Promise<void>;
  createSkill: (data: CreateSkillInput) => Promise<Skill>;
  checkUpdates: () => Promise<Skill[]>;
  updateSkillVersion: (skillId: string) => Promise<void>;
  setFilter: (filter: SkillState['installedFilter']) => void;
  setSearchQuery: (query: string) => void;
  setCategory: (category: string | null) => void;
}
```

#### SupervisorStore
```typescript
interface SupervisorState {
  currentSupervisor: Supervisor | null;
  decisions: SupervisorDecision[];
  pendingDecisions: SupervisorDecision[];
  chatHistory: ChatMessage[];
  isThinking: boolean;
  interventionLevel: 'minimal' | 'moderate' | 'high';
  autoDecisionRules: AutoDecisionRules;
  
  fetchSupervisor: (projectId: string) => Promise<void>;
  fetchDecisions: (projectId: string, params?: DecisionParams) => Promise<void>;
  makeDecision: (decisionId: string, optionId: string, feedback?: string) => Promise<void>;
  postPoneDecision: (decisionId: string, duration: number) => Promise<void>;
  askForHelp: (decisionId: string, question: string) => Promise<void>;
  sendChatMessage: (projectId: string, message: string) => Promise<void>;
  fetchChatHistory: (projectId: string) => Promise<void>;
  clearChat: (projectId: string) => Promise<void>;
  setInterventionLevel: (level: SupervisorState['interventionLevel']) => void;
  updateAutoDecisionRules: (rules: Partial<AutoDecisionRules>) => void;
  acknowledgeDecision: (decisionId: string) => void;
}
```

---

## 4. API 集成设计

### 4.1 API 客户端

```typescript
// api/client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/common/Toast';

class ApiClient {
  private client: AxiosInstance;
  private baseURL: string;
  
  constructor() {
    // 根据环境选择baseURL
    this.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8001';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    this.setupInterceptors();
  }
  
  private setupInterceptors() {
    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        // 添加认证token
        const token = useAuthStore.getState().token;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        
        // 添加请求时间戳
        config.metadata = { startTime: Date.now() };
        
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => {
        // 计算请求耗时
        const duration = Date.now() - response.config.metadata.startTime;
        console.log(`[API] ${response.config.method?.toUpperCase()} ${response.config.url} - ${duration}ms`);
        
        return response.data;
      },
      (error: AxiosError<ApiError>) => {
        return this.handleError(error);
      }
    );
  }
  
  private handleError(error: AxiosError<ApiError>): Promise<never> {
    const { response, request, message } = error;
    
    if (response) {
      // 服务器返回错误
      const status = response.status;
      const data = response.data;
      
      switch (status) {
        case 401:
          // 未授权，清除token并跳转登录
          useAuthStore.getState().logout();
          window.location.href = '/login';
          break;
        case 403:
          toast.error('没有权限执行此操作');
          break;
        case 404:
          toast.error('请求的资源不存在');
          break;
        case 422:
          toast.error(`验证错误: ${data.message || '请检查输入'}`);
          break;
        case 429:
          toast.error('请求过于频繁，请稍后再试');
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          toast.error('服务器错误，请稍后重试');
          break;
        default:
          toast.error(data.message || '请求失败');
      }
      
      return Promise.reject({
        status,
        message: data.message || '请求失败',
        errors: data.errors,
      });
    } else if (request) {
      // 请求发送但没有收到响应
      toast.error('网络错误，请检查网络连接');
      return Promise.reject({
        status: 0,
        message: '网络错误',
      });
    } else {
      // 请求配置出错
      toast.error('请求配置错误');
      return Promise.reject({
        status: -1,
        message: message || '请求配置错误',
      });
    }
  }
  
  // HTTP 方法封装
  async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    return this.client.get(url, { params });
  }
  
  async post<T>(url: string, data?: any): Promise<T> {
    return this.client.post(url, data);
  }
  
  async put<T>(url: string, data?: any): Promise<T> {
    return this.client.put(url, data);
  }
  
  async patch<T>(url: string, data?: any): Promise<T> {
    return this.client.patch(url, data);
  }
  
  async delete<T>(url: string): Promise<T> {
    return this.client.delete(url);
  }
  
  // SSE 连接
  connectSSE<T>(url: string, onMessage: (data: T) => void, onError?: (error: Event) => void): EventSource {
    const fullUrl = `${this.baseURL}${url}`;
    const token = useAuthStore.getState().token;
    const es = new EventSource(`${fullUrl}?token=${token}`);
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };
    
    es.onerror = (error) => {
      console.error('SSE error:', error);
      onError?.(error);
    };
    
    return es;
  }
}

export const apiClient = new ApiClient();
```

### 4.2 API 模块

```typescript
// api/projects.ts
import { apiClient } from './client';
import type { Project, CreateProjectInput, UpdateProjectInput, ProjectFilters } from '@/types';

export const projectsApi = {
  // 列表查询
  list: (filters?: ProjectFilters) =>
    apiClient.get<Project[]>('/api/projects', filters),
  
  // 详情
  get: (id: string) =>
    apiClient.get<Project>(`/api/projects/${id}`),
  
  // 创建
  create: (data: CreateProjectInput) =>
    apiClient.post<Project>('/api/projects', data),
  
  // 更新
  update: (id: string, data: UpdateProjectInput) =>
    apiClient.put<Project>(`/api/projects/${id}`, data),
  
  // 删除
  delete: (id: string) =>
    apiClient.delete<void>(`/api/projects/${id}`),
  
  // 开始执行
  run: (id: string) =>
    apiClient.post<void>(`/api/projects/${id}/run`),
  
  // 暂停
  pause: (id: string) =>
    apiClient.post<void>(`/api/projects/${id}/pause`),
  
  // 恢复
  resume: (id: string) =>
    apiClient.post<void>(`/api/projects/${id}/resume`),
  
  // AI 规划
  plan: (id: string, goal: string) =>
    apiClient.post<Task[]>(`/api/projects/${id}/plan`, { goal }),
  
  // SSE 实时状态流
  connectStatusStream: (
    id: string,
    onUpdate: (update: ProjectUpdate) => void,
    onError?: (error: Event) => void
  ) => apiClient.connectSSE(
    `/api/projects/${id}/stream`,
    onUpdate,
    onError
  ),
};
```

---

## 5. 样式系统设计

### 5.1 CSS 变量系统

```css
/* styles/variables.css */
:root {
  /* 主题色 - 紫蓝色系 */
  --primary-50: #eef2ff;
  --primary-100: #e0e7ff;
  --primary-200: #c7d2fe;
  --primary-300: #a5b4fc;
  --primary-400: #818cf8;
  --primary-500: #6366f1;
  --primary-600: #4f46e5;
  --primary-700: #4338ca;
  --primary-800: #3730a3;
  --primary-900: #312e81;
  
  /* 状态色 */
  --status-idle: #3b82f6;        /* 蓝 - 空闲 */
  --status-running: #22c55e;     /* 绿 - 运行 */
  --status-pending: #eab308;     /* 黄 - 等待 */
  --status-error: #ef4444;       /* 红 - 错误 */
  --status-completed: #10b981;   /* 青绿 - 完成 */
  --status-paused: #f97316;      /* 橙 - 暂停 */
  
  /* 背景色 - Dark Theme */
  --bg-primary: #0a0a0a;
  --bg-secondary: #141414;
  --bg-tertiary: #1f1f1f;
  --bg-elevated: #262626;
  --bg-overlay: rgba(0, 0, 0, 0.8);
  
  /* 文字色 */
  --text-primary: #fafafa;
  --text-secondary: #a3a3a3;
  --text-tertiary: #737373;
  --text-disabled: #525252;
  
  /* 边框 */
  --border-primary: #262626;
  --border-secondary: #1f1f1f;
  --border-focus: var(--primary-500);
  
  /* 间距系统 */
  --space-0: 0;
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-10: 2.5rem;  /* 40px */
  --space-12: 3rem;    /* 48px */
  
  /* 圆角 */
  --radius-none: 0;
  --radius-sm: 0.125rem;  /* 2px */
  --radius-md: 0.375rem;  /* 6px */
  --radius-lg: 0.5rem;    /* 8px */
  --radius-xl: 0.75rem;   /* 12px */
  --radius-2xl: 1rem;     /* 16px */
  --radius-full: 9999px;
  
  /* 阴影 */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-inner: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
  --shadow-glow: 0 0 20px rgba(99, 102, 241, 0.3);
  
  /* 动画 */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 350ms;
  --duration-slower: 500ms;
  
  --ease-linear: linear;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  
  /* 字体 */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', monospace;
  
  /* 字号 */
  --text-xs: 0.75rem;    /* 12px */
  --text-sm: 0.875rem;   /* 14px */
  --text-base: 1rem;     /* 16px */
  --text-lg: 1.125rem;   /* 18px */
  --text-xl: 1.25rem;    /* 20px */
  --text-2xl: 1.5rem;    /* 24px */
  --text-3xl: 1.875rem;  /* 30px */
  --text-4xl: 2.25rem;   /* 36px */
  
  /* 字重 */
  --font-light: 300;
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  
  /* 行高 */
  --leading-none: 1;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;
  
  /* z-index */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-fixed: 300;
  --z-drawer: 400;
  --z-modal: 500;
  --z-popover: 600;
  --z-tooltip: 700;
  --z-toast: 800;
  --z-splash: 900;
}
```

---

## 6. 详细界面设计

### 6.1 快速启动窗口

```tsx
// components/quicklaunch/QuickLaunch.tsx
interface QuickLaunchProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickLaunch({ isOpen, onClose }: QuickLaunchProps) {
  const [input, setInput] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const { recentProjects, quickTemplates } = useQuickLaunchStore();
  
  const handleSubmit = async () => {
    if (!input.trim()) return;
    
    // 创建新项目
    const project = await createProject({
      name: input.slice(0, 50),
      goal: input,
      template: selectedTemplate,
    });
    
    // 启动项目
    await runProject(project.id);
    
    // 关闭窗口并导航
    onClose();
    navigate(`/projects/${project.id}`);
  };
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      className="quick-launch-modal"
    >
      <div className="quick-launch-content">
        {/* Header */}
        <div className="ql-header">
          <Logo size="md" />
          <h2>快速任务</h2>
          <ShortcutHint keys={['Cmd', 'Shift', 'D']} />
        </div>
        
        {/* Input Area */}
        <div className="ql-input-area">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="描述你的任务目标，例如：分析代码结构并重构组件目录..."
            className="ql-input"
            autoFocus
            rows={3}
          />
          <Button
            variant="primary"
            size="lg"
            icon={<SendIcon />}
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="ql-submit"
          >
            开始执行
          </Button>
        </div>
        
        {/* Quick Templates */}
        <div className="ql-templates">
          <span className="ql-section-label">快速选择:</span>
          <div className="ql-template-buttons">
            {quickTemplates.map((template) => (
              <Button
                key={template.id}
                variant={selectedTemplate === template.id ? 'primary' : 'ghost'}
                size="sm"
                icon={template.icon}
                onClick={() => setSelectedTemplate(
                  selectedTemplate === template.id ? null : template.id
                )}
              >
                {template.name}
              </Button>
            ))}
          </div>
        </div>
        
        {/* Recent Tasks */}
        {recentProjects.length > 0 && (
          <div className="ql-recent">
            <span className="ql-section-label">最近任务:</span>
            <div className="ql-recent-list">
              {recentProjects.slice(0, 4).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  variant="compact"
                  onClick={() => {
                    onClose();
                    navigate(`/projects/${project.id}`);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        
        {/* File Drop Zone */}
        <FileDropZone
          onDrop={(files) => {
            // 处理拖拽的文件
            handleFileDrop(files);
          }}
          className="ql-dropzone"
        >
          <span>拖拽文件到此处</span>
          <span className="ql-or">或</span>
          <Button variant="ghost" size="sm">
            浏览项目...
          </Button>
        </FileDropZone>
      </div>
    </Modal>
  );
}
```

---

由于篇幅限制，我将继续在下一部分详细说明其他模块。这份设计文档涵盖了架构、组件、状态管理和API集成等核心内容。你是否需要我继续详细展开某个特定部分？比如 Supervisor 的决策流程、技能中心的实现，或者与后端 DeerFlow 的集成细节？
