# -*- coding: utf-8 -*-
"""
正飞技能进化系统 - 心跳保活引擎
正飞信息技术出品
"""

import time
import os
import sys
import io
from datetime import datetime

# 修复Windows控制台编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def heartbeat_check(interval=60):
    """
    心跳保活：每隔interval秒输出一次日志，确保进化系统在线
    :param interval: 心跳间隔（秒），默认60秒
    """
    heartbeat_file = "zhengfei-logs/heartbeat.log"

    # 确保日志目录存在
    os.makedirs("zhengfei-logs", exist_ok=True)

    heartbeat_count = 0

    print("\n" + "="*60)
    print("     正飞技能进化系统 | 心跳保活")
    print("="*60)
    print(f"\n⏱️  心跳间隔: {interval} 秒")
    print(f"📁 日志文件: {heartbeat_file}")
    print(f"\n💓 心跳保活已启动...")
    print("="*60 + "\n")

    while True:
        heartbeat_count += 1
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 生成心跳日志
        log_entry = f"[{current_time}] 💓 心跳 #{heartbeat_count} - 正飞进化系统在线\n"

        # 写入心跳日志文件
        with open(heartbeat_file, "a", encoding="utf-8") as f:
            f.write(log_entry)

        # 控制台输出（带状态标记）
        status_icon = "✅" if heartbeat_count % 10 == 0 else "💓"
        print(f"{status_icon} [{current_time}] 心跳 #{heartbeat_count} | 正飞进化系统在线")

        # 每10次心跳输出统计信息
        if heartbeat_count % 10 == 0:
            print(f"   📊 已运行 {heartbeat_count} 次心跳 ({heartbeat_count * interval // 60} 分钟)")

        time.sleep(interval)

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="正飞技能进化系统 - 心跳保活")
    parser.add_argument("--interval", type=int, default=60, help="心跳间隔（秒），默认60")

    args = parser.parse_args()

    try:
        heartbeat_check(interval=args.interval)
    except KeyboardInterrupt:
        print("\n\n" + "="*60)
        print("  🛑 收到停止指令，心跳保活已停止")
        print("="*60)
        print("\n     正飞出品 | 持续进化 | 专业服务")
        print("="*60 + "\n")
