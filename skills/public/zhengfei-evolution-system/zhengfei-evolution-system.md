# 正飞信息技术 - 技能进化系统 V3.0

## 正飞出品 | 专业、智能、持续进化

---

## 一、系统定位

**正飞技能进化系统**是zhengfeiClaw的核心引擎，通过持续学习用户需求、沉淀最佳实践、优化执行能力，让AI助手越来越懂你、越来越专业。

**核心理念：**每一次交互都是一次进化，每一次执行都是一次学习

---

## 二、核心优势

### 1. 自动化程度高
- 全自动素材收集：执行即记录，无需手动操作
- 全自动能力提炼：智能识别通用模式
- 全自动内化生效：能力自动嵌入执行流程

### 2. 学习能力强
- 跨场景复用：一次经验，多处受益
- 持续迭代优化：每天自动升级能力库
- 自我进化机制：系统本身也会持续优化

### 3. 专业度提升
- 标准化能力卡片：5维能力模型
- 完整追溯体系：所有进化可追溯
- 质量保障机制：能力验证与归档

---

## 三、系统架构

```
┌─────────────────────────────────────────────────────────┐
│                   正飞技能进化系统                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐            │
│  │ 素材收集 │ ─→ │ 能力提炼 │ ─→ │ 自动生效 │            │
│  └─────────┘    └─────────┘    └─────────┘            │
│       ↓              ↓              ↓                  │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐            │
│  │ 定期整理 │ ←─ │ 记忆联动 │ ←─ │ 进化总结 │            │
│  └─────────┘    └─────────┘    └─────────┘            │
│       │              │                                 │
│       └──────────────┴──────────────────────────────┐  │
│                                                     │  │
│              ┌──────────────────────┐              │  │
│              │   自动化引擎         │              │  │
│              │  - 心跳保活         │              │  │
│              │  - 定时任务         │              │  │
│              │  - 进化触发         │              │  │
│              └──────────────────────┘              │  │
│                                                     │  │
└─────────────────────────────────────────────────────┘  │
                                                       │
        每日 03:00 自动维护 | 每次任务后自动进化       │
```

---

## 四、工作流程

### 阶段1：素材收集（全自动）

**触发时机：** 每次完成任务后

**收集内容：**
- 优秀模板：代码框架、文档结构、prompt范例
- 解决方案：问题修复方法、优化技巧、避坑经验
- 执行流程：从理解需求到交付结果的最优路径
- 高频需求：重复出现的用户诉求

**存储位置：** `zhengfei-materials/日期.md`

**自动触发：**
```bash
python zhengfei-trigger.py "任务名称" "执行结果"
```

---

### 阶段2：能力提炼（智能化）

**提炼维度：** 正飞5维能力模型

| 维度 | 说明 | 示例 |
|------|------|------|
| **触发条件** | 什么时候用这个能力 | 写Python代码需要异常处理时 |
| **核心价值** | 这个能力解决什么问题 | 提高代码健壮性，避免崩溃 |
| **实施方案** | 具体怎么实现 | try-except结构 + 日志记录 |
| **适用范围** | 可以用在哪些场景 | 所有Python脚本、数据处理任务 |
| **风险边界** | 什么时候不能用 | 多线程日志冲突、版本不兼容 |

**存储位置：** `zhengfei-capabilities/CAP-{ID}-{名称}.md`

**能力卡片示例：**
```markdown
# CAP-001: Python异常处理标准方案

## 触发条件
- 写Python代码时
- 需要处理异常时
- 用户要求"要健壮""要加错误处理"

## 核心价值
- 提高代码健壮性
- 避免程序崩溃
- 便于排查问题

## 实施方案
```python
try:
    # 主要逻辑
except Exception as e:
    logger.error(f"错误: {e}")
    raise
```

## 适用范围
- 所有Python脚本
- 数据处理任务
- API调用场景

## 风险边界
- 多线程场景可能导致日志冲突
- Python 2.x不兼容
```

---

### 阶段3：自动生效（无缝集成）

**生效方式：**

1. **嵌入执行规则**
   - 更新执行规范文档
   - 在执行时自动应用能力

2. **优先使用经验**
   - 同类问题优先调用已验证方案
   - 避免重复试错

3. **前置规划参考**
   - 接到需求时先查能力库
   - 直接复用最优方案

**更新文件：**
- `AGENTS.md` - 添加新规范
- `MEMORY.md` - 沉淀长期能力
- `ZHENGFEI.md` - 正飞专属能力

---

### 阶段4：定期整理（每日维护）

**执行时间：** 每天凌晨3:00

**整理内容：**

1. **合并重复能力**
   - 相似度>80%的合并
   - 保留最优版本

2. **升级通用能力**
   - 拓展适用场景
   - 提升执行效率

3. **归档过时能力**
   - 标记为`@archived`
   - 保留历史追溯

**自动执行：** Cron定时任务（已配置）

---

### 阶段5：记忆联动（全链路追溯）

**读权限：**
- 历史进化记录
- 用户偏好设置
- 踩坑经验库

**写权限：**
- 新增能力记录
- 进化过程日志
- 维护报告

**存储位置：**
- `zhengfei-memory/日期.md` - 日常记录
- `zhengfei-memory/index.md` - 能力索引

---

### 阶段6：进化总结（可视化输出）

**每次进化完成输出：**

```
📊 正飞技能进化报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 本次进化统计
  ✓ 新增能力：2项
  ✓ 升级能力：1项
  ✓ 归档能力：0项
  ✓ 能力库总量：15项

📋 新增能力清单
  1. CAP-003 - 文档排版优化
  2. CAP-004 - 数据清洗标准流程

🔄 升级能力清单
  1. CAP-001 - 拓展到多线程场景

📁 能力库索引
  已更新：zhengfei-capabilities/index.json

⏰ 下次维护
  2026-03-23 03:00:00

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
正飞出品 | 持续进化 | 专业服务
```

---

## 五、自动化引擎

### 引擎1：心跳保活

**功能：** 确保进化系统持续在线

**脚本：** `zhengfei-heartbeat.py`

**日志位置：** `zhengfei-logs/heartbeat.log`

**运行方式：**
```bash
python zhengfei-heartbeat.py
```

**后台运行：**
```bash
start /B python zhengfei-heartbeat.py > zhengfei-logs/heartbeat.log 2>&1
```

---

### 引擎2：定时任务

**功能：** 每日自动维护能力库

**脚本：** `zhengfei-scheduler.py`

**维护内容：**
- 扫描能力库
- 合并重复能力
- 升级通用能力
- 生成维护报告

**运行方式：**
```bash
python zhengfei-scheduler.py
```

**自动触发：** 已设置Cron任务（每天03:00）

---

### 引擎3：进化触发

**功能：** 任务完成后自动记录素材

**脚本：** `zhengfei-trigger.py`

**使用方式：**
```bash
python zhengfei-trigger.py "Python脚本生成" "成功"
```

**自动记录：**
- 素材库更新
- 进化提示生成
- 能力卡片建议

---

### 引擎4：系统初始化

**功能：** 一键搭建完整系统

**脚本：** `zhengfei-init.py`

**创建内容：**
- 完整目录结构
- 初始化配置文件
- 创建示例能力卡片
- 生成索引文件

**运行方式：**
```bash
python zhengfei-init.py
```

---

## 六、文件结构

```
技能脚本/
├── zhengfei-evolution-system.md       # 本文档
│
├── zhengfei-heartbeat.py              # 心跳保活引擎
├── zhengfei-scheduler.py              # 定时任务引擎
├── zhengfei-trigger.py               # 进化触发引擎
├── zhengfei-init.py                 # 系统初始化引擎
│
├── zhengfei-materials/               # 素材库
│   ├── 2026-03-22.md                # 2026-03-22素材
│   └── 2026-03-23.md                # 2026-03-23素材
│
├── zhengfei-capabilities/            # 能力库
│   ├── CAP-001-python-exception.md   # 能力卡片
│   ├── CAP-002-doc-format.md        # 能力卡片
│   └── index.json                   # 能力索引
│
├── zhengfei-archived/               # 归档库
│   └── CAP-old-001.md              # 归档能力
│
├── zhengfei-memory/                 # 记忆库
│   ├── 2026-03-22.md              # 日常记录
│   └── index.md                   # 记忆索引
│
└── zhengfei-logs/                   # 日志库
    ├── heartbeat.log                # 心跳日志
    ├── scheduler.log               # 调度日志
    └── evolution.log              # 进化日志
```

---

## 七、快速开始（3步启动）

### 第1步：初始化系统

```bash
cd C:\Users\Administrator\Desktop\技能脚本
python zhengfei-init.py
```

**输出：**
```
🚀 正飞技能进化系统初始化中...

✓ 创建目录结构
✓ 初始化配置文件
✓ 创建示例能力卡片
✓ 生成索引文件

✅ 系统初始化完成！

下一步：
1. 运行心跳保活: python zhengfei-heartbeat.py
2. 运行定时任务: python zhengfei-scheduler.py
3. 完成任务后触发: python zhengfei-trigger.py <任务> <结果>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
正飞出品 | 专业智能 | 持续进化
```

---

### 第2步：启动后台服务

```bash
# 心跳保活（后台运行）
start /B python zhengfei-heartbeat.py > zhengfei-logs\heartbeat.log 2>&1

# 定时任务（后台运行）
start /B python zhengfei-scheduler.py > zhengfei-logs\scheduler.log 2>&1
```

**验证运行：**
```bash
# 查看心跳日志
type zhengfei-logs\heartbeat.log

# 查看调度日志
type zhengfei-logs\scheduler.log
```

---

### 第3步：触发进化

完成任务后手动触发：

```bash
python zhengfei-trigger.py "Python脚本生成" "成功"
```

**自动执行：**
1. 记录任务素材
2. 分析进化机会
3. 生成能力建议
4. 更新能力索引

---

## 八、使用场景

### 场景1：代码生成任务

**完成代码后：**
```bash
python zhengfei-trigger.py "Python代码生成" "成功"
```

**系统自动：**
1. 记录代码模板（带注释、异常处理）
2. 提炼通用能力（异常处理标准方案）
3. 内化到执行规范（以后自动加异常处理）

**下次生成代码时：**
- 自动应用异常处理模板
- 自动添加代码注释
- 自动提供使用示例

---

### 场景2：文档创建任务

**完成文档后：**
```bash
python zhengfei-trigger.py "技术文档创建" "成功"
```

**系统自动：**
1. 记录文档结构（标题、段落、列表、代码块）
2. 提炼通用能力（Markdown标准格式）
3. 内化到执行规范（以后自动按标准排版）

**下次创建文档时：**
- 自动使用标准格式
- 自动优化段落结构
- 自动添加代码高亮

---

### 场景3：问题排查任务

**完成排查后：**
```bash
python zhengfei-trigger.py "问题排查" "解决"
```

**系统自动：**
1. 记录排查流程（分析→定位→修复→验证）
2. 提炼通用能力（标准排查步骤）
3. 内化到执行规范（以后按步骤排查）

**下次遇到问题时：**
- 自动按标准流程排查
- 自动记录排查日志
- 自动生成修复建议

---

## 九、质量保障

### 1. 能力验证

**验证流程：**
1. 新能力生成后，标记为`@test`
2. 执行3次以上，确认稳定
3. 标记为`@verified`，正式生效

**状态标记：**
- `@draft` - 草稿，待完善
- `@test` - 测试中
- `@verified` - 已验证
- `@archived` - 已归档

---

### 2. 重复检测

**检测标准：**
- 能力名称相似度>80%
- 触发条件相似度>80%
- 实施方案相似度>80%

**处理方式：**
- 合并相似能力
- 保留最优版本
- 标记其他版本为`@merged`

---

### 3. 定期审查

**审查周期：** 每周

**审查内容：**
- 使用频率低的能力
- 过时失效的能力
- 可优化的能力

**处理方式：**
- 升级优化
- 归档保留
- 删除标记

---

## 十、正飞专属特性

### 1. 品牌化命名

**文件命名规则：**
- 引擎脚本：`zhengfei-{功能}.py`
- 素材文件：`zhengfei-materials/日期.md`
- 能力卡片：`zhengfei-capabilities/CAP-{ID}-{名称}.md`

**能力ID规则：**
- CAP-0XX: 正飞通用能力
- CAP-1XX: 代码相关
- CAP-2XX: 文档相关
- CAP-3XX: 工具相关
- CAP-9XX: 系统相关

---

### 2. 专属能力库

**正飞核心能力：**
- CAP-900: 正飞代码规范
- CAP-901: 正飞文档标准
- CAP-902: 正飞问题排查流程
- CAP-903: 正飞客户服务标准

---

### 3. 进化报告模板

**正飞风格报告：**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     正飞技能进化系统 V3.0 | 进化报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 进化统计
  新增能力：X项
  升级能力：Y项
  归档能力：Z项
  能力总量：N项

📋 能力清单
  [CAP-XXX] 能力名称
  [CAP-XXX] 能力名称

⏰ 维护计划
  下次维护：YYYY-MM-DD HH:MM:SS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
正飞出品 | 持续进化 | 专业服务
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 十一、常见问题

### Q1: 如何查看当前能力库？

```bash
# 查看所有能力
dir zhengfei-capabilities

# 查看能力索引
type zhengfei-capabilities\index.json

# 查看特定能力
type zhengfei-capabilities\CAP-001-xxx.md
```

---

### Q2: 如何手动添加能力？

**步骤：**
1. 在`zhengfei-capabilities/`创建新文件
2. 按照能力卡片模板填写
3. 更新`index.json`索引
4. 运行触发脚本验证

---

### Q3: 系统会自动进化吗？

**是的，系统会：**
- 每次任务后自动记录素材
- 每日凌晨3点自动维护
- 自动合并重复能力
- 自动升级通用能力

**你只需要：**
- 正常使用zhengfeiClaw
- 偶尔触发进化（可选）
- 定期查看能力库（可选）

---

### Q4: 如何恢复历史能力？

**归档能力保留在：**
```
zhengfei-archived/
```

**恢复方式：**
1. 找到归档能力文件
2. 移动回`zhengfei-capabilities/`
3. 更新`index.json`
4. 标记状态为`@verified`

---

## 十二、系统监控

### 查看运行状态

```bash
# 查看心跳日志
type zhengfei-logs\heartbeat.log

# 查看调度日志
type zhengfei-logs\scheduler.log

# 查看进化日志
type zhengfei-logs\evolution.log
```

### 查看今日素材

```bash
# 查看素材文件
type zhengfei-materials\2026-03-22.md
```

### 查看能力统计

```bash
# 统计能力数量
dir zhengfei-capabilities /b | find /c "CAP-"
```

---

## 十三、进阶使用

### 自定义触发器

**创建自定义触发脚本：**

```python
# zhengfei-custom-trigger.py
import sys
from zhengfei_trigger import trigger_evolution

skill_name = sys.argv[1] if len(sys.argv) > 1 else "自定义任务"
result = sys.argv[2] if len(sys.argv) > 2 else "成功"

trigger_evolution(skill_name, result)
```

**使用：**
```bash
python zhengfei-custom-trigger.py "我的任务" "成功"
```

---

### 批量导入能力

**创建导入脚本：**

```python
# zhengfei-import.py
import os
import json

def import_capabilities():
    """批量导入能力卡片"""
    # 读取导入文件
    # 创建能力卡片
    # 更新索引
    pass

if __name__ == "__main__":
    import_capabilities()
```

---

### 导出能力库

**创建导出脚本：**

```python
# zhengfei-export.py
import json
import os

def export_capabilities():
    """导出能力库为JSON"""
    capabilities = []

    for filename in os.listdir("zhengfei-capabilities"):
        if filename.startswith("CAP-") and filename.endswith(".md"):
            # 读取能力文件
            # 添加到列表
            pass

    # 导出为JSON
    with open("zhengfei-capabilities-export.json", "w", encoding="utf-8") as f:
        json.dump(capabilities, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    export_capabilities()
```

---

## 十四、更新日志

### V2.0 (2026-03-22)

**新增功能：**
- ✅ 完整的自动化引擎（4个）
- ✅ 正飞专属品牌化命名
- ✅ 正飞5维能力模型
- ✅ 每日自动维护机制
- ✅ 完整的追溯体系

**优化改进：**
- ✅ 更清晰的文件结构
- ✅ 更专业的能力卡片模板
- ✅ 更友好的使用说明
- ✅ 更详细的质量保障机制

**已知问题：**
- 无

---

## 十五、技术支持

### 正飞信息技术

**联系方式：**
- 系统文档：`zhengfei-evolution-system.md`
- 能力库：`zhengfei-capabilities/`
- 日志库：`zhengfei-logs/`

**反馈方式：**
- 在使用过程中发现问题，请记录在`zhengfei-memory/feedback.md`
- 优化建议请记录在`zhengfei-memory/suggestions.md`

---

## 十六、结语

**正飞技能进化系统**是zhengfeiClaw的核心竞争力，通过持续学习、持续进化，让AI助手越来越专业、越来越懂你。

**我们相信：**
- 每一次交互都是一次进化
- 每一次执行都是一次学习
- 持续进化，永不止步

**正飞出品，必属精品！**

---

*文档版本：V3.0*
*更新时间：2026-03-25*
*出品方：正飞信息技术*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     正飞技能进化系统 V3.0 | 正飞出品
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
