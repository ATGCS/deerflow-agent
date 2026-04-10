#!/usr/bin/env python3
"""
数字人视频生成脚本
支持语音克隆和视频合成功能，支持本地文件和URL
"""

import os
import sys
import json
import time
import argparse
import requests
import webbrowser
import mimetypes
import contextlib
from typing import Optional, Dict, Any
from requests_toolbelt import MultipartEncoder


class DigitalHumanGenerator:
    """数字人视频生成器"""

    def __init__(self, api_key: Optional[str] = None, upload_server: Optional[str] = None):
        self.api_key = api_key or os.environ.get('MOARK_API_KEY')
        self.upload_server = upload_server or os.environ.get('UPLOAD_SERVER', 'https://gengxin.gdzhengfei.com')
        if not self.api_key:
            raise ValueError('API key is required. Set MOARK_API_KEY environment variable or pass api_key parameter.')

    def upload_to_temp_material(self, file_path: str) -> str:
        """
        上传本地文件到临时素材库，返回公开URL

        Args:
            file_path: 本地文件路径

        Returns:
            公开的文件URL
        """
        if file_path.startswith(('http://', 'https://')):
            return file_path

        if not os.path.exists(file_path):
            raise FileNotFoundError(f'File not found: {file_path}')

        url = f'{self.upload_server}/api/temp-material/upload'
        
        print(f'正在上传文件到临时素材库: {file_path}')
        
        with open(file_path, 'rb') as f:
            files = {'file': (os.path.basename(file_path), f)}
            response = requests.post(url, files=files, timeout=300)
        
        response.raise_for_status()
        result = response.json()
        
        if result.get('code') != 0:
            raise ValueError(f"Upload failed: {result.get('message', 'Unknown error')}")
        
        file_url = result['data']['url']
        print(f'文件上传成功: {file_url}')
        return file_url

    def clone_voice(self, text: str, ref_audio_url: str, model: str = 'Spark-TTS-0.5B') -> str:
        """
        语音克隆 - 将文本转换为克隆的语音（异步API）

        Args:
            text: 要转换的文本内容
            ref_audio_url: 参考音频URL（用于克隆声音）
            model: 模型名称，默认 Spark-TTS-0.5B

        Returns:
            任务ID
        """
        url = 'https://api.moark.com/v1/async/audio/speech'
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
        data = {
            'inputs': text,
            'model': model,
            'prompt_audio_url': ref_audio_url
        }

        print(f'正在提交语音克隆任务...')
        print(f'文本: {text[:50]}{"..." if len(text) > 50 else ""}')

        response = requests.post(url, headers=headers, json=data, timeout=300)
        response.raise_for_status()

        result = response.json()
        task_id = result.get('task_id')
        if not task_id:
            print(f'响应: {json.dumps(result, indent=2, ensure_ascii=False)}')
            raise ValueError('Failed to get task_id from response')

        print(f'任务已提交，ID: {task_id}')
        return task_id

    def poll_task(self, task_id: str, timeout: int = 1800, retry_interval: int = 10) -> Dict[str, Any]:
        """
        轮询任务状态

        Args:
            task_id: 任务ID
            timeout: 超时时间（秒），默认30分钟
            retry_interval: 轮询间隔（秒），默认10秒

        Returns:
            任务结果
        """
        url = f'https://moark.com/v1/task/{task_id}'
        headers = {'Authorization': f'Bearer {self.api_key}'}

        print(f'等待任务完成...')

        max_attempts = int(timeout / retry_interval)
        attempts = 0

        while attempts < max_attempts:
            attempts += 1

            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()

            result = response.json()

            if result.get('error'):
                raise ValueError(f"{result['error']}: {result.get('message', 'Unknown error')}")

            status = result.get('status', 'unknown')
            print(f'任务状态: {status} [{attempts}/{max_attempts}]')

            if status == 'success':
                if 'output' in result and 'file_url' in result['output']:
                    file_url = result['output']['file_url']
                    duration = (result.get('completed_at', 0) - result.get('started_at', 0)) / 1000
                    print(f'任务完成!')
                    print(f'下载链接: {file_url}')
                    print(f'耗时: {duration:.2f} 秒')
                    return {
                        'status': 'success',
                        'file_url': file_url,
                        'duration': duration,
                        'result': result
                    }
                else:
                    raise ValueError('No output URL found in response')

            elif status in ['failed', 'cancelled']:
                raise RuntimeError(f'Task {status}')

            time.sleep(retry_interval)

        raise TimeoutError(f'Timeout after {timeout} seconds')

    def clone_voice_and_wait(self, text: str, ref_audio_url: str, model: str = 'Spark-TTS-0.5B', output_path: Optional[str] = None) -> str:
        """
        语音克隆并等待完成

        Args:
            text: 要转换的文本内容
            ref_audio_url: 参考音频URL
            model: 模型名称
            output_path: 输出文件路径（可选）

        Returns:
            音频文件路径或URL
        """
        task_id = self.clone_voice(text, ref_audio_url, model)
        result = self.poll_task(task_id)
        
        if output_path:
            self._download_file(result['file_url'], output_path)
            print(f'音频已保存: {output_path}')
            return output_path
        
        return result['file_url']

    def synthesize_video(self, ref_audio: str, ref_video: str, model: str = 'Duix.Heygem') -> str:
        """
        视频合成 - 使用克隆的音频生成数字人视频
        支持本地文件路径和URL

        Args:
            ref_audio: 音频文件路径或URL
            ref_video: 视频文件路径或URL
            model: 模型名称，默认 Duix.Heygem

        Returns:
            任务ID
        """
        url = 'https://api.moark.com/v1/async/videos/audio-video-to-video'
        headers = {
            'Authorization': f'Bearer {self.api_key}'
        }

        print(f'正在提交视频合成任务...')

        fields = [('model', model)]

        with contextlib.ExitStack() as stack:
            for key, filepath in [('ref_audio', ref_audio), ('ref_video', ref_video)]:
                name = os.path.basename(filepath)
                if filepath.startswith(('http://', 'https://')):
                    print(f'{key}: {filepath} (URL)')
                    response = requests.get(filepath, timeout=30)
                    response.raise_for_status()
                    fields.append((key, (name, response.content, response.headers.get('Content-Type', 'application/octet-stream'))))
                else:
                    print(f'{key}: {filepath} (本地文件)')
                    mime_type, _ = mimetypes.guess_type(filepath)
                    fields.append((key, (name, stack.enter_context(open(filepath, 'rb')), mime_type or 'application/octet-stream')))

            encoder = MultipartEncoder(fields)
            headers['Content-Type'] = encoder.content_type
            response = requests.post(url, headers=headers, data=encoder, timeout=300)

        response.raise_for_status()
        result = response.json()

        task_id = result.get('task_id')
        if not task_id:
            print(f'响应: {json.dumps(result, indent=2, ensure_ascii=False)}')
            raise ValueError('Failed to get task_id from response')

        print(f'任务已提交，ID: {task_id}')
        return task_id

    def synthesize_video_and_wait(self, ref_audio: str, ref_video: str, model: str = 'Duix.Heygem', output_path: Optional[str] = None) -> str:
        """
        视频合成并等待完成

        Args:
            ref_audio: 音频文件路径或URL
            ref_video: 视频文件路径或URL
            model: 模型名称
            output_path: 输出文件路径（可选）

        Returns:
            视频文件路径或URL
        """
        task_id = self.synthesize_video(ref_audio, ref_video, model)
        result = self.poll_task(task_id)
        
        if output_path:
            self._download_file(result['file_url'], output_path)
            print(f'视频已保存: {output_path}')
            return output_path
        
        return result['file_url']

    def create_digital_human(self, ref_audio: str, ref_video: str, text: str, output_dir: str = './output', open_browser: bool = True) -> Dict[str, Any]:
        """
        一键创建数字人视频

        流程：
        1. 如果是本地文件，上传到临时素材库获取URL
        2. 使用参考音频URL克隆语音，生成新文本的语音
        3. 使用克隆的语音和参考视频合成数字人视频

        Args:
            ref_audio: 参考音频路径或URL（用于语音克隆）
            ref_video: 参考视频路径或URL（包含清晰人脸）
            text: 要转换的新文本内容
            output_dir: 输出目录
            open_browser: 是否在浏览器中打开结果

        Returns:
            包含音频路径和视频URL的字典
        """
        os.makedirs(output_dir, exist_ok=True)

        # 步骤0：上传本地文件到临时素材库
        print('=== 步骤0: 准备素材 ===')
        ref_audio_url = self.upload_to_temp_material(ref_audio)
        print(f'参考音频URL: {ref_audio_url}')

        # 步骤1：语音克隆
        print('\n=== 步骤1: 语音克隆 ===')
        cloned_audio_path = os.path.join(output_dir, 'cloned_voice.mp3')
        self.clone_voice_and_wait(text, ref_audio_url, output_path=cloned_audio_path)

        # 步骤2：视频合成
        print('\n=== 步骤2: 视频合成 ===')
        video_path = os.path.join(output_dir, 'digital_human_output.mp4')
        video_url = self.synthesize_video_and_wait(cloned_audio_path, ref_video, output_path=video_path)

        # 在浏览器中打开
        if open_browser:
            webbrowser.open(video_url)

        return {
            'ref_audio_url': ref_audio_url,
            'cloned_audio_path': cloned_audio_path,
            'video_url': video_url,
            'video_path': video_path
        }

    def _download_file(self, url: str, output_path: str):
        """下载文件"""
        response = requests.get(url, stream=True, timeout=300)
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)


def main():
    parser = argparse.ArgumentParser(description='数字人视频生成工具')
    subparsers = parser.add_subparsers(dest='command', help='可用命令')

    # upload 命令
    upload_parser = subparsers.add_parser('upload', help='上传本地文件到临时素材库')
    upload_parser.add_argument('--file', '-f', required=True, help='本地文件路径')
    upload_parser.add_argument('--upload-server', '-s', help='上传服务器地址')

    # clone 命令
    clone_parser = subparsers.add_parser('clone', help='语音克隆')
    clone_parser.add_argument('--text', '-t', required=True, help='要转换的文本')
    clone_parser.add_argument('--ref-audio-url', '-a', required=True, help='参考音频URL')
    clone_parser.add_argument('--output', '-o', default='cloned_voice.mp3', help='输出文件路径')
    clone_parser.add_argument('--api-key', '-k', help='API Key')

    # synthesize 命令
    synth_parser = subparsers.add_parser('synthesize', help='视频合成')
    synth_parser.add_argument('--audio', '-a', required=True, help='音频文件路径或URL')
    synth_parser.add_argument('--video', '-v', required=True, help='视频文件路径或URL')
    synth_parser.add_argument('--output', '-o', default='output.mp4', help='输出文件路径')
    synth_parser.add_argument('--api-key', '-k', help='API Key')

    # create 命令（一键完成）
    create_parser = subparsers.add_parser('create', help='一键创建数字人视频')
    create_parser.add_argument('--ref-audio', '-a', required=True, help='参考音频路径或URL（用于语音克隆）')
    create_parser.add_argument('--ref-video', '-v', required=True, help='参考视频路径或URL（包含清晰人脸）')
    create_parser.add_argument('--text', '-t', required=True, help='数字人要说的文本')
    create_parser.add_argument('--output-dir', '-o', default='./output', help='输出目录')
    create_parser.add_argument('--api-key', '-k', help='API Key')
    create_parser.add_argument('--upload-server', '-s', help='上传服务器地址')
    create_parser.add_argument('--no-browser', action='store_true', help='不在浏览器中打开结果')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    try:
        if args.command == 'upload':
            generator = DigitalHumanGenerator(api_key='dummy', upload_server=getattr(args, 'upload_server', None))
            url = generator.upload_to_temp_material(args.file)
            print(f'\n文件URL: {url}')

        else:
            generator = DigitalHumanGenerator(api_key=args.api_key, upload_server=getattr(args, 'upload_server', None))

            if args.command == 'clone':
                generator.clone_voice_and_wait(args.text, args.ref_audio_url, output_path=args.output)

            elif args.command == 'synthesize':
                generator.synthesize_video_and_wait(args.audio, args.video, output_path=args.output)

            elif args.command == 'create':
                result = generator.create_digital_human(
                    ref_audio=args.ref_audio,
                    ref_video=args.ref_video,
                    text=args.text,
                    output_dir=args.output_dir,
                    open_browser=not args.no_browser
                )
                print('\n=== 完成 ===')
                print(f'参考音频URL: {result["ref_audio_url"]}')
                print(f'克隆语音: {result["cloned_audio_path"]}')
                print(f'视频URL: {result["video_url"]}')
                print(f'本地视频: {result["video_path"]}')

    except Exception as e:
        print(f'错误: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
