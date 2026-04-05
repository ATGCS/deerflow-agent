"""Test the authorize execution API endpoint directly"""

import requests
import json

BASE_URL = "http://localhost:8012"

def test_authorize_pending_task():
    """Test authorizing a pending task via API"""
    
    # Step 1: Create a test task
    print("Step 1: Creating test task...")
    response = requests.post(
        f"{BASE_URL}/api/tasks",
        json={
            "name": "Test Pending Task",
            "description": "Testing if pending tasks can be authorized"
        }
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to create task: {response.status_code}")
        print(response.text)
        return False
    
    task_data = response.json()
    task_id = task_data.get('id')
    project_id = task_data.get('project_id')
    
    print(f"✅ Task created: ID={task_id}, Project={project_id}")
    print(f"   Status: {task_data.get('status')}")
    
    # Step 2: Try to authorize execution (this should work with the fix)
    print("\nStep 2: Attempting to authorize execution...")
    response = requests.post(
        f"{BASE_URL}/api/tasks/{task_id}/authorize-execution",
        json={"authorized_by": "test-user"}
    )
    
    print(f"Response Status: {response.status_code}")
    print(f"Response Body: {response.text}")
    
    if response.status_code == 200:
        print("\n✅ SUCCESS: Pending task can be authorized!")
        
        # Step 3: Verify task status
        response = requests.get(f"{BASE_URL}/api/tasks/{task_id}")
        if response.status_code == 200:
            task = response.json()
            print(f"   Task status: {task.get('status')}")
            print(f"   execution_authorized: {task.get('execution_authorized')}")
        
        # Cleanup
        print("\nCleaning up...")
        requests.delete(f"{BASE_URL}/api/tasks/{task_id}")
        print("✅ Test task deleted")
        
        return True
    else:
        print("\n❌ FAILED: Cannot authorize pending task")
        error_msg = response.json().get('detail', response.text)
        print(f"   Error: {error_msg}")
        
        # Check if error mentions 'pending'
        if 'pending' in error_msg.lower():
            print("\n⚠️  The backend is still using the old code!")
            print("   You need to restart the backend service.")
        
        # Cleanup
        print("\nCleaning up...")
        requests.delete(f"{BASE_URL}/api/tasks/{task_id}")
        
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Testing Authorize Execution API")
    print("=" * 60)
    
    try:
        success = test_authorize_pending_task()
        
        print("=" * 60)
        if success:
            print("✅ FIX VERIFIED: Backend allows pending task authorization")
        else:
            print("❌ FIX NOT WORKING: Backend needs to be restarted")
            print("\n📝 To restart the backend:")
            print("   1. Stop the current backend process")
            print("   2. Start it again with: cd backend && uv run python app/gateway/app.py")
        print("=" * 60)
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to backend at http://localhost:8012")
        print("   Please ensure the backend is running.")
    except Exception as e:
        print(f"❌ Error: {e}")
