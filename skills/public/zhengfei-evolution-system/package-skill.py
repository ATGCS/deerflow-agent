# -*- coding: utf-8 -*-
"""
正飞技能进化系统 - 打包脚本
正飞信息技术出品
"""

import zipfile
import os
import sys
import io
from datetime import datetime

# 修复Windows控制台编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def package_skill():
    """打包技能包"""

    print("\n" + "="*60)
    print("  正飞技能进化系统 | 技能包打包")
    print("="*60)

    # 生成包名
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    package_name = f"zhengfei-evolution-system-v2.0-{timestamp}.zip"
    package_path = os.path.join("C:\\Users\\Administrator\\Desktop", package_name)

    # 需要打包的文件和目录
    files_to_package = [
        "SKILL.md",
        "zhengfei-evolution-system.md",
        "zhengfei-heartbeat.py",
        "zhengfei-scheduler.py",
        "zhengfei-trigger.py",
        "zhengfei-init.py",
        "zhengfei-materials",
        "zhengfei-capabilities",
        "zhengfei-archived",
        "zhengfei-memory",
        "zhengfei-logs"
    ]

    print("\n准备打包以下文件和目录：")
    for item in files_to_package:
        print(f"  - {item}")

    print("\n开始打包...")

    # 源目录
    source_dir = "C:\\Users\\Administrator\\Desktop\\技能脚本"

    try:
        with zipfile.ZipFile(package_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for item in files_to_package:
                item_path = os.path.join(source_dir, item)

                if os.path.exists(item_path):
                    if os.path.isfile(item_path):
                        # 打包单个文件
                        zipf.write(item_path, item)
                        print(f"  ✓ {item}")
                    elif os.path.isdir(item_path):
                        # 打包整个目录
                        for root, dirs, files in os.walk(item_path):
                            for file in files:
                                file_path = os.path.join(root, file)
                                arcname = os.path.relpath(file_path, source_dir)
                                zipf.write(file_path, arcname)
                                print(f"  ✓ {arcname}")
                else:
                    print(f"  ✗ {item} (不存在)")

        print("\n" + "="*60)
        print("  打包完成！")
        print("="*60)
        print(f"\n包路径: {package_path}")
        print(f"包大小: {os.path.getsize(package_path) / 1024:.2f} KB")

        print("\n" + "="*60)
        print("     正飞出品 | 持续进化 | 专业服务")
        print("="*60 + "\n")

    except Exception as e:
        print(f"\n打包失败: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    package_skill()
