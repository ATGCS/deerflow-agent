---
name: video-tools
description: "通用视频处理技能。支持字幕添加、封面生成、视频剪辑、格式转换、压缩优化等。当用户需要处理视频时使用：添加字幕、创建缩略图、裁剪片段、转换格式或压缩文件。"
---

# 视频处理工具 (Video Tools)

## 概述

这是一个综合性的视频处理技能，提供字幕添加、封面生成、视频剪辑、格式转换、压缩优化等常用功能。基于 FFmpeg 实现，支持多种视频格式。

## 功能列表

| 功能 | 说明 | 命令 |
|------|------|------|
| 字幕添加 | 添加硬字幕/软字幕 | `add-subtitle` |
| 封面生成 | 从视频提取封面图 | `create-thumbnail` |
| 视频剪辑 | 裁剪、合并视频片段 | `trim-video` |
| 格式转换 | 转换视频格式 | `convert-format` |
| 压缩优化 | 减小视频文件大小 | `compress-video` |
| 水印添加 | 添加图片/文字水印 | `add-watermark` |
| 音频处理 | 提取/替换音频 | `audio-process` |
| 视频信息 | 获取视频元数据 | `video-info` |

## 前置要求

### 安装 FFmpeg

**Windows:**
```bash
# 使用 winget
winget install ffmpeg

# 或使用 Chocolatey
choco install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg
```

### 验证安装

```bash
ffmpeg -version
```

## 字幕处理

### 添加硬字幕（烧录）

```bash
ffmpeg -i input.mp4 -vf "subtitles=subtitle.srt" output.mp4
```

### 添加软字幕（嵌入）

```bash
ffmpeg -i input.mp4 -i subtitle.srt -c copy -c:s mov_text output.mp4
```

### SRT 字幕格式

```srt
1
00:00:00,000 --> 00:00:03,000
这是第一句字幕

2
00:00:03,000 --> 00:00:06,000
这是第二句字幕
```

### 字幕样式定制

```bash
ffmpeg -i input.mp4 -vf "subtitles=subtitle.srt:force_style='FontName=微软雅黑,FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2'" output.mp4
```

## 封面生成

### 提取单帧

```bash
# 提取第5秒的帧
ffmpeg -i input.mp4 -ss 00:00:05 -vframes 1 thumbnail.jpg

# 提取最后一帧
ffmpeg -sseof -1 -i input.mp4 -vframes 1 thumbnail.jpg
```

### 批量提取帧

```bash
# 每秒提取1帧
ffmpeg -i input.mp4 -vf fps=1 frame_%04d.jpg

# 每10秒提取1帧
ffmpeg -i input.mp4 -vf fps=1/10 frame_%04d.jpg
```

### 生成 GIF 封面

```bash
ffmpeg -i input.mp4 -ss 00:00:05 -t 3 -vf "fps=10,scale=320:-1" thumbnail.gif
```

## 视频剪辑

### 裁剪片段

```bash
# 从第10秒开始，截取30秒
ffmpeg -i input.mp4 -ss 00:00:10 -t 30 -c copy output.mp4

# 从第10秒到第40秒
ffmpeg -i input.mp4 -ss 00:00:10 -to 00:00:40 -c copy output.mp4
```

### 合并视频

**方法1: 使用 concat 协议**
```bash
# 创建文件列表 filelist.txt
file 'video1.mp4'
file 'video2.mp4'
file 'video3.mp4'

ffmpeg -f concat -i filelist.txt -c copy output.mp4
```

**方法2: 使用 concat 滤镜**
```bash
ffmpeg -i video1.mp4 -i video2.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" output.mp4
```

### 裁剪画面

```bash
# 裁剪为 16:9 比例
ffmpeg -i input.mp4 -vf "crop=1920:1080:0:0" output.mp4

# 自动检测并裁剪黑边
ffmpeg -i input.mp4 -vf "cropdetect" -f null - 2>&1 | grep crop
```

## 格式转换

### 常用格式转换

```bash
# MP4 转 MOV
ffmpeg -i input.mp4 -c:v libx264 -c:a aac output.mov

# MP4 转 AVI
ffmpeg -i input.mp4 output.avi

# MP4 转 WebM
ffmpeg -i input.mp4 -c:v libvpx-vp9 -c:a libopus output.webm

# MP4 转 GIF
ffmpeg -i input.mp4 -vf "fps=10,scale=640:-1" output.gif
```

### 转换为抖音格式

```bash
# 9:16 竖版，720p
ffmpeg -i input.mp4 -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k output.mp4
```

### 转换为小红书格式

```bash
# 3:4 竖版，1080p
ffmpeg -i input.mp4 -vf "scale=1080:1440:force_original_aspect_ratio=decrease,pad=1080:1440:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset medium -crf 23 output.mp4
```

## 压缩优化

### 基本压缩

```bash
# 使用 CRF 质量控制 (0-51, 越小质量越好)
ffmpeg -i input.mp4 -c:v libx264 -crf 28 output.mp4

# 推荐值: 18-28
# 18: 视觉无损
# 23: 默认值
# 28: 明显压缩
```

### 指定文件大小

```bash
# 压缩到 10MB
ffmpeg -i input.mp4 -c:v libx264 -b:v 1M -pass 1 -f mp4 /dev/null
ffmpeg -i input.mp4 -c:v libx264 -b:v 1M -pass 2 output.mp4
```

### 压缩音频

```bash
ffmpeg -i input.mp4 -c:v copy -c:a aac -b:a 96k output.mp4
```

## 水印添加

### 图片水印

```bash
# 右下角
ffmpeg -i input.mp4 -i watermark.png -filter_complex "overlay=W-w-10:H-h-10" output.mp4

# 居中
ffmpeg -i input.mp4 -i watermark.png -filter_complex "overlay=(W-w)/2:(H-h)/2" output.mp4

# 左上角
ffmpeg -i input.mp4 -i watermark.png -filter_complex "overlay=10:10" output.mp4
```

### 文字水印

```bash
ffmpeg -i input.mp4 -vf "drawtext=text='My Watermark':fontfile=/path/to/font.ttf:fontsize=24:fontcolor=white:x=10:y=H-h-10" output.mp4
```

### 动态水印

```bash
# 从右到左滚动
ffmpeg -i input.mp4 -vf "drawtext=text='My Watermark':fontfile=/path/to/font.ttf:fontsize=24:fontcolor=white:x=w-text_w-t*50:y=H-h-10" output.mp4
```

## 音频处理

### 提取音频

```bash
ffmpeg -i input.mp4 -vn -c:a copy output.aac

# 提取为 MP3
ffmpeg -i input.mp4 -vn -c:a libmp3lame -b:a 192k output.mp3
```

### 替换音频

```bash
ffmpeg -i input.mp4 -i audio.mp3 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 output.mp4
```

### 添加背景音乐

```bash
ffmpeg -i input.mp4 -i bgm.mp3 -filter_complex "[0:a][1:a]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" output.mp4
```

### 调整音量

```bash
# 音量加倍
ffmpeg -i input.mp4 -af "volume=2" output.mp4

# 音量减半
ffmpeg -i input.mp4 -af "volume=0.5" output.mp4
```

## 视频信息

### 获取基本信息

```bash
ffprobe -i input.mp4

# JSON 格式
ffprobe -i input.mp4 -print_format json -show_format -show_streams
```

### 获取时长

```bash
ffprobe -i input.mp4 -show_entries format=duration -v quiet -of csv="p=0"
```

### 获取分辨率

```bash
ffprobe -i input.mp4 -show_entries stream=width,height -v quiet -of csv="p=0"
```

## 批量处理脚本

### 批量转换格式

```bash
#!/bin/bash
for file in *.avi; do
  ffmpeg -i "$file" "${file%.avi}.mp4"
done
```

### 批量压缩

```bash
#!/bin/bash
for file in *.mp4; do
  ffmpeg -i "$file" -c:v libx264 -crf 28 "compressed_${file}"
done
```

### 批量添加水印

```bash
#!/bin/bash
for file in *.mp4; do
  ffmpeg -i "$file" -i watermark.png -filter_complex "overlay=W-w-10:H-h-10" "watermarked_${file}"
done
```

## Node.js 封装

```javascript
const { exec } = require('child_process');
const path = require('path');

class VideoTools {
  static async trim(input, output, start, duration) {
    const cmd = `ffmpeg -i "${input}" -ss ${start} -t ${duration} -c copy "${output}"`;
    return this.exec(cmd);
  }

  static async convert(input, output, format) {
    const cmd = `ffmpeg -i "${input}" -c:v libx264 -c:a aac "${output}"`;
    return this.exec(cmd);
  }

  static async compress(input, output, crf = 28) {
    const cmd = `ffmpeg -i "${input}" -c:v libx264 -crf ${crf} "${output}"`;
    return this.exec(cmd);
  }

  static async addSubtitle(input, subtitle, output) {
    const cmd = `ffmpeg -i "${input}" -vf "subtitles=${subtitle}" "${output}"`;
    return this.exec(cmd);
  }

  static async addWatermark(input, watermark, output, position = 'br') {
    const positions = {
      'br': 'W-w-10:H-h-10',
      'bl': '10:H-h-10',
      'tr': 'W-w-10:10',
      'tl': '10:10',
      'center': '(W-w)/2:(H-h)/2'
    };
    const overlay = positions[position] || positions['br'];
    const cmd = `ffmpeg -i "${input}" -i "${watermark}" -filter_complex "overlay=${overlay}" "${output}"`;
    return this.exec(cmd);
  }

  static async getDuration(input) {
    const cmd = `ffprobe -i "${input}" -show_entries format=duration -v quiet -of csv="p=0"`;
    const result = await this.exec(cmd);
    return parseFloat(result.trim());
  }

  static exec(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout || stderr);
      });
    });
  }
}

module.exports = VideoTools;
```

## 使用示例

```javascript
const VideoTools = require('./video-tools');

async function main() {
  // 裁剪视频
  await VideoTools.trim('input.mp4', 'clip.mp4', '00:00:10', 30);
  
  // 压缩视频
  await VideoTools.compress('input.mp4', 'compressed.mp4', 28);
  
  // 添加字幕
  await VideoTools.addSubtitle('input.mp4', 'subtitle.srt', 'output.mp4');
  
  // 添加水印
  await VideoTools.addWatermark('input.mp4', 'logo.png', 'output.mp4', 'br');
  
  // 获取时长
  const duration = await VideoTools.getDuration('input.mp4');
  console.log(`视频时长: ${duration}秒`);
}

main();
```

## 注意事项

1. **性能优化**
   - 使用 `-c copy` 避免重新编码
   - 使用 `-preset` 控制编码速度
   - 多线程处理 `-threads`

2. **质量平衡**
   - CRF 值越小质量越好
   - 文件大小与质量成反比
   - 不同编码器参数不同

3. **兼容性**
   - H.264 最广泛支持
   - AAC 音频兼容性好
   - MP4 容器通用性强

4. **常见问题**
   - 字幕乱码：指定字体编码
   - 音画不同步：使用 `-vsync cfr`
   - 内存不足：分段处理
