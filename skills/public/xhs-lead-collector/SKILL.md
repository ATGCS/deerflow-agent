---
name: xhs-lead-collector
description: "多平台热门内容分析与潜在客户采集器。支持抖音、小红书、视频号、B站等平台的关键词热门内容采集、内容分析、最优文案生成。当需要采集热门内容、分析爆款因素、生成优质文案时使用。"
license: Proprietary
official: true
---

# 多平台热门内容分析器

## 概述

支持抖音、小红书、视频号、B站等平台的关键词热门内容采集和分析，输出最优文案和展现形式。

## 功能特性

1. **多平台热门内容采集** - 抖音、小红书、视频号、B站
2. **内容分析与归纳** - 提取关键要点、分析写作风格
3. **最优文案生成** - 基于热门内容生成推荐文案

## 安装依赖

```bash
pip install playwright
playwright install chromium
```

## 使用方法

### 热门内容分析

```bash
python scripts/hot_content_analyzer.py -k 关键词1 关键词2 -p 小红书 抖音 -l 100
```

### 潜在客户采集

```bash
python scripts/xhs_lead_collector.py -k 关键词1 关键词2 -m 20
```

## 参数说明

### hot_content_analyzer.py

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-k, --keywords` | 采集关键词列表（必填） | - |
| `-p, --platforms` | 采集平台列表 | 小红书 抖音 视频号 B站 |
| `-l, --min-likes` | 最小点赞数过滤 | 100 |
| `-d, --days` | 采集最近几天的内容 | 7 |
| `-m, --max-content` | 每个关键词最大采集数量 | 20 |
| `-o, --output` | 输出目录 | ./hot_content |
| `-f, --format` | 导出格式(csv/json/both) | both |
| `--headed` | 显示浏览器窗口（调试用） | - |
| `--cookies` | Cookie文件路径 | - |

### xhs_lead_collector.py

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-k, --keywords` | 采集关键词列表（必填） | - |
| `-m, --max-leads` | 每个关键词最大采集数量 | 20 |
| `-l, --min-intent` | 最小意向等级过滤(1-5) | 3 |

## 平台支持情况

| 平台 | 状态 | 说明 |
|------|------|------|
| B站 | ✅ 可直接采集 | 无需登录 |
| 小红书 | ⚠️ 需要登录 | 需要Cookie或扫码登录 |
| 抖音 | ⚠️ 需要登录 | 需要Cookie或扫码登录 |
| 视频号 | ⚠️ 需要微信扫码 | 需要微信扫码登录 |

## 输出内容

### 热门内容分析输出

- **CSV格式**：热门内容列表
- **JSON格式**：包含分析结果和最优文案建议

### JSON输出结构

```json
{
  "meta": { "total": 50, "keywords": [...], "platforms": [...] },
  "contents": [...],
  "analyses": [
    {
      "summary": "内容摘要",
      "key_points": ["关键要点"],
      "writing_style": "写作风格",
      "presentation_style": "展现形式",
      "viral_factors": ["爆款因素"]
    }
  ],
  "optimal_copy": {
    "optimal_copy": "最优文案模板",
    "presentation_styles": ["推荐展现形式"],
    "keyword_suggestions": ["关键词使用建议"],
    "engagement_strategies": ["互动引导策略"]
  }
}
```

## 分析维度

### 内容分析（由AI判断）

| 维度 | 说明 |
|------|------|
| 内容摘要 | 提炼核心内容 |
| 关键要点 | 提取3-5个关键点 |
| 写作风格 | 分析文案风格特点 |
| 展现形式 | 分析内容呈现方式 |
| 爆款因素 | 分析为何能获得高互动 |

### 最优文案生成（由AI判断）

- 基于热门内容分析生成最优文案模板
- 推荐展现形式（图文/视频/直播等）
- 关键词使用建议
- 互动引导策略

## 使用Cookie登录

对于需要登录的平台，可以先手动登录后导出Cookie：

1. 使用浏览器登录目标平台
2. 使用开发者工具导出Cookie为JSON格式
3. 运行时指定Cookie文件：`--cookies cookies.json`

## 注意事项

1. 本工具仅供学习和研究使用
2. 请遵守各平台规则和法律法规
3. 建议设置合理的采集间隔，避免频繁请求
4. 部分平台需要登录才能获取完整数据
