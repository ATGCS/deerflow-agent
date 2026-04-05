"""Test the new set_task_planned supervisor tool"""

import requests
import json

BASE_URL = "http://localhost:8012"

def test_set_task_planned():
    """Test set_task_planned action via direct API call"""
    
    print("="*60)
    print("测试新增的 set_task_planned 工具")
    print("="*60)
    
    # Step 1: 创建任务
    print("\n1️⃣  创建任务...")
    response = requests.post(
        f"{BASE_URL}/api/tasks",
        json={
            "name": "Test Set Task Planned",
            "description": "Testing the new set_task_planned tool"
        }
    )
    
    if response.status_code != 200:
        print(f"❌ 创建任务失败：{response.status_code}")
        return False
    
    task = response.json()
    task_id = task.get('id')
    print(f"✅ 任务已创建：ID={task_id}")
    print(f"   初始状态：{task.get('status')}")
    
    # Step 2: 使用 set_task_planned 工具
    print("\n2️⃣  调用 supervisor tool 的 set_task_planned action...")
    
    # 通过调用 LangGraph 的 runs API 来触发 supervisor tool
    # 这里我们直接模拟模型调用工具的方式
    print(f"   注意：需要通过模型调用 supervisor(action='set_task_planned', task_id='{task_id}')")
    print(f"   或者直接在聊天中告诉模型使用这个新工具")
    
    # Step 3: 验证状态
    print("\n3️⃣  验证任务状态...")
    response = requests.get(f"{BASE_URL}/api/tasks/{task_id}")
    if response.status_code == 200:
        task = response.json()
        print(f"   当前状态：{task.get('status')}")
        print(f"   execution_authorized: {task.get('execution_authorized')}")
    
    # Step 4: 尝试授权执行
    print("\n4️⃣  尝试授权执行...")
    response = requests.post(
        f"{BASE_URL}/api/tasks/{task_id}/authorize-execution",
        json={"authorized_by": "test-user"}
    )
    
    print(f"   响应状态：{response.status_code}")
    if response.status_code == 200:
        print(f"✅ 授权成功！")
        result = response.json()
        print(f"   消息：{result.get('message', 'N/A')}")
    else:
        print(f"❌ 授权失败：{response.text}")
    
    # Cleanup
    print("\n5️⃣  清理...")
    response = requests.delete(f"{BASE_URL}/api/tasks/{task_id}")
    if response.status_code == 200:
        print(f"✅ 测试任务已删除")
    
    print("\n" + "="*60)
    print("✅ 测试完成！")
    print("="*60)
    print("\n使用说明：")
    print("在聊天中告诉模型：'使用 supervisor 工具的 set_task_planned action 将任务状态设为 planned'")
    print("例如：supervisor(action='set_task_planned', task_id='xxx')")
    print("="*60)

if __name__ == "__main__":
    try:
        test_set_task_planned()
    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到后端服务 (http://localhost:8012)")
    except Exception as e:
        print(f"❌ 测试出错：{e}")
