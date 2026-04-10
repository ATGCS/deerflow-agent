# -*- coding: utf-8 -*-
"""
正飞技能进化系统 - 定时任务调度引擎
正飞信息技术出品
"""

import time
import os
import sys
import io
from datetime import datetime
import json

# 修复Windows控制台编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 简单的调度器实现（不依赖外部库）
class SimpleScheduler:
    """简单定时任务调度器"""

    def __init__(self):
        self.tasks = []

    def schedule_daily(self, hour, minute, task_func):
        """添加每日定时任务"""
        self.tasks.append({
            "type": "daily",
            "hour": hour,
            "minute": minute,
            "task": task_func
        })
        print(f"  ✓ 已添加每日任务: {hour:02d}:{minute:02d}")

    def run(self):
        """运行调度器"""
        print("\n  🕐 调度器正在运行...")

        while True:
            current_time = datetime.now()

            # 检查每个任务
            for task in self.tasks:
                if task["type"] == "daily":
                    # 检查是否到达执行时间
                    if (current_time.hour == task["hour"] and
                        current_time.minute == task["minute"] and
                        current_time.second == 0):
                        try:
                            task["task"]()
                        except Exception as e:
                            print(f"  ⚠️  任务执行异常: {e}")

            # 等待1秒再检查
            time.sleep(1)

def daily_maintenance():
    """每日定时维护：整理能力库、合并重复、归档过时"""
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    date_str = datetime.now().strftime("%Y-%m-%d")

    print("\n" + "="*60)
    print("     正飞技能进化系统 | 每日维护")
    print("="*60)
    print(f"\n⏰ 维护时间: {current_time}")
    print(f"📅 维护日期: {date_str}")

    # 1. 扫描能力库
    capabilities_dir = "zhengfei-capabilities"
    if not os.path.exists(capabilities_dir):
        os.makedirs(capabilities_dir)
        print("\n  ✓ 创建能力库目录")

    # 2. 读取所有能力文件
    capabilities = []
    if os.path.exists(capabilities_dir):
        for filename in os.listdir(capabilities_dir):
            if filename.startswith("CAP-") and filename.endswith(".md"):
                with open(os.path.join(capabilities_dir, filename), "r", encoding="utf-8") as f:
                    content = f.read()
                    capabilities.append({
                        "id": filename,
                        "content": content
                    })
        print(f"  ✓ 读取到 {len(capabilities)} 个能力")

    # 3. 分析能力状态
    active_count = 0
    draft_count = 0
    test_count = 0
    archived_count = 0

    for cap in capabilities:
        if "@archived" in cap["content"]:
            archived_count += 1
        elif "@draft" in cap["content"]:
            draft_count += 1
        elif "@test" in cap["content"]:
            test_count += 1
        else:
            active_count += 1

    print(f"\n  📊 能力状态统计：")
    print(f"    - 已验证 (@verified): {active_count} 项")
    print(f"    - 草稿 (@draft): {draft_count} 项")
    print(f"    - 测试中 (@test): {test_count} 项")
    print(f"    - 已归档 (@archived): {archived_count} 项")
    print(f"    - 总计: {len(capabilities)} 项")

    # 4. 生成维护报告
    report_content = f"""# 正飞技能进化系统 | 每日维护报告

## 维护信息
- 维护时间: {current_time}
- 维护日期: {date_str}
- 能力总量: {len(capabilities)} 项

## 能力状态统计
- 已验证 (@verified): {active_count} 项
- 草稿 (@draft): {draft_count} 项
- 测试中 (@test): {test_count} 项
- 已归档 (@archived): {archived_count} 项

## 待优化项
- [ ] 检查重复能力（相似度>80%）
- [ ] 升级通用能力
- [ ] 归档过时能力
- [ ] 审查低频能力

## 下次维护
- 预计时间: {date_str} 03:00:00

---
正飞信息技术 | 正飞出品 | 专业服务
"""

    report_file = f"zhengfei-logs/maintenance-{date_str}.txt"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(report_content)

    print(f"\n  ✓ 维护报告已保存: {report_file}")

    # 5. 更新能力索引
    index_file = os.path.join(capabilities_dir, "index.json")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            index_data = json.load(f)
    else:
        index_data = {
            "system": "正飞技能进化系统",
            "version": "2.0",
            "created_at": current_time,
            "capabilities": []
        }

    index_data["last_maintenance"] = current_time
    index_data["last_maintenance_count"] = len(capabilities)

    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    print(f"  ✓ 能力索引已更新: {index_file}")

    print("\n" + "="*60)
    print("  ✅ 每日维护完成！")
    print("="*60)
    print("     正飞出品 | 持续进化 | 专业服务")
    print("="*60 + "\n")

def main():
    """主函数"""
    print("\n" + "="*60)
    print("     正飞技能进化系统 | 定时任务调度")
    print("="*60)

    # 创建调度器
    scheduler = SimpleScheduler()

    # 添加每日维护任务（凌晨3点）
    scheduler.schedule_daily(3, 0, daily_maintenance)

    print("\n" + "="*60)
    print("  🚀 调度器已启动")
    print("="*60 + "\n")

    # 运行调度器
    try:
        scheduler.run()
    except KeyboardInterrupt:
        print("\n\n" + "="*60)
        print("  🛑 收到停止指令，调度器已停止")
        print("="*60)
        print("\n     正飞出品 | 持续进化 | 专业服务")
        print("="*60 + "\n")

if __name__ == "__main__":
    main()
