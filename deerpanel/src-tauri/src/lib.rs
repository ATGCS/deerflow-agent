mod commands;
mod models;
mod tray;
mod utils;

use commands::{
    agent, assistant, config, device, extensions, logs, memory, messaging, pairing, service,
    skills, update,
};

pub fn run() {
    let hot_update_dir = commands::deerpanel_dir()
        .join("deerpanel")
        .join("web-update");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .register_uri_scheme_protocol("tauri", move |ctx, request| {
            let uri_path = request.uri().path();
            let path = if uri_path == "/" || uri_path.is_empty() {
                "index.html"
            } else {
                uri_path.strip_prefix('/').unwrap_or(uri_path)
            };

            // 1. 优先检查热更新目录
            let update_file = hot_update_dir.join(path);
            if update_file.is_file() {
                if let Ok(data) = std::fs::read(&update_file) {
                    return tauri::http::Response::builder()
                        .header(
                            tauri::http::header::CONTENT_TYPE,
                            update::mime_from_path(path),
                        )
                        .body(data)
                        .unwrap();
                }
            }

            // 2. 回退到内嵌资�?            if let Some(asset) = ctx.app_handle().asset_resolver().get(path.to_string()) {
                let builder = tauri::http::Response::builder()
                    .header(tauri::http::header::CONTENT_TYPE, &asset.mime_type);
                // Tauri 内嵌资源可能�?CSP header
                let builder = if let Some(csp) = asset.csp_header {
                    builder.header("Content-Security-Policy", csp)
                } else {
                    builder
                };
                builder.body(asset.bytes).unwrap()
            } else {
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .body(b"Not Found".to_vec())
                    .unwrap()
            }
        })
        .setup(|app| {
            service::start_backend_guardian(app.handle().clone());
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 配置
            config::read_deerpanel_config,
            config::write_deerpanel_config,
            config::validate_deerpanel_config,
            config::read_mcp_config,
            config::write_mcp_config,
            config::get_version_info,
            config::check_installation,
            config::init_deerpanel_config,
            config::check_node,
            config::check_node_at_path,
            config::scan_node_paths,
            config::save_custom_node_path,
            config::write_env_file,
            config::list_backups,
            config::create_backup,
            config::restore_backup,
            config::delete_backup,
            config::reload_gateway,
            config::restart_gateway,
            config::test_model,
            config::list_remote_models,
            config::list_deerpanel_versions,
            config::upgrade_deerpanel,
            config::uninstall_deerpanel,
            config::install_gateway,
            config::uninstall_gateway,
            config::patch_model_vision,
            config::check_panel_update,
            config::get_deerpanel_dir,
            config::read_panel_config,
            config::write_panel_config,
            config::test_proxy,
            config::get_npm_registry,
            config::set_npm_registry,
            config::check_git,
            config::auto_install_git,
            config::configure_git_https,
            config::invalidate_path_cache,
            config::get_status_summary,
            config::doctor_fix,
            config::doctor_check,
            config::relaunch_app,
            // 设备密钥 + Gateway 握手
            device::create_connect_frame,
            // 设备配对
            pairing::auto_pair_device,
            pairing::check_pairing_status,
            pairing::pairing_list_channel,
            pairing::pairing_approve_channel,
            // 服务
            service::get_services_status,
            service::start_service,
            service::stop_service,
            service::restart_service,
            service::guardian_status,
            // 日志
            logs::read_log_tail,
            logs::search_log,
            // 记忆文件
            memory::list_memory_files,
            memory::read_memory_file,
            memory::write_memory_file,
            memory::delete_memory_file,
            memory::export_memory_zip,
            // 扩展工具
            extensions::get_cftunnel_status,
            extensions::cftunnel_action,
            extensions::get_cftunnel_logs,
            extensions::get_clawapp_status,
            extensions::install_cftunnel,
            extensions::install_clawapp,
            // Agent 管理
            agent::list_agents,
            agent::add_agent,
            agent::delete_agent,
            agent::update_agent_identity,
            agent::update_agent_model,
            agent::backup_agent,
            // AI 助手工具
            assistant::assistant_exec,
            assistant::assistant_read_file,
            assistant::assistant_write_file,
            assistant::assistant_list_dir,
            assistant::assistant_system_info,
            assistant::assistant_list_processes,
            assistant::assistant_check_port,
            assistant::assistant_web_search,
            assistant::assistant_fetch_url,
            // 数据目录 & 图片存储
            assistant::assistant_ensure_data_dir,
            assistant::assistant_save_image,
            assistant::assistant_load_image,
            assistant::assistant_delete_image,
            // 消息渠道管理
            messaging::read_platform_config,
            messaging::save_messaging_platform,
            messaging::remove_messaging_platform,
            messaging::toggle_messaging_platform,
            messaging::verify_bot_token,
            messaging::diagnose_channel,
            messaging::repair_qqbot_channel_setup,
            messaging::list_configured_platforms,
            messaging::get_channel_plugin_status,
            messaging::install_channel_plugin,
            messaging::install_qqbot_plugin,
            messaging::run_channel_action,
            messaging::check_weixin_plugin_status,
            // Agent 渠道绑定管理
            messaging::get_agent_bindings,
            messaging::list_all_bindings,
            messaging::save_agent_binding,
            messaging::delete_agent_binding,
            messaging::delete_agent_all_bindings,
            // Skills 管理（openclaw skills CLI�?            skills::skills_list,
            skills::skills_info,
            skills::skills_check,
            skills::skills_install_dep,
            skills::skills_skillhub_check,
            skills::skills_skillhub_setup,
            skills::skills_skillhub_search,
            skills::skills_skillhub_install,
            skills::skills_clawhub_search,
            skills::skills_clawhub_install,
            skills::skills_uninstall,
            skills::skills_validate,
            // 前端热更�?            update::check_frontend_update,
            update::download_frontend_update,
            update::rollback_frontend_update,
            update::get_update_status,
        ])
        .on_window_event(|window, event| {
            // 关闭窗口时最小化到托盘，不退出应�?            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("启动 DeerPanel 失败")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(target_os = "windows")]
                {
                    // 退出时关闭 Gateway 终端窗口
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    let _ = std::process::Command::new("cmd")
                        .args(["/c", "taskkill", "/fi", "WINDOWTITLE eq DeerPanel Gateway"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                }
            }
        });
}
