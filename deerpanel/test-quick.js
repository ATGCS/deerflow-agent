/**
 * 快速测试脚本
 * 文件：deerpanel/test-quick.js
 * 
 * 在浏览器控制台执行此脚本进行快速功能验证
 * 使用方法：
 * 1. 打开 deerpanel 应用
 * 2. 打开浏览器开发者工具（F12）
 * 3. 在控制台粘贴此脚本并回车
 */

console.log('🧪 DeerFlow 快速测试脚本启动...\n')

// 测试计数器
let totalTests = 0
let passedTests = 0
let failedTests = 0

/**
 * 断言函数
 */
function assert(condition, message) {
  totalTests++
  if (condition) {
    passedTests++
    console.log(`✅ ${message}`)
  } else {
    failedTests++
    console.error(`❌ ${message}`)
  }
}

/**
 * 异步测试
 */
async function runTests() {
  console.log('📋 开始执行测试...\n')
  
  // ========== Test 1: 检查全局对象 ==========
  console.log('=== 测试套件 1: 环境检查 ===')
  
  assert(
    typeof tasksAPI !== 'undefined',
    'Test 1.1: tasksAPI 已定义'
  )
  
  assert(
    typeof EventStreamManager !== 'undefined',
    'Test 1.2: EventStreamManager 已定义'
  )
  
  assert(
    typeof FloatingTaskPanel !== 'undefined',
    'Test 1.3: FloatingTaskPanel 已定义'
  )
  
  assert(
    typeof EmbeddedTaskDashboard !== 'undefined',
    'Test 1.4: EmbeddedTaskDashboard 已定义'
  )
  
  assert(
    typeof TaskConversationPanel !== 'undefined',
    'Test 1.5: TaskConversationPanel 已定义'
  )
  
  assert(
    typeof StatePersistence !== 'undefined',
    'Test 1.6: StatePersistence 已定义'
  )
  
  console.log('')
  
  // ========== Test 2: API 客户端 ==========
  console.log('=== 测试套件 2: API 客户端 ===')
  
  try {
    const tasks = await tasksAPI.listTasks()
    assert(Array.isArray(tasks), 'Test 2.1: listTasks 返回数组')
    console.log(`   获取到 ${tasks.length} 个任务`)
  } catch (error) {
    assert(false, `Test 2.1: listTasks 失败 - ${error.message}`)
  }
  
  try {
    // 测试错误处理
    await tasksAPI.getTask('non-existent-id')
    assert(false, 'Test 2.2: getTask 应该抛出 404 错误')
  } catch (error) {
    assert(
      error.message.includes('404') || error.message.includes('not found'),
      'Test 2.2: getTask 错误处理正常'
    )
  }
  
  console.log('')
  
  // ========== Test 3: 状态持久化 ==========
  console.log('=== 测试套件 3: 状态持久化 ===')
  
  try {
    const testTasks = [
      { id: 'test-1', status: 'executing', progress: 50 },
      { id: 'test-2', status: 'completed', progress: 100 }
    ]
    
    await StatePersistence.saveTasks(testTasks)
    assert(true, 'Test 3.1: saveTasks 执行成功')
    
    const restored = await StatePersistence.restoreTasks()
    assert(
      restored !== null && restored.length === 2,
      'Test 3.2: restoreTasks 恢复成功'
    )
    
    // 清除测试数据
    StatePersistence.clearTasksCache()
    assert(true, 'Test 3.3: clearTasksCache 清除成功')
  } catch (error) {
    assert(false, `Test 3: 状态持久化失败 - ${error.message}`)
  }
  
  console.log('')
  
  // ========== Test 4: 样式检查 ==========
  console.log('=== 测试套件 4: 样式检查 ===')
  
  const styles = document.styleSheets
  let hasTaskStyles = false
  
  try {
    for (let sheet of styles) {
      try {
        const rules = sheet.cssRules || sheet.rules
        for (let rule of rules) {
          if (rule.selectorText && rule.selectorText.includes('task-')) {
            hasTaskStyles = true
            break
          }
        }
      } catch (e) {
        // 跨域样式表无法访问
      }
    }
    assert(hasTaskStyles, 'Test 4.1: 任务组件样式已加载')
  } catch (error) {
    assert(false, `Test 4: 样式检查失败 - ${error.message}`)
  }
  
  console.log('')
  
  // ========== Test 5: DOM 元素 ==========
  console.log('=== 测试套件 5: DOM 元素 ===')
  
  // 检查是否有任务相关元素
  const taskElements = document.querySelectorAll('[class*="task-"]')
  assert(
    taskElements.length > 0,
    `Test 5.1: 页面中有 ${taskElements.length} 个任务相关元素`
  )
  
  console.log('')
  
  // ========== 测试结果汇总 ==========
  console.log('\n📊 测试结果汇总')
  console.log('=' .repeat(50))
  console.log(`总测试数：${totalTests}`)
  console.log(`✅ 通过：${passedTests}`)
  console.log(`❌ 失败：${failedTests}`)
  console.log(`通过率：${((passedTests / totalTests) * 100).toFixed(1)}%`)
  console.log('=' .repeat(50))
  
  if (failedTests === 0) {
    console.log('\n🎉 所有测试通过！系统运行正常！')
  } else {
    console.log(`\n⚠️ 有 ${failedTests} 个测试失败，请检查错误信息`)
  }
  
  // 返回测试结果
  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    successRate: ((passedTests / totalTests) * 100).toFixed(1)
  }
}

// ========== 执行测试 ==========
runTests().then(results => {
  console.log('\n📋 详细测试结果:', results)
  
  // 如果有失败，输出调试信息
  if (results.failed > 0) {
    console.log('\n🔍 调试建议:')
    console.log('1. 检查后端服务是否运行 (http://localhost:8000)')
    console.log('2. 检查网络连接是否正常')
    console.log('3. 检查浏览器控制台是否有其他错误')
    console.log('4. 查看测试计划文档获取更多测试用例')
  }
  
  // 返回结果给调用者
  return results
}).catch(error => {
  console.error('💥 测试执行失败:', error)
  return {
    total: totalTests,
    passed: 0,
    failed: totalTests,
    successRate: 0,
    error: error.message
  }
})
