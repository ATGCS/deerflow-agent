const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const cron = require('node-cron');

const store = new Store();

let mainWindow;
let tray;
let reminderTasks = [];

const defaultConfig = {
  character: {
    name: '小助手',
    size: 200,
    opacity: 1
  },
  voice: {
    enabled: true,
    wakeWords: ['小助手', '你好助手', '嘿助手'],
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

function getConfig() {
  return { ...defaultConfig, ...store.get('config', {}) };
}

function createWindow() {
  const config = getConfig();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  const windowConfig = {
    width: config.character.size,
    height: config.character.size,
    transparent: true,
    frame: false,
    alwaysOnTop: config.appearance.alwaysOnTop,
    resizable: false,
    skipTaskbar: !config.appearance.showInTaskbar,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  };

  if (config.appearance.position.x !== null && config.appearance.position.y !== null) {
    windowConfig.x = config.appearance.position.x;
    windowConfig.y = config.appearance.position.y;
  } else {
    windowConfig.x = width - config.character.size - 20;
    windowConfig.y = height - config.character.size - 20;
  }

  mainWindow = new BrowserWindow(windowConfig);
  mainWindow.loadFile('index.html');
  mainWindow.setMovable(true);

  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    const currentConfig = getConfig();
    currentConfig.appearance.position = { x, y };
    store.set('config', currentConfig);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const { nativeImage } = require('electron');
  const fs = require('fs');
  
  const iconPath = path.join(__dirname, '../assets/images/icon.png');
  const characterPath = path.join(__dirname, '../assets/images/character.png');
  
  let trayIcon;
  
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else if (fs.existsSync(characterPath)) {
    const img = nativeImage.createFromPath(characterPath);
    trayIcon = img.resize({ width: 32, height: 32 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示助手', click: () => mainWindow && mainWindow.show() },
    { label: '隐藏助手', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    { 
      label: '提醒设置', 
      submenu: [
        { label: '开启工作提醒', type: 'checkbox', checked: true, click: (item) => toggleReminder('work', item.checked) },
        { label: '开启休息提醒', type: 'checkbox', checked: true, click: (item) => toggleReminder('break', item.checked) }
      ]
    },
    { type: 'separator' },
    { label: '重置位置', click: () => resetPosition() },
    { type: 'separator' },
    { label: '退出', click: () => {
      clearAllReminders();
      app.quit();
    }}
  ]);

  tray.setToolTip('桌面助手');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function setupReminders() {
  const config = getConfig();
  if (!config.reminder.enabled) return;

  clearAllReminders();

  const morningTask = cron.schedule('0 9 * * *', () => {
    sendMessage('早上好！新的一天开始了~');
  });
  reminderTasks.push(morningTask);

  const breakTask = cron.schedule(`0 */${config.reminder.workInterval} * * *`, () => {
    sendMessage('工作一段时间了，休息一下吧！');
  });
  reminderTasks.push(breakTask);

  const eveningTask = cron.schedule('0 18 * * 1-5', () => {
    sendMessage('下班时间到啦！辛苦了~');
  });
  reminderTasks.push(eveningTask);

  const nightTask = cron.schedule('0 22 * * *', () => {
    sendMessage('夜深了，早点休息哦~');
  });
  reminderTasks.push(nightTask);
}

function toggleReminder(type, enabled) {
  const config = getConfig();
  if (type === 'work') {
    config.reminder.workEnabled = enabled;
  } else if (type === 'break') {
    config.reminder.breakEnabled = enabled;
  }
  store.set('config', config);
  setupReminders();
}

function clearAllReminders() {
  reminderTasks.forEach(task => task.stop());
  reminderTasks = [];
}

function resetPosition() {
  const config = getConfig();
  config.appearance.position = { x: null, y: null };
  store.set('config', config);
  if (mainWindow) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(width - config.character.size - 20, height - config.character.size - 20);
  }
}

function sendMessage(text) {
  if (mainWindow) {
    mainWindow.webContents.send('message', { text });
  }

  new Notification({
    title: '桌面助手',
    body: text,
    silent: false
  }).show();
}

function sendReminder(text) {
  if (mainWindow) {
    mainWindow.webContents.send('reminder', { message: text });
  }

  new Notification({
    title: '桌面助手提醒',
    body: text,
    silent: false
  }).show();
}

ipcMain.on('set-emotion', (event, emotion) => {
  console.log('Emotion changed:', emotion);
});

ipcMain.on('window-move', (event, { screenX, screenY }) => {
  if (mainWindow) {
    const [winX, winY] = mainWindow.getPosition();
    const [winW, winH] = mainWindow.getSize();
    mainWindow.setPosition(screenX - winW / 2, screenY - winH / 2);
  }
});

ipcMain.on('speak', (event, text) => {
  sendMessage(text);
});

ipcMain.on('get-config', (event) => {
  event.reply('config', getConfig());
});

ipcMain.on('set-config', (event, newConfig) => {
  store.set('config', newConfig);
  setupReminders();
});

ipcMain.on('set-position', (event, { x, y }) => {
  const config = getConfig();
  config.appearance.position = { x, y };
  store.set('config', config);
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupReminders();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    clearAllReminders();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  clearAllReminders();
});
