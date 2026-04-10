# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 启动脚本
"""

import argparse
import uvicorn
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    parser = argparse.ArgumentParser(description="正飞进化系统后端服务")
    parser.add_argument("--host", default="127.0.0.1", help="服务地址")
    parser.add_argument("--port", type=int, default=8765, help="服务端口")
    parser.add_argument("--reload", action="store_true", help="开发模式（自动重载）")
    parser.add_argument("--workers", type=int, default=1, help="工作进程数")
    args = parser.parse_args()
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     正飞进化系统 V6.0 - 后端服务                              ║
║     Zhengfei Evolution System Backend Service                ║
║                                                              ║
║     地址: http://{args.host}:{args.port}                        ║
║     文档: http://{args.host}:{args.port}/docs                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    uvicorn.run(
        "server.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=args.workers
    )


if __name__ == "__main__":
    main()
