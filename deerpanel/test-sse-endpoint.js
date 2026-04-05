/**
 * 测试 SSE 事件流连接
 * 使用方法：在浏览器控制台运行
 */

// 测试不同的端口
const ports = [8000, 8012, 1423, 2024];
const projectId = 'main';

console.log('====== 开始测试 SSE 端点 ======');

ports.forEach(port => {
  const url = `http://localhost:${port}/api/events/projects/${projectId}/stream`;
  console.log(`\n测试端口 ${port}: ${url}`);
  
  const es = new EventSource(url);
  
  es.onopen = () => {
    console.log(`✅ 端口 ${port} 连接成功！`);
    console.log('   readyState:', es.readyState);
    console.log('   URL:', es.url);
    es.close();
  };
  
  es.onerror = (err) => {
    console.log(`❌ 端口 ${port} 连接失败:`, err);
    if (err.target?.readyState === EventSource.CLOSED) {
      console.log('   错误：连接已关闭');
    } else if (err.target?.readyState === EventSource.CONNECTING) {
      console.log('   错误：正在重连');
    } else {
      console.log('   HTTP 状态：', err);
    }
    es.close();
  };
  
  // 5 秒后超时
  setTimeout(() => {
    if (es.readyState === EventSource.CONNECTING) {
      console.log(`⏱️ 端口 ${port} 超时，关闭连接`);
      es.close();
    }
  }, 5000);
});

console.log('\n等待连接结果...');
