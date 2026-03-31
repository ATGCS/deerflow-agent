# DeerFlow Desktop 详细实施设计文档 - Part 2

## 目录
7. 路由与导航设计
8. 与 DeerFlow 后端集成
9. Tauri 桌面集成
10. 性能优化策略
11. 测试策略
12. 开发计划与里程碑

---

## 7. 路由与导航设计

### 7.1 路由配置

```typescript
// router.tsx
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { QuickLaunch } from '@/components/quicklaunch/QuickLaunch';

// 懒加载页面组件
const ProjectListPage = lazy(() => import('@/pages/projects/ProjectListPage'));
const ProjectDetailPage = lazy(() => import('@/pages/projects/ProjectDetailPage'));
const TaskOrchestrationPage = lazy(() => import('@/pages/projects/TaskOrchestrationPage'));
const SupervisorPage = lazy(() => import('@/pages/supervisor/SupervisorPage'));
const SkillCenterPage = lazy(() => import('@/pages/skills/SkillCenterPage'));
const SkillMarketPage = lazy(() => import('@/pages/skills/SkillMarketPage'));
const SkillEditorPage = lazy(() => import('@/pages/skills/SkillEditorPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));

// 路由守卫
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  if (isLoading) {
    return <FullScreenLoading />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/projects" replace />,
      },
      {
        path: 'projects',
        children: [
          {
            index: true,
            element: <ProjectListPage />,
          },
          {
            path: ':projectId',
            children: [
              {
                index: true,
                element: <ProjectDetailPage />,
              },
              {
                path: 'tasks',
                element: <TaskOrchestrationPage />,
              },
              {
                path: 'supervisor',
                element: <SupervisorPage />,
              },
            ],
          },
        ],
      },
      {
        path: 'skills',
        children: [
          {
            index: true,
            element: <SkillCenterPage />,
          },
          {
            path: 'market',
            element: <SkillMarketPage />,
          },
          {
            path: 'edit/:skillId?',
            element: <SkillEditorPage />,
          },
        ],
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
```

### 7.2 导航菜单

```typescript
// config/navigation.ts
import {
  LayoutDashboard,
  FolderKanban,
  Brain,
  Puzzle,
  Settings,
  Zap,
  GitBranch,
  MessageSquare,
} from 'lucide-react';

export const mainNavigation = [
  {
    id: 'quick-launch',
    label: '快速启动',
    icon: Zap,
    shortcut: 'Cmd+Shift+D',
    action: 'openQuickLaunch',
  },
  {
    id: 'projects',
    label: '项目与任务',
    icon: FolderKanban,
    href: '/projects',
    badge: 'projectCount',
  },
  {
    id: 'supervisor',
    label: 'Supervisor',
    icon: Brain,
    href: '/projects/current/supervisor',
    badge: 'pendingDecisions',
    highlight: true,
  },
  {
    id: 'skills',
    label: '技能中心',
    icon: Puzzle,
    href: '/skills',
    children: [
      { id: 'my-skills', label: '我的技能', href: '/skills' },
      { id: 'skill-market', label: '技能市场', href: '/skills/market' },
      { id: 'skill-editor', label: '创建技能', href: '/skills/edit' },
    ],
  },
  {
    id: 'settings',
    label: '设置',
    icon: Settings,
    href: '/settings',
  },
];

export const quickActions = [
  { id: 'new-project', label: '新建项目', icon: FolderKanban, shortcut: 'Cmd+N' },
  { id: 'new-skill', label: '创建技能', icon: Puzzle, shortcut: 'Cmd+Shift+N' },
  { id: 'open-devtools', label: '开发者工具', icon: GitBranch, shortcut: 'F12' },
];
```

---

## 8. 与 DeerFlow 后端集成

### 8.1 服务发现与连接

```typescript
// services/connection.ts
import { invoke } from '@tauri-apps/api/core';

interface ServiceEndpoints {
  gateway: string;
  langgraph: string;
  sse: string;
}

class ConnectionManager {
  private endpoints: ServiceEndpoints | null = null;
  private healthCheckInterval: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  async discoverEndpoints(): Promise<ServiceEndpoints> {
    try {
      // 尝试从 Tauri 配置读取
      const config = await invoke<{
        gateway_url: string;
        langgraph_url: string;
      }>('get_service_config');
      
      this.endpoints = {
        gateway: config.gateway_url,
        langgraph: config.langgraph_url,
        sse: `${config.gateway_url}/api/stream`,
      };
      
      return this.endpoints;
    } catch (error) {
      // 回退到默认配置
      console.warn('Failed to read service config, using defaults:', error);
      this.endpoints = {
        gateway: 'http://localhost:8001',
        langgraph: 'http://localhost:2024',
        sse: 'http://localhost:8001/api/stream',
      };
      return this.endpoints;
    }
  }
  
  async checkHealth(): Promise<boolean> {
    if (!this.endpoints) {
      await this.discoverEndpoints();
    }
    
    try {
      const response = await fetch(`${this.endpoints!.gateway}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  
  startHealthCheck(intervalMs = 30000) {
    this.stopHealthCheck();
    
    const check = async () => {
      const isHealthy = await this.checkHealth();
      
      if (!isHealthy) {
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          // 触发离线事件
          window.dispatchEvent(new CustomEvent('deerflow:connection:offline'));
        }
      } else {
        this.reconnectAttempts = 0;
      }
    };
    
    check(); // 立即检查一次
    this.healthCheckInterval = window.setInterval(check, intervalMs);
  }
  
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

export const connectionManager = new ConnectionManager();
```

### 8.2 数据同步策略

```typescript
// services/sync.ts
import { apiClient } from '@/api/client';
import { useProjectStore } from '@/stores/projectStore';

interface SyncOptions {
  projectId: string;
  interval?: number;
  onUpdate?: (update: ProjectUpdate) => void;
  onError?: (error: Error) => void;
}

class ProjectSyncManager {
  private eventSources: Map<string, EventSource> = new Map();
  private syncIntervals: Map<string, number> = new Map();
  
  // 启动实时同步 (SSE)
  startRealtimeSync({ projectId, onUpdate, onError }: SyncOptions) {
    // 停止已有连接
    this.stopRealtimeSync(projectId);
    
    const es = apiClient.connectSSE(
      `/api/projects/${projectId}/stream`,
      (update: ProjectUpdate) => {
        // 更新本地 store
        useProjectStore.getState().applyUpdate(projectId, update);
        onUpdate?.(update);
      },
      (error) => {
        console.error('SSE error:', error);
        onError?.(new Error('Connection lost'));
        
        // 尝试重连
        setTimeout(() => {
          this.startRealtimeSync({ projectId, onUpdate, onError });
        }, 5000);
      }
    );
    
    this.eventSources.set(projectId, es);
  }
  
  stopRealtimeSync(projectId: string) {
    const es = this.eventSources.get(projectId);
    if (es) {
      es.close();
      this.eventSources.delete(projectId);
    }
  }
  
  // 启动轮询同步 (fallback)
  startPollingSync({ projectId, interval = 5000, onUpdate }: SyncOptions) {
    this.stopPollingSync(projectId);
    
    const poll = async () => {
      try {
        const project = await apiClient.projects.get(projectId);
        useProjectStore.getState().updateProject(project);
        onUpdate?.({ type: 'project', data: project });
      } catch (error) {
        console.error('Poll error:', error);
      }
    };
    
    poll(); // 立即执行一次
    const intervalId = window.setInterval(poll, interval);
    this.syncIntervals.set(projectId, intervalId);
  }
  
  stopPollingSync(projectId: string) {
    const intervalId = this.syncIntervals.get(projectId);
    if (intervalId) {
      clearInterval(intervalId);
      this.syncIntervals.delete(projectId);
    }
  }
  
  stopAllSync() {
    // 停止所有 SSE
    this.eventSources.forEach((es) => es.close());
    this.eventSources.clear();
    
    // 停止所有轮询
    this.syncIntervals.forEach((id) => clearInterval(id));
    this.syncIntervals.clear();
  }
}

export const syncManager = new ProjectSyncManager();
```

---

## 9. Tauri 桌面集成

### 9.1 Tauri 配置

```json
// src-tauri/tauri.conf.json
{
  "productName": "DeerFlow Desktop",
  "version": "1.0.0",
  "identifier": "tech.deerflow.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "DeerFlow",
        "width": 1400,
        "height": 900,
        "minWidth": 900,
        "minHeight": 600,
        "center": true,
        "decorations": true,
        "transparent": false,
        "fullscreen": false,
        "resizable": true,
        "maximized": false
      },
      {
        "label": "quick-launch",
        "title": "快速任务",
        "width": 600,
        "height": 500,
        "minWidth": 400,
        "minHeight": 300,
        "center": true,
        "decorations": false,
        "transparent": true,
        "visible": false,
        "alwaysOnTop": true,
        "skipTaskbar": true
      }
    ],
    "trayIcon": {
      "iconPath": "icons/icon.png",
      "tooltip": "DeerFlow Desktop",
      "menuItems": [
        {
          "id": "quick-launch",
          "text": "快速任务"
        },
        {
          "id": "show",
          "text": "显示主窗口"
        },
        {
          "id": "separator",
          "text": "-"
        },
        {
          "id": "settings",
          "text": "设置"
        },
        {
          "id": "quit",
          "text": "退出"
        }
      ]
    },
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://localhost:* https://api.deerflow.tech; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:;",
      "dangerousRemoteDomainIpcAccess": [],
      "freezePrototype": true
    },
    "macOSPrivateApi": false
  },
  "bundle": {
    "active": true,
    "category": "DeveloperTool",
    "copyright": "Copyright (c) 2024 DeerFlow",
    "deb": {
      "depends": []
    },
    "macOS": {
      "entitlements": "./entitlements.plist",
      "exceptionDomain": "",
      "frameworks": [],
      "minimumSystemVersion": "11.0",
      "signingIdentity": null
    },
    "resources": [],
    "shortDescription": "DeerFlow Desktop - AI任务编排与人机协作",
    "targets": ["msi", "nsis", "app", "dmg", "appimage", "deb", "rpm"],
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": ""
    }
  },
  "plugins": {
    "shell": {
      "open": true
    },
    "clipboard": {
      "writeText": true,
      "readText": true
    },
    "dialog": {
      "open": true,
      "save": true
    },
    "fs": {
      "readFile": true,
      "writeFile": true,
      "readDir": true,
      "copyFile": true,
      "createDir": true,
      "removeDir": true,
      "removeFile": true,
      "renameFile": true,
      "exists": true
    },
    "globalShortcut": {
      "register": true,
      "unregister": true
    },
    "http": {
      "request": true
    },
    "notification": {
      "send": true,
      "requestPermission": true
    },
    "os": {
      "platform": true,
      "version": true,
      "type": true,
      "arch": true
    },
    "process": {
      "relaunch": true,
      "exit": true
    },
    "updater": {
      "check": true,
      "download": true,
      "install": true
    }
  }
}
```

### 9.2 Rust 后端代码

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder},
    Manager, Runtime, State, WindowEvent,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// 应用状态
struct AppState {
    quick_launch_visible: Mutex<bool>,
    service_config: Mutex<ServiceConfig>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ServiceConfig {
    gateway_url: String,
    langgraph_url: String,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            gateway_url: "http://localhost:8001".to_string(),
            langgraph_url: "http://localhost:2024".to_string(),
        }
    }
}

// 命令处理器
#[tauri::command]
async fn get_service_config(state: State<'_, AppState>) -> Result<ServiceConfig, String> {
    let config = state.service_config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
async fn set_service_config(
    config: ServiceConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut current = state.service_config.lock().map_err(|e| e.to_string())?;
    *current = config;
    Ok(())
}

#[tauri::command]
async fn toggle_quick_launch(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick-launch") {
        if window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 主函数
fn main() {
    tauri::Builder::default()
        .manage(AppState {
            quick_launch_visible: Mutex::new(false),
            service_config: Mutex::new(ServiceConfig::default()),
        })
        .invoke_handler(tauri::generate_handler![
            get_service_config,
            set_service_config,
            toggle_quick_launch,
            show_main_window,
        ])
        .setup(|app| {
            // 设置系统托盘
            let tray_icon = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeerFlow Desktop")
                .menu(&create_tray_menu(app)?)
                .on_menu_event(|app, event| {
                    handle_tray_menu_event(app, event);
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        // 左键点击显示主窗口
                        let app = tray.app_handle();
                        let _ = show_main_window(app.clone());
                    }
                })
                .build(app)?;
            
            // 设置全局快捷键
            #[cfg(desktop)]
            {
                use tauri::global_shortcut::ShortcutState;
                
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["Cmd+Shift+D"])?
                        .with_handler(|app, shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                if shortcut.to_string() == "Cmd+Shift+D" {
                                    let _ = toggle_quick_launch(app.clone());
                                }
                            }
                        })
                        .build(),
                )?;
            }
            
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    // 主窗口关闭时最小化到托盘
                    if window.label() == "main" {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn create_tray_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let menu = Menu::new(app)?;
    
    let item_quick_launch = MenuItem::new(app, "快速任务", true, None::<&str>)?;
    let item_show = MenuItem::new(app, "显示主窗口", true, None::<&str>)?;
    let item_separator = MenuItem::new(app, "-", true, None::<&str>)?;
    let item_settings = MenuItem::new(app, "设置", true, None::<&str>)?;
    let item_quit = MenuItem::new(app, "退出", true, None::<&str>)?;
    
    menu.append(&item_quick_launch)?;
    menu.append(&item_show)?;
    menu.append(&item_separator)?;
    menu.append(&item_settings)?;
    menu.append(&item_quit)?;
    
    Ok(menu)
}

fn handle_tray_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.0.as_str() {
        "快速任务" => {
            let _ = toggle_quick_launch(app.clone());
        }
        "显示主窗口" => {
            let _ = show_main_window(app.clone());
        }
        "设置" => {
            let _ = show_main_window(app.clone());
            // 触发导航到设置页面
            app.emit("navigate", "/settings").unwrap();
        }
        "退出" => {
            app.exit(0);
        }
        _ => {}
    }
}
```

---

由于篇幅限制，剩余部分（性能优化、测试策略、开发计划）将在 Part 3 中继续。这份设计文档涵盖了：

1. **路由与导航** - 完整的路由配置和导航菜单设计
2. **后端集成** - API 客户端、SSE 实时同步、服务发现
3. **Tauri 集成** - Rust 后端代码、系统托盘、全局快捷键

是否需要我继续创建 Part 3 来完成整个设计文档？
