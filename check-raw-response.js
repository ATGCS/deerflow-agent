// 检查原始 API 响应中的 token 数据
async function checkRawResponse() {
  try {
    // 获取最新的 state
    const response = await fetch('http://localhost:1420/api/langgraph/threads/d35722a6-2fae-438a-8b6c-a30c4ea86a76/state');
    const data = await response.json();
    
    // 获取最后一条消息（无论类型）
    const lastMessage = data.values?.messages?.[data.values.messages.length - 1];
    
    if (lastMessage) {
      console.log('=== Last Message Full Content ===');
      console.log('Type:', lastMessage.type);
      console.log('Full message:', JSON.stringify(lastMessage, null, 2));
      
      // 特别检查所有可能包含 token 的字段
      console.log('\n=== Token-related Fields ===');
      console.log('usage_metadata:', lastMessage.usage_metadata);
      console.log('additional_kwargs.usage:', lastMessage.additional_kwargs?.usage);
      console.log('additional_kwargs.usage_metadata:', lastMessage.additional_kwargs?.usage_metadata);
      console.log('response_metadata.usage:', lastMessage.response_metadata?.usage);
      console.log('response_metadata.usage_metadata:', lastMessage.response_metadata?.usage_metadata);
    }
    
  } catch (error) {
    console.error('检查失败:', error);
  }
}

checkRawResponse();
