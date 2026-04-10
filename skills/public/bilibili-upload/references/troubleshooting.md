# 故障排查

## 找不到 sau 命令

可以尝试以下方式：

```powershell
.\.venv\Scripts\Activate.ps1
sau bilibili --help
```

```powershell
.\.venv\Scripts\python.exe sau_cli.py bilibili --help
```

```bash
uv run sau bilibili --help
```

如果当前环境还没有安装项目：

```bash
uv pip install -e .
```

## biliup 下载失败

如果自动下载 biliup 失败：

1. 检查网络是否能访问 GitHub Release
2. 尝试使用代理：https://gh-proxy.com/ 或 https://gh-proxy.org/
3. 手动下载 biliup release 并放到指定目录

## 登录二维码显示不完整

如果终端二维码显示不完整：

1. 直接打开当前目录下的 `qrcode.png` 扫码
2. 不要反复尝试不同的终端设置

## 账号无效或已过期

先检查账号状态：

```bash
sau bilibili check --account <account>
```

如果无效，让用户自己在本地终端重新登录：

```bash
sau bilibili login --account <account>
```

## 上传参数缺失

视频上传最少需要：
- `--account`
- `--file`
- `--title`
- `--desc`
- `--tid`（分区 ID）

## 分区 ID 错误

确保 `--tid` 传入正确的分区 ID。常用分区：

| 分区 | tid |
|------|-----|
| 科技 | 188 |
| 知识 | 201 |
| 生活 | 138 |
| 游戏 | 4 |
| 音乐 | 3 |

## 定时发布

时间格式使用：`YYYY-MM-DD HH:MM`

如果不需要定时发布，去掉 `--schedule` 即可改为立即发布。
