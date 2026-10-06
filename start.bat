@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AI 网页 PPT 生成器

echo ==========================================================
echo   AI 网页 PPT 生成器 - 一键启动
echo   项目目录: %CD%
echo ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。请先安装 Node.js 20.6 或更高版本: https://nodejs.org/
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [1/5] Node.js !NODEV!  正常

if not exist "node_modules" (
  echo [2/5] 首次运行，正在安装依赖，约 1-3 分钟，请勿关闭窗口 ...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
) else (
  echo [2/5] 依赖已安装 node_modules ，跳过
)

if not exist "dist\index.html" (
  echo [3/5] 正在构建前端页面 ...
  call npm run build
  if errorlevel 1 (
    echo [错误] 前端构建失败。
    pause
    exit /b 1
  )
) else (
  echo [3/5] 前端已构建 dist ，跳过
)

if not exist ".env" (
  echo [4/5] 未找到 .env 配置文件，本次以 MOCK 本地模拟模式启动
  echo       如需真实大模型: 复制 .env.example 为 .env 并填入 DEEPSEEK_API_KEY
  set "MOCK_AI=1"
) else (
  echo [4/5] 已找到 .env 配置
)

echo [5/5] 检查服务是否已在运行 ...
node -e "fetch('http://127.0.0.1:8787/api/health').then(()=>process.exit(0)).catch(()=>process.exit(1))"
if not errorlevel 1 (
  echo        服务已在运行，直接打开浏览器
  goto open
)

echo        正在启动服务，请稍候 ...
start "AI-Web-PPT-Server" cmd /c "npm start"
node -e "const t=Date.now();(function p(){fetch('http://127.0.0.1:8787/api/health').then(()=>{console.log('        [OK] service ready');process.exit(0)}).catch(()=>{if(Date.now()-t>90000){console.log('        [ERROR] startup timeout');process.exit(1)}setTimeout(p,700)})})()"
if errorlevel 1 (
  echo [错误] 服务启动失败，请手动运行 npm start 查看报错。
  pause
  exit /b 1
)

:open
if /i "%~1"=="--no-open" (
  echo.
  echo 服务地址: http://127.0.0.1:8787
  echo 提示: 已按 --no-open 跳过自动打开浏览器
  exit /b 0
)

start "" http://127.0.0.1:8787
echo.
echo ==========================================================
echo   已在浏览器打开: http://127.0.0.1:8787
echo.
echo   使用步骤:
echo     1 把长文案粘贴到左侧「原始文案」框
echo     2 选择页数 语言 风格，点击「生成网页 PPT」
echo     3 生成完成后自动进入演示模式 F 全屏 方向键翻页
echo     4 点右上角「导出独立 HTML」保存为单文件演示
echo.
echo   停止服务: 关闭标题为 AI-Web-PPT-Server 的窗口，
echo             或在任务管理器中结束 node.exe
echo ==========================================================
echo.
pause
