use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub label: String,
    pub pid: Option<u32>,
    pub running: bool,
    pub description: String,
    /// CLI 工具是否已安装（Windows/Linux: deerpanel CLI�?    pub cli_installed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionInfo {
    pub current: Option<String>,
    pub latest: Option<String>,
    pub recommended: Option<String>,
    pub update_available: bool,
    pub latest_update_available: bool,
    pub is_recommended: bool,
    pub ahead_of_recommended: bool,
    pub panel_version: String,
    pub source: String,
    /// 当前实际使用�?CLI 完整路径
    pub cli_path: Option<String>,
    /// CLI 安装来源标签: standalone / npm-zh / npm-official / unknown
    pub cli_source: Option<String>,
    /// 所有检测到�?DeerPanel 安装（路�?+ 来源 + 版本�?    pub all_installations: Option<Vec<DeerPanelInstallation>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeerPanelInstallation {
    pub path: String,
    pub source: String,
    pub version: Option<String>,
    pub active: bool,
}
