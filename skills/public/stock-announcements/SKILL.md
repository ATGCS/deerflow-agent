---
name: stock-announcements
description: "从东方财富获取A股公司公告。支持按股票代码、日期范围和关键词筛选。提供PDF内容提取以进行详细分析。当用户询问“公告”、“公司公告”时触发。"
official: true
---

# Stock Announcements

Fetch A-share company announcements from Eastmoney data source.

## Features

- **Multi-source Data** — Eastmoney announcement database
- **Date Range Filter** — Query announcements from past N days
- **Keyword Filter** — Filter by title keywords
- **PDF Extraction** — Extract summary from announcement PDFs
- **Multiple Output Formats** — Text or JSON

## Dependencies

Python packages (install once):

```bash
pip install akshare pandas requests PyPDF2
```

## Usage

**IMPORTANT:** Always use the `$SKILLS_ROOT` environment variable to locate scripts.

### Basic Query

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-announcements/scripts/announcements.py" 000858
```

### Specify Date Range

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-announcements/scripts/announcements.py" 600519 --days 60
```

### Filter by Keyword

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-announcements/scripts/announcements.py" 000858 --keyword "业绩"
```

### With PDF Extraction

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-announcements/scripts/announcements.py" 600519 --detail
```

### JSON Output

```bash
export PYTHONIOENCODING=utf-8
python "$SKILLS_ROOT/stock-announcements/scripts/announcements.py" 000858 --format json
```

## Parameters

| Parameter | Description | Example | Default |
|-----------|-------------|---------|---------|
| `stock_code` | Stock code (required) | 000858, 600519.SS | - |
| `--days` | Query past N days | 30, 60, 90 | 30 |
| `--keyword` | Title keyword filter | "业绩", "分红" | None |
| `--format` | Output format | text, json | text |
| `--detail` | Extract PDF content | - | False |

## Output Fields

| Field | Description |
|-------|-------------|
| `date` | Announcement date |
| `title` | Announcement title |
| `type` | Announcement type |
| `url` | Announcement URL |
| `pdf_url` | PDF download URL |
| `code` | Stock code |
| `name` | Company name |
| `summary` | PDF summary (with --detail) |

## Workflow

When user asks about company announcements:

1. **Identify stock code**
   - User may provide company name → convert to stock code
   - Accept formats: 000858, 600519.SS

2. **Execute query**
   ```bash
   export PYTHONIOENCODING=utf-8
   python "$SKILLS_ROOT/stock-announcements/scripts/announcements.py" <code>
   ```

3. **Present results**
   - List announcements with dates and titles
   - Highlight important announcements (业绩, 分红, 重组)
   - Offer to extract PDF content if needed

## Limitations

- A-share only (Mainland China stocks)
- Requires akshare package installation
- PDF extraction depends on network availability
- Some announcements may not have PDF versions

## When to Use This Skill

- User asks "XX公司最近有什么公告"
- User wants to check "业绩预告", "分红公告"
- User needs "公告详情" or "公告内容"
