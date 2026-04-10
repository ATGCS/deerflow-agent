# CAP-011: Windows控制台编码修复方案

## 触发条件
- 在Windows系统上运行Python脚本
- 出现UnicodeEncodeError错误
- 控制台输出中文/emoji时报错
- 错误信息包含 `'gbk' codec can't encode character`

## 核心价值
- 解决Windows控制台编码问题
- 支持中文和特殊字符输出
- 提高脚本兼容性

## 实施方案
```python
import sys
import io

# 修复Windows控制台编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 后续所有print输出都会正常显示中文
print("中文输出测试 ✅")
print("特殊字符测试: 🚀 🎉")
```

**放置位置：** 脚本开头，所有import之后，其他代码之前

## 适用范围
- 所有需要在Windows控制台运行的Python脚本
- 需要输出中文/Unicode字符的程序
- 跨平台脚本（兼容Windows）

## 风险边界
- Windows PowerShell可能仍有部分限制
- 某些IDE的内置终端可能不适用（如PyCharm）
- 重定向到文件时可能不生效
- Python 2.x不兼容

**替代方案：**
- 使用CMD而非PowerShell运行
- 在IDE设置中配置UTF-8编码
- 输出到日志文件而非控制台

---
能力状态: @verified
创建时间: 2026-03-22 15:43:00
适用版本: Python 3.x
测试环境: Windows 10/11
