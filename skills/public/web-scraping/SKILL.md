---
name: web-scraping
description: "智能网页爬虫，使用Scrapling框架进行网页抓取。支持静态页面、动态渲染、反爬虫绕过。当需要抓取网页内容、提取数据、绕过反爬虫时使用。触发词：爬虫、抓取网页、网页内容、提取数据、scrapling、fetch"
version: 1.0.0
---

# Web Scraping Skill

使用 Scrapling 框架进行智能网页抓取，支持自适应解析、反爬虫绕过、动态渲染。

## 工具选择策略

```
静态页面 → fetch (基础HTTP请求)
    ↓ 失败（需要JS渲染、SSL问题）
dynamic_fetch (Playwright浏览器渲染)
    ↓ 失败（反爬虫保护、Cloudflare）
stealthy_fetch (隐身浏览器绕过)
```

## 命令

### 基础抓取 (fetch)

快速 HTTP 请求，适合静态页面：

```bash
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" fetch <url> [选项]
```

**选项：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--format <fmt>` | 输出格式: `markdown`, `html`, `text` | `markdown` |
| `--selector <css>` | CSS选择器提取特定元素 | - |
| `--adapter <name>` | 适配器: `httpx`(默认), `requests` | `httpx` |

**示例：**
```bash
# 抓取页面并转为markdown
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" fetch "https://example.com"

# 提取特定元素
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" fetch "https://example.com" --selector ".article-content"

# 输出原始HTML
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" fetch "https://example.com" --format html
```

### 动态渲染 (dynamic_fetch)

使用 Playwright 浏览器渲染，适合需要 JavaScript 的页面：

```bash
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" dynamic_fetch <url> [选项]
```

**选项：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--format <fmt>` | 输出格式: `markdown`, `html`, `text` | `markdown` |
| `--selector <css>` | CSS选择器 | - |
| `--wait <css>` | 等待特定元素出现 | - |
| `--network-idle` | 等待网络空闲 | `false` |
| `--timeout <ms>` | 超时时间(毫秒) | `30000` |
| `--headless` | 无头模式 | `true` |

**示例：**
```bash
# 等待元素加载
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" dynamic_fetch "https://spa-example.com" --wait ".content"

# 等待网络空闲
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" dynamic_fetch "https://spa-example.com" --network-idle

# 提取动态加载的数据
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" dynamic_fetch "https://spa-example.com" --selector ".product-list" --wait ".product-item"
```

### 隐身抓取 (stealthy_fetch)

绕过反爬虫保护（Cloudflare Turnstile 等）：

```bash
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" stealthy_fetch <url> [选项]
```

**选项：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--format <fmt>` | 输出格式: `markdown`, `html`, `text` | `markdown` |
| `--selector <css>` | CSS选择器 | - |
| `--wait <css>` | 等待特定元素 | - |
| `--network-idle` | 等待网络空闲 | `false` |
| `--headless` | 无头模式 | `true` |
| `--proxy <url>` | 代理服务器 | - |

**示例：**
```bash
# 绕过 Cloudflare 保护
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" stealthy_fetch "https://protected-site.com"

# 使用代理
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" stealthy_fetch "https://protected-site.com" --proxy "http://user:pass@proxy:8080"
```

### 批量抓取 (bulk_fetch)

批量抓取多个 URL：

```bash
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" bulk_fetch <urls_file> [选项]
```

**选项：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--format <fmt>` | 输出格式 | `markdown` |
| `--concurrency <n>` | 并发数 | `5` |
| `--delay <ms>` | 请求间隔(毫秒) | `1000` |
| `--method <m>` | 方法: `fetch`, `dynamic`, `stealthy` | `fetch` |

**示例：**
```bash
# 批量抓取URL列表文件
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" bulk_fetch urls.txt --concurrency 3 --delay 2000

# 使用隐身模式批量抓取
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" bulk_fetch urls.txt --method stealthy
```

### 自适应提取 (adaptive)

当网站结构变化时自动定位元素：

```bash
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" adaptive <url> --selector <css> --save
```

**示例：**
```bash
# 首次抓取并保存元素特征
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" adaptive "https://example.com" --selector ".product-title" --save

# 后续抓取（自动适应变化）
python "$SKILLS_ROOT/web-scraping/scripts/scrape.py" adaptive "https://example.com" --selector ".product-title"
```

## 输出格式

所有命令输出 JSON：

```json
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "title": "Page Title",
    "content": "提取的内容...",
    "format": "markdown",
    "elements": [
      {
        "selector": ".article",
        "text": "元素文本",
        "html": "<div>...</div>"
      }
    ],
    "metadata": {
      "status": 200,
      "response_time_ms": 1234,
      "final_url": "https://example.com/redirected"
    }
  }
}
```

## Agent 使用流程

1. **静态页面** → 使用 `fetch`
2. **需要 JS 渲染** → 使用 `dynamic_fetch`
3. **遇到反爬虫** → 使用 `stealthy_fetch`
4. **网站结构变化** → 使用 `adaptive`

**示例对话：**

> 用户：帮我抓取这个页面的文章内容 https://example.com/article
>
> Agent：
> 1. 先尝试 `fetch`，检查是否成功
> 2. 如果内容为空或报错，改用 `dynamic_fetch`
> 3. 返回提取的内容

> 用户：这个网站有 Cloudflare 保护
>
> Agent：
> 直接使用 `stealthy_fetch` 绕过保护

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| SSL 证书错误 | 改用 `dynamic_fetch` |
| 内容为空 | 使用 `dynamic_fetch` + `--wait` |
| 被反爬虫拦截 | 使用 `stealthy_fetch` |
| 批量请求被封 | 降低 `--concurrency`，增加 `--delay` |
| 元素找不到 | 检查 `--selector` 语法 |

## 依赖安装

首次使用会自动安装依赖：

```bash
pip install scrapling playwright
playwright install chromium
```

## 注意事项

1. **合法合规**：确保抓取行为符合网站服务条款
2. **速率限制**：避免过于频繁的请求，尊重 robots.txt
3. **资源释放**：浏览器任务完成后自动清理
4. **首次使用**：需要等待浏览器依赖安装完成
