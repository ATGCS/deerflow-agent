@echo off
REM Delegates to scripts\windows\restart-backend.ps1 (stops 2024+8012, starts LangGraph + Gateway)
cd /d %~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\windows\restart-backend.ps1"
if errorlevel 1 exit /b 1
