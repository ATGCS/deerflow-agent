// 测试流式请求
async function testStream() {
  console.log('=== 开始测试流式请求 ===')
  
  const threadId = 'test-' + Date.now()
  const body = {
    assistant_id: 'lead_agent',
    input: { 
      messages: [{ 
        role: 'user', 
        content: [{ type: 'text', text: '你好，请简单回复' }] 
      }] 
    },
    stream_mode: ['values', 'messages-tuple'],
    streamSubgraphs: true,
    streamResumable: true,
    config: {
      recursion_limit: 1000,
    },
    context: {
      thinking_enabled: true,
      is_plan_mode: false,
      subagent_enabled: false,
      include_search: false,
      thread_id: threadId,
    }
  }
  
  console.log('线程 ID:', threadId)
  console.log('发送请求...')
  const startTime = Date.now()
  
  try {
    const resp = await fetch(`/api/langgraph/threads/${threadId}/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    console.log('\n✅ 响应状态:', resp.status)
    console.log('⏱️  首包时间:', Date.now() - startTime, 'ms')
    
    if (!resp.ok) {
      const text = await resp.text()
      console.error('❌ 错误:', text)
      return
    }
    
    if (!resp.body) {
      console.error('❌ 响应体为空')
      return
    }
    
    console.log('\n📡 开始读取流...')
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventCount = 0
    let messageCount = 0
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('\n✅ 流结束')
        console.log('📊 总事件数:', eventCount)
        console.log('📊 消息数:', messageCount)
        console.log('⏱️  总耗时:', Date.now() - startTime, 'ms')
        break
      }
      
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      
      for (const part of parts) {
        eventCount++
        const lines = part.split('\n')
        let dataLine = ''
        let eventName = ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            dataLine = line.slice(6)
          }
          if (line.startsWith('event: ')) {
            eventName = line.slice(7)
          }
        }
        
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine)
            if (data.event === 'values') {
              const msgs = data.data?.messages || []
              const aiMsgs = msgs.filter(m => m.role === 'ai')
              if (aiMsgs.length > 0) {
                messageCount += aiMsgs.length
                console.log(`📨 事件 ${eventCount} [${eventName || 'values'}]:`, {
                  title: data.data?.title || '-',
                  messages: msgs.length,
                  ai_messages: aiMsgs.length,
                })
              }
            } else if (data.event === 'messages-tuple') {
              console.log(`💬 事件 ${eventCount} [messages-tuple]:`, {
                type: data.data?.type,
                content_preview: data.data?.content?.slice(0, 50) + '...',
              })
            } else {
              console.log(`📝 事件 ${eventCount} [${eventName || data.event}]`)
            }
          } catch (e) {
            console.log(`📝 事件 ${eventCount} - 解析失败`)
          }
        }
      }
    }
  } catch (error) {
    console.error('\n❌ 请求失败:', error.message)
    console.error(error)
  }
}

// 在浏览器控制台运行
testStream()
