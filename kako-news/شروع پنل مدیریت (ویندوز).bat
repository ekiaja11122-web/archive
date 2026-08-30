@echo off
chcp 65001 >nul
title کاکو نیوز — پنل مدیریت
cd /d "%~dp0"

echo.
echo   در حال باز کردن پنل مدیریت کاکو نیوز...
echo   نشانی:  http://127.0.0.1:7799
echo.
echo   این پنجره را نبندید. برای بستن برنامه Ctrl+C را بزنید.
echo.

timeout /t 2 >nul
start "" http://127.0.0.1:7799
call npm run serve
pause
