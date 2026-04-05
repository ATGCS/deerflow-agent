"""快速测试：验证 pending 状态的任务能否被授权"""
import requests

BASE_URL = "http://localhost:8012"

# 创建任务
response = requests.post(f"{BASE_URL}/api/tasks", json={
    "name": "Test Pending Auth",
    "description": "Testing if pending task can be authorized"
})

if response.status_code != 200:
    print(f"❌ 创建任务失败：{response.status_code}")
    exit(1)

task = response.json()
task_id = task['id']
print(f"✅ 任务已创建：{task_id}")
print(f"   状态：{task.get('status')}")

# 尝试授权执行
response = requests.post(f"{BASE_URL}/api/tasks/{task_id}/authorize-execution", json={
    "authorized_by": "test"
})

print(f"\n📌 授权执行结果:")
print(f"   状态码：{response.status_code}")

if response.status_code == 200:
    result = response.json()
    print(f"   ✅ 授权成功！")
    print(f"   消息：{result.get('message', 'N/A')}")
else:
    error = response.text
    print(f"   ❌ 授权失败")
    print(f"   错误：{error}")
    
    if "'pending'" in error:
        print(f"\n⚠️  后端还在使用旧代码！allowed_status 不包含 'pending'")
    else:
        print(f"\n⚠️  其他错误")

# 清理
requests.delete(f"{BASE_URL}/api/tasks/{task_id}")

print("\n" + "="*60)
if response.status_code == 200:
    print("✅ 修复验证成功！pending 状态的任务可以被授权")
else:
    print("❌ 修复未生效，需要进一步检查")
print("="*60)
