use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequest {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(default)]
    pub query: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyResponse {
    pub ok: bool,
    pub status: u16,
    #[serde(default)]
    pub body: serde_json::Value,
    #[serde(default)]
    pub error: String,
}

fn gateway_port() -> u16 {
    let config_path = super::openclaw_dir().join("openclaw.json");
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
    8012
}

fn gateway_base_url() -> String {
    let port = gateway_port();
    format!("http://127.0.0.1:{}", port)
}

#[tauri::command]
pub async fn gateway_proxy(request: ProxyRequest) -> Result<ProxyResponse, String> {
    let client = crate::commands::build_http_client(
        std::time::Duration::from_secs(30),
        Some("ClawPanel/1.0"),
    )
    .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let base = gateway_base_url();
    let query_string = if let Some(ref query) = request.query {
        if !query.is_empty() {
            let pairs: Vec<String> = query
                .iter()
                .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
                .collect();
            format!("?{}", pairs.join("&"))
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let url = format!("{}{}{}", base, request.path, query_string);
    let method = request.method.to_uppercase();

    let mut req_builder = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => return Err(format!("不支持的 HTTP 方法: {}", method)),
    };

    if let Some(body) = request.body {
        req_builder = req_builder
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }

    let resp = req_builder
        .send()
        .await
        .map_err(|e| format!("请求 Gateway 失败: {e}"))?;

    let status = resp.status().as_u16();

    let body_text = resp.text().await.unwrap_or_default();
    let body_json: serde_json::Value = if body_text.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(&body_text).unwrap_or_else(|_| {
            serde_json::Value::String(body_text)
        })
    };

    let error_msg = if status >= 400 {
        body_json
            .get("detail")
            .or_else(|| body_json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("请求失败")
            .to_string()
    } else {
        String::new()
    };

    Ok(ProxyResponse {
        ok: status >= 200 && status < 300,
        status,
        body: body_json,
        error: error_msg,
    })
}

#[tauri::command]
pub fn gateway_health() -> Result<bool, String> {
    let port = gateway_port();
    let addr = format!("127.0.0.1:{}", port);
    match std::net::TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("地址解析失败: {e}"))?,
        std::time::Duration::from_secs(2),
    ) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
