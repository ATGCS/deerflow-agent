#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 读取 deerpanel.json 中用户绑定的 CLI 路径
fn bound_cli_path() -> Option<std::path::PathBuf> {
    let config = crate::commands::read_panel_config_value()?;
    let raw = config.get("deerpanelCliPath")?.as_str()?;
    if raw.is_empty() {
        return None;
    }
    let p = std::path::PathBuf::from(raw);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Windows: �?PATH 中查�?deerpanel.cmd 的完整路�?/// 避免通过 `cmd /c deerpanel` 调用�?npm .cmd shim 中的引号导致
/// "\"node\"" is not recognized 错误
#[cfg(target_os = "windows")]
fn find_deerpanel_cmd() -> Option<std::path::PathBuf> {
    // 优先使用用户绑定的路�?    if let Some(bound) = bound_cli_path() {
        return Some(bound);
    }
    let path = crate::commands::enhanced_path();
    for dir in path.split(';') {
        let candidate = std::path::Path::new(dir).join("deerpanel.cmd");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn common_non_windows_cli_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    // standalone 安装目录（集中管理，避免多处硬编码）
    for sa_dir in crate::commands::config::all_standalone_dirs() {
        candidates.push(sa_dir.join("deerpanel"));
    }
    // 其他标准路径
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join("deerpanel"));
    }
    candidates.push(std::path::PathBuf::from("/opt/homebrew/bin/deerpanel"));
    candidates.push(std::path::PathBuf::from("/usr/local/bin/deerpanel"));
    candidates.push(std::path::PathBuf::from("/usr/bin/deerpanel"));
    candidates
}

/// 解析当前实际使用�?deerpanel CLI 完整路径（跨平台�?pub fn resolve_deerpanel_cli_path() -> Option<String> {
    // 优先使用用户绑定的路�?    if let Some(bound) = bound_cli_path() {
        return Some(bound.to_string_lossy().to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let path = crate::commands::enhanced_path();
        for dir in path.split(';') {
            let candidate = std::path::Path::new(dir).join("deerpanel.cmd");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        for candidate in common_non_windows_cli_candidates() {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        let path = crate::commands::enhanced_path();
        let sep = ':';
        for dir in path.split(sep) {
            let candidate = std::path::Path::new(dir).join("deerpanel");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    }
}

/// 根据 CLI 路径判断安装来源
pub fn classify_cli_source(cli_path: &str) -> String {
    let lower = cli_path.replace('\\', "/").to_lowercase();
    // standalone 安装
    if lower.contains("/programs/deerpanel/")
        || lower.contains("/deerpanel-bin/")
        || lower.contains("/opt/deerpanel/")
    {
        return "standalone".into();
    }
    // npm 汉化�?    if lower.contains("deerpanel-zh") || lower.contains("@qingchencloud") {
        return "npm-zh".into();
    }
    // npm 全局（大概率官方版）
    if lower.contains("/npm/") || lower.contains("/node_modules/") {
        return "npm-official".into();
    }
    // Homebrew
    if lower.contains("/homebrew/") || lower.contains("/usr/local/bin") {
        return "npm-global".into();
    }
    "unknown".into()
}

/// 跨平台获�?deerpanel 命令的方法（同步版本�?#[allow(dead_code)]
pub fn deerpanel_command() -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let enhanced = crate::commands::enhanced_path();
        // 优先：找�?deerpanel.cmd 完整路径，用 cmd /c "完整路径" 避免引号问题
        if let Some(cmd_path) = find_deerpanel_cmd() {
            let mut cmd = std::process::Command::new("cmd");
            cmd.arg("/c").arg(cmd_path);
            cmd.env("PATH", &enhanced);
            crate::commands::apply_proxy_env(&mut cmd);
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd;
        }
        // 兜底：直接用 cmd /c deerpanel
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/c").arg("deerpanel");
        cmd.env("PATH", &enhanced);
        crate::commands::apply_proxy_env(&mut cmd);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let bin = bound_cli_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "deerpanel".into());
        let mut cmd = std::process::Command::new(bin);
        cmd.env("PATH", crate::commands::enhanced_path());
        crate::commands::apply_proxy_env(&mut cmd);
        cmd
    }
}

/// 异步版本�?deerpanel 命令（推荐使用，避免阻塞 UI�?pub fn deerpanel_command_async() -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let enhanced = crate::commands::enhanced_path();
        // 优先：找�?deerpanel.cmd 完整路径
        if let Some(cmd_path) = find_deerpanel_cmd() {
            let mut cmd = tokio::process::Command::new("cmd");
            cmd.arg("/c").arg(cmd_path);
            cmd.env("PATH", &enhanced);
            crate::commands::apply_proxy_env_tokio(&mut cmd);
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd;
        }
        // 兜底
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/c").arg("deerpanel");
        cmd.env("PATH", &enhanced);
        crate::commands::apply_proxy_env_tokio(&mut cmd);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let bin = bound_cli_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "deerpanel".into());
        let mut cmd = tokio::process::Command::new(bin);
        cmd.env("PATH", crate::commands::enhanced_path());
        crate::commands::apply_proxy_env_tokio(&mut cmd);
        cmd
    }
}
