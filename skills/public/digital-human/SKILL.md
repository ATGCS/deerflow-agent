---
name: digital-human
description: "数字人视频生成技能，支持本地文件和URL。自动上传本地文件到临时素材库获取公开URL，然后进行语音克隆和视频合成。当用户需要创建数字人视频时使用。"
---

# Digital Human Skill

数字人视频生成技能，基于 Moark API 实现语音克隆和视频合成功能。

## 功能概述

1. **临时素材上传**：自动上传本地文件到OSS，获取公开URL
2. **语音克隆**：使用参考音频克隆声音，生成新文本的语音
3. **视频合成**：使用克隆的语音和参考视频生成数字人视频

## 工作流程

```
用户提供音频文件（本地或URL）
用户提供视频文件（本地或URL）
        ↓
    自动上传本地文件到OSS（如需要）
        ↓
    获取公开URL
        ↓
    语音克隆（输入新文本）
        ↓
    视频合成（克隆语音 + 参考视频）
        ↓
    生成新的数字人视频
```

## 环境变量

使用前需要设置以下环境变量：

- `MOARK_API_KEY`: Moark API 密钥（用户自行提供）
- `UPLOAD_SERVER`: 上传服务器地址（可选，默认 https://gengxin.gdzhengfei.com）

## 使用示例

### 命令行使用

```bash
# 一键创建数字人视频（支持本地文件）
python scripts/digital_human.py create \
    --ref-audio "path/to/voice.wav" \
    --ref-video "path/to/video.mp4" \
    --text "这是数字人要说的新的内容" \
    --api-key "your_api_key"

# 上传本地文件获取URL
python scripts/digital_human.py upload \
    --file "path/to/file.mp3"

# 单独语音克隆（需要URL）
python scripts/digital_human.py clone \
    --text "Hello, world!" \
    --ref-audio-url "https://example.com/voice.wav" \
    --api-key "your_api_key"

# 单独视频合成（支持本地文件）
python scripts/digital_human.py synthesize \
    --audio "cloned_voice.mp3" \
    --video "ref_video.mp4" \
    --api-key "your_api_key"
```

### Python API

```python
from scripts.digital_human import DigitalHumanGenerator

generator = DigitalHumanGenerator(
    api_key="your_api_key",
    upload_server="https://gengxin.gdzhengfei.com"
)

# 一键创建（支持本地文件）
result = generator.create_digital_human(
    ref_audio="path/to/voice.wav",  # 本地文件或URL
    ref_video="path/to/video.mp4",  # 本地文件或URL
    text="这是数字人要说的内容",
    output_dir="./output"
)

print(f"生成的视频: {result['video_path']}")
```

## API 接口说明

### 1. 临时素材上传

```
POST https://gengxin.gdzhengfei.com/api/temp-material/upload
Body: multipart/form-data
  - file: 文件

Response:
{
    "code": 0,
    "data": {
        "url": "https://oss.example.com/..."
    }
}
```

### 2. 语音克隆 API（异步）

```
POST https://api.moark.com/v1/async/audio/speech
Headers:
  - Content-Type: application/json
  - Authorization: Bearer {MOARK_API_KEY}
Body:
{
    "inputs": "要转换的文本",
    "model": "Spark-TTS-0.5B",
    "prompt_audio_url": "参考音频URL"
}

Response:
{
    "task_id": "任务ID"
}
```

### 3. 视频合成 API（异步）

```
POST https://api.moark.com/v1/async/videos/audio-video-to-video
Headers:
  - Authorization: Bearer {MOARK_API_KEY}
Body (multipart/form-data):
  - model: Duix.Heygem
  - ref_audio: 音频文件（本地或URL）
  - ref_video: 视频文件（本地或URL）

Response:
{
    "task_id": "任务ID"
}
```

### 4. 任务状态查询

```
GET https://moark.com/v1/task/{task_id}
Headers:
  - Authorization: Bearer {MOARK_API_KEY}

Response:
{
    "status": "success",
    "output": {
        "file_url": "生成的文件URL"
    }
}
```

## 参数说明

### create 命令参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| --ref-audio, -a | string | 是 | 参考音频路径或URL（用于语音克隆） |
| --ref-video, -v | string | 是 | 参考视频路径或URL（包含清晰人脸） |
| --text, -t | string | 是 | 数字人要说的新的文本内容 |
| --output-dir, -o | string | 否 | 输出目录，默认 ./output |
| --api-key, -k | string | 否 | API Key，可从环境变量读取 |
| --upload-server, -s | string | 否 | 上传服务器地址 |
| --no-browser | flag | 否 | 不在浏览器中打开结果 |

## 输出文件

一键创建会在输出目录生成以下文件：

1. `cloned_voice.mp3` - 克隆后的语音
2. `digital_human_output.mp4` - 最终生成的数字人视频

## 返回值格式

完成后，**必须**在聊天中返回以下JSON格式，以便用户可以点击查看结果：

```json
{
    "status": "success",
    "video_url": "https://oss.example.com/xxx.mp4",
    "audio_url": "https://oss.example.com/xxx.mp3",
    "message": "数字人视频生成成功！点击链接查看：[视频](video_url)"
}
```

### 返回示例

成功时：
```json
{
    "status": "success",
    "video_url": "https://pgtg-shanghai.oss-cn-shanghai.aliyuncs.com/xxx/digital_human_output.mp4",
    "audio_url": "https://pgtg-shanghai.oss-cn-shanghai.aliyuncs.com/xxx/cloned_voice.mp3",
    "message": "数字人视频生成成功！\n\n🎬 [查看视频](https://pgtg-shanghai.oss-cn-shanghai.aliyuncs.com/xxx/digital_human_output.mp4)\n🔊 [收听音频](https://pgtg-shanghai.oss-cn-shanghai.aliyuncs.com/xxx/cloned_voice.mp3)"
}
```

失败时：
```json
{
    "status": "error",
    "error": "错误信息",
    "message": "数字人视频生成失败：错误信息"
}
```

## 注意事项

1. **API Key**：需要用户自行提供，测试 Key 仅用于开发测试
2. **本地文件**：支持本地文件路径，会自动上传到临时素材库
3. **URL**：直接使用公开URL，不会重复上传
4. **音频质量**：建议参考音频音质清晰，无背景噪音
5. **视频要求**：参考视频需要包含清晰的人脸画面
6. **文本长度**：建议文本长度适中，过长可能导致处理时间较长

## 依赖

```bash
pip install requests requests-toolbelt
```
