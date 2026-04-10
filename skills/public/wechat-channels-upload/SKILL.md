---
name: wechat-channels-upload
description: "当 agent 需要通过 social-auto-upload 的 tencent_uploader 完成微信视频号登录、视频上传时使用这个 skill。该 skill 适用于已经安装 `social-auto-upload` 的环境。注意：视频号目前尚未接入 CLI，需要通过 Python 脚本调用。"
---

# 微信视频号上传 (WeChat Channels Upload)

## 核心原则

- 视频号目前**尚未接入 CLI**，需要通过 Python 脚本直接调用 `tencent_uploader`
- 使用 playwright 模拟浏览器行为
- **必须使用本地 Chrome 浏览器**，chromium 不支持视频上传

## 功能概览

| 功能 | 入口 | 说明 |
|------|------|------|
| 登录 | `get_tencent_cookie.py` | 扫码登录获取 cookie |
| 视频上传 | `upload_video_to_tencent.py` | 上传视频到视频号 |

**当前限制：**
- ❌ 不支持图文上传
- ❌ 尚未接入 CLI
- ❌ 尚未接入 Skill（官方）

## 前置要求

### 1. 安装依赖

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 2. 安装 playwright 浏览器

```bash
playwright install chromium firefox
```

### 3. 配置本地 Chrome（重要！）

视频号使用 chromium 会出现不支持上传视频的问题，需要指定本地 Chrome：

1. 下载 Chrome 浏览器
2. 找到 Chrome 的安装目录
3. 在 `TencentVideo` 类中配置：

```python
self.local_executable_path = "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

**Windows 常见路径：**
- `C:/Program Files/Google/Chrome/Application/chrome.exe`
- `C:/Program Files (x86)/Google/Chrome/Application/chrome.exe`

**macOS 常见路径：**
- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

## 使用流程

### 步骤 1: 准备视频目录结构

```
videos/
├── demo.mp4        # 视频文件
└── demo.txt        # 元数据文件
```

**demo.txt 格式：**

```
视频标题 #话题1 #话题2 #话题3
```

示例：
```
这是一条测试视频 #日常分享 #生活记录
```

### 步骤 2: 获取登录 Cookie

从项目 `examples` 目录复制脚本：

```bash
cp examples/get_tencent_cookie.py .
python get_tencent_cookie.py
```

执行后会打开浏览器，扫码登录微信视频号，登录成功后关闭浏览器即可。

### 步骤 3: 上传视频

从项目 `examples` 目录复制脚本：

```bash
cp examples/upload_video_to_tencent.py .
python upload_video_to_tencent.py
```

脚本会扫描 `videos` 目录，按顺序发布视频。

## Python 代码示例

### 登录获取 Cookie

```python
from uploader.tencent_uploader.main import TencentVideo

if __name__ == '__main__':
    tencent = TencentVideo()
    tencent.get_cookie()
```

### 上传视频

```python
from uploader.tencent_uploader.main import TencentVideo

if __name__ == '__main__':
    account_file = 'account/tencent_cookie.json'  # cookie 文件路径
    video_path = 'videos/demo.mp4'
    title = '视频标题'
    tags = ['话题1', '话题2']
    
    tencent = TencentVideo()
    tencent.upload(
        account_file=account_file,
        video_path=video_path,
        title=title,
        tags=tags
    )
```

### 定时发布

```python
from uploader.tencent_uploader.main import TencentVideo
from utils import generate_schedule_time_next_day

if __name__ == '__main__':
    tencent = TencentVideo()
    
    # 生成定时发布时间
    schedule_times = generate_schedule_time_next_day(
        total_videos=7,      # 总视频数
        videos_per_day=2,    # 每天发布数
        daily_times=[9, 18]  # 每天发布时间点
    )
    
    tencent.upload(
        account_file='account/tencent_cookie.json',
        video_path='videos/demo.mp4',
        title='视频标题',
        tags=['话题1'],
        publish_time=schedule_times[0]
    )
```

## 参数说明

### upload 方法参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `account_file` | str | 是 | cookie 文件路径 |
| `video_path` | str | 是 | 视频文件路径 |
| `title` | str | 是 | 视频标题 |
| `tags` | list | 否 | 话题标签列表 |
| `publish_time` | str | 否 | 定时发布时间 |

### generate_schedule_time_next_day 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `total_videos` | int | 本次上传视频总数 |
| `videos_per_day` | int | 每日上传视频数量 |
| `daily_times` | list | 每日发布时间点，默认 [6, 11, 14, 16, 22] |
| `start_days` | int | 从第 N 天开始，默认 1 |

## 注意事项

### 1. 浏览器配置

- **必须使用本地 Chrome**，不能使用 chromium
- 确保在代码中正确配置 `local_executable_path`

### 2. 登录状态

- cookie 会保存在 `account/` 目录下
- 如果登录失效，需要重新运行 `get_tencent_cookie.py`

### 3. 发布限制

- 每天发布数量有限制
- 视频时长限制
- 文件大小限制

### 4. 内容审核

- 确保内容符合平台规范
- 避免敏感词汇
- 注意版权问题

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| 浏览器不支持上传 | 配置本地 Chrome 路径 |
| 登录失效 | 重新运行 `get_tencent_cookie.py` |
| 上传失败 | 检查视频格式和大小 |
| 元素找不到 | 更新选择器 |

## 参考文档

- 项目地址：https://github.com/dreammis/social-auto-upload
- 示例脚本：`examples/upload_video_to_tencent.py`
- Uploader 源码：`uploader/tencent_uploader/main.py`
