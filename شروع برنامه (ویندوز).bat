@echo off
chcp 65001 >nul
title نرم‌افزار مدیریت آرشیو
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] نرم‌افزار Node.js روی این رایانه نصب نيست.
  echo.
  echo   لطفا نسخه LTS را از نشانی زیر دانلود و نصب کنید:
  echo       https://nodejs.org
  echo.
  echo   پس از نصب، دوباره روی همین فایل دوبار کلیک کنید.
  echo.
  pause
  exit /b 1
)

echo.
echo   در حال راه اندازی نرم افزار آرشیو...
echo   مرورگر به صورت خودکار باز می شود.
echo.
echo   این پنجره را نبندید. برای بستن برنامه کلیدهای Ctrl+C را بزنید.
echo.
node --no-warnings server/index.js
pause
