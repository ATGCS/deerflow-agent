# -*- coding: utf-8 -*-
"""
正飞技能进化系统 - 初始化引擎
正飞信息技术出品
"""

import os
import sys
import io
import json
from datetime import datetime

# 修复Windows控制台编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def init_zhengfei_system():
    """初始化正飞技能进化系统"""

    print("\n" + "="*60)
    print("     正飞技能进化系统 V3.0 | 初始化")
    print("="*60)

    # 创建目录结构
    directories = [
        "zhengfei-materials",
        "zhengfei-capabilities",
        "zhengfei-archived",
        "zhengfei-memory",
        "zhengfei-logs"
    ]

    print("\n创建目录结构...")
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        print(f"  {directory}/")

    # 创建能力索引
    index_data = {
        "system": "正飞技能进化系统 V3.0",
        "version": "3.0",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "capabilities": []
    }

    index_file = "zhengfei-capabilities/index.json"
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)
    print(f"\n能力索引: {index_file}")

    # 创建记忆索引
    memory_index_content = """# 正飞记忆索引

创建时间: {timestamp}

## 记录列表

- 等待添加...
""".format(timestamp=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

    memory_index_file = "zhengfei-memory/index.md"
    with open(memory_index_file, "w", encoding="utf-8") as f:
        f.write(memory_index_content)
    print(f"记忆索引: {memory_index_file}")

    # 创建示例能力卡片
    example_capability = """# CAP-001: 示例能力卡片

## 触发条件
- 什么时候用这个能力
- 用户说XXX时

## 核心价值
- 这个能力解决什么问题
- 提高什么效率

## 实施方案
```
代码/方案示例
```

## 适用范围
- 可以用在哪些场景
- 适用的技能类型

## 风险边界
- 什么时候不能用
- 有什么限制条件

---
能力状态: @draft
创建时间: {timestamp}
""".format(timestamp=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

    example_file = "zhengfei-capabilities/CAP-001-example.md"
    with open(example_file, "w", encoding="utf-8") as f:
        f.write(example_capability)
    print(f"示例能力: {example_file}")

    # 创建正飞专属能力卡片
    # 使用标准字符串避免嵌套引号问题
    zhengfei_capability_content = '''# CAP-900: 正飞Python代码规范

## 触发条件
- 编写Python代码时
- 生成Python脚本时
- 用户要求"写个Python脚本"

## 核心价值
- 确保代码质量
- 提高代码可读性
- 便于维护和扩展

## 实施方案
```python
# -*- coding: utf-8 -*-
"""
模块说明
"""

import sys
import logging
from datetime import datetime

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    # 主函数
    logger.info("程序启动")

    try:
        # 主要逻辑
        pass
    except Exception as e:
        logger.error(f"程序异常: {e}")
        raise

if __name__ == "__main__":
    main()
```

## 适用范围
- 所有Python脚本
- 数据处理任务
- 自动化脚本

## 风险边界
- Python 2.x不兼容
- 需要logging库支持

---
能力状态: @verified
创建时间: ''' + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + '''
适用版本: Python 3.6+
'''

    zhengfei_file = "zhengfei-capabilities/CAP-900-zhengfei-python-standard.md"
    with open(zhengfei_file, "w", encoding="utf-8") as f:
        f.write(zhengfei_capability_content)
    print(f"正飞能力: {zhengfei_file}")

    # 更新能力索引
    index_data["capabilities"].extend([
        {
            "id": "CAP-001-example",
            "name": "示例能力卡片",
            "status": "@draft",
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        },
        {
            "id": "CAP-900-zhengfei-python-standard",
            "name": "正飞Python代码规范",
            "status": "@verified",
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    ])

    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    # 创建初始化日志
    init_time = datetime.now()
    log_lines = [
        "# 正飞技能进化系统初始化日志",
        "",
        "## 系统信息",
        f"- 系统名称: 正飞技能进化系统",
        f"- 系统版本: V3.0",
        f"- 初始化时间: {init_time.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 创建的目录",
        "1. zhengfei-materials/ - 素材库",
        "2. zhengfei-capabilities/ - 能力库",
        "3. zhengfei-archived/ - 归档库",
        "4. zhengfei-memory/ - 记忆库",
        "5. zhengfei-logs/ - 日志库",
        "",
        "## 创建的文件",
        "1. zhengfei-capabilities/index.json - 能力索引",
        "2. zhengfei-memory/index.md - 记忆索引",
        "3. zhengfei-capabilities/CAP-001-example.md - 示例能力",
        "4. zhengfei-capabilities/CAP-900-zhengfei-python-standard.md - 正飞能力",
        "",
        "## 初始能力",
        "- CAP-001: 示例能力卡片 (@draft)",
        "- CAP-900: 正飞Python代码规范 (@verified)",
        "",
        "## 下一步操作",
        "1. 运行心跳保活: python zhengfei-heartbeat.py",
        "2. 运行定时任务: python zhengfei-scheduler.py",
        "3. 完成任务后触发: python zhengfei-trigger.py <任务> <结果>",
        "",
        "---",
        f"初始化完成时间: {init_time.strftime('%Y-%m-%d %H:%M:%S')}",
        "正飞信息技术 | 正飞出品 | 专业服务",
    ]

    log_content = "\n".join(log_lines)

    log_file = f"zhengfei-logs/init-{init_time.strftime('%Y%m%d-%H%M%S')}.log"
    with open(log_file, "w", encoding="utf-8") as f:
        f.write(log_content)

    print(f"初始化日志: {log_file}")

    print("\n" + "="*60)
    print("     系统初始化完成！")
    print("="*60)
    print("\n下一步操作:")
    print("  1. 运行心跳保活: python zhengfei-heartbeat.py")
    print("  2. 运行定时任务: python zhengfei-scheduler.py")
    print("  3. 完成任务后触发: python zhengfei-trigger.py <任务> <结果>")

if __name__ == "__main__":
    init_zhengfei_system()
