---
name: redbook
description: "小红书操作（通过redbook CLI）：搜索笔记、阅读内容、分析博主、发布图文。使用浏览器Cookie认证，无需API Key。当需要以下操作时使用：(1) 搜索小红书笔记，(2) 阅读笔记内容和评论，(3) 分析博主资料和笔记列表，(4) 发布图文笔记。"
metadata:
  {
    "openclaw":
      {
        "emoji": "📕",
        "requires": { "bins": ["redbook"] },
        "install":
          [
            {
              "id": "npm",
              "kind": "npm",
              "package": "@lucasygu/redbook",
              "bins": ["redbook"],
              "label": "Install redbook CLI (npm)",
            },
          ],
      },
  }
---

# Redbook (小红书) Skill

Use the `redbook` CLI to interact with Xiaohongshu (小红书) platform.

## When to Use

✅ **USE this skill when:**

- Searching notes on Xiaohongshu
- Reading note content and comments
- Analyzing user profiles and their posts
- Publishing image-text notes
- Getting recommended feed content
- Searching topic hashtags
- Analyzing viral notes and extracting templates

## When NOT to Use

❌ **DON'T use this skill when:**

- You need to interact with other social platforms (Weibo, Douyin, etc.)
- You need to perform actions not supported by the CLI
- Cookie authentication is not set up

## Setup

The tool uses browser Cookie authentication via `sweet-cookie`. No API Key required.

```bash
redbook whoami
```

If authentication fails, make sure you're logged into Xiaohongshu in Chrome browser.

**Note**: On Windows with Chrome 127+, you may need to close Chrome before running commands, or use `--cookie-string` manually:

```bash
redbook whoami --cookie-string "a1=VALUE; web_session=VALUE"
```

## Commands

### whoami

Check connection and current user:

```bash
redbook whoami
```

### Search Notes

Search for notes by keyword:

```bash
redbook search <keyword>
redbook search <keyword> --json
```

Example:
```bash
redbook search "美食推荐"
redbook search "旅行攻略" --json
```

### Read Note (获取完整图文)

Read a single note by URL, including full text and images:

```bash
redbook read <url>
redbook read <url> --json
```

Example:
```bash
redbook read "https://www.xiaohongshu.com/explore/xxxxx"
redbook read "https://www.xiaohongshu.com/explore/xxxxx" --json
```

Use `--json` flag to get structured output with:
- Note title and description
- Full text content
- Image URLs (original quality)
- Author info
- Engagement stats (likes, collects, comments)

### Get Comments

Get comments for a note:

```bash
redbook comments <url>
redbook comments <url> --json
```

### User Profile

View user profile:

```bash
redbook user <userId>
redbook user <userId> --json
```

### User Posts

List all posts from a user:

```bash
redbook user-posts <userId>
redbook user-posts <userId> --json
```

### Feed

Get recommended feed content:

```bash
redbook feed
redbook feed --json
```

### Topics

Search topic hashtags:

```bash
redbook topics <keyword>
```

### Favorites (收藏列表)

List a user's collected/favorited notes:

```bash
redbook favorites
redbook favorites <userId>
redbook favorites --json
```

### Collection Boards (收藏专辑)

List user's collection boards:

```bash
redbook boards
redbook boards <userId>
```

List notes in a collection board:

```bash
redbook board <boardUrl>
```

### Followers & Following

List a user's followers:

```bash
redbook followers <userId>
```

List accounts a user follows:

```bash
redbook following <userId>
```

### Interactions

Collect (bookmark) a note:

```bash
redbook collect <url>
```

Remove from collection:

```bash
redbook uncollect <url>
```

Like a note:

```bash
redbook like <url>
```

### Comments & Replies

Post a top-level comment:

```bash
redbook comment <url>
```

Reply to a comment:

```bash
redbook reply <url>
```

Batch reply to comments:

```bash
redbook batch-reply <url>
```

### Post

Publish an image-text note:

```bash
redbook post
```

### Delete

Delete your own note:

```bash
redbook delete <url>
```

### Health Check (限流检测)

Check note distribution health — detect hidden rate-limiting:

```bash
redbook health
```

### Viral Analysis

Analyze why a viral note works:

```bash
redbook analyze-viral <url>
```

Extract content template from viral notes:

```bash
redbook viral-template <url1> <url2> <url3>
```

### Render (生成图文卡片)

Render markdown to styled PNG cards for Xiaohongshu posts:

```bash
redbook render <file.md>
```

## Common Workflows

### Get Full Note Content (获取完整图文)

```bash
redbook read "https://www.xiaohongshu.com/explore/xxxxx" --json
```

This returns structured JSON with:
- `title`: Note title
- `desc`: Full text content
- `images`: Array of image URLs
- `author`: Author profile
- `stats`: Engagement metrics

### Competitor Analysis

```bash
redbook search "竞品关键词" --json
redbook read "https://www.xiaohongshu.com/explore/xxxxx" --json
redbook comments "https://www.xiaohongshu.com/explore/xxxxx" --json
redbook analyze-viral "https://www.xiaohongshu.com/explore/xxxxx"
```

### Blogger Research

```bash
redbook user "userId" --json
redbook user-posts "userId" --json
redbook followers "userId"
redbook following "userId"
```

### Topic Research

```bash
redbook topics "目标话题"
redbook search "目标关键词" --json
redbook feed --json
```

### Content Template Extraction

```bash
redbook viral-template "url1" "url2" "url3"
```

## Notes

- Cookie authentication reads from Chrome browser automatically
- Use `--json` flag for structured output suitable for parsing
- Main API (edith.xiaohongshu.com) uses 144-byte x-s signature for reading
- Creator API (creator.xiaohongshu.com) uses AES-128-CBC signature for publishing
- No headless browser or browser automation required - pure HTTP requests
- On Windows, close Chrome before running commands to avoid cookie lock issues
