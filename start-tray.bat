@echo off
cd /d "%~dp0"
if not exist "runtime\logs" mkdir "runtime\logs"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set LOGFILE=runtime\logs\server-%DT:~0,8%-%DT:~8,6%.log
npx tsx apps/server/src/tray-entry.ts > "%LOGFILE%" 2>&1
