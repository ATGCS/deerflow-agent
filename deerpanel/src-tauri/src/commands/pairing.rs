/// 设备配对命令
/// 自动�?Gateway 注册设备，跳过手动配对流�?
#[tauri::command]
pub fn auto_pair_device() -> Result<String, String> {
    // 无论是否已配对，都确�?gateway.controlUi.allowedOrigins 已写�?    // 必须在最前面，避免因设备密钥不存在而跳�?    patch_gateway_origins();

    // 获取或生成设备密钥（首次安装时自动创建）
    let (device_id, public_key, _) = super::device::get_or_create_key()?;

    // 读取或创�?paired.json
    let paired_path = crate::commands::deerpanel_dir()
        .join("devices")
        .join("paired.json");
    let devices_dir = crate::commands::deerpanel_dir().join("devices");

    // 确保 devices 目录存在
    if !devices_dir.exists() {
        std::fs::create_dir_all(&devices_dir).map_err(|e| format!("创建 devices 目录失败: {e}"))?;
    }

    let mut paired: serde_json::Value = if paired_path.exists() {
        let content = std::fs::read_to_string(&paired_path)
            .map_err(|e| format!("读取 paired.json 失败: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("解析 paired.json 失败: {e}"))?
    } else {
        serde_json::json!({})
    };

    let os_platform = std::env::consts::OS; // "windows" | "macos" | "linux"

    // 如果已配对，档查 platform 字段是否正确；不正确则覆盖更新，
    // 避免 Gateway �?metadata-upgrade 拒绝静默自动配对
    if let Some(existing) = paired.get_mut(&device_id) {
        let current_platform = existing
            .get("platform")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if current_platform != os_platform {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert(
                    "platform".to_string(),
                    serde_json::Value::String(os_platform.to_string()),
                );
                obj.insert(
                    "deviceFamily".to_string(),
                    serde_json::Value::String("desktop".to_string()),
                );
            }
            let new_content = serde_json::to_string_pretty(&paired)
                .map_err(|e| format!("序列�?paired.json 失败: {e}"))?;
            std::fs::write(&paired_path, new_content)
                .map_err(|e| format!("更新 paired.json 失败: {e}"))?;
            return Ok("设备已配对（已修正平台字段）".into());
        }
        return Ok("设备已配�?.into());
    }

    // 添加设备到配对列�?    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    paired[&device_id] = serde_json::json!({
        "deviceId": device_id,
        "publicKey": public_key,
        "platform": os_platform,
        "deviceFamily": "desktop",
        "clientId": "deerpanel-control-ui",
        "clientMode": "ui",
        "role": "operator",
        "roles": ["operator"],
        "scopes": [
            "operator.admin",
            "operator.approvals",
            "operator.pairing",
            "operator.read",
            "operator.write"
        ],
        "approvedScopes": [
            "operator.admin",
            "operator.approvals",
            "operator.pairing",
            "operator.read",
            "operator.write"
        ],
        "tokens": {},
        "createdAtMs": now_ms,
        "approvedAtMs": now_ms
    });

    // 写入 paired.json
    let new_content = serde_json::to_string_pretty(&paired)
        .map_err(|e| format!("序列�?paired.json 失败: {e}"))?;

    std::fs::write(&paired_path, new_content).map_err(|e| format!("写入 paired.json 失败: {e}"))?;

    Ok("设备配对成功".into())
}

/// �?Tauri 应用�?origin 写入 gateway.controlUi.allowedOrigins
/// 避免 Gateway �?origin not allowed 拒绝 WebSocket 握手
fn patch_gateway_origins() {
    let config_path = crate::commands::deerpanel_dir().join("deerpanel.json");
    if !config_path.exists() {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&config_path) else {
        return;
    };
    let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };

    // Tauri 应用 + 本地开发服务器必须存在�?origin
    let required: Vec<String> = vec![
        "tauri://localhost".into(),
        "https://tauri.localhost".into(),
        "http://tauri.localhost".into(),
        "http://localhost:1420".into(),
        "http://127.0.0.1:1420".into(),
    ];

    if let Some(obj) = config.as_object_mut() {
        let gateway = obj
            .entry("gateway")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(gw) = gateway.as_object_mut() {
            let control_ui = gw
                .entry("controlUi")
                .or_insert_with(|| serde_json::json!({}));
            if let Some(cui) = control_ui.as_object_mut() {
                // 合并：保留用户已有的 origin，追加缺失的 Tauri origin
                let existing: Vec<String> = cui
                    .get("allowedOrigins")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|s| s.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut merged = existing;
                for r in &required {
                    if !merged.iter().any(|e| e == r) {
                        merged.push(r.clone());
                    }
                }
                cui.insert("allowedOrigins".to_string(), serde_json::json!(merged));
            }
        }
    }

    if let Ok(new_json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(&config_path, new_json);
    }
}

#[tauri::command]
pub fn check_pairing_status() -> Result<bool, String> {
    // 读取设备密钥
    let device_key_path = crate::commands::deerpanel_dir().join("deerpanel-device-key.json");
    if !device_key_path.exists() {
        return Ok(false);
    }

    let device_key_content =
        std::fs::read_to_string(&device_key_path).map_err(|e| format!("读取设备密钥失败: {e}"))?;

    let device_key: serde_json::Value =
        serde_json::from_str(&device_key_content).map_err(|e| format!("解析设备密钥失败: {e}"))?;

    let device_id = device_key["deviceId"].as_str().ok_or("设备 ID 不存�?)?;

    // 检�?paired.json
    let paired_path = crate::commands::deerpanel_dir()
        .join("devices")
        .join("paired.json");
    if !paired_path.exists() {
        return Ok(false);
    }

    let content =
        std::fs::read_to_string(&paired_path).map_err(|e| format!("读取 paired.json 失败: {e}"))?;

    let paired: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 paired.json 失败: {e}"))?;

    Ok(paired.get(device_id).is_some())
}

async fn run_pairing_command(args: Vec<String>) -> Result<String, String> {
    let mut cmd = crate::utils::deerpanel_command_async();
    cmd.args(args);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("执行 deerpanel 失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let message = match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => String::new(),
    };

    if output.status.success() {
        Ok(if message.is_empty() {
            "操作完成".into()
        } else {
            message
        })
    } else {
        Err(if message.is_empty() {
            format!("命令执行失败: {}", output.status)
        } else {
            message
        })
    }
}

#[tauri::command]
pub async fn pairing_list_channel(channel: String) -> Result<String, String> {
    let channel = channel.trim();
    if channel.is_empty() {
        return Err("channel 不能为空".into());
    }
    run_pairing_command(vec!["pairing".into(), "list".into(), channel.into()]).await
}

#[tauri::command]
pub async fn pairing_approve_channel(
    channel: String,
    code: String,
    notify: bool,
) -> Result<String, String> {
    let channel = channel.trim();
    let code = code.trim();
    if channel.is_empty() {
        return Err("channel 不能为空".into());
    }
    if code.is_empty() {
        return Err("配对码不能为�?.into());
    }
    let mut args = vec![
        "pairing".into(),
        "approve".into(),
        channel.into(),
        code.into(),
    ];
    if notify {
        args.push("--notify".into());
    }
    run_pairing_command(args).await
}
