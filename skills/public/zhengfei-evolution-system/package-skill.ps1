# -*- coding: utf-8 -*-
"""
正飞技能进化系统 - 打包脚本
正飞信息技术出品
"""

# 压缩技能包
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageName = "zhengfei-evolution-system-v2.0-$timestamp.zip"
$packagePath = "C:\Users\Administrator\Desktop\$packageName"

Write-Host ""
Write-Host "=" * 60
Write-Host "  正飞技能进化系统 | 技能包打包"
Write-Host "=" * 60
Write-Host ""

# 需要打包的文件和目录
$filesToPackage = @(
    "SKILL.md",
    "zhengfei-evolution-system.md",
    "zhengfei-heartbeat.py",
    "zhengfei-scheduler.py",
    "zhengfei-trigger.py",
    "zhengfei-init.py",
    "zhengfei-materials",
    "zhengfei-capabilities",
    "zhengfei-archived",
    "zhengfei-memory",
    "zhengfei-logs"
)

Write-Host "准备打包以下文件和目录："
foreach ($file in $filesToPackage) {
    Write-Host "  - $file"
}

Write-Host ""
Write-Host "开始打包..."
Write-Host ""

# 使用PowerShell的Compress-Archive
$files = @()
foreach ($file in $filesToPackage) {
    $files += "C:\Users\Administrator\Desktop\技能脚本\$file"
}

try {
    Compress-Archive -Path $files -DestinationPath $packagePath -Force

    Write-Host ""
    Write-Host "=" * 60
    Write-Host "  打包完成！"
    Write-Host "=" * 60
    Write-Host ""
    Write-Host "包路径: $packagePath"
    Write-Host "包大小: $((Get-Item $packagePath).Length / 1KB) KB"
    Write-Host ""
    Write-Host "=" * 60
    Write-Host "     正飞出品 | 持续进化 | 专业服务"
    Write-Host "=" * 60
    Write-Host ""

} catch {
    Write-Host "打包失败: $_"
    Write-Host ""
    exit 1
}
