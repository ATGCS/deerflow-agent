# CAP-012: 文件操作异常处理最佳实践

## 触发条件
- 需要读写文件时
- 处理用户上传的文件
- 批量文件操作
- 需要确保文件操作安全时

## 核心价值
- 提高程序健壮性
- 优雅处理文件操作异常
- 提供清晰的错误信息
- 防止数据丢失

## 实施方案
```python
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def safe_read_file(file_path, encoding='utf-8'):
    """安全读取文件"""
    try:
        with open(file_path, 'r', encoding=encoding) as f:
            return f.read()
    except FileNotFoundError:
        logger.error(f"文件不存在: {file_path}")
        raise
    except PermissionError:
        logger.error(f"权限不足: {file_path}")
        raise
    except UnicodeDecodeError:
        logger.error(f"编码错误: {file_path}")
        # 尝试其他编码
        try:
            with open(file_path, 'r', encoding='gbk') as f:
                return f.read()
        except Exception as e:
            logger.error(f"GBK编码也失败: {e}")
            raise
    except Exception as e:
        logger.error(f"读取文件异常: {e}")
        raise

def safe_write_file(file_path, content, encoding='utf-8'):
    """安全写入文件"""
    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        with open(file_path, 'w', encoding=encoding) as f:
            f.write(content)
        logger.info(f"文件写入成功: {file_path}")
    except PermissionError:
        logger.error(f"权限不足，无法写入: {file_path}")
        raise
    except Exception as e:
        logger.error(f"写入文件异常: {e}")
        raise
```

## 适用范围
- 所有文件读写操作
- 配置文件处理
- 日志文件操作
- 数据文件处理

## 风险边界
- 并发写入需要加锁
- 大文件需要分块处理
- 网络文件需要特殊处理
- 文件路径长度限制（Windows 260字符）

**最佳实践：**
1. 始终使用with语句确保文件正确关闭
2. 提供有意义的错误信息
3. 尝试多种编码格式
4. 确保目录存在再写入
5. 记录操作日志

---
能力状态: @verified
创建时间: 2026-03-22 15:43:00
适用版本: Python 3.6+
