"""测试完整的任务创建和 SSE 连接流程"""

import asyncio
import httpx

async def test_full_flow():
    """测试完整流程：查看项目 -> 创建任务 -> 连接 SSE"""
    
    base_url = "http://localhost:8012"
    
    print("====== 测试完整流程 ======\n")
    
    # 1. 查看当前所有项目
    print("1️⃣  查看当前所有项目...")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{base_url}/api/tasks")
            print(f"  状态码：{response.status_code}")
            if response.status_code == 200:
                tasks = response.json()
                print(f"  ✅ 获取成功，共 {len(tasks)} 个任务")
                
                # 统计项目
                projects = set()
                for task in tasks:
                    projects.add(task.get('parent_project_id', 'unknown'))
                
                print(f"  📁 共有 {len(projects)} 个项目:")
                for proj in projects:
                    print(f"     - {proj}")
            else:
                print(f"  ❌ 错误：{response.status_code}")
                print(f"  响应：{response.text[:200]}")
    except Exception as e:
        print(f"  ❌ 错误：{e}")
    
    print()
    
    # 2. 创建新任务
    print("2️⃣  创建新任务...")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.post(
                f"{base_url}/api/tasks",
                json={
                    "name": "测试任务",
                    "description": "这是一个测试任务",
                    "thread_id": "new-mnl7prj1"  # 使用当前的 thread_id
                }
            )
            print(f"  状态码：{response.status_code}")
            if response.status_code == 200:
                task = response.json()
                print(f"  ✅ 任务创建成功！")
                print(f"     任务 ID: {task.get('id')}")
                print(f"     任务名称：{task.get('name')}")
                print(f"     项目 ID: {task.get('parent_project_id')}")
                print(f"     项目名称：{task.get('project_name')}")
                
                project_id = task.get('parent_project_id')
            else:
                print(f"  ❌ 错误：{response.status_code}")
                print(f"  响应：{response.text[:200]}")
                project_id = None
    except Exception as e:
        print(f"  ❌ 错误：{e}")
        project_id = None
    
    print()
    
    # 3. 连接 SSE
    if project_id:
        print(f"3️⃣  连接 SSE (项目 ID: {project_id})...")
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                url = f"{base_url}/api/events/projects/{project_id}/stream"
                print(f"  URL: {url}")
                
                async with client.stream("GET", url) as response:
                    print(f"  状态码：{response.status_code}")
                    if response.status_code == 200:
                        print(f"  ✅ SSE 连接成功！")
                        print(f"  等待事件...")
                        
                        # 等待 5 秒看是否有事件
                        try:
                            async for line in response.aiter_lines():
                                print(f"  📨 收到事件：{line}")
                                break
                        except asyncio.TimeoutError:
                            print(f"  ⏱️  超时，无事件")
                    else:
                        print(f"  ❌ 错误：{response.status_code}")
                        content = await response.aread()
                        print(f"  响应：{content.decode()[:200]}")
        except Exception as e:
            print(f"  ❌ 错误：{e}")
    else:
        print("3️⃣  跳过 SSE 连接（项目 ID 不存在）")
    
    print()
    print("====== 测试结束 ======")

if __name__ == "__main__":
    asyncio.run(test_full_flow())
