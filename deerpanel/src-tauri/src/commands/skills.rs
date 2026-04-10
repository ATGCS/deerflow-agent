use crate::utils::openclaw_command_async;
use serde_json::{json, Value};

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

/// 列出所有 Skills 及其状态（openclaw skills list --json）
#[tauri::command]
pub async fn skills_list() -> Result<Value, String> {
    let output = openclaw_command_async()
        .args(["skills", "list", "--json"])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            // CLI output may contain non-JSON lines (Node warnings, update prompts).
            // Extract the first valid JSON object or array from stdout.
            extract_json(&stdout).ok_or_else(|| "解析失败: 输出中未找到有效 JSON".to_string())
        }
        _ => {
            // CLI 不可用时，兜底扫描本地 skills 目录
            scan_local_skills()
        }
    }
}

/// 查看单个 Skill 详情（openclaw skills info <name> --json）
#[tauri::command]
pub async fn skills_info(name: String) -> Result<Value, String> {
    let output = openclaw_command_async()
        .args(["skills", "info", &name, "--json"])
        .output()
        .await
        .map_err(|e| format!("执行 openclaw 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("获取详情失败: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_json(&stdout).ok_or_else(|| "解析详情失败: 输出中未找到有效 JSON".to_string())
}

/// 检查 Skills 依赖状态（openclaw skills check --json）
#[tauri::command]
pub async fn skills_check() -> Result<Value, String> {
    let output = openclaw_command_async()
        .args(["skills", "check", "--json"])
        .output()
        .await
        .map_err(|e| format!("执行 openclaw 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("检查失败: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_json(&stdout).ok_or_else(|| "解析失败: 输出中未找到有效 JSON".to_string())
}

/// 安装 Skill 依赖（根据 install spec 执行 brew/npm/go/uv/download）
#[tauri::command]
pub async fn skills_install_dep(kind: String, spec: Value) -> Result<Value, String> {
    let path_env = super::enhanced_path();

    let (program, args) = match kind.as_str() {
        "brew" => {
            let formula = spec
                .get("formula")
                .and_then(|v| v.as_str())
                .ok_or("缺少 formula 参数")?
                .to_string();
            ("brew".to_string(), vec!["install".to_string(), formula])
        }
        "node" => {
            let package = spec
                .get("package")
                .and_then(|v| v.as_str())
                .ok_or("缺少 package 参数")?
                .to_string();
            (
                "npm".to_string(),
                vec!["install".to_string(), "-g".to_string(), package],
            )
        }
        "go" => {
            let module = spec
                .get("module")
                .and_then(|v| v.as_str())
                .ok_or("缺少 module 参数")?
                .to_string();
            ("go".to_string(), vec!["install".to_string(), module])
        }
        "uv" => {
            let package = spec
                .get("package")
                .and_then(|v| v.as_str())
                .ok_or("缺少 package 参数")?
                .to_string();
            (
                "uv".to_string(),
                vec!["tool".to_string(), "install".to_string(), package],
            )
        }
        other => return Err(format!("不支持的安装类型: {other}")),
    };

    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&args).env("PATH", &path_env);
    super::apply_proxy_env_tokio(&mut cmd);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("执行 {program} 失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "安装失败 ({program} {}): {}",
            output.status,
            stderr.trim()
        ));
    }

    Ok(serde_json::json!({
        "success": true,
        "output": stdout.trim(),
    }))
}

/// 检测 SkillHub CLI 是否已安装
#[tauri::command]
pub async fn skills_skillhub_check() -> Result<Value, String> {
    let path_env = super::enhanced_path();
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/c", "skillhub", "--cli-version"]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("skillhub");
        c.arg("--cli-version");
        c
    };
    cmd.env("PATH", &path_env);
    match cmd.output().await {
        Ok(o) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
            Ok(serde_json::json!({ "installed": true, "version": ver }))
        }
        _ => Ok(serde_json::json!({ "installed": false })),
    }
}

/// 安装 SkillHub CLI（从腾讯云 COS 下载）
#[tauri::command]
pub async fn skills_skillhub_setup(cli_only: bool) -> Result<Value, String> {
    let path_env = super::enhanced_path();
    #[allow(unused_variables)]
    let flag = if cli_only {
        "--cli-only"
    } else {
        "--no-skills"
    };

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = tokio::process::Command::new("bash");
        cmd.args(["-c", &format!(
            "curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- {flag}"
        )])
        .env("PATH", &path_env);
        super::apply_proxy_env_tokio(&mut cmd);
        let output = cmd
            .output()
            .await
            .map_err(|e| format!("执行安装脚本失败: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Err(format!("SkillHub 安装失败: {}", stderr.trim()));
        }
        Ok(serde_json::json!({ "success": true, "output": stdout.trim() }))
    }
    #[cfg(target_os = "windows")]
    {
        // Windows: 通过 npm 全局安装 skillhub（避免 bash/WSL 路径问题）
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.args([
            "/c",
            "npm",
            "install",
            "-g",
            "skillhub@latest",
            "--registry",
            "https://registry.npmmirror.com",
        ])
        .env("PATH", &path_env);
        super::apply_proxy_env_tokio(&mut cmd);
        cmd.creation_flags(0x08000000);
        let output = cmd
            .output()
            .await
            .map_err(|e| format!("执行 npm install 失败: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Err(format!("SkillHub CLI 安装失败: {}", stderr.trim()));
        }
        Ok(serde_json::json!({ "success": true, "output": stdout.trim() }))
    }
}

/// 从 SkillHub 安装 Skill（skillhub install <slug>）
#[tauri::command]
pub async fn skills_skillhub_install(slug: String) -> Result<Value, String> {
    let path_env = super::enhanced_path();
    let home = dirs::home_dir().unwrap_or_default();

    let skills_dir = super::openclaw_dir().join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建 skills 目录失败: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/c", "skillhub", "install", &slug, "--force"]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("skillhub");
        c.args(["install", &slug, "--force"]);
        c
    };
    cmd.env("PATH", &path_env).current_dir(&home);
    super::apply_proxy_env_tokio(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("执行 skillhub 失败: {e}。请先安装 SkillHub CLI"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("安装失败: {}", stderr.trim()));
    }

    Ok(serde_json::json!({
        "success": true,
        "slug": slug,
        "output": stdout.trim(),
    }))
}

/// 从 SkillHub/ClawHub 搜索 Skills（通过 Convex API，支持分页）
#[tauri::command]
pub async fn skills_skillhub_search(query: String, page: Option<u32>, page_size: Option<u32>) -> Result<Value, String> {
    _clawhub_convex_search(&query, page, page_size).await
}

/// 从 ClawHub 搜索 Skills（复用同一接口）
#[tauri::command]
pub async fn skills_clawhub_search(query: String, page: Option<u32>, page_size: Option<u32>) -> Result<Value, String> {
    _clawhub_convex_search(&query, page, page_size).await
}

/// 共享的 Convex 搜索实现（使用 listPublicPageV4 分页接口）
async fn _clawhub_convex_search(query: &str, page: Option<u32>, page_size: Option<u32>) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("DeerFlow/1.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let p = page.unwrap_or(1);
    let ps = page_size.unwrap_or(50).min(50);

    // 使用 skills:listPublicPageV4 — 支持分页 + 按 downloads 排序
    let mut args = serde_json::json!({
        "dir": "desc",
        "highlightedOnly": false,
        "nonSuspiciousOnly": true,
        "numItems": ps,
        "sort": "downloads",
    });
    // 第2页及以后传入 cursor（首页不传或传 null）
    if p > 1 {
        args["cursor"] = serde_json::json!(r#"[{"__undef":1},false,23131,1775617219631,1773255925321.0134,"r17dgzt5ne3x6setz3wpg3kzhd82qpp2"]"#);
    }

    let body = serde_json::json!({ "path": "skills:listPublicPageV4", "args": args });
    let resp = client
        .post("https://wry-manatee-359.convex.cloud/api/query")
        .header("Content-Type", "application/json")
        .header("convex-client", "npm-1.34.1")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 ClawHub 失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ClawHub 返回 HTTP {}", resp.status()));
    }

    let data: Value = resp.json().await.map_err(|e| format!("解析响应失败: {e}"))?;

    // 提取 page 数组
    let raw_items = data.get("value")
        .and_then(|v| {
            // 值可能是对象含 .page 字段，也可能是数组本身
            v.get("page").and_then(|p| p.as_array())
                .or_else(|| v.as_array())
        })
        .cloned()
        .unwrap_or_default();

    // 客户端关键词过滤（Convex search 接口有 bug）
    let filtered = if !query.is_empty() {
        let q = query.to_lowercase();
        raw_items.into_iter().filter(|s| {
            let slug = s.get("slug").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let name = s.get("displayName").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let summary = s.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            slug.contains(&q) || name.contains(&q) || summary.contains(&q)
        }).collect::<Vec<_>>()
    } else {
        raw_items
    };

    // 提取翻页游标
    let has_more = data.get("value")
        .and_then(|v| v.get("continueCursor").and_then(|c| c.as_str()))
        .map(|c| !c.is_empty())
        .unwrap_or(false);
    let cursor = data.get("value")
        .and_then(|v| v.get("continueCursor").and_then(|c| c.as_str()))
        .map(|s| Value::String(s.to_string()))
        .unwrap_or(Value::Null);

    // 映射为前端格式（Convex 数据嵌套在 .skill 字段中）
    let mapped: Vec<Value> = filtered.iter().map(|s| {
        // 提取内部 skill 对象
        let inner = s.get("skill").unwrap_or(s);
        let stats = inner.get("stats").unwrap_or(&Value::Null);
        serde_json::json!({
            "slug": inner.get("slug"),
            "name": inner.get("displayName").or_else(|| inner.get("name")).or_else(|| s.get("name")),
            "description": inner.get("summary").or_else(|| inner.get("description")).or_else(|| s.get("summary")),
            "stars": stats.get("stars"),
            "downloads": stats.get("downloads"),
            "versionId": inner.get("_id"),
            "source": "clawhub",
        })
    }).collect();

    Ok(serde_json::json!({
        "skills": mapped,
        "hasMore": has_more,
        "cursor": cursor,
        "total": mapped.len(),
    }))
}

// ========== 以下是旧版 CLI 命令（已弃用，保留兼容）==========
#[allow(dead_code)]
async fn _legacy_skillhub_cli_check() -> Result<Value, String> {
    let path_env = super::enhanced_path();
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/c", "skillhub", "search", ""]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("skillhub");
        c.args(["search", &q]);
        c
    };
    cmd.env("PATH", &path_env);
    super::apply_proxy_env_tokio(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("执行 skillhub 失败: {e}。请先安装 SkillHub CLI"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("搜索失败: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // skillhub search 实际输出格式：
    // ──────────────── (分隔线)
    // [1]   openclaw/openclaw/feishu-doc           🛡️ Pass
    //      AI 85  ⬇     33  ⭐ 248.7k  Feishu document read/write opera...
    // ──────────────── (分隔线)
    // 序号和 slug 在同一行，描述在下一行
    let lines: Vec<&str> = stdout.lines().collect();
    let mut items: Vec<Value> = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // 找序号行：以 [数字] 开头，同一行包含 slug（owner/repo/name）
        if !trimmed.starts_with('[') {
            continue;
        }
        let bracket_end = match trimmed.find(']') {
            Some(pos) => pos,
            None => continue,
        };
        // 提取 ] 后面的内容
        let after_bracket = trimmed[bracket_end + 1..].trim();
        // slug 是第一个空格前的部分，且包含 /
        let slug = after_bracket.split_whitespace().next().unwrap_or("").trim();
        if !slug.contains('/') {
            continue;
        }

        // 描述在下一行：跳过数字、⬇、⭐ 等统计信息，提取文字描述
        let mut desc = String::new();
        if i + 1 < lines.len() {
            let next = lines[i + 1].trim();
            // 找到第一个英文或中文字母开始的描述文字
            // 格式: "AI 85  ⬇     33  ⭐ 248.7k  Feishu document..."
            // 或: "⬇      0  ⭐ 212.2k  Feishu document..."
            // 策略：找 ⭐ 后面的数字后的文字
            if let Some(star_pos) = next.find('⭐') {
                let after_star = &next[star_pos + '⭐'.len_utf8()..].trim_start();
                // 跳过星标数字（如 "248.7k"）
                let after_num = after_star
                    .trim_start_matches(|c: char| {
                        c.is_ascii_digit()
                            || c == '.'
                            || c == 'k'
                            || c == 'K'
                            || c == 'm'
                            || c == 'M'
                    })
                    .trim();
                if !after_num.is_empty() {
                    desc = after_num.to_string();
                }
            }
        }

        items.push(serde_json::json!({
            "slug": slug,
            "description": desc,
            "source": "skillhub"
        }));
    }

    Ok(Value::Array(items))
}

/// 从 ClawHub 安装 Skill（npx clawhub install <slug>）— 原版海外源
#[tauri::command]
pub async fn skills_clawhub_install(slug: String) -> Result<Value, String> {
    let path_env = super::enhanced_path();
    let home = dirs::home_dir().unwrap_or_default();
    let skills_dir = super::openclaw_dir().join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建 skills 目录失败: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/c", "npx", "-y", "clawhub", "install", &slug]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("npx");
        c.args(["-y", "clawhub", "install", &slug]);
        c
    };
    cmd.env("PATH", &path_env).current_dir(&home);
    super::apply_proxy_env_tokio(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("执行 clawhub 失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("安装失败: {}", stderr.trim()));
    }
    Ok(serde_json::json!({ "success": true, "slug": slug, "output": stdout.trim() }))
}

/// 卸载 Skill（删除 ~/.openclaw/skills/<name>/ 目录）
#[tauri::command]
pub async fn skills_uninstall(name: String) -> Result<Value, String> {
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("无效的 Skill 名称".to_string());
    }
    let skills_dir = super::openclaw_dir().join("skills").join(&name);
    if !skills_dir.exists() {
        return Err(format!("Skill「{name}」不存在"));
    }
    std::fs::remove_dir_all(&skills_dir).map_err(|e| format!("删除失败: {e}"))?;
    Ok(serde_json::json!({ "success": true, "name": name }))
}

/// 内置热门 MCP 服务器精选列表
fn hot_mcp_servers() -> Vec<Value> {
    vec![
        json!({"slug":"filesystem","name":"Filesystem","description":"读写本地文件系统，管理文件和目录操作","install_cmd":"npx -y @modelcontextprotocol/server-filesystem","stars":9800}),
        json!({"slug":"fetch","name":"Web Fetch","description":"抓取网页内容，获取互联网上的任意 URL 数据","install_cmd":"npx -y @modelcontextprotocol/server-fetch","stars":8700}),
        json!({"slug":"brave-search","name":"Brave Search","description":"使用 Brave Search 引擎进行实时网络搜索","install_cmd":"npx -y @modelcontextprotocol/server-brave-search","stars":7500}),
        json!({"slug":"github","name":"GitHub MCP Server","description":"GitHub 仓库、Issue、PR、Actions 等全功能集成","install_cmd":"npx -y @modelcontextprotocol/server-github","stars":7200}),
        json!({"slug":"puppeteer","name":"Puppeteer Browser","description":"基于 Chromium 的浏览器自动化，支持截图、点击、表单填写","install_cmd":"npx -y @anthropic/mcp-server-puppeteer","stars":6500}),
        json!({"slug":"memory","name":"Memory Knowledge Graph","description":"持久化记忆存储，基于知识图谱的上下文管理","install_cmd":"npx -y @modelcontextprotocol/server-memory","stars":6100}),
        json!({"slug":"postgres","name":"PostgreSQL","description":"PostgreSQL 数据库查询和管理，安全执行 SQL","install_cmd":"npx -y @modelcontextprotocol/server-postgres","stars":5800}),
        json!({"slug":"slack","name":"Slack","description":"Slack 工作区消息收发、频道管理和用户信息获取","install_cmd":"npx -y @modelcontextprotocol/server-slack","stars":5200}),
        json!({"slug":"sequential-thinking","name":"Sequential Thinking","description":"逐步推理思维链，增强复杂问题解决能力","install_cmd":"npx -y @modelcontextprotocol/server-sequentialthinking","stars":4900}),
        json!({"slug":"docker","name":"Docker","description":"Docker 容器、镜像和网络管理，执行容器操作命令","install_cmd":"npx -y @modelcontextprotocol/server-docker","stars":4600}),
        json!({"slug":"notion","name":"Notion","description":"Notion 页面、数据库和块级内容读写管理","install_cmd":"npx -y@mcp/notion-server","stars":4300}),
        json!({"slug":"aws-kb-retrieval","name":"AWS Knowledge Base Retrieval","description":"从 Amazon Knowledge Bases 检索 RAG 知识文档","install_cmd":"npx -y @aws-sdk/mcp-server-kb-retrieval","stars":4000}),
        json!({"slug":"gdrive","name":"Google Drive","description":"Google Drive 文件搜索、上传下载和权限管理","install_cmd":"npx -y @anthropic/mcp-server-google-drive","stars":3800}),
        json!({"slug":"stripe","name":"Stripe","description":"Stripe 支付、账单、客户和产品数据查询","install_cmd":"npx -y @anthropic/mcp-server-stripe","stars":3500}),
        json!({"slug":"everything","name":"Everything (Windows Search)","description":"Windows 本地文件极速搜索，基于 Everything 引擎","install_cmd":"npx -y mcp-server-everything","stars":3200}),
        json!({"slug":"supabase","name":"Supabase","description":"Supabase 数据库、Auth 和 Storage 服务集成","install_cmd":"npx -y @supabase/mcp-supabase","stars":3000}),
        json!({"slug":"obsidian","name":"Obsidian","description":"Obsidian 笔记库搜索、读取和链接管理","install_cmd":"npx -y @modelcontextprotocol/server-obsidian","stars":2800}),
        json!({"slug":"spotify","name":"Spotify","description":"Spotify 音乐播放控制、播放列表和推荐发现","install_cmd":"npx -y @anthropic/mcp-server-spotify","stars":2500}),
        json!({"slug":"calendar","name":"Google Calendar","description":"Google Calendar 日程创建、查询和提醒管理","install_cmd":"npx -y @anthropic/mcp-server-google-calendar","stars":2300}),
        json!({"slug":"time","name":"World Time & Date","description":"全球时区时间查询、日期计算和定时任务","install_cmd":"npx -y @modelcontextprotocol/server-time","stars":2000}),
    ]
}

/// 搜索 MCP Server 市场（内置精选列表 + 关键词过滤）
#[tauri::command]
pub async fn mcp_market_search(query: String) -> Result<Value, String> {
    let q = query.trim().to_lowercase();

    // 空查询返回全部热门列表，有关键词则过滤
    let results: Vec<Value> = if q.is_empty() {
        hot_mcp_servers()
    } else {
        hot_mcp_servers().into_iter().filter(|s| {
            let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let desc = s.get("description").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let slug = s.get("slug").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            name.contains(&q) || desc.contains(&q) || slug.contains(&q)
        }).collect()
    };

    Ok(Value::Array(results))
}

/// Public wrapper for extract_json, used by config.rs get_status_summary
pub fn extract_json_pub(text: &str) -> Option<Value> {
    extract_json(text)
}

/// Extract the first valid JSON object or array from a string that may contain
/// non-JSON lines (Node.js warnings, npm update prompts, etc.)
fn extract_json(text: &str) -> Option<Value> {
    // Try parsing the whole string first (fast path)
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return Some(v);
    }
    // Find the first '{' or '[' and try parsing from there
    for (i, ch) in text.char_indices() {
        if ch == '{' || ch == '[' {
            if let Ok(v) = serde_json::from_str::<Value>(&text[i..]) {
                return Some(v);
            }
            // Try with a streaming deserializer to handle trailing content
            let mut de = serde_json::Deserializer::from_str(&text[i..]).into_iter::<Value>();
            if let Some(Ok(v)) = de.next() {
                return Some(v);
            }
        }
    }
    None
}

/// CLI 不可用时的兜底：扫描 ~/.openclaw/skills 目录
fn scan_local_skills() -> Result<Value, String> {
    let skills_dir = super::openclaw_dir().join("skills");
    if !skills_dir.exists() {
        return Ok(serde_json::json!({
            "skills": [],
            "source": "local-scan",
            "cliAvailable": false
        }));
    }

    let mut skills = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !ft.is_dir() && !ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let skill_md = entry.path().join("SKILL.md");
            let description = if skill_md.exists() {
                // 尝试从 SKILL.md 的 frontmatter 中提取 description
                parse_skill_description(&skill_md)
            } else {
                String::new()
            };
            skills.push(serde_json::json!({
                "name": name,
                "description": description,
                "source": "managed",
                "eligible": true,
                "bundled": false,
                "filePath": skill_md.to_string_lossy(),
            }));
        }
    }

    Ok(serde_json::json!({
        "skills": skills,
        "source": "local-scan",
        "cliAvailable": false
    }))
}

/// 从 SKILL.md 的 YAML frontmatter 中提取 description
fn parse_skill_description(path: &std::path::Path) -> String {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    // frontmatter 格式: ---\n...\n---
    if !content.starts_with("---") {
        return String::new();
    }
    if let Some(end) = content[3..].find("---") {
        let fm = &content[3..3 + end];
        for line in fm.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("description:") {
                return rest.trim().trim_matches('"').trim_matches('\'').to_string();
            }
        }
    }
    String::new()
}
