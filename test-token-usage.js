// 测试 token 数据流程
async function testTokenUsage() {
  try {
    // 1. 获取线程状态
    const response = await fetch('http://localhost:1420/api/langgraph/threads/d35722a6-2fae-438a-8b6c-a30c4ea86a76/state');
    const data = await response.json();
    
    console.log('=== 完整的 State 数据 ===');
    console.log('State keys:', Object.keys(data));
    console.log('Values keys:', Object.keys(data.values || {}));
    
    const messages = data.values?.messages || [];
    console.log('\n=== 消息统计 ===');
    console.log('Total messages:', messages.length);
    
    // 找 AI 消息
    const aiMessages = messages.filter(m => m.type === 'ai');
    console.log('AI messages:', aiMessages.length);
    
    if (aiMessages.length > 0) {
      const firstAi = aiMessages[0];
      console.log('\n=== 第一条 AI 消息 ===');
      console.log('Message keys:', Object.keys(firstAi));
      console.log('usage_metadata:', firstAi.usage_metadata);
      console.log('response_metadata:', firstAi.response_metadata);
      
      // 检查所有 AI 消息的 usage_metadata
      console.log('\n=== 所有 AI 消息的 usage_metadata ===');
      aiMessages.forEach((msg, i) => {
        console.log(`AI Message ${i}: usage_metadata =`, msg.usage_metadata);
      });
    }
    
    // 检查是否有其他字段包含 token 数据
    console.log('\n=== 搜索 token 相关字段 ===');
    const allKeys = new Set();
    messages.forEach((msg, i) => {
      Object.keys(msg).forEach(key => {
        if (key.toLowerCase().includes('token') || key.toLowerCase().includes('usage')) {
          allKeys.add(key);
        }
      });
    });
    console.log('Found token/usage related keys:', Array.from(allKeys));
    
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testTokenUsage();
