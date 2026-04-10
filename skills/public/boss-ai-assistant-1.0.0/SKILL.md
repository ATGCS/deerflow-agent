---
name: boss-ai-assistant
description: Boss直聘AI助理，自动监控未读消息、AI智能回复、自动发送简历、自动同意交换微信。触发词：Boss直聘、自动回复HR、Boss AI助理、招聘自动化。
---

# Boss直聘AI助理

自动化处理 Boss 直聘消息的 AI 助理脚本。

## 功能

- 自动监控未读消息
- AI 智能回复（根据简历信息和服务领域）
- 自动发送简历（HR请求时）
- 自动同意交换微信
- 自动同意发送简历
- 公司背景信息搜索（Google）
- 聊天记录存服务器数据库
- Bark 推送通知

## 安装

1. 在 ScriptCat 或 Tampermonkey 中添加脚本
2. 配置个人信息和 API Key（见 references/config.md）
3. 访问 Boss 直聘聊天页面，脚本自动启动

## 使用

访问 `https://www.zhipin.com/web/geek/chat*` 页面，脚本会自动：

1. 显示控制面板（右上角）
2. 自动开始监控未读消息
3. 收到新消息时 AI 自动回复
4. HR 索要简历时自动发送
5. HR 请求交换微信时自动同意

## 文件说明

- `scripts/boss_ai_assistant.js` - 主脚本，复制到 ScriptCat/Tampermonkey
- `references/config.md` - 配置说明
- `presets/hr-assistant.md` - 人事预设助手，提供招聘全流程话术和模板
- `presets/templates/jd-template.md` - 职位描述模板
- `presets/templates/communication-templates.md` - 沟通话术模板
- `presets/templates/interview-evaluation.md` - 面试评估表和题库

## 人事预设助手

预设助手提供以下功能：

### 1. 候选人沟通
- 初筛邀约话术
- 面试安排和提醒
- 面试结果反馈（通过/未通过）
- 入职跟进

### 2. 招聘文案生成
- 职位描述(JD)模板
- 招聘海报文案
- 公司介绍文案
- 朋友圈招聘文案

### 3. 面试辅助
- 结构化面试问题设计
- 面试评估表模板
- 技术面试提纲
- 行为面试问题库（STAR法则）

### 4. 薪酬谈判
- 薪资方案建议话术
- Offer沟通模板
- 薪资谈判策略
- 福利说明话术

### 5. 人事文档
- Offer Letter模板
- 面试邀请函
- 拒绝信模板
- 入职须知

### 6. 雇主品牌
- 企业文化提炼
- 员工故事撰写
- 招聘宣传语
- 社交媒体内容

## 管理后台

- HR 列表和聊天记录：见 config.md 中的管理后台地址
