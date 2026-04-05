"""Test all supervisor tools to find a way to change task status"""

import requests
import json

BASE_URL = "http://localhost:8012"

def print_separator(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def test_all_supervisor_actions():
    """Test all supervisor tool actions"""
    
    print_separator("测试所有 Supervisor 工具动作")
    
    # Step 1: 创建任务
    print("1️⃣  创建任务...")
    response = requests.post(
        f"{BASE_URL}/api/tasks",
        json={
            "name": "Test Task Status Change",
            "description": "Testing if we can change task status"
        }
    )
    
    if response.status_code != 200:
        print(f"❌ 创建任务失败：{response.status_code}")
        return
    
    task = response.json()
    task_id = task.get('id')
    print(f"✅ 任务已创建：ID={task_id}")
    print(f"   状态：{task.get('status')}")
    print(f"   execution_authorized: {task.get('execution_authorized')}")
    
    # Step 2: 尝试直接调用 supervisor API
    print_separator("2️⃣  尝试调用 supervisor_tool 的各种 action")
    
    # 获取当前任务状态
    print("\n📌 获取任务状态...")
    response = requests.get(f"{BASE_URL}/api/tasks/{task_id}")
    if response.status_code == 200:
        task = response.json()
        print(f"   当前状态：{task.get('status')}")
    
    # 尝试 start_execution
    print("\n📌 尝试 start_execution...")
    response = requests.post(
        f"{BASE_URL}/api/tasks/{task_id}/authorize-execution",
        json={"authorized_by": "test"}
    )
    print(f"   响应状态：{response.status_code}")
    print(f"   响应内容：{response.text}")
    
    # Step 3: 检查是否有其他 API 可以改变状态
    print_separator("3️⃣  检查可用的任务 API")
    
    # 检查 tasks API 的 OPTIONS
    print("\n📌 检查 /api/tasks 支持的 HTTP 方法...")
    response = requests.options(f"{BASE_URL}/api/tasks")
    print(f"   Allow: {response.headers.get('Allow', 'N/A')}")
    
    # 检查单个 task API 的 OPTIONS
    print(f"\n📌 检查 /api/tasks/{task_id} 支持的 HTTP 方法...")
    response = requests.options(f"{BASE_URL}/api/tasks/{task_id}")
    print(f"   Allow: {response.headers.get('Allow', 'N/A')}")
    
    # Step 4: 尝试 PUT/PATCH 更新任务
    print_separator("4️⃣  尝试 PUT/PATCH 更新任务状态")
    
    # 尝试 PUT
    print("\n📌 尝试 PUT 更新状态为 planned...")
    response = requests.put(
        f"{BASE_URL}/api/tasks/{task_id}",
        json={"status": "planned"}
    )
    print(f"   响应状态：{response.status_code}")
    print(f"   响应内容：{response.text[:200] if response.text else 'N/A'}")
    
    # 尝试 PATCH
    print("\n📌 尝试 PATCH 更新状态为 planned...")
    response = requests.patch(
        f"{BASE_URL}/api/tasks/{task_id}",
        json={"status": "planned"}
    )
    print(f"   响应状态：{response.status_code}")
    print(f"   响应内容：{response.text[:200] if response.text else 'N/A'}")
    
    # Step 5: 检查后端代码中的 supervisor_tool.py
    print_separator("5️⃣  检查 supervisor_tool.py 中的可用 actions")
    
    supervisor_tool_path = r"d:\github\deerflaw\backend\packages\harness\deerflow\tools\builtins\supervisor_tool.py"
    try:
        with open(supervisor_tool_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # 查找所有 action == "xxx" 的模式
        import re
        actions = re.findall(r'action\s*==\s*["\'](\w+)["\']', content)
        actions = list(set(actions))  # 去重
        
        print(f"\n✅ 在 supervisor_tool.py 中找到以下 actions:")
        for action in sorted(actions):
            print(f"   - {action}")
            
        # 检查是否有 update_status 或类似的
        status_related = [a for a in actions if 'status' in a.lower() or 'update' in a.lower() or 'set' in a.lower()]
        if status_related:
            print(f"\n🎯 可能与状态相关的 actions: {status_related}")
        else:
            print(f"\n❌ 没有找到与状态更新相关的 actions")
            
    except Exception as e:
        print(f"❌ 无法读取文件：{e}")
    
    # Step 6: 尝试直接修改 storage.py 中的 authorize 函数
    print_separator("6️⃣  验证 storage.py 的修改")
    
    storage_path = r"d:\github\deerflaw\backend\packages\harness\deerflow\collab\storage.py"
    try:
        with open(storage_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # 查找 allowed_status 定义
        import re
        match = re.search(r'allowed_status\s*=\s*\(([^)]+)\)', content)
        if match:
            allowed = match.group(1)
            print(f"\n✅ authorize_main_task_execution 中的 allowed_status:")
            print(f"   {allowed}")
            
            if 'pending' in allowed:
                print(f"\n🎉 pending 已在允许列表中！后端可能未正确重启")
            else:
                print(f"\n❌ pending 不在允许列表中")
        else:
            print(f"❌ 未找到 allowed_status 定义")
            
    except Exception as e:
        print(f"❌ 无法读取文件：{e}")
    
    # Cleanup
    print_separator("清理")
    response = requests.delete(f"{BASE_URL}/api/tasks/{task_id}")
    if response.status_code == 200:
        print(f"✅ 测试任务已删除")
    else:
        print(f"⚠️  删除失败：{response.status_code}")

if __name__ == "__main__":
    try:
        test_all_supervisor_actions()
    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到后端服务 (http://localhost:8012)")
        print("   请确保后端已启动")
    except Exception as e:
        print(f"❌ 测试出错：{e}")
