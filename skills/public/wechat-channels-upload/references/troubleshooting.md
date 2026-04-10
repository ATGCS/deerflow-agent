# 故障排查

## 浏览器不支持上传

**问题：** 使用 chromium 上传视频时提示不支持

**解决方案：**
1. 安装 Google Chrome 浏览器
2. 在代码中配置 `local_executable_path`：

```python
self.local_executable_path = "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

## 登录失效

**问题：** cookie 过期，无法上传

**解决方案：**
1. 删除旧的 cookie 文件
2. 重新运行登录脚本：

```bash
python get_tencent_cookie.py
```

3. 扫码登录后关闭浏览器

## 找不到模块

**问题：** `ModuleNotFoundError: No module named 'uploader'`

**解决方案：**

确保在项目根目录执行脚本，或设置 PYTHONPATH：

```bash
# Windows
set PYTHONPATH=%cd%
python examples/upload_video_to_tencent.py

# Linux/macOS
export PYTHONPATH=$(pwd)
python examples/upload_video_to_tencent.py
```

## 视频上传失败

**问题：** 视频上传过程中失败

**可能原因：**
1. 视频格式不支持 - 建议使用 MP4 格式
2. 视频文件过大 - 建议压缩后上传
3. 网络问题 - 检查网络连接
4. 登录状态失效 - 重新获取 cookie

## 元素找不到

**问题：** 运行时提示找不到页面元素

**解决方案：**
1. 视频号页面可能已更新，需要更新选择器
2. 检查 `uploader/tencent_uploader/main.py` 中的定位代码
3. 提交 issue 到项目仓库

## 定时发布失败

**问题：** 定时发布时间设置无效

**解决方案：**
1. 确保时间格式正确
2. 定时时间必须在当前时间之后
3. 检查 `generate_schedule_time_next_day` 函数参数

## Cookie 文件路径错误

**问题：** 找不到 cookie 文件

**解决方案：**
1. 确保 `account/` 目录存在
2. 检查文件路径是否正确
3. 确保已成功运行过 `get_tencent_cookie.py`
