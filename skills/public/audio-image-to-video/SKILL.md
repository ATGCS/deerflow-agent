---
name: audio-image-to-video
description: "音图驱动视频生成技能，根据图片和音频生成口型同步的视频。支持本地文件和URL，自动上传本地文件。当用户需要根据静态图片和音频生成会说话的视频时调用。"
---

# Audio Image to Video Skill

音图驱动视频生成技能，基于 Moark API 的 InfiniteTalk 模型，实现根据静态图片和音频生成口型同步视频的功能。

## 功能概述

1. **图片+音频输入**：支持本地文件路径或 URL
2. **自动上传**：本地文件自动上传到临时素材库获取公开 URL
3. **口型同步**：生成的视频中人物口型与音频同步
4. **异步任务**：支持长时间任务处理，自动轮询结果

## 工作流程

```
用户提供图片（本地或URL）
用户提供音频文件（本地或URL）
        ↓
    自动上传本地文件到OSS（如需要）
        ↓
    获取公开URL
        ↓
    调用 Moark API 创建任务
        ↓
    轮询任务状态
        ↓
    生成口型同步视频
```

## 环境变量

使用前需要设置以下环境变量：

- `MOARK_API_KEY`: Moark API 密钥（用户自行提供）
- `UPLOAD_SERVER`: 上传服务器地址（可选，默认 https://gengxin.gdzhengfei.com）

## 使用示例

### 命令行使用

```bash
# 生成音图驱动视频
python scripts/audio_image_to_video.py create \
    --image "path/to/image.jpg" \
    --audio "path/to/audio.wav" \
    --prompt "A woman is passionately singing..." \
    --api-key "your_api_key"

# 上传本地文件获取URL
python scripts/audio_image_to_video.py upload \
    --file "path/to/file.mp3"
```

### Python API

```python
from scripts.audio_image_to_video import AudioImageToVideo

generator = AudioImageToVideo(
    api_key="your_api_key",
    upload_server="https://gengxin.gdzhengfei.com"
)

result = generator.create(
    image="path/to/image.jpg",
    audio=["path/to/audio.wav"],
    prompt="A woman is passionately singing into a professional microphone...",
    output_dir="./output"
)

print(f"生成的视频: {result['video_url']}")
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

### 2. 音图驱动视频 API（异步）

```
POST https://api.moark.com/v1/async/videos/image-to-video
Headers:
  - Authorization: Bearer {MOARK_API_KEY}
Body (multipart/form-data):
  - prompt: 提示词描述
  - model: InfiniteTalk
  - cond_video: 图片文件（本地或URL）
  - cond_audio: 音频文件（本地或URL，可多个）
  - num_inference_steps: 推理步数（默认4）
  - motion_frame: 运动帧数（默认9）
  - size: 尺寸（infinitetalk-480）

Response:
{
    "task_id": "任务ID"
}
```

### 3. 任务状态查询

```
GET https://moark.com/v1/task/{task_id}
Headers:
  - Authorization: Bearer {MOARK_API_KEY}

Response:
{
    "status": "success",
    "output": {
        "file_url": "生成的视频URL"
    }
}
```

## 参数说明

### create 命令参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| --image, -i | string | 是 | 图片路径或URL |
| --audio, -a | list | 是 | 音频路径或URL（可多个） |
| --prompt, -p | string | 是 | 视频描述提示词 |
| --model, -m | string | 否 | 模型名称，默认 InfiniteTalk |
| --steps | int | 否 | 推理步数，默认 4 |
| --motion-frame | int | 否 | 运动帧数，默认 9 |
| --size | string | 否 | 尺寸，默认 infinitetalk-480 |
| --output-dir, -o | string | 否 | 输出目录，默认 ./output |
| --api-key, -k | string | 否 | API Key，可从环境变量读取 |
| --upload-server, -s | string | 否 | 上传服务器地址 |
| --no-browser | flag | 否 | 不在浏览器中打开结果 |

## 返回值格式

完成后，**必须**在聊天中返回以下JSON格式，以便用户可以点击查看结果：

```json
{
    "status": "success",
    "video_url": "https://oss.example.com/xxx.mp4",
    "message": "音图驱动视频生成成功！点击链接查看：[视频](video_url)"
}
```

### 返回示例

成功时：
```json
{
    "status": "success",
    "video_url": "https://pgtg-shanghai.oss-cn-shanghai.aliyuncs.com/xxx/output.mp4",
    "message": "音图驱动视频生成成功！\n\n🎬 [查看视频](https://pgtg-shanghai.oss-cn-shanghai.aliyuncs.com/xxx/output.mp4)"
}
```

失败时：
```json
{
    "status": "error",
    "error": "错误信息",
    "message": "音图驱动视频生成失败：错误信息"
}
```

## 注意事项

1. **API Key**：需要用户自行提供 Moark API Key
2. **本地文件**：支持本地文件路径，会自动上传到临时素材库
3. **URL**：直接使用公开URL，不会重复上传
4. **图片要求**：建议使用清晰的人物正面照片
5. **音频要求**：建议音频清晰，无背景噪音
6. **处理时间**：视频生成可能需要几分钟，请耐心等待

## 依赖

```bash
pip install requests requests-toolbelt
```

## 适用场景

- 数字人视频制作
- 虚拟主播内容生成
- 静态照片"说话"效果
- 音频驱动的口型同步视频
