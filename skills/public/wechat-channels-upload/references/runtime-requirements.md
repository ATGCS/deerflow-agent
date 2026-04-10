# 运行前提

这个 skill 默认假设当前环境已经具备：

- 已安装 `social-auto-upload`
- 已安装 Python 3.10+
- 已安装 playwright
- **已安装 Chrome 浏览器**（chromium 不支持视频号上传）

## 安装依赖

### 1. 安装 Python 依赖

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 2. 安装 playwright 浏览器

```bash
playwright install chromium firefox
```

## 配置本地 Chrome（重要）

视频号使用 chromium 会出现不支持上传视频的问题，必须指定本地 Chrome。

### Windows

1. 下载 Chrome：https://www.google.com/chrome/
2. 找到安装路径，常见位置：
   - `C:/Program Files/Google/Chrome/Application/chrome.exe`
   - `C:/Program Files (x86)/Google/Chrome/Application/chrome.exe`

3. 在代码中配置：

```python
self.local_executable_path = "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

### macOS

1. 下载 Chrome
2. 默认路径：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

```python
self.local_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### Linux

1. 下载 Chrome
2. 常见路径：`/usr/bin/google-chrome` 或 `/opt/google/chrome/chrome`

```python
self.local_executable_path = "/usr/bin/google-chrome"
```

## 获取项目代码

```bash
git clone https://github.com/dreammis/social-auto-upload.git
cd social-auto-upload
```

## 目录结构

```
social-auto-upload/
├── examples/
│   ├── get_tencent_cookie.py    # 获取 cookie 脚本
│   └── upload_video_to_tencent.py  # 上传视频脚本
├── uploader/
│   └── tencent_uploader/
│       └── main.py              # 视频号上传器
├── videos/                      # 视频目录
└── account/                     # cookie 存储目录
```
