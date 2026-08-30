@echo off
chcp 65001 >nul
title کاکو نیوز — اجرای نمایشی
cd /d "%~dp0"

echo.
echo   در حال اجرای نمایشی کل مسیر خبر...
echo   [متن خبرها در این حالت نمونه‌اند، نه بازنویسی واقعی]
echo.

call npm run demo
if errorlevel 1 (
  echo.
  echo   [!] اجرای نمایشی ناموفق بود.
  echo       ابتدا «راه‌اندازی اولیه (ویندوز).bat» را اجرا کنید.
  echo.
  pause
  exit /b 1
)

echo.
echo   حالا پنل مدیریت باز می‌شود...
echo.
timeout /t 2 >nul
start "" http://127.0.0.1:7799
call npm run serve
pause
