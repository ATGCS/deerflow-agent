# CAP-010: 技能包打包与分发流程

## 触发条件
- 需要将系统打包成技能包时
- 用户要求"打包成技能包"
- 需要分发或部署技能时

## 核心价值
- 标准化打包流程
- 便于系统分发和安装
- 保持文件完整性

## 实施方案
```python
import zipfile
import os

def package_skill(source_dir, package_name, files_to_include):
    """打包技能包"""
    with zipfile.ZipFile(package_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for item in files_to_include:
            item_path = os.path.join(source_dir, item)
            if os.path.exists(item_path):
                if os.path.isfile(item_path):
                    zipf.write(item_path, item)
                elif os.path.isdir(item_path):
                    for root, dirs, files in os.walk(item_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, source_dir)
                            zipf.write(file_path, arcname)
```

## 适用范围
- 所有Python技能系统
- 需要分发的软件包
- 版本管理和归档

## 风险边界
- 需要zipfile模块支持
- 大文件打包可能耗时
- Windows路径分隔符问题

---
能力状态: @verified
创建时间: 2026-03-22 15:43:00
适用版本: Python 3.6+
