@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Installation des dependances de RoForge...
  call npm install --no-fund --no-audit
  node node_modules\electron\install.js
)
start "" "node_modules\electron\dist\electron.exe" .
