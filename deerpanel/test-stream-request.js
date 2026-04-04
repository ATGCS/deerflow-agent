// 测试脚本：检查流式请求是否正常
const testStream = async () => {
  console.log('开始测试流式请求...')
  
  const threadId = 'test-' + Date.now()
  const body = {
    assistant_id: 'lead_agent',
    input: { 
      messages: [{ 
        role: 'user', 
        content: [{ type: 'text', text: '你好' }] 
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
      is_plan_mode: true,
      subagent_enabled: false,
      thread_id: threadId,
    }
  }
  
  console.log('发送请求...')
  const startTime = Date.now()
  
  try {
    const resp = await fetch(`/api/langgraph/threads/${threadId}/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    console.log('响应状态:', resp.status)
    console.log('响应时间:', Date.now() - startTime, 'ms')
    
    if (!resp.ok) {
      const text = await resp.text()
      console.error('错误:', text)
      return
    }
    
    if (!resp.body) {
      console.error('响应体为空')
      return
    }
    
    console.log('开始读取流...')
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventCount = 0
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('流结束，总事件数:', eventCount)
        break
      }
      
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      
      for (const part of parts) {
        eventCount++
        const lines = part.split('\n')
        let dataLine = ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            dataLine = line.slice(6)
          }
        }
        
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine)
            if (data.event === 'values') {
              console.log('Event', eventCount, '- values:', {
                title: data.data?.title,
                todos: data.data?.todos?.length || 0,
                messages: data.data?.messages?.length || 0,
              })
            } else {
              console.log('Event', eventCount, '-', data.event)
            }
          } catch (e) {
            console.log('Event', eventCount, '- 解析失败')
          }
        }
      }
    }
  } catch (error) {
    console.error('请求失败:', error)
  }
}

// 在浏览器控制台运行
testStream()
