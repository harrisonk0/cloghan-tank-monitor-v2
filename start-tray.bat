@echo off
cd /d "%~dp0"
if not exist "runtime\logs" mkdir "runtime\logs"
> "runtime\logs\server.log" (
    echo === Cloghan Tank Monitor started %date% %time% ===
)
npx tsx apps/server/src/tray-entry.ts >> "runtime\logs\server.log" 2>&1
