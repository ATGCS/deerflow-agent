---
name: desktop-assistant
description: "桌面智能助手技能。可爱卡通角色、语音唤醒、通知提醒、情绪动画。当用户需要创建桌面宠物/助手，需要语音交互、通知或动画角色时使用。"
---

# 桌面智能助手 (Desktop Assistant)

## 概述

这是一个桌面智能助手技能，提供可爱的卡通角色、语音唤醒、通知提醒、情绪动画等功能。可以作为桌面宠物、工作助手或互动玩具使用。

## 功能特性

| 功能   | 说明         |
| ---- | ---------- |
| 卡通角色 | 可爱的桌面宠物形象  |
| 语音唤醒 | 通过语音指令激活   |
| 通知提醒 | 定时提醒、日程通知  |
| 情绪动画 | 根据状态显示不同表情 |
| 桌面互动 | 拖拽、点击交互    |
| 语音合成 | 文字转语音播报    |
| 天气显示 | 实时天气信息     |

## 技术架构

```
desktop-assistant/
├── src/
│   ├── main.js           # Electron 主进程
│   ├── renderer.js       # 渲染进程
│   ├── character/        # 角色动画
│   │   ├── idle.js       # 待机动画
│   │   ├── happy.js      # 开心动画
│   │   └── sad.js        # 难过动画
│   ├── voice/            # 语音模块
│   │   ├── wake.js       # 唤醒检测
│   │   └── tts.js        # 语音合成
│   ├── notification/     # 通知模块
│   │   └── reminder.js   # 提醒功能
│   └── weather/          # 天气模块
│       └── weather.js    # 天气获取
├── assets/
│   ├── images/           # 角色图片
│   └── sounds/           # 音效文件
├── styles/
│   └── main.css          # 样式文件
└── package.json
```

## 快速开始

### 安装依赖

```bash
npm install electron
npm install electron-store
npm install node-notifier
npm install axios
```

### 基础代码

**main.js - 主进程**

```javascript
const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 200,
    height: 200,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // 设置窗口可拖拽
  mainWindow.setMovable(true);
  
  // 隐藏任务栏图标
  mainWindow.setSkipTaskbar(true);
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示', click: () => mainWindow.show() },
    { label: '隐藏', click: () => mainWindow.hide() },
    { label: '设置', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  
  tray.setToolTip('桌面助手');
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

**index.html - 界面**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      -webkit-app-region: drag;
      overflow: hidden;
    }
    
    .assistant {
      width: 200px;
      height: 200px;
      position: relative;
    }
    
    .character {
      width: 100%;
      height: 100%;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      animation: float 3s ease-in-out infinite;
    }
    
    .character.idle {
      background-image: url('assets/images/idle.png');
    }
    
    .character.happy {
      background-image: url('assets/images/happy.png');
      animation: bounce 0.5s ease-in-out;
    }
    
    .character.sad {
      background-image: url('assets/images/sad.png');
    }
    
    .bubble {
      position: absolute;
      top: -60px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      border-radius: 10px;
      padding: 10px 15px;
      font-size: 14px;
      white-space: nowrap;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      display: none;
    }
    
    .bubble.show {
      display: block;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    
    @keyframes bounce {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  </style>
</head>
<body>
  <div class="assistant">
    <div class="bubble" id="bubble"></div>
    <div class="character idle" id="character"></div>
  </div>
  
  <script src="renderer.js"></script>
</body>
</html>
```

**renderer.js - 渲染进程**

```javascript
const { ipcRenderer } = require('electron');

const character = document.getElementById('character');
const bubble = document.getElementById('bubble');

// 情绪状态
const emotions = {
  idle: 'idle',
  happy: 'happy',
  sad: 'sad',
  surprised: 'surprised'
};

let currentEmotion = emotions.idle;

// 设置情绪
function setEmotion(emotion) {
  character.className = `character ${emotion}`;
  currentEmotion = emotion;
  
  // 3秒后恢复待机
  setTimeout(() => {
    if (currentEmotion !== emotions.idle) {
      setEmotion(emotions.idle);
    }
  }, 3000);
}

// 显示气泡消息
function showMessage(text, duration = 3000) {
  bubble.textContent = text;
  bubble.classList.add('show');
  
  setTimeout(() => {
    bubble.classList.remove('show');
  }, duration);
}

// 点击交互
character.addEventListener('click', () => {
  const responses = [
    { emotion: emotions.happy, message: '你好呀！' },
    { emotion: emotions.surprised, message: '哇！你点我~' },
    { emotion: emotions.happy, message: '今天心情怎么样？' }
  ];
  
  const response = responses[Math.floor(Math.random() * responses.length)];
  setEmotion(response.emotion);
  showMessage(response.message);
});

// 监听通知
ipcRenderer.on('notification', (event, data) => {
  setEmotion(emotions.surprised);
  showMessage(data.message);
});

// 监听提醒
ipcRenderer.on('reminder', (event, data) => {
  setEmotion(emotions.happy);
  showMessage(`提醒：${data.message}`);
});
```

## 语音唤醒

### 使用 Web Speech API

```javascript
class VoiceWake {
  constructor(callback) {
    this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    this.recognition.continuous = true;
    this.recognition.lang = 'zh-CN';
    this.callback = callback;
    this.wakeWords = ['小助手', '你好助手', '嘿助手'];
  }
  
  start() {
    this.recognition.onresult = (event) => {
      const last = event.results.length - 1;
      const text = event.results[last][0].transcript.toLowerCase();
      
      for (const word of this.wakeWords) {
        if (text.includes(word)) {
          this.callback(text.replace(word, '').trim());
          break;
        }
      }
    };
    
    this.recognition.start();
  }
  
  stop() {
    this.recognition.stop();
  }
}

// 使用
const voiceWake = new VoiceWake((command) => {
  console.log('收到指令:', command);
  // 处理指令
});

voiceWake.start();
```

## 语音合成

```javascript
class TextToSpeech {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
  }
  
  async init() {
    return new Promise((resolve) => {
      const voices = this.synth.getVoices();
      if (voices.length > 0) {
        this.voice = voices.find(v => v.lang.includes('zh')) || voices[0];
        resolve();
      } else {
        this.synth.onvoiceschanged = () => {
          const voices = this.synth.getVoices();
          this.voice = voices.find(v => v.lang.includes('zh')) || voices[0];
          resolve();
        };
      }
    });
  }
  
  speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = this.voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    this.synth.speak(utterance);
  }
  
  stop() {
    this.synth.cancel();
  }
}

// 使用
const tts = new TextToSpeech();
await tts.init();
tts.speak('你好，我是你的桌面助手！');
```

## 通知提醒

```javascript
const { Notification } = require('electron');
const cron = require('node-cron');

class Reminder {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.tasks = [];
  }
  
  // 添加一次性提醒
  addOnce(time, message) {
    const task = cron.schedule(time, () => {
      this.notify(message);
      task.stop();
    });
    this.tasks.push(task);
  }
  
  // 添加周期性提醒
  addRecurring(cronExpression, message) {
    const task = cron.schedule(cronExpression, () => {
      this.notify(message);
    });
    this.tasks.push(task);
  }
  
  // 发送通知
  notify(message) {
    // 系统通知
    new Notification({
      title: '桌面助手提醒',
      body: message,
      silent: false
    }).show();
    
    // 发送到渲染进程
    this.mainWindow.webContents.send('reminder', { message });
  }
  
  // 清除所有提醒
  clearAll() {
    this.tasks.forEach(task => task.stop());
    this.tasks = [];
  }
}

// 使用示例
const reminder = new Reminder(mainWindow);

// 每天9点提醒
reminder.addRecurring('0 9 * * *', '早上好！新的一天开始了~');

// 每30分钟休息提醒
reminder.addRecurring('*/30 * * * *', '该休息一下了，站起来活动活动吧！');
```

## 天气显示

```javascript
const axios = require('axios');

class Weather {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openweathermap.org/data/2.5';
  }
  
  async getCurrent(city) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/weather?q=${city}&appid=${this.apiKey}&units=metric&lang=zh_cn`
      );
      
      return {
        temp: Math.round(response.data.main.temp),
        description: response.data.weather[0].description,
        icon: response.data.weather[0].icon
      };
    } catch (error) {
      console.error('获取天气失败:', error);
      return null;
    }
  }
  
  getWeatherEmoji(icon) {
    const emojiMap = {
      '01d': '☀️', '01n': '🌙',
      '02d': '⛅', '02n': '☁️',
      '03d': '☁️', '03n': '☁️',
      '04d': '☁️', '04n': '☁️',
      '09d': '🌧️', '09n': '🌧️',
      '10d': '🌦️', '10n': '🌧️',
      '11d': '⛈️', '11n': '⛈️',
      '13d': '❄️', '13n': '❄️'
    };
    return emojiMap[icon] || '🌤️';
  }
}

// 使用
const weather = new Weather('your-api-key');
const current = await weather.getCurrent('Beijing');
console.log(`北京天气: ${weather.getWeatherEmoji(current.icon)} ${current.temp}°C ${current.description}`);
```

## 情绪系统

```javascript
class EmotionSystem {
  constructor() {
    this.mood = 100; // 心情值 0-100
    this.energy = 100; // 精力值 0-100
  }
  
  // 更新状态
  update(delta) {
    this.mood = Math.max(0, Math.min(100, this.mood + delta.mood || 0));
    this.energy = Math.max(0, Math.min(100, this.energy + delta.energy || 0));
  }
  
  // 获取当前情绪
  getEmotion() {
    if (this.mood > 70 && this.energy > 50) return 'happy';
    if (this.mood < 30) return 'sad';
    if (this.energy < 30) return 'tired';
    return 'idle';
  }
  
  // 互动影响
  interact(type) {
    switch (type) {
      case 'pet':
        this.update({ mood: 10, energy: 5 });
        break;
      case 'feed':
        this.update({ energy: 20 });
        break;
      case 'play':
        this.update({ mood: 15, energy: -10 });
        break;
      case 'ignore':
        this.update({ mood: -5 });
        break;
    }
  }
  
  // 自然衰减
  decay() {
    setInterval(() => {
      this.update({ mood: -1, energy: -1 });
    }, 60000); // 每分钟衰减
  }
}
```

## 完整示例

```javascript
const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const cron = require('node-cron');
const axios = require('axios');

class DesktopAssistant {
  constructor() {
    this.window = null;
    this.emotion = new EmotionSystem();
    this.reminders = [];
  }
  
  async init() {
    await app.whenReady();
    this.createWindow();
    this.setupReminders();
    this.emotion.decay();
  }
  
  createWindow() {
    this.window = new BrowserWindow({
      width: 200,
      height: 200,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    
    this.window.loadFile('index.html');
  }
  
  setupReminders() {
    // 早上问候
    cron.schedule('0 9 * * *', () => {
      this.sendMessage('早上好！新的一天开始了~');
    });
    
    // 休息提醒
    cron.schedule('0 */1 * * *', () => {
      this.sendMessage('工作一小时了，休息一下吧！');
    });
    
    // 下班提醒
    cron.schedule('0 18 * * 1-5', () => {
      this.sendMessage('下班时间到啦！辛苦了~');
    });
  }
  
  sendMessage(text) {
    this.window.webContents.send('message', { text });
    new Notification({
      title: '桌面助手',
      body: text
    }).show();
  }
}

const assistant = new DesktopAssistant();
assistant.init();
```

## 配置选项

```javascript
const defaultConfig = {
  character: {
    name: '小助手',
    size: 200,
    opacity: 1
  },
  voice: {
    enabled: true,
    wakeWords: ['小助手', '你好助手'],
    language: 'zh-CN'
  },
  reminder: {
    enabled: true,
    workInterval: 60,
    breakDuration: 5
  },
  weather: {
    enabled: true,
    city: 'Beijing',
    updateInterval: 30
  },
  appearance: {
    alwaysOnTop: true,
    showInTaskbar: false,
    position: { x: null, y: null }
  }
};
```

## 注意事项

**性能优化**

- 减少动画帧率

## 使用 CSS 动画代替 JS

- 合理设置更新间隔
- **用户体验**
  - 提供静音模式
  - 可调节透明度
  - 支持自定义角色
- **系统兼容**
  - Windows/macOS/Linux 适配
  - 处理多显示器情况
  - 支持开机自启动

