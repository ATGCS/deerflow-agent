use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use tauri::ipc::Channel;

/// 桌面端统一后端地址（`~/.openclaw/ytpanel.json`，旧版为 `clawpanel.json` → `deerflow`），避免与 `openclaw.json` 里过期的 `gateway.port` 绑死。
/// 示例：
/// ```json
/// {
///   "deerflow": {
///     "restBaseUrl": "http://127.0.0.1:8012",
///     "langGraphBaseUrl": "http://127.0.0.1:2026",
///     "langGraphProbePorts": [18789, 2024, 2026]
///   }
/// }
/// ```
#[derive(Debug, Clone, Default)]
struct DeerflowProxyConfig {
    rest_base_url: Option<String>,
    lang_graph_base_url: Option<String>,
    lang_graph_probe_ports: Vec<u16>,
}

fn load_deerflow_proxy_config() -> DeerflowProxyConfig {
    let Some(path) = super::panel_config_existing_path() else {
        return DeerflowProxyConfig::default();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return DeerflowProxyConfig::default();
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) else {
        return DeerflowProxyConfig::default();
    };
    let Some(df) = val.get("deerflow").and_then(|x| x.as_object()) else {
        return DeerflowProxyConfig::default();
    };

    let rest = df
        .get("restBaseUrl")
        .or_else(|| df.get("rest_base_url"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty());

    let lg = df
        .get("langGraphBaseUrl")
        .or_else(|| df.get("lang_graph_base_url"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty());

    let mut probe: Vec<u16> = df
        .get("langGraphProbePorts")
        .or_else(|| df.get("lang_graph_probe_ports"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.as_u64().map(|n| n as u16))
                .filter(|&n| n > 0)
                .collect()
        })
        .unwrap_or_default();
    if probe.is_empty() {
        probe = vec![18789, 2024, 2026];
    }

    DeerflowProxyConfig {
        rest_base_url: rest,
        lang_graph_base_url: lg,
        lang_graph_probe_ports: probe,
    }
}

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

fn openclaw_gateway_port() -> u16 {
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

fn rest_api_base_url() -> String {
    let df = load_deerflow_proxy_config();
    if let Some(u) = df.rest_base_url {
        return u;
    }
    let port = openclaw_gateway_port();
    format!("http://127.0.0.1:{}", port)
}

fn fallback_gateway_base_url() -> String {
    "http://127.0.0.1:8012".to_string()
}

async fn send_via_rest_chain(
    client: &reqwest::Client,
    method: &str,
    path_and_query: &str,
    primary_base: &str,
    fallback_base: &str,
    req_body: Option<serde_json::Value>,
) -> Result<reqwest::Response, String> {
    let send_once =
        |url: &str, body: Option<serde_json::Value>| -> Result<reqwest::RequestBuilder, String> {
            let mut req_builder = match method {
                "GET" => client.get(url),
                "POST" => client.post(url),
                "PUT" => client.put(url),
                "DELETE" => client.delete(url),
                "PATCH" => client.patch(url),
                _ => return Err(format!("不支持的 HTTP 方法: {}", method)),
            };
            if let Some(ref body_json) = body {
                req_builder = req_builder
                    .header("Content-Type", "application/json")
                    .body(body_json.to_string());
            }
            Ok(req_builder)
        };

    let full = |base: &str| {
        format!(
            "{}{}",
            base.trim_end_matches('/'),
            path_and_query
        )
    };
    let primary_url = full(primary_base);
    match send_once(&primary_url, req_body.clone())?.send().await {
        Ok(r) => Ok(r),
        Err(primary_err) => {
            gateway_proxy_debug_log(&format!(
                "primary request failed: method={} url={} err={}",
                method, primary_url, primary_err
            ));
            if primary_base != fallback_base {
                let fallback_url = full(fallback_base);
                match send_once(&fallback_url, req_body)?.send().await {
                    Ok(r) => {
                        gateway_proxy_debug_log(&format!(
                            "fallback succeeded: method={} url={} status={}",
                            method,
                            fallback_url,
                            r.status().as_u16()
                        ));
                        Ok(r)
                    }
                    Err(fallback_err) => {
                        gateway_proxy_debug_log(&format!(
                            "fallback failed: method={} url={} err={}",
                            method, fallback_url, fallback_err
                        ));
                        Err(format!("请求 Gateway 失败: {primary_err}"))
                    }
                }
            } else {
                gateway_proxy_debug_log(&format!(
                    "request failed (no fallback): method={} url={} err={}",
                    method, primary_url, primary_err
                ));
                Err(format!("请求 Gateway 失败: {primary_err}"))
            }
        }
    }
}

/// 与 `gateway_proxy` 相同的上游路由逻辑，返回尚未读取 body 的响应（供 JSON 代理与 SSE 流式代理共用）。
async fn forward_proxy_request(
    client: &reqwest::Client,
    request: &ProxyRequest,
) -> Result<reqwest::Response, String> {
    let df = load_deerflow_proxy_config();
    let primary_base = rest_api_base_url();
    let fallback_base = fallback_gateway_base_url();
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

    let path_and_query = format!("{}{}", request.path, query_string);
    let method = request.method.to_uppercase();

    let send_once = |url: &str, body: Option<serde_json::Value>| {
        let mut req_builder = match method.as_str() {
            "GET" => client.get(url),
            "POST" => client.post(url),
            "PUT" => client.put(url),
            "DELETE" => client.delete(url),
            "PATCH" => client.patch(url),
            _ => return Err(format!("不支持的 HTTP 方法: {}", method)),
        };
        if let Some(ref body_json) = body {
            req_builder = req_builder
                .header("Content-Type", "application/json")
                .body(body_json.to_string());
        }
        Ok(req_builder)
    };

    let req_body = request.body.clone();
    let is_langgraph = request.path.starts_with("/api/langgraph/");

    let mut resp = if is_langgraph {
        if let Some(ref lg_base) = df.lang_graph_base_url {
            let lg_url = format!(
                "{}{}",
                lg_base.trim_end_matches('/'),
                path_and_query
            );
            match send_once(&lg_url, req_body.clone())?.send().await {
                Ok(r) => {
                    gateway_proxy_debug_log(&format!(
                        "langgraph configured base: method={} url={} status={}",
                        method,
                        lg_url,
                        r.status().as_u16()
                    ));
                    r
                }
                Err(e) => {
                    gateway_proxy_debug_log(&format!(
                        "langgraph configured base failed: method={} url={} err={}",
                        method, lg_url, e
                    ));
                    send_via_rest_chain(
                        client,
                        &method,
                        &path_and_query,
                        &primary_base,
                        &fallback_base,
                        req_body.clone(),
                    )
                    .await?
                }
            }
        } else {
            send_via_rest_chain(
                client,
                &method,
                &path_and_query,
                &primary_base,
                &fallback_base,
                req_body.clone(),
            )
            .await?
        }
    } else {
        send_via_rest_chain(
            client,
            &method,
            &path_and_query,
            &primary_base,
            &fallback_base,
            req_body.clone(),
        )
        .await?
    };

    if is_langgraph && resp.status().as_u16() == 404 {
        for p in &df.lang_graph_probe_ports {
            let candidate_base = format!("http://127.0.0.1:{p}");
            if candidate_base == primary_base || candidate_base == fallback_base {
                continue;
            }
            if df
                .lang_graph_base_url
                .as_ref()
                .map(|u| u.trim_end_matches('/') == candidate_base.as_str())
                .unwrap_or(false)
            {
                continue;
            }
            let candidate_url = format!(
                "{}{}",
                candidate_base.trim_end_matches('/'),
                path_and_query
            );
            match send_once(&candidate_url, req_body.clone())?.send().await {
                Ok(r2) => {
                    let code = r2.status().as_u16();
                    gateway_proxy_debug_log(&format!(
                        "langgraph probe: method={} url={} status={}",
                        method, candidate_url, code
                    ));
                    if code != 404 {
                        resp = r2;
                        break;
                    }
                }
                Err(e2) => {
                    gateway_proxy_debug_log(&format!(
                        "langgraph probe failed: method={} url={} err={}",
                        method, candidate_url, e2
                    ));
                }
            }
        }
    }

    Ok(resp)
}

fn gateway_proxy_debug_log(message: &str) {
    // 独立调试日志：不与 gateway.log 混用，便于排查桌面端代理问题。
    // 路径：~/.openclaw/runtime-logs/gateway-proxy-debug.log
    let dir = super::openclaw_dir().join("runtime-logs");
    if create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("gateway-proxy-debug.log");
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] {}\n", now, message);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

#[tauri::command]
pub async fn gateway_proxy(request: ProxyRequest) -> Result<ProxyResponse, String> {
    let ua = crate::commands::app_user_agent();
    let client = crate::commands::build_http_client(
        std::time::Duration::from_secs(30),
        Some(&ua),
    )
    .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = forward_proxy_request(&client, &request).await?;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStreamResult {
    pub status: u16,
    pub ok: bool,
}

const STREAM_EOF_MARKER: &str = "__DF_EOF__";

/// 长连接 SSE/流式响应：经 Rust 读出上游字节后 base64 推到前端，避免打包后 WebView 对 `fetch('/api/...')` 无 Vite 代理。
/// 前端：`invoke('gateway_proxy_stream', { request, onChunk })`（`onChunk` 对应 `on_chunk`）。
#[tauri::command]
pub async fn gateway_proxy_stream(
    request: ProxyRequest,
    on_chunk: Channel<String>,
) -> Result<GatewayStreamResult, String> {
    gateway_proxy_debug_log(&format!(
        "stream start: method={} path={}",
        request.method, request.path
    ));
    let ua = crate::commands::app_user_agent();
    let client = crate::commands::build_http_streaming_client(
        std::time::Duration::from_secs(3600),
        Some(&ua),
    )
    .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = forward_proxy_request(&client, &request).await?;
    let status = resp.status().as_u16();

    if status >= 400 {
        let body_text = resp.text().await.unwrap_or_default();
        gateway_proxy_debug_log(&format!(
            "stream upstream error: status={} path={} body_len={}",
            status,
            request.path,
            body_text.len()
        ));
        if body_text.is_empty() {
            return Err(format!("HTTP {status}"));
        }
        return Err(body_text);
    }

    let mut stream = resp.bytes_stream();
    let mut sent = 0usize;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        if chunk.is_empty() {
            continue;
        }
        sent += chunk.len();
        let b64 = STANDARD.encode(&chunk);
        if on_chunk.send(b64).is_err() {
            gateway_proxy_debug_log("stream: frontend channel closed, abort read");
            break;
        }
    }

    let _ = on_chunk.send(STREAM_EOF_MARKER.to_string());

    gateway_proxy_debug_log(&format!(
        "stream end: status={} path={} upstream_bytes={}",
        status, request.path, sent
    ));

    Ok(GatewayStreamResult {
        status,
        ok: status >= 200 && status < 300,
    })
}

#[tauri::command]
pub fn gateway_health() -> Result<bool, String> {
    let base = rest_api_base_url();
    let host_port = base
        .strip_prefix("http://")
        .or_else(|| base.strip_prefix("https://"))
        .map(|s| s.trim_end_matches('/').split('/').next().unwrap_or(s).to_string())
        .unwrap_or_else(|| format!("127.0.0.1:{}", openclaw_gateway_port()));
    match std::net::TcpStream::connect_timeout(
        &host_port.parse().map_err(|e| format!("地址解析失败: {e}"))?,
        std::time::Duration::from_secs(2),
    ) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
