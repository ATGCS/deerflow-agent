const { ipcRenderer } = require('electron');

const assistant = document.getElementById('assistant');
const character = document.getElementById('character');
const bubble = document.getElementById('bubble');
const hint = document.getElementById('hint');

const emotions = {
  idle: 'idle',
  happy: 'happy',
  sad: 'sad',
  surprised: 'surprised',
  tired: 'tired',
  love: 'love'
};

let currentEmotion = emotions.idle;
let emotionTimeout = null;
let isSpeaking = false;

const clickResponses = [
  { emotion: emotions.happy, message: '你好呀！' },
  { emotion: emotions.surprised, message: '哇！你点我~' },
  { emotion: emotions.happy, message: '今天心情怎么样？' },
  { emotion: emotions.love, message: '最喜欢你了！' },
  { emotion: emotions.happy, message: '有什么可以帮你的吗？' },
  { emotion: emotions.surprised, message: '嘿嘿，被发现了~' }
];

const idleMessages = [
  '发呆中...',
  '有点无聊呢~',
  '在想事情...',
  '今天天气不错~'
];

class EmotionSystem {
  constructor() {
    this.mood = 100;
    this.energy = 100;
    this.happiness = 50;
  }

  update(delta) {
    this.mood = Math.max(0, Math.min(100, this.mood + (delta.mood || 0)));
    this.energy = Math.max(0, Math.min(100, this.energy + (delta.energy || 0)));
    this.happiness = Math.max(0, Math.min(100, this.happiness + (delta.happiness || 0)));
  }

  getEmotion() {
    if (this.happiness > 70) return 'happy';
    if (this.mood > 70 && this.energy > 50) return 'happy';
    if (this.mood < 30) return 'sad';
    if (this.energy < 30) return 'tired';
    return 'idle';
  }

  interact(type) {
    switch (type) {
      case 'click':
        this.update({ mood: 5, energy: 2, happiness: 10 });
        break;
      case 'pet':
        this.update({ mood: 10, energy: 5, happiness: 15 });
        break;
      case 'feed':
        this.update({ energy: 20, happiness: 10 });
        break;
      case 'play':
        this.update({ mood: 15, energy: -10, happiness: 20 });
        break;
      case 'ignore':
        this.update({ mood: -5, happiness: -5 });
        break;
    }
  }

  decay() {
    setInterval(() => {
      this.update({ mood: -1, energy: -1, happiness: -0.5 });
    }, 60000);
  }
}

const emotionSystem = new EmotionSystem();
emotionSystem.decay();

function setEmotion(emotion, duration = 3000) {
  if (emotionTimeout) {
    clearTimeout(emotionTimeout);
  }

  character.className = `character ${emotion}`;
  currentEmotion = emotion;

  if (duration > 0) {
    emotionTimeout = setTimeout(() => {
      const autoEmotion = emotionSystem.getEmotion();
      if (currentEmotion !== emotions.idle && currentEmotion !== autoEmotion) {
        setEmotion(autoEmotion, 0);
      }
    }, duration);
  }

  ipcRenderer.send('set-emotion', emotion);
}

function showMessage(text, duration = 3000) {
  bubble.textContent = text;
  bubble.classList.add('show');

  setTimeout(() => {
    bubble.classList.remove('show');
  }, duration);
}

function speak(text) {
  if (isSpeaking) return;
  isSpeaking = true;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 1;
  utterance.pitch = 1.2;

  utterance.onend = () => {
    isSpeaking = false;
    setEmotion(emotionSystem.getEmotion(), 0);
  };

  speechSynthesis.speak(utterance);
  setEmotion(emotions.happy);
}

function handleClick() {
  hint.style.display = 'none';

  emotionSystem.interact('click');

  const response = clickResponses[Math.floor(Math.random() * clickResponses.length)];
  setEmotion(response.emotion);
  showMessage(response.message);

  if (Math.random() > 0.7) {
    speak(response.message);
  }
}

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragThreshold = 5;
let petTimeout = null;

assistant.addEventListener('mousedown', (e) => {
  isDragging = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;

  petTimeout = setTimeout(() => {
    emotionSystem.interact('pet');
    setEmotion(emotions.love);
    showMessage('好舒服~');
    petTimeout = null;
  }, 1000);

  const onMouseMove = (e) => {
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;

    if (!isDragging && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
      isDragging = true;
      assistant.classList.add('dragging');
      if (petTimeout) {
        clearTimeout(petTimeout);
        petTimeout = null;
      }
    }

    if (isDragging) {
      ipcRenderer.send('window-move', { screenX: e.screenX, screenY: e.screenY });
    }
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    assistant.classList.remove('dragging');

    if (petTimeout) {
      clearTimeout(petTimeout);
      petTimeout = null;
    }

    if (!isDragging) {
      handleClick();
    }

    isDragging = false;
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

character.addEventListener('mouseenter', () => {
  character.style.transform = 'scale(1.05)';
});

character.addEventListener('mouseleave', () => {
  character.style.transform = 'scale(1)';
});

ipcRenderer.on('message', (event, data) => {
  setEmotion(emotions.happy);
  showMessage(data.text);
});

ipcRenderer.on('reminder', (event, data) => {
  setEmotion(emotions.surprised);
  showMessage(`⏰ ${data.message}`);
});

ipcRenderer.on('notification', (event, data) => {
  setEmotion(emotions.surprised);
  showMessage(data.message);
});

ipcRenderer.on('config', (event, config) => {
  console.log('Config received:', config);
});

setInterval(() => {
  if (currentEmotion === emotions.idle && Math.random() > 0.95) {
    const msg = idleMessages[Math.floor(Math.random() * idleMessages.length)];
    showMessage(msg, 2000);
  }
}, 10000);

console.log('桌面助手已启动！');
