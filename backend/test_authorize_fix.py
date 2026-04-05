"""Test script to verify the authorize_main_task_execution fix"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'packages', 'harness'))

from datetime import datetime
from deerflow.collab.authorize_execution import authorize_main_task_execution
from deerflow.collab.storage import get_project_storage

def test_authorize_pending_task():
    """Test that pending tasks can now be authorized for execution"""
    storage = get_project_storage()
    
    # Create a test project with a pending task
    now = datetime.utcnow().isoformat() + "Z"
    project_data = {
        "id": "test-project-fix",
        "name": "Test Project for Fix Verification",
        "created_at": now,
        "tasks": [
            {
                "id": "test-task-pending",
                "name": "Test Task",
                "status": "pending",  # This is the key - status is "pending"
                "execution_authorized": False,
                "subtasks": [],
                "created_at": now,
            }
        ]
    }
    
    # Save the project
    if not storage.save_project(project_data):
        print("❌ Failed to save test project")
        return False
    
    print("✅ Test project created with pending task")
    
    # Try to authorize execution (this should now work with the fix)
    ok, msg = authorize_main_task_execution(storage, "test-task-pending", "test-user")
    
    if ok:
        print(f"✅ SUCCESS: Pending task can now be authorized! Message: {msg}")
        
        # Verify the task was updated
        project = storage.load_project("test-project-fix")
        task = project["tasks"][0]
        print(f"   Task status: {task['status']}")
        print(f"   execution_authorized: {task.get('execution_authorized')}")
        print(f"   authorized_by: {task.get('authorized_by')}")
        
        # Cleanup
        storage.delete_project("test-project-fix")
        print("   Test project cleaned up")
        
        return True
    else:
        print(f"❌ FAILED: {msg}")
        print("   The fix is NOT working - pending tasks still cannot be authorized")
        
        # Cleanup
        storage.delete_project("test-project-fix")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Testing authorize_main_task_execution fix")
    print("=" * 60)
    
    success = test_authorize_pending_task()
    
    print("=" * 60)
    if success:
        print("✅ FIX VERIFIED: The change allows pending tasks to be authorized")
    else:
        print("❌ FIX NOT WORKING: Backend may need to be restarted")
    print("=" * 60)
