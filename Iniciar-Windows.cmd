@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Para abrir ViceLens, instala Node.js 18 o posterior desde https://nodejs.org/
  pause
  exit /b 1
)
node servidor.mjs --abrir
if errorlevel 1 pause
