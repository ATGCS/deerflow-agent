// ==UserScript==
// @name         Boss直聘AI助理
// @namespace    http://tampermonkey.net/
// @version      4.2
// @description  自动监控Boss直聘消息，AI助理自动回复
// @author       OpenClaw
// @match        https://www.zhipin.com/web/geek/chat*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=zhipin.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlhttpRequest
// @connect      dashscope.aliyuncs.com
// @connect      api.day.app
// @connect      121.199.76.208
// @connect      www.googleapis.com
// @updateURL    http://121.199.76.208/boss_auto_greet.user.js
// @downloadURL  http://121.199.76.208/boss_auto_greet.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 兼容 Tampermonkey 和 ScriptCat
    const xhr = (typeof GM_xmlhttpRequest !== 'undefined') ? GM_xmlhttpRequest : 
                (typeof GM !== 'undefined' && GM.xmlhttpRequest) ? GM.xmlhttpRequest : null;

    // ============ 配置区域 ============
    const CONFIG = {
        apiKey: 'sk-22118c56659647e39ba847253e671062',
        barkUrl: 'https://api.day.app/BMtjb8EnZjV6qsRH4pgaqY/',
        ownerName: '陈致成',
        checkInterval: 5000,
        autoReply: true,
        replyDelayMin: 2000,
        replyDelayMax: 5000,
        apiBaseUrl: 'http://121.199.76.208/hr_api.php',
        googleApiKey: '1c58b249fc64bd1183c1075c8a9f81e142d197096c384ffe0e3bc096932c8847',
        googleSearchEngineId: '76f2ac689721246ad'
    };
    
    // 简历信息
    const RESUME = {
        name: '陈致成',
        title: 'AI自动化解决方案工程师',
        position: '项目制 / 驻场 / 远程合作',
        phone: '18611101221',
        email: 'ccf4@vip.qq.com',
        location: '深圳',
        experience: '15年互联网技术经验',
        summary: '专注于AI自动化解决方案与企业流程优化，擅长基于OpenClaw构建自动化系统',
        skills: [
            'AI Agent开发（OpenClaw Skills定制）',
            '企业自动化系统设计（RPA + AI）',
            '浏览器自动化（Playwright / Selenium）',
            '数据采集与处理（爬虫 / API）',
            'AI内容生成与自动化流程',
            '系统集成（n8n / API / SaaS）'
        ],
        services: [
            'AI自动化系统开发（企业级）',
            'OpenClaw Skills定制开发',
            '招聘/电商/运营自动化解决方案',
            '数据采集与分析系统',
            '社媒自动化营销系统',
            'AI内容生产系统'
        ],
        projects: [
            'AI招聘自动化系统 - 效率提升70%+',
            '跨境电商自动化运营系统 - 上架效率提升5倍',
            '社媒自动化营销系统',
            'AI视频内容生产系统'
        ],
        techStack: 'OpenClaw / Python / Playwright / n8n / Selenium / API集成'
    };
    // ================================

    let isMonitoring = false;
    let monitorInterval = null;
    let conversationHistory = {};
    let processedChats = new Set();
    
    // ===== API 调用函数 =====
    
    // 获取HR状态
    function apiGetStatus(hrId) {
        return new Promise((resolve) => {
            if (!xhr) { resolve({ has_introduced: false }); return; }
            xhr({
                method: 'GET',
                url: `${CONFIG.apiBaseUrl}?action=get_status&hr_id=${encodeURIComponent(hrId)}`,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        resolve(data.success ? data.data : { has_introduced: false });
                    } catch (e) {
                        resolve({ has_introduced: false });
                    }
                },
                onerror: () => resolve({ has_introduced: false })
            });
        });
    }
    
    // 获取对话历史
    function apiGetHistory(hrId) {
        return new Promise((resolve) => {
            if (!xhr) { resolve([]); return; }
            xhr({
                method: 'GET',
                url: `${CONFIG.apiBaseUrl}?action=get_history&hr_id=${encodeURIComponent(hrId)}`,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.success && data.data.messages) {
                            resolve(data.data.messages);
                        } else {
                            resolve([]);
                        }
                    } catch (e) {
                        resolve([]);
                    }
                },
                onerror: () => resolve([])
            });
        });
    }
    
    // 保存消息到服务器
    function apiSaveMessage(hrId, hrName, role, content) {
        return new Promise((resolve) => {
            if (!xhr) { resolve(false); return; }
            xhr({
                method: 'POST',
                url: `${CONFIG.apiBaseUrl}?action=save_message`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    hr_id: hrId,
                    hr_name: hrName,
                    role: role,
                    content: content
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.success) {
                            addLog('数据已保存到服务器');
                        } else {
                            addLog('保存失败: ' + data.error, 'error');
                        }
                    } catch (e) {}
                    resolve(true);
                },
                onerror: () => resolve(false)
            });
        });
    }
    
    // 标记已表明身份
    function apiSetIntroduced(hrId) {
        return new Promise((resolve) => {
            if (!xhr) { resolve(false); return; }
            xhr({
                method: 'POST',
                url: `${CONFIG.apiBaseUrl}?action=set_introduced`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ hr_id: hrId }),
                onload: () => resolve(true),
                onerror: () => resolve(false)
            });
        });
    }
    
    // Google 搜索公司信息
    function searchCompany(companyName) {
        return new Promise((resolve) => {
            if (!companyName || companyName.length < 2 || !xhr) {
                resolve('');
                return;
            }
            
            const query = encodeURIComponent(companyName + ' 公司 简介');
            const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.googleApiKey}&cx=${CONFIG.googleSearchEngineId}&q=${query}&num=3`;
            
            xhr({
                method: 'GET',
                url: url,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.items && data.items.length > 0) {
                            const results = data.items.slice(0, 3).map(item => {
                                return `${item.title}: ${item.snippet}`;
                            }).join('\n');
                            resolve(results);
                        } else {
                            resolve('');
                        }
                    } catch (e) {
                        resolve('');
                    }
                },
                onerror: () => resolve('')
            });
        });
    }
    
    // 发送简历
    async function sendResume() {
        try {
            // 点击"发简历"按钮
            const resumeBtn = document.querySelector('.toolbar-btn');
            if (resumeBtn && resumeBtn.textContent.includes('发简历')) {
                addLog('检测到简历请求，点击发简历');
                resumeBtn.click();
                
                // 延迟1秒点击确定
                await randomDelay(1000, 1500);
                
                const confirmBtn = document.querySelector('.panel-resume .btn-sure-v2');
                if (confirmBtn) {
                    confirmBtn.click();
                    addLog('已确认发送简历');
                    sendBarkNotification('已发送简历', '简历已发送给HR');
                    return true;
                } else {
                    addLog('未找到确认按钮', 'error');
                }
            }
        } catch (e) {
            addLog('发送简历失败: ' + e.message, 'error');
        }
        return false;
    }

    // ================================

    function randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    // 发送Bark推送
    function sendBarkNotification(title, message) {
        const url = CONFIG.barkUrl + encodeURIComponent(title) + '/' + encodeURIComponent(message);
        if (!xhr) return;
        xhr({
            method: 'GET',
            url: url,
            onload: () => addLog('Bark推送已发送'),
            onerror: () => addLog('Bark推送失败', 'error')
        });
    }

    // 弹窗处理中标记
    let popoverProcessing = false;

    // 检查并处理弹窗（微信交换、简历请求等）
    async function checkWechatExchange() {
        if (popoverProcessing) return false;
        
        let agreeBtn = document.querySelector('.respond-popover .btn-agree');
        if (!agreeBtn) agreeBtn = document.querySelector('.respond-popover .op .btn-agree');
        if (!agreeBtn) agreeBtn = document.querySelector('span.btn-agree');
        
        const popover = document.querySelector('.respond-popover');
        if (popover && agreeBtn) {
            const textEl = popover.querySelector('.text');
            const text = textEl ? textEl.textContent : '';
            
            // 检查是否是微信交换弹窗
            if (text.includes('微信')) {
                popoverProcessing = true;
                addLog('检测到交换微信请求');
                
                agreeBtn.click();
                addLog('已点击同意交换微信');
                
                await randomDelay(1000, 1500);
                
                const wechatElements = document.querySelectorAll('.last-msg-text');
                let wechatId = '';
                for (const el of wechatElements) {
                    const txt = el.textContent;
                    if (txt.includes('微信号') || txt.includes('微信：') || txt.includes('WeChat')) {
                        const match = txt.match(/微信号[：:]\s*([a-zA-Z0-9_-]+)/) || 
                                      txt.match(/微信[：:]\s*([a-zA-Z0-9_-]+)/) ||
                                      txt.match(/WeChat[：:]\s*([a-zA-Z0-9_-]+)/);
                        if (match) { wechatId = match[1]; break; }
                    }
                }
                
                if (wechatId) {
                    sendBarkNotification('已添加微信', `微信号: ${wechatId}`);
                    addLog(`微信号: ${wechatId}`, 'reply');
                } else {
                    sendBarkNotification('已同意交换微信', '请查看聊天记录');
                }
                
                setTimeout(() => { popoverProcessing = false; }, 3000);
                return true;
            }
            
            // 检查是否是简历请求弹窗
            if (text.includes('简历')) {
                popoverProcessing = true;
                addLog('检测到简历请求');
                
                agreeBtn.click();
                addLog('已点击同意发送简历');
                
                sendBarkNotification('已同意发送简历', '请查看聊天记录');
                
                setTimeout(() => { popoverProcessing = false; }, 3000);
                return true;
            }
            
            // 其他弹窗不处理
            return false;
        }
        return false;
    }

    // MutationObserver 实时监听微信交换弹窗
    function setupWechatObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList && node.classList.contains('respond-popover')) {
                            addLog('MutationObserver检测到弹窗');
                            checkWechatExchange();
                            return;
                        }
                        const popover = node.querySelector ? node.querySelector('.respond-popover') : null;
                        if (popover) {
                            addLog('MutationObserver检测到弹窗(子元素)');
                            checkWechatExchange();
                            return;
                        }
                    }
                }
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        addLog('微信弹窗监听已启动');
        return observer;
    }

    // 获取当前对话的HR信息
    function getHRInfo() {
        const info = { hrName: '', company: '', hrTitle: '', position: '', salary: '' };
        
        try {
            // HR名称
            const nameEl = document.querySelector('.name-text');
            if (nameEl) info.hrName = nameEl.textContent.trim();
            
            // 公司名称 - 在name-content后面的兄弟span
            const nameContent = document.querySelector('.name-content');
            if (nameContent && nameContent.parentElement) {
                const spans = nameContent.parentElement.querySelectorAll(':scope > span');
                for (const span of spans) {
                    const txt = span.textContent.trim();
                    if (txt && !span.classList.contains('name-text') && txt !== info.hrName) {
                        info.company = txt;
                        break;
                    }
                }
            }
            
            // 如果上面没找到，尝试从base-info获取
            if (!info.company) {
                const baseInfo = document.querySelector('.base-info');
                if (baseInfo) {
                    const spans = baseInfo.querySelectorAll('span');
                    for (const span of spans) {
                        const txt = span.textContent.trim();
                        if (txt && !txt.includes(info.hrName) && !span.classList.contains('base-title') && !span.classList.contains('name-text')) {
                            info.company = txt;
                            break;
                        }
                    }
                    const titleEl = baseInfo.querySelector('.base-title');
                    if (titleEl) info.hrTitle = titleEl.textContent.trim();
                }
            } else {
                // HR岗位从base-info获取
                const baseInfo = document.querySelector('.base-info');
                if (baseInfo) {
                    const titleEl = baseInfo.querySelector('.base-title');
                    if (titleEl) info.hrTitle = titleEl.textContent.trim();
                }
            }
            
            const posNameEl = document.querySelector('.position-name');
            if (posNameEl) info.position = posNameEl.textContent.trim();
            
            const salaryEl = document.querySelector('.salary');
            if (salaryEl) info.salary = salaryEl.textContent.trim();
            
            addLog(`HR信息: 名称=${info.hrName}, 公司=${info.company}`);
        } catch (e) {
            addLog('获取HR信息失败: ' + e.message, 'error');
        }
        
        return info;
    }

    // 调用AI API
    async function callAI(message, chatId, hrName, hrInfo) {
        const status = await apiGetStatus(chatId);
        // 新HR(exists=false) 或 未介绍过的HR(has_introduced!=1) 都需要介绍
        const hasIntroduced = status.exists !== false && status.has_introduced == 1;
        addLog(`chatId: ${chatId}, hasIntroduced: ${hasIntroduced}`);
        
        let companyInfo = '';
        if (hrInfo.company && hrInfo.company.length >= 2) {
            addLog(`搜索公司: ${hrInfo.company}`);
            companyInfo = await searchCompany(hrInfo.company);
            if (companyInfo) addLog('获取到公司信息');
        }
        
        const servicesList = `【服务领域】
- AI自动化系统开发（企业级）
- OpenClaw Skills定制开发
- 招聘/电商/运营自动化解决方案
- 数据采集与分析系统
- 社媒自动化营销系统
- AI内容生产系统`;

        let hrContext = '';
        if (hrInfo.company) {
            hrContext = `\n\n【当前对话HR信息】
- HR称呼：${hrInfo.hrName || '未知'}
- 公司名称：${hrInfo.company}
- HR岗位：${hrInfo.hrTitle || '未知'}
- 招聘职位：${hrInfo.position || '未知'}
- 薪资范围：${hrInfo.salary || '未知'}`;
            if (companyInfo) hrContext += `\n\n【公司背景信息】\n${companyInfo}`;
            hrContext += `\n\n请根据公司信息分析业务方向，推荐合适服务。回复时用尊称。`;
        }

        const systemPromptFirst = `你是陈致成的OpenClaw助理，正在帮他接单和沟通项目。

【关于陈致成】
AI自动化解决方案工程师 / AI Agent开发（OpenClaw）
- 15年互联网技术经验
- 专注AI自动化解决方案与企业流程优化
- 擅长基于OpenClaw构建"可交互、可修改、可扩展"的自动化系统
- 目前位置：深圳
- 合作方式：项目制 / 驻场 / 远程合作

${servicesList}

【核心能力】
- AI Agent开发（OpenClaw Skills定制）
- 企业自动化系统设计（RPA + AI）
- 浏览器自动化（Playwright / Selenium）
- 数据采集与处理
- 系统集成（n8n / API / SaaS）

【项目经验】
- AI招聘自动化系统：效率提升70%+
- 跨境电商自动化运营系统：上架效率提升5倍
- 社媒自动化营销系统
- AI视频内容生产系统

【回复规则 - 重要】
1. 绝对不要在聊天中发送任何联系方式，会被平台封号
2. 如需进一步沟通，引导HR点击"交换微信"按钮
3. 第一次回复需表明身份：例如"你好${hrInfo.hrName ? '，' + hrInfo.hrName : ''}，我是陈致成的OpenClaw助理"
4. 用尊称称呼对方
5. 幽默风趣但简洁，展现专业能力
6. 根据公司业务推荐合适的服务
7. 不用emoji和花哨符号${hrContext}`;

        const systemPromptContinue = `你是陈致成的OpenClaw助理，正在帮他接单和沟通项目。

【关于陈致成】
AI自动化解决方案工程师 / AI Agent开发（OpenClaw）
- 15年互联网技术经验
- 擅长基于OpenClaw构建自动化系统
- 合作方式：项目制 / 驻场 / 远程合作

${servicesList}

【核心能力】
- AI Agent开发（OpenClaw Skills定制）
- 企业自动化系统设计（RPA + AI）
- 浏览器自动化 / 数据采集 / 系统集成

【回复规则 - 重要】
1. 绝对不要在聊天中发送任何联系方式，会被平台封号
2. 如需进一步沟通，引导HR点击"交换微信"按钮
3. 用尊称称呼对方
4. 幽默风趣但简洁，展现专业能力
5. 根据公司业务推荐合适的服务
6. 不再说"我是OpenClaw助理"
7. 不用emoji和花哨符号${hrContext}`;

        let messages = [{ role: 'system', content: hasIntroduced ? systemPromptContinue : systemPromptFirst }];
        
        const history = await apiGetHistory(chatId);
        if (history && history.length > 0) {
            const recentHistory = history.slice(-18);
            for (const msg of recentHistory) {
                if (msg.role !== 'system') messages.push({ role: msg.role, content: msg.content });
            }
        }
        
        messages.push({ role: 'user', content: message });
        await apiSaveMessage(chatId, hrName, 'user', message);

        return new Promise((resolve, reject) => {
            xhr({
                method: 'POST',
                url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CONFIG.apiKey}`
                },
                data: JSON.stringify({
                    model: 'qwen-plus',
                    messages: messages,
                    max_tokens: 500
                }),
                onload: async function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.choices && data.choices[0]) {
                            const reply = data.choices[0].message.content;
                            await apiSaveMessage(chatId, hrName, 'assistant', reply);
                            resolve(reply);
                        } else {
                            addLog('API错误: ' + JSON.stringify(data), 'error');
                            reject(new Error('API返回格式错误'));
                        }
                    } catch (e) {
                        addLog('解析错误: ' + e.message, 'error');
                        reject(e);
                    }
                },
                onerror: function(error) {
                    addLog('请求失败', 'error');
                    reject(error);
                }
            });
        });
    }

    // 创建控制面板
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'boss-ai-panel';
        panel.innerHTML = `
            <style>
                #boss-ai-panel {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    background: #fff;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 15px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    z-index: 10000;
                    min-width: 320px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                #boss-ai-panel h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #333;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                #boss-ai-panel .status-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: #ccc;
                }
                #boss-ai-panel .status-dot.active {
                    background: #00c777;
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.1); }
                }
                #boss-ai-panel .status {
                    font-size: 12px;
                    color: #666;
                    margin-bottom: 10px;
                    padding: 8px;
                    background: #f5f5f5;
                    border-radius: 4px;
                }
                #boss-ai-panel .log {
                    font-size: 11px;
                    color: #333;
                    margin-bottom: 10px;
                    padding: 8px;
                    background: #fafafa;
                    border-radius: 4px;
                    max-height: 180px;
                    overflow-y: auto;
                    font-family: monospace;
                    border: 1px solid #eee;
                }
                #boss-ai-panel .log-item {
                    margin: 4px 0;
                    padding: 3px 0;
                    border-bottom: 1px solid #eee;
                }
                #boss-ai-panel .log-item:last-child { border-bottom: none; }
                #boss-ai-panel .log-item.reply { color: #00c777; }
                #boss-ai-panel .log-item.error { color: #ff4d4f; }
                #boss-ai-panel button {
                    width: 100%;
                    padding: 8px 15px;
                    margin: 5px 0;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    transition: background 0.2s;
                }
                #boss-ai-panel .btn-start { background: #00c777; color: white; }
                #boss-ai-panel .btn-start:hover { background: #00b368; }
                #boss-ai-panel .btn-stop { background: #ff4d4f; color: white; }
                #boss-ai-panel .btn-test { background: #1890ff; color: white; }
                #boss-ai-panel .btn-clear { background: #faad14; color: white; }
                #boss-ai-panel .btn-close { background: #f0f0f0; color: #333; }
                #boss-ai-panel .toggle-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin: 8px 0;
                    font-size: 12px;
                }
                #boss-ai-panel .toggle-switch {
                    width: 44px;
                    height: 22px;
                    background: #ccc;
                    border-radius: 11px;
                    cursor: pointer;
                    position: relative;
                    transition: background 0.2s;
                }
                #boss-ai-panel .toggle-switch.active { background: #00c777; }
                #boss-ai-panel .toggle-switch::after {
                    content: '';
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 18px;
                    height: 18px;
                    background: white;
                    border-radius: 50%;
                    transition: left 0.2s;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                }
                #boss-ai-panel .toggle-switch.active::after { left: 24px; }
            </style>
            <h3><span class="status-dot" id="status-dot"></span>Boss AI助理 v4.2</h3>
            <div class="status" id="ai-status">状态: 未启动</div>
            <div class="log" id="ai-log"><div class="log-item">等待启动...</div></div>
            <div class="toggle-row">
                <label>自动回复</label>
                <div class="toggle-switch active" id="auto-reply-toggle"></div>
            </div>
            <button class="btn-test" id="btn-test">测试：检查未读消息</button>
            <button class="btn-start" id="btn-start">开始监控</button>
            <button class="btn-stop" id="btn-stop">停止监控</button>
            <button class="btn-clear" id="btn-clear">清除处理记录</button>
            <button class="btn-close" id="btn-close">关闭面板</button>
        `;
        document.body.appendChild(panel);

        document.getElementById('btn-start').addEventListener('click', startMonitoring);
        document.getElementById('btn-stop').addEventListener('click', stopMonitoring);
        document.getElementById('btn-close').addEventListener('click', () => panel.style.display = 'none');
        document.getElementById('btn-test').addEventListener('click', testChatList);
        document.getElementById('btn-clear').addEventListener('click', () => {
            processedChats.clear();
            conversationHistory = {};
            addLog('已清除所有记录');
        });
        document.getElementById('auto-reply-toggle').addEventListener('click', function() {
            this.classList.toggle('active');
            CONFIG.autoReply = this.classList.contains('active');
            addLog('自动回复: ' + (CONFIG.autoReply ? '开启' : '关闭'));
        });
    }

    function addLog(text, type = 'normal') {
        const logEl = document.getElementById('ai-log');
        if (logEl) {
            const time = new Date().toLocaleTimeString();
            const item = document.createElement('div');
            item.className = 'log-item' + (type === 'reply' ? ' reply' : '') + (type === 'error' ? ' error' : '');
            item.textContent = `[${time}] ${text}`;
            logEl.appendChild(item);
            logEl.scrollTop = logEl.scrollHeight;
            while (logEl.children.length > 30) logEl.removeChild(logEl.firstChild);
        }
        console.log('[Boss AI助理]', text);
    }

    function updateStatus(text) {
        const statusEl = document.getElementById('ai-status');
        if (statusEl) statusEl.textContent = '状态: ' + text;
    }

    async function testChatList() {
        addLog('=== 测试开始 ===');
        const agreeBtn = document.querySelector('.respond-popover .btn-agree');
        if (agreeBtn) addLog('检测到交换微信弹窗');
        
        const chatItems = document.querySelectorAll('li[role="listitem"]');
        addLog(`找到 ${chatItems.length} 个聊天项`);
        
        for (let i = 0; i < Math.min(chatItems.length, 10); i++) {
            const item = chatItems[i];
            const noticeBadge = item.querySelector('.notice-badge');
            const hasUnread = noticeBadge !== null;
            const nameEl = item.querySelector('.name-text');
            const name = nameEl ? nameEl.textContent : '未知';
            const lastMsgEl = item.querySelector('.last-msg-text');
            const lastMsg = lastMsgEl ? lastMsgEl.textContent.substring(0, 25) : '无消息';
            
            if (hasUnread) addLog(`${i+1}. ${name}: 未读 ✓`);
            else addLog(`${i+1}. ${name}: "${lastMsg}..."`);
        }
        addLog('=== 测试结束 ===');
    }

    async function checkUnreadMessages() {
        try {
            const wechatHandled = await checkWechatExchange();
            if (wechatHandled) return;
            
            const chatItems = document.querySelectorAll('li[role="listitem"]');
            
            for (const item of chatItems) {
                const noticeBadge = item.querySelector('.notice-badge');
                const hasUnread = noticeBadge !== null;
                
                const nameEl = item.querySelector('.name-text');
                const name = nameEl ? nameEl.textContent : '';
                
                // 从列表项获取公司名称
                const companyEl = item.querySelector('.company-text') || item.querySelector('.info-labels span');
                const company = companyEl ? companyEl.textContent.trim() : '';
                
                // 用HR名称+公司名称作为唯一标识
                const chatId = `hr_${name}_${company}`;
                
                const lastMsgEl = item.querySelector('.last-msg-text');
                const lastMsg = lastMsgEl ? lastMsgEl.textContent.trim() : '';
                
                if (hasUnread && !processedChats.has(chatId)) {
                    addLog(`[未读] ${name}: ${lastMsg.substring(0, 25)}...`);
                    sendBarkNotification('Boss新消息', `${name}: ${lastMsg.substring(0, 50)}`);
                    processedChats.add(chatId);
                    
                    const friendContent = item.querySelector('.friend-content');
                    if (friendContent) friendContent.click();
                    else item.click();
                    
                    await randomDelay(2000, 3000);
                    
                    // 检查微信/简历弹窗
                    const wechatHandled2 = await checkWechatExchange();
                    if (wechatHandled2) return;
                    
                    // 检查是否HR文字要求简历
                    if (lastMsg.includes('简历') || lastMsg.includes('附件') || lastMsg.includes('发一份')) {
                        const resumeSent = await sendResume();
                        if (resumeSent) {
                            await randomDelay(1000, 1500);
                        }
                    }
                    
                    if (CONFIG.autoReply) await handleConversation(lastMsg, chatId, name);
                    return;
                }
            }
        } catch (e) {
            addLog('检查出错: ' + e.message, 'error');
        }
    }

    async function handleConversation(hrMessage, chatId, hrName) {
        try {
            updateStatus('AI思考中...');
            
            const hrInfo = getHRInfo();
            addLog(`HR: ${hrInfo.hrName} | 公司: ${hrInfo.company} | 岗位: ${hrInfo.hrTitle}`);
            
            // 检查是否HR文字要求简历（再次检查，确保不错过）
            if (hrMessage.includes('简历') || hrMessage.includes('附件') || hrMessage.includes('发一份')) {
                await sendResume();
                await randomDelay(1000, 1500);
            }
            
            const reply = await callAI(hrMessage, chatId, hrName, hrInfo);
            addLog(`AI: ${reply.substring(0, 30)}...`, 'reply');
            
            const inputBox = document.getElementById('chat-input');
            if (inputBox) {
                inputBox.focus();
                inputBox.textContent = '';
                
                document.execCommand('insertText', false, reply);
                inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
                
                await randomDelay(1000, 1500);
                
                const sendBtn = document.querySelector('.btn-send');
                if (sendBtn) {
                    if (sendBtn.classList.contains('disabled')) {
                        addLog('按钮禁用，尝试激活...');
                        inputBox.dispatchEvent(new Event('change', { bubbles: true }));
                        inputBox.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        await randomDelay(500, 800);
                    }
                    
                    if (!sendBtn.classList.contains('disabled')) {
                        sendBtn.click();
                        addLog('消息已发送', 'reply');
                        sendBarkNotification('Boss回复已发送', `回复给${hrName}`);
                        updateStatus('已回复');
                        
                        await apiSetIntroduced(chatId);
                        
                        addLog('1秒后刷新页面...');
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        addLog('尝试按Enter发送');
                        inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                        await randomDelay(100, 200);
                        inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                        addLog('已按Enter发送', 'reply');
                        
                        await apiSetIntroduced(chatId);
                        
                        addLog('1秒后刷新页面...');
                        setTimeout(() => location.reload(), 1000);
                    }
                } else {
                    addLog('未找到发送按钮', 'error');
                }
            } else {
                addLog('未找到输入框', 'error');
            }
        } catch (e) {
            addLog('处理出错: ' + e.message, 'error');
        }
    }

    function startMonitoring() {
        if (isMonitoring) return;
        isMonitoring = true;
        
        document.getElementById('status-dot')?.classList.add('active');
        updateStatus('监控中...');
        addLog('开始监控');
        
        checkUnreadMessages();
        monitorInterval = setInterval(checkUnreadMessages, CONFIG.checkInterval);
    }

    function stopMonitoring() {
        isMonitoring = false;
        document.getElementById('status-dot')?.classList.remove('active');
        if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
        updateStatus('已停止');
        addLog('停止监控');
    }

    function init() {
        console.log('[Boss AI助理] 脚本已加载 v4.2');
        createControlPanel();
        setupWechatObserver();
        
        setTimeout(() => {
            addLog('自动启动监控');
            startMonitoring();
        }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();