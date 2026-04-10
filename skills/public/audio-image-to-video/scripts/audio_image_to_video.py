#!/usr/bin/env python3
"""
Audio Image to Video Generator
根据图片和音频生成口型同步视频
"""

import argparse
import json
import os
import sys
import time
import webbrowser
import mimetypes
import contextlib
from typing import Optional, List, Dict, Any, Union

import requests
from requests_toolbelt import MultipartEncoder


class AudioImageToVideo:
    """音图驱动视频生成器"""

    API_URL = "https://api.moark.com/v1/async/videos/image-to-video"
    STATUS_URL_TEMPLATE = "https://moark.com/v1/task/{task_id}"
    DEFAULT_UPLOAD_SERVER = "https://gengxin.gdzhengfei.com"

    def __init__(
        self,
        api_key: Optional[str] = None,
        upload_server: Optional[str] = None
    ):
        self.api_key = api_key or os.environ.get("MOARK_API_KEY")
        if not self.api_key:
            raise ValueError("API key is required. Set MOARK_API_KEY environment variable or pass api_key parameter.")
        self.upload_server = upload_server or os.environ.get("UPLOAD_SERVER", self.DEFAULT_UPLOAD_SERVER)

    def upload_file(self, file_path: str) -> str:
        """
        上传本地文件到临时素材库，返回公开URL
        
        Args:
            file_path: 本地文件路径
            
        Returns:
            公开URL
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        url = f"{self.upload_server}/api/temp-material/upload"
        
        with open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f)}
            response = requests.post(url, files=files, timeout=60)
            
        response.raise_for_status()
        result = response.json()
        
        if result.get("code") != 0:
            raise RuntimeError(f"Upload failed: {result.get('message', 'Unknown error')}")
        
        return result["data"]["url"]

    def _get_file_content(
        self, 
        filepath: str, 
        stack: contextlib.ExitStack
    ) -> tuple:
        """
        获取文件内容（支持本地文件和URL）
        
        Args:
            filepath: 文件路径或URL
            stack: ExitStack for resource management
            
        Returns:
            (filename, content, mime_type) tuple
        """
        name = os.path.basename(filepath)
        
        if filepath.startswith(("http://", "https://")):
            response = requests.get(filepath, timeout=30)
            response.raise_for_status()
            content = response.content
            mime_type = response.headers.get("Content-Type", "application/octet-stream")
            return (name, content, mime_type)
        else:
            if not os.path.exists(filepath):
                raise FileNotFoundError(f"File not found: {filepath}")
            mime_type, _ = mimetypes.guess_type(filepath)
            file_obj = stack.enter_context(open(filepath, "rb"))
            return (name, file_obj, mime_type or "application/octet-stream")

    def create_task(
        self,
        prompt: str,
        image: str,
        audio: Union[str, List[str]],
        model: str = "InfiniteTalk",
        num_inference_steps: int = 4,
        motion_frame: int = 9,
        size: str = "infinitetalk-480"
    ) -> Dict[str, Any]:
        """
        创建音图驱动视频任务
        
        Args:
            prompt: 视频描述提示词
            image: 图片路径或URL
            audio: 音频路径或URL（单个或多个）
            model: 模型名称
            num_inference_steps: 推理步数
            motion_frame: 运动帧数
            size: 输出尺寸
            
        Returns:
            API响应，包含task_id
        """
        if isinstance(audio, str):
            audio = [audio]

        fields = [
            ("prompt", prompt),
            ("model", model),
            ("num_inference_steps", str(num_inference_steps)),
            ("motion_frame", str(motion_frame)),
            ("size", size),
        ]

        with contextlib.ExitStack() as stack:
            fields.append(("cond_video", self._get_file_content(image, stack)))
            
            for audio_path in audio:
                fields.append(("cond_audio", self._get_file_content(audio_path, stack)))

            encoder = MultipartEncoder(fields)
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": encoder.content_type
            }
            
            response = requests.post(self.API_URL, headers=headers, data=encoder, timeout=120)
            response.raise_for_status()
            return response.json()

    def poll_task(
        self,
        task_id: str,
        timeout: int = 30 * 60,
        retry_interval: int = 10,
        open_browser: bool = True
    ) -> Dict[str, Any]:
        """
        轮询任务状态直到完成
        
        Args:
            task_id: 任务ID
            timeout: 超时时间（秒）
            retry_interval: 重试间隔（秒）
            open_browser: 是否在浏览器中打开结果
            
        Returns:
            任务结果
        """
        status_url = self.STATUS_URL_TEMPLATE.format(task_id=task_id)
        headers = {"Authorization": f"Bearer {self.api_key}"}
        
        max_attempts = int(timeout / retry_interval)
        attempts = 0
        
        while attempts < max_attempts:
            attempts += 1
            print(f"Checking task status [{attempts}]...", end="")
            
            response = requests.get(status_url, headers=headers, timeout=30)
            result = response.json()
            
            if result.get("error"):
                print("error")
                raise ValueError(f"{result['error']}: {result.get('message', 'Unknown error')}")
            
            status = result.get("status", "unknown")
            print(status)
            
            if status == "success":
                if "output" in result and "file_url" in result["output"]:
                    file_url = result["output"]["file_url"]
                    duration = (result.get('completed_at', 0) - result.get('started_at', 0)) / 1000
                    print(f"Download link: {file_url}")
                    print(f"Task duration: {duration:.2f} seconds")
                    if open_browser:
                        webbrowser.open(file_url)
                elif "output" in result and "text_result" in result["output"]:
                    print(f"Text result: {result['output']['text_result']}")
                else:
                    print("No output URL found")
            elif status in ["failed", "cancelled"]:
                print(f"Task {status}")
            else:
                time.sleep(retry_interval)
                continue
            
            task_file = f"task_{task_id}.json"
            with open(task_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=4, ensure_ascii=False)
            print(f"Task was saved to file {task_file}")
            return result
        
        print(f"Maximum attempts reached ({max_attempts})")
        return {"status": "timeout", "message": "maximum wait time exceeded"}

    def create(
        self,
        prompt: str,
        image: str,
        audio: Union[str, List[str]],
        model: str = "InfiniteTalk",
        num_inference_steps: int = 4,
        motion_frame: int = 9,
        size: str = "infinitetalk-480",
        output_dir: str = "./output",
        open_browser: bool = True
    ) -> Dict[str, Any]:
        """
        一键创建音图驱动视频
        
        Args:
            prompt: 视频描述提示词
            image: 图片路径或URL
            audio: 音频路径或URL（单个或多个）
            model: 模型名称
            num_inference_steps: 推理步数
            motion_frame: 运动帧数
            size: 输出尺寸
            output_dir: 输出目录
            open_browser: 是否在浏览器中打开结果
            
        Returns:
            包含视频URL的结果字典
        """
        os.makedirs(output_dir, exist_ok=True)
        
        print("Creating task...")
        result = self.create_task(
            prompt=prompt,
            image=image,
            audio=audio,
            model=model,
            num_inference_steps=num_inference_steps,
            motion_frame=motion_frame,
            size=size
        )
        
        task_id = result.get("task_id")
        if not task_id:
            raise ValueError("Task ID not found in the response")
        
        print(f"Task ID: {task_id}")
        
        task_result = self.poll_task(task_id, open_browser=open_browser)
        
        if task_result.get("status") == "success":
            video_url = task_result.get("output", {}).get("file_url", "")
            return {
                "status": "success",
                "video_url": video_url,
                "task_id": task_id,
                "message": f"音图驱动视频生成成功！\n\n🎬 [查看视频]({video_url})"
            }
        else:
            return {
                "status": "error",
                "error": task_result.get("message", "Unknown error"),
                "message": f"音图驱动视频生成失败：{task_result.get('message', 'Unknown error')}"
            }


def main():
    parser = argparse.ArgumentParser(description="音图驱动视频生成工具")
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    create_parser = subparsers.add_parser("create", help="创建音图驱动视频")
    create_parser.add_argument("-i", "--image", required=True, help="图片路径或URL")
    create_parser.add_argument("-a", "--audio", required=True, nargs="+", help="音频路径或URL（可多个）")
    create_parser.add_argument("-p", "--prompt", required=True, help="视频描述提示词")
    create_parser.add_argument("-m", "--model", default="InfiniteTalk", help="模型名称")
    create_parser.add_argument("--steps", type=int, default=4, help="推理步数")
    create_parser.add_argument("--motion-frame", type=int, default=9, help="运动帧数")
    create_parser.add_argument("--size", default="infinitetalk-480", help="输出尺寸")
    create_parser.add_argument("-o", "--output-dir", default="./output", help="输出目录")
    create_parser.add_argument("-k", "--api-key", help="API Key")
    create_parser.add_argument("-s", "--upload-server", help="上传服务器地址")
    create_parser.add_argument("--no-browser", action="store_true", help="不在浏览器中打开结果")

    upload_parser = subparsers.add_parser("upload", help="上传文件获取URL")
    upload_parser.add_argument("-f", "--file", required=True, help="文件路径")
    upload_parser.add_argument("-k", "--api-key", help="API Key")
    upload_parser.add_argument("-s", "--upload-server", help="上传服务器地址")

    args = parser.parse_args()

    if args.command == "create":
        generator = AudioImageToVideo(
            api_key=args.api_key,
            upload_server=args.upload_server
        )
        result = generator.create(
            prompt=args.prompt,
            image=args.image,
            audio=args.audio,
            model=args.model,
            num_inference_steps=args.steps,
            motion_frame=args.motion_frame,
            size=args.size,
            output_dir=args.output_dir,
            open_browser=not args.no_browser
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif args.command == "upload":
        generator = AudioImageToVideo(
            api_key=args.api_key,
            upload_server=args.upload_server
        )
        url = generator.upload_file(args.file)
        print(f"Uploaded URL: {url}")

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
