"""Test workaround: Use PUT to change status, then start execution"""

import requests
import json

BASE_URL = "http://localhost:8012"

def print_step(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}\n")

def test_workaround():
    """Test the workaround: PUT -> planned, then authorize"""
    
    print_step("📋 测试绕过方案：PUT 更新状态 -> 授权执行")
    
    # Step 1: 创建任务
    print("1️⃣  创建任务...")
    response = requests.post(
        f"{BASE_URL}/api/tasks",
        json={
            "name": "Workaround Test Task",
            "description": "Testing PUT workaround to enable execution"
        }
    )
    
    if response.status_code != 200:
        print(f"❌ 创建任务失败：{response.status_code}")
        return False
    
    task = response.json()
    task_id = task.get('id')
    print(f"✅ 任务已创建：ID={task_id}")
    print(f"   初始状态：{task.get('status')}")
    
    # Step 2: 用 PUT 更新状态为 planned
    print_step("2️⃣  使用 PUT 更新任务状态为 planned")
    response = requests.put(
        f"{BASE_URL}/api/tasks/{task_id}",
        json={"status": "planned"}
    )
    
    if response.status_code != 200:
        print(f"❌ PUT 更新失败：{response.status_code}")
        print(f"   响应：{response.text}")
        return False
    
    updated_task = response.json()
    print(f"✅ 状态已更新：{updated_task.get('status')}")
    
    # Step 3: 授权执行
    print_step("3️⃣  调用 authorize-execution")
    response = requests.post(
        f"{BASE_URL}/api/tasks/{task_id}/authorize-execution",
        json={"authorized_by": "test-user"}
    )
    
    print(f"   响应状态：{response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        print(f"✅ 授权成功！")
        print(f"   消息：{result.get('message', 'N/A')}")
        
        # Step 4: 验证最终状态
        print_step("4️⃣  验证最终状态")
        response = requests.get(f"{BASE_URL}/api/tasks/{task_id}")
        if response.status_code == 200:
            task = response.json()
            print(f"   状态：{task.get('status')}")
            print(f"   execution_authorized: {task.get('execution_authorized')}")
            print(f"   authorized_by: {task.get('authorized_by')}")
            
        # Cleanup
        print_step("5️⃣  清理")
        response = requests.delete(f"{BASE_URL}/api/tasks/{task_id}")
        if response.status_code == 200:
            print(f"✅ 测试任务已删除")
        
        print_step("🎉 测试成功！绕过方案有效")
        return True
    else:
        print(f"❌ 授权失败：{response.status_code}")
        print(f"   响应：{response.text}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tasks/{task_id}")
        return False

if __name__ == "__main__":
    try:
        success = test_workaround()
        if success:
            print("\n" + "="*60)
            print("✅ 绕过方案验证成功！")
            print("="*60)
            print("\n使用流程：")
            print("1. 创建任务 (POST /api/tasks)")
            print("2. 更新状态为 planned (PUT /api/tasks/{id})")
            print("3. 授权执行 (POST /api/tasks/{id}/authorize-execution)")
            print("="*60)
        else:
            print("\n" + "="*60)
            print("❌ 绕过方案失败")
            print("="*60)
    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到后端服务 (http://localhost:8012)")
    except Exception as e:
        print(f"❌ 测试出错：{e}")
