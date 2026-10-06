@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AI 网页 PPT 生成器 - 公网分享

echo ==========================================================
echo   把网页 PPT 生成器分享给别人（公网一次性链接）
echo   项目目录: %CD%
echo ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装后重试: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo 提示: 前端尚未构建，正在构建 ...
  call npm run build
  if errorlevel 1 ( echo [错误] 构建失败 & pause & exit /b 1 )
)

echo [1/3] 检查本机服务是否已启动 ...
set "SERVER_STARTED="
node -e "fetch('http://127.0.0.1:8787/api/health').then(()=>process.exit(0)).catch(()=>process.exit(1))"
if errorlevel 1 (
  echo        未启动，正在后台启动服务 ...
  start "AI-Web-PPT-Server" cmd /c "npm start"
  node -e "const t=Date.now();(function p(){fetch('http://127.0.0.1:8787/api/health').then(()=>{console.log('        [OK] service ready');process.exit(0)}).catch(()=>{if(Date.now()-t>90000){console.log('        [ERROR] startup timeout');process.exit(1)};setTimeout(p,700)})})()"
  if errorlevel 1 ( echo [错误] 服务启动失败，请先手动运行 npm start & pause & exit /b 1 )
) else (
  echo        服务已在运行
)

echo [2/3] 读取访问口令 ...
findstr /b /c:"ACCESS_PASSWORD=" ".env" >nul 2>nul
if errorlevel 1 (
  echo        [提醒] .env 里没有配置 ACCESS_PASSWORD，
  echo               任何人拿到链接都能用你的模型额度，建议先配置再分享。
) else (
  echo        已读取 .env 中的访问口令（稍后会一并显示）
)

echo [3/3] 建立公网隧道 ...
echo.
node tools\share.mjs
echo.
echo 隧道已结束，分享链接已失效。
pause
