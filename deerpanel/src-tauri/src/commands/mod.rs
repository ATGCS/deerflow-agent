use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;

/// 缓存 gateway 端口，避免频繁读文件�?秒有效期�?static GATEWAY_PORT_CACHE: std::sync::LazyLock<std::sync::Mutex<(u16, std::time::Instant)>> =
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new((18789, std::time::Instant::now() - Duration::from_secs(60)))
    });

pub mod agent;
pub mod assistant;
pub mod config;
pub mod device;
pub mod extensions;
pub mod logs;
pub mod memory;
pub mod messaging;
pub mod pairing;
pub mod service;
pub mod skills;
pub mod update;

/// 默认 DeerPanel 配置目录（ClawPanel 自身配置始终在此�?fn default_deerpanel_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".deerpanel")
}

/// 获取 DeerPanel 配置目录
/// 优先使用 deerpanel.json 中的 deerpanelDir 自定义路径，不存在则回退默认 ~/.deerpanel
pub fn deerpanel_dir() -> PathBuf {
    // 直接�?deerpanel.json（始终在默认目录下），避免循环依�?    let config_path = default_deerpanel_dir().join("deerpanel.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(custom) = v.get("deerpanelDir").and_then(|d| d.as_str()) {
                let p = PathBuf::from(custom);
                if !custom.is_empty() && p.exists() {
                    return p;
                }
            }
        }
    }
    default_deerpanel_dir()
}

/// Gateway 监听端口：读�?`deerpanel.json` �?`gateway.port`，缺�?**18789**�?/// 与面板「Gateway 配置」、服务状态检测（netstat / TCP / launchctl 兜底）共用同一来源�?/// 并尊�?`deerpanel.json` 中的 `deerpanelDir` 自定义配置目录�?pub fn gateway_listen_port() -> u16 {
    // 5秒内返回缓存值，避免服务状态检测时频繁读文�?    if let Ok(cache) = GATEWAY_PORT_CACHE.lock() {
        if cache.1.elapsed() < Duration::from_secs(5) {
            return cache.0;
        }
    }
    let port = read_gateway_port_from_config();
    if let Ok(mut cache) = GATEWAY_PORT_CACHE.lock() {
        *cache = (port, std::time::Instant::now());
    }
    port
}

fn read_gateway_port_from_config() -> u16 {
    let config_path = deerpanel_dir().join("deerpanel.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(port) = val
                .get("gateway")
                .and_then(|g| g.get("port"))
                .and_then(|p| p.as_u64())
            {
                if port > 0 && port < 65536 {
                    return port as u16;
                }
            }
        }
    }
    18789
}

fn panel_config_path() -> PathBuf {
    // DeerPanel 自身配置始终在默认目录，不随 deerpanelDir 变化
    default_deerpanel_dir().join("deerpanel.json")
}

pub fn read_panel_config_value() -> Option<serde_json::Value> {
    std::fs::read_to_string(panel_config_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

pub fn configured_proxy_url() -> Option<String> {
    let value = read_panel_config_value()?;
    let raw = value
        .get("networkProxy")
        .and_then(|entry| {
            if let Some(obj) = entry.as_object() {
                obj.get("url").and_then(|v| v.as_str())
            } else {
                entry.as_str()
            }
        })?
        .trim()
        .to_string();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn should_bypass_proxy_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    if lower.is_empty() || lower == "localhost" || lower.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = lower.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local()
            }
        };
    }
    false
}

/// 构建 HTTP 客户端，use_proxy=true 时走用户配置的代�?pub fn build_http_client(
    timeout: Duration,
    user_agent: Option<&str>,
) -> Result<reqwest::Client, String> {
    build_http_client_opt(timeout, user_agent, true)
}

/// 构建模型请求用的 HTTP 客户�?/// 默认不走代理；用户在面板设置中开�?proxyModelRequests 后才走代�?pub fn build_http_client_no_proxy(
    timeout: Duration,
    user_agent: Option<&str>,
) -> Result<reqwest::Client, String> {
    let use_proxy = read_panel_config_value()
        .and_then(|v| v.get("networkProxy")?.get("proxyModelRequests")?.as_bool())
        .unwrap_or(false);
    build_http_client_opt(timeout, user_agent, use_proxy)
}

fn build_http_client_opt(
    timeout: Duration,
    user_agent: Option<&str>,
    use_proxy: bool,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(timeout).gzip(true);
    if let Some(ua) = user_agent {
        builder = builder.user_agent(ua);
    }
    if use_proxy {
        if let Some(proxy_url) = configured_proxy_url() {
            let proxy_value = proxy_url.clone();
            builder = builder.proxy(reqwest::Proxy::custom(move |url| {
                let host = url.host_str().unwrap_or("");
                if should_bypass_proxy_host(host) {
                    None
                } else {
                    Some(proxy_value.clone())
                }
            }));
        }
    }
    builder.build().map_err(|e| e.to_string())
}

pub fn apply_proxy_env(cmd: &mut std::process::Command) {
    if let Some(proxy_url) = configured_proxy_url() {
        cmd.env("HTTP_PROXY", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1");
    }
}

pub fn apply_proxy_env_tokio(cmd: &mut tokio::process::Command) {
    if let Some(proxy_url) = configured_proxy_url() {
        cmd.env("HTTP_PROXY", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1");
    }
}

/// 缓存 enhanced_path 结果，避免每次调用都扫描文件系统
/// 使用 RwLock 替代 OnceLock，支持运行时刷新缓存
static ENHANCED_PATH_CACHE: RwLock<Option<String>> = RwLock::new(None);

/// Tauri 应用启动�?PATH 可能不完整：
/// - macOS �?Finder 启动�?PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin
/// - Windows 上安�?Node.js 到非默认路径、或安装后未重启进程
///
/// 补充 Node.js / npm 常见安装路径
pub fn enhanced_path() -> String {
    // 先尝试读缓存
    if let Ok(guard) = ENHANCED_PATH_CACHE.read() {
        if let Some(ref cached) = *guard {
            return cached.clone();
        }
    }
    // 缓存为空，重新构�?    let path = build_enhanced_path();
    if let Ok(mut guard) = ENHANCED_PATH_CACHE.write() {
        *guard = Some(path.clone());
    }
    path
}

/// 刷新 enhanced_path 缓存，使新设置的 Node.js 路径立即生效（无需重启应用�?pub fn refresh_enhanced_path() {
    let new_path = build_enhanced_path();
    if let Ok(mut guard) = ENHANCED_PATH_CACHE.write() {
        *guard = Some(new_path);
    }
}

fn build_enhanced_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();

    // 读取用户保存的自定义 Node.js 路径
    let custom_path = deerpanel_dir()
        .join("deerpanel.json")
        .exists()
        .then(|| {
            std::fs::read_to_string(deerpanel_dir().join("deerpanel.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("nodePath")?.as_str().map(String::from))
        })
        .flatten();

    #[cfg(target_os = "macos")]
    {
        // 版本管理器路径优先于系统路径，确�?nvm/volta/fnm 管理�?Node.js 版本被优先检测到
        let mut extra: Vec<String> = vec![
            format!("{}/.nvm/current/bin", home.display()),
            format!("{}/.volta/bin", home.display()),
            format!("{}/.nodenv/shims", home.display()),
            format!("{}/n/bin", home.display()),
            format!("{}/.npm-global/bin", home.display()),
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
        ];
        // NPM_CONFIG_PREFIX: 用户通过 npm config set prefix 自定义的全局安装路径
        if let Ok(prefix) = std::env::var("NPM_CONFIG_PREFIX") {
            extra.push(format!("{}/bin", prefix));
        }
        // standalone 安装目录（集中管理，避免多处硬编码）
        for sa_dir in config::all_standalone_dirs() {
            extra.push(sa_dir.to_string_lossy().into_owned());
        }
        // 扫描 nvm 实际安装的版本目录（兼容�?current 符号链接的情况）
        // 按版本号倒序排列，确保最新版优先（修�?#143：v20 排在 v24 前面�?        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(b.file_name()));
                for entry in dirs {
                    extra.push(entry.path().join("bin").to_string_lossy().to_string());
                }
            }
        }
        // fnm: 扫描 $FNM_DIR 或默�?~/.local/share/fnm 下的版本目录
        let fnm_dir = std::env::var("FNM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share/fnm"));
        let fnm_versions = fnm_dir.join("node-versions");
        if fnm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("installation/bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(b.file_name()));
                for entry in dirs {
                    extra.push(
                        entry
                            .path()
                            .join("installation/bin")
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
        }
        let mut parts: Vec<&str> = vec![];
        if let Some(ref cp) = custom_path {
            parts.push(cp.as_str());
        }
        parts.extend(extra.iter().map(|s| s.as_str()));
        if !current.is_empty() {
            parts.push(&current);
        }
        parts.join(":")
    }

    #[cfg(target_os = "linux")]
    {
        // 版本管理器路径优先于系统路径，确�?nvm/volta/fnm 管理�?Node.js 版本被优先检测到
        let mut extra: Vec<String> = vec![
            format!("{}/.nvm/current/bin", home.display()),
            format!("{}/.volta/bin", home.display()),
            format!("{}/.nodenv/shims", home.display()),
            format!("{}/n/bin", home.display()),
            format!("{}/.npm-global/bin", home.display()),
            format!("{}/.local/bin", home.display()),
            "/usr/local/bin".into(),
            "/usr/bin".into(),
            "/snap/bin".into(),
        ];
        // NPM_CONFIG_PREFIX: 用户通过 npm config set prefix 自定义的全局安装路径
        if let Ok(prefix) = std::env::var("NPM_CONFIG_PREFIX") {
            extra.push(format!("{}/bin", prefix));
        }
        // standalone 安装目录（集中管理，避免多处硬编码）
        for sa_dir in config::all_standalone_dirs() {
            extra.push(sa_dir.to_string_lossy().into_owned());
        }
        // NVM_DIR 环境变量（用户可能自定义�?nvm 安装目录�?        // 按版本号倒序排列，确保最新版优先（修�?#143：v20 排在 v24 前面�?        let nvm_dir = std::env::var("NVM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".nvm"));
        let nvm_versions = nvm_dir.join("versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(b.file_name()));
                for entry in dirs {
                    extra.push(entry.path().join("bin").to_string_lossy().to_string());
                }
            }
        }
        // fnm: 扫描 $FNM_DIR 或默�?~/.local/share/fnm 下的版本目录
        let fnm_dir = std::env::var("FNM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share/fnm"));
        let fnm_versions = fnm_dir.join("node-versions");
        if fnm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("installation/bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(b.file_name()));
                for entry in dirs {
                    extra.push(
                        entry
                            .path()
                            .join("installation/bin")
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
        }
        // nodesource / 手动安装�?Node.js 可能�?/usr/local/lib/nodejs/ �?        let nodejs_lib = std::path::Path::new("/usr/local/lib/nodejs");
        if nodejs_lib.is_dir() {
            if let Ok(entries) = std::fs::read_dir(nodejs_lib) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.is_dir() {
                        extra.push(bin.to_string_lossy().to_string());
                    }
                }
            }
        }
        let mut parts: Vec<&str> = vec![];
        if let Some(ref cp) = custom_path {
            parts.push(cp.as_str());
        }
        parts.extend(extra.iter().map(|s| s.as_str()));
        if !current.is_empty() {
            parts.push(&current);
        }
        parts.join(":")
    }

    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();

        // 版本管理器路径优先，确保 nvm/volta/fnm 管理�?Node.js 被优先检测到
        let mut extra: Vec<String> = vec![];

        // 1. NVM_SYMLINK（nvm-windows 活跃版本符号链接，如 D:\nodejs）—�?最高优先级
        // 增强：尝试解析符号链接目�?        if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
            let symlink_path = std::path::Path::new(&nvm_symlink);
            if symlink_path.is_dir() {
                extra.push(nvm_symlink.clone());
            }
            // 如果是符号链接，尝试读取其实际指向的目标
            #[cfg(target_os = "windows")]
            if symlink_path.is_symlink() {
                if let Ok(target) = std::fs::read_link(symlink_path) {
                    if target.is_dir() {
                        extra.push(target.to_string_lossy().to_string());
                    }
                }
            }
        }

        // 2. NVM_HOME（用户自定义 nvm 安装目录�?        if let Ok(nvm_home) = std::env::var("NVM_HOME") {
            let nvm_path = std::path::Path::new(&nvm_home);
            if nvm_path.is_dir() {
                // 扫描所有已安装的版本目�?                if let Ok(entries) = std::fs::read_dir(nvm_path) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() && p.join("node.exe").exists() {
                            extra.push(p.to_string_lossy().to_string());
                        }
                    }
                }
                // 尝试�?settings.json 读取当前激活版�?                let settings_path = nvm_path.join("settings.json");
                if settings_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&settings_path) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            // settings.json 中有 "path" 字段指向当前版本
                            if let Some(current_version) = json.get("path").and_then(|v| v.as_str())
                            {
                                let version_path = nvm_path.join(current_version);
                                if version_path.is_dir() {
                                    // 将当前激活版本移到更高优先级
                                    let version_bin = version_path.to_string_lossy().to_string();
                                    if !extra.contains(&version_bin) {
                                        extra.insert(0, version_bin);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. %APPDATA%\nvm（nvm-windows 默认安装目录�?        if !appdata.is_empty() {
            let nvm_dir = std::path::Path::new(&appdata).join("nvm");
            if nvm_dir.is_dir() {
                // 扫描所有已安装的版�?                if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() && p.join("node.exe").exists() {
                            extra.push(p.to_string_lossy().to_string());
                        }
                    }
                }
                // 尝试�?settings.json 读取当前激活版�?                let settings_path = nvm_dir.join("settings.json");
                if settings_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&settings_path) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(current_version) = json.get("path").and_then(|v| v.as_str())
                            {
                                let version_path = nvm_dir.join(current_version);
                                if version_path.is_dir() {
                                    let version_bin = version_path.to_string_lossy().to_string();
                                    if !extra.contains(&version_bin) {
                                        extra.insert(0, version_bin);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 4. volta
        extra.push(format!(r"{}\.volta\bin", home.display()));
        // volta 的活跃版�?        let volta_bin = std::path::Path::new(&home).join(".volta/bin");
        if volta_bin.is_dir() && !extra.contains(&volta_bin.to_string_lossy().to_string()) {
            extra.insert(0, volta_bin.to_string_lossy().to_string());
        }

        // 5. fnm
        if !localappdata.is_empty() {
            extra.push(format!(r"{}\fnm_multishells", localappdata));
        }
        let fnm_base = std::env::var("FNM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::Path::new(&appdata).join("fnm"));
        let fnm_versions = fnm_base.join("node-versions");
        if fnm_versions.is_dir() {
            // 尝试找到 fnm 的当前活跃版�?            let fnm_current = fnm_base.join("current");
            if fnm_current.is_dir() {
                let current_inst = fnm_current.join("installation");
                if current_inst.is_dir()
                    && current_inst.join("node.exe").exists()
                    && !extra.contains(&current_inst.to_string_lossy().to_string())
                {
                    extra.insert(0, current_inst.to_string_lossy().to_string());
                }
            }
            // 扫描所有版�?            if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
                for entry in entries.flatten() {
                    let inst = entry.path().join("installation");
                    if inst.is_dir() && inst.join("node.exe").exists() {
                        let inst_str = inst.to_string_lossy().to_string();
                        if !extra.contains(&inst_str) {
                            extra.push(inst_str);
                        }
                    }
                }
            }
        }

        // 6. npm 全局（openclaw.cmd 通常在这里）
        if !appdata.is_empty() {
            extra.push(format!(r"{}\npm", appdata));
        }

        // 6.5 standalone 安装目录（集中管理，避免多处硬编码）
        // standalone 安装后通过注册表写入用�?PATH，但当前进程�?PATH 环境变量不会
        // 实时更新，需要显式添加到 enhanced_path 以确�?resolve_deerpanel_cli_path()
        // 能找�?standalone 安装�?deerpanel.cmd
        for sa_dir in config::all_standalone_dirs() {
            extra.push(sa_dir.to_string_lossy().into_owned());
        }

        // 7. 系统默认 Node.js 安装路径（优先级最低）
        extra.push(format!(r"{}\nodejs", pf));
        extra.push(format!(r"{}\nodejs", pf86));
        if !localappdata.is_empty() {
            extra.push(format!(r"{}\Programs\nodejs", localappdata));
        }

        // 8. 扫描常见盘符下的 Node 安装（用户可能装�?D:\、F:\ 等）
        for drive in &["C", "D", "E", "F"] {
            extra.push(format!(r"{}:\nodejs", drive));
            extra.push(format!(r"{}:\Node", drive));
            extra.push(format!(r"{}:\Program Files\nodejs", drive));
            // 常见 AI/Dev 工具目录
            extra.push(format!(r"{}:\AI\Node", drive));
            extra.push(format!(r"{}:\AI\nodejs", drive));
            extra.push(format!(r"{}:\Dev\nodejs", drive));
            extra.push(format!(r"{}:\Tools\nodejs", drive));
        }

        let mut parts: Vec<&str> = vec![];
        // 用户自定义路径优先级最�?        if let Some(ref cp) = custom_path {
            parts.push(cp.as_str());
        }
        // 然后是默认扫描到的路径（去重�?        let mut seen = std::collections::HashSet::new();
        for p in &extra {
            if std::path::Path::new(p).exists() && seen.insert(p.clone()) {
                parts.push(p.as_str());
            }
        }
        // 最后是系统 PATH
        if !current.is_empty() {
            parts.push(&current);
        }
        parts.join(";")
    }
}
