# 后端依赖手动安装指南

## 问题原因
系统 DNS 解析失败，无法自动下载 Python 包。

## 解决方案

### 方案 1: 修复 DNS（推荐）

以**管理员身份**运行 PowerShell，执行：

```powershell
# 设置 Google DNS
Set-DnsClientServerAddress -InterfaceIndex (Get-NetAdapter | Where Status -EQ 'Up' | Select -First 1).ifIndex -ServerAddresses ("8.8.8.8", "8.8.4.4")

# 或者使用国内 DNS
# Set-DnsClientServerAddress -InterfaceIndex (Get-NetAdapter | Where Status -EQ 'Up' | Select -First 1).ifIndex -ServerAddresses ("114.114.114.114", "114.114.115.115")

# 刷新 DNS 缓存
ipconfig /flushdns
```

然后安装依赖：

```powershell
cd d:\github\deerflow-agent\backend
uv sync
```

### 方案 2: 使用其他网络

1. 切换到手机热点或其他 WiFi
2. 运行：
```powershell
cd d:\github\deerflow-agent\backend
uv sync
```

### 方案 3: 手动下载包

1. 在有网络的机器上下载所有依赖包（.whl 文件）
2. 复制到 U 盘或网络共享
3. 在目标机器上离线安装：

```powershell
cd d:\github\deerflow-agent\backend
uv pip install *.whl --no-index --find-links=.
```

### 方案 4: 使用 pip 国内镜像

```powershell
cd d:\github\deerflow-agent\backend
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install fastapi httpx python-multipart sse-starlette uvicorn lark-oapi slack-sdk python-telegram-bot langgraph-sdk markdown-to-mrkdwn deerflow-harness -i https://pypi.tuna.tsinghua.edu.cn/simple
```

## 安装完成后启动后端

```powershell
cd d:\github\deerflow-agent
.\start-backend-simple.ps1
```

后端服务地址：
- Gateway: http://localhost:8012
- LangGraph: http://localhost:2024

## 需要的完整依赖包列表

```
deerflow-harness
fastapi>=0.115.0
httpx>=0.28.0
python-multipart>=0.0.20
sse-starlette>=2.1.0
uvicorn[standard]>=0.34.0
lark-oapi>=1.4.0
slack-sdk>=3.33.0
python-telegram-bot>=21.0
langgraph-sdk>=0.1.51
markdown-to-mrkdwn>=0.3.1
pytest>=8.0.0
ruff>=0.14.11
```
