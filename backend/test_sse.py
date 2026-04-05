"""测试 SSE 端点"""

import asyncio
import httpx

async def test_sse_endpoint():
    """测试不同的项目和端口"""
    
    # 测试不同的组合
    tests = [
        ("http://localhost:8012", "main"),
        ("http://localhost:8012", "test"),
        ("http://localhost:1423", "main"),
        ("http://localhost:2024", "main"),
    ]
    
    print("====== 测试 SSE 端点 ======\n")
    
    for base_url, project_id in tests:
        url = f"{base_url}/api/events/projects/{project_id}/stream"
        print(f"测试：{url}")
        
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                async with client.stream("GET", url) as response:
                    print(f"  状态码：{response.status_code}")
                    if response.status_code == 200:
                        print(f"  ✅ 连接成功！")
                        # 读取第一个事件
                        async for line in response.aiter_lines():
                            print(f"  收到：{line}")
                            break
                    else:
                        print(f"  ❌ 错误：{response.status_code}")
                        content = await response.aread()
                        print(f"  响应：{content.decode()[:200]}")
        except httpx.ConnectError as e:
            print(f"  ❌ 连接失败：{e}")
        except Exception as e:
            print(f"  ❌ 错误：{type(e).__name__}: {e}")
        
        print()

if __name__ == "__main__":
    asyncio.run(test_sse_endpoint())
