# CAP-900: 正飞Python代码规范

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
创建时间: 2026-04-02 04:09:47
适用版本: Python 3.6+
