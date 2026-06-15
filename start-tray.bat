@echo off
cd /d "%~dp0"
npx tsx apps/server/src/tray-entry.ts
