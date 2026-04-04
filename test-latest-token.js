// 测试最新的 AI 消息
async function testLatestMessage() {
  try {
    const response = await fetch('http://localhost:1420/api/langgraph/threads/d35722a6-2fae-438a-8b6c-a30c4ea86a76/state');
    const data = await response.json();
    
    const messages = data.values?.messages || [];
    const aiMessages = messages.filter(m => m.type === 'ai');
    
    console.log('Total AI messages:', aiMessages.length);
    
    // 查看最后 3 条 AI 消息
    const last3 = aiMessages.slice(-3);
    last3.forEach((msg, i) => {
      console.log(`\n=== Last AI Message ${i + 1} ===`);
      console.log('Content preview:', msg.content?.substring(0, 100));
      console.log('usage_metadata:', JSON.stringify(msg.usage_metadata, null, 2));
      console.log('response_metadata:', JSON.stringify(msg.response_metadata, null, 2));
    });
    
    // 检查是否有 model_name 为 kimi-k2.5 的最新消息
    const latestKimi = aiMessages.reverse().find(m => 
      m.response_metadata?.model_name === 'kimi-k2.5'
    );
    
    if (latestKimi) {
      console.log('\n=== Latest Kimi Message ===');
      console.log('Has usage_metadata?', latestKimi.usage_metadata !== null);
      console.log('usage_metadata value:', latestKimi.usage_metadata);
    }
    
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testLatestMessage();
