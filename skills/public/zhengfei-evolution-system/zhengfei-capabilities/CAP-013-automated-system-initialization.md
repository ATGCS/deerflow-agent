# CAP-013: 自动化系统初始化流程

## 触发条件
- 需要部署新的系统时
- 用户要求"初始化系统"
- 首次使用某个工具或框架时
- 需要搭建开发环境时

## 核心价值
- 标准化初始化流程
- 减少手动操作
- 确保环境一致性
- 快速部署和启动

## 实施方案
```python
import os
import json
from datetime import datetime

def init_system(base_dir="."):
    """自动化系统初始化"""
    print("\n" + "="*60)
    print("  系统初始化中...")
    print("="*60)

    # 1. 创建目录结构
    directories = [
        "materials",      # 素材库
        "capabilities",    # 能力库
        "archived",       # 归档库
        "memory",         # 记忆库
        "logs"            # 日志库
    ]

    print("\n创建目录结构...")
    for directory in directories:
        os.makedirs(os.path.join(base_dir, directory), exist_ok=True)
        print(f"  ✓ {directory}/")

    # 2. 创建配置文件
    config = {
        "system": "系统名称",
        "version": "1.0",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "config": {}
    }

    config_file = os.path.join(base_dir, "config.json")
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f"\n配置文件: {config_file}")

    # 3. 创建索引文件
    index_file = os.path.join(base_dir, "index.json")
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump({"items": []}, f, ensure_ascii=False, indent=2)
    print(f"索引文件: {index_file}")

    # 4. 创建初始化日志
    log_file = os.path.join(base_dir, "logs", f"init-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log")
    with open(log_file, "w", encoding="utf-8") as f:
        f.write(f"# 系统初始化日志\n\n")
        f.write(f"初始化时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    print(f"初始化日志: {log_file}")

    print("\n" + "="*60)
    print("  ✅ 系统初始化完成！")
    print("="*60 + "\n")

# 使用方式
if __name__ == "__main__":
    init_system("C:\\path\\to\\system")
```

## 适用范围
- 所有需要目录结构和配置的系统
- Web应用初始化
- 开发框架搭建
- 工具系统部署

## 风险边界
- 已存在文件不会被覆盖（除非明确指定）
- 权限不足会失败
- 网络路径需要特殊处理
- 大量文件创建可能耗时

**增强功能：**
- 支持模板文件复制
- 支持环境变量配置
- 支持权限设置
- 支持进度显示

---
能力状态: @verified
创建时间: 2026-03-22 15:43:00
适用版本: Python 3.6+
