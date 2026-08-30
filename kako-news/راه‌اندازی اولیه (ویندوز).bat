@echo off
chcp 65001 >nul
title کاکو نیوز — راه‌اندازی اولیه
cd /d "%~dp0"

echo.
echo   ==========================================
echo     کاکو نیوز — راه‌اندازی اولیه
echo   ==========================================
echo.

REM ---------- بررسی Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo   [!] نرم‌افزار Node.js روی این رایانه نصب نیست.
  echo.
  echo   نسخهٔ LTS را از نشانی زیر دانلود و نصب کنید:
  echo       https://nodejs.org
  echo.
  echo   پس از نصب، دوباره روی همین فایل دوبار کلیک کنید.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo   [!] نسخهٔ Node.js شما %NODEMAJOR% است، ولی نسخهٔ ۲۲ یا بالاتر لازم است.
  echo       نسخهٔ LTS را از https://nodejs.org نصب کنید.
  echo.
  pause
  exit /b 1
)

REM ---------- نصب وابستگی‌ها ----------
if not exist "node_modules" (
  echo   در حال نصب وابستگی‌ها... [این مرحله چند دقیقه طول می‌کشد]
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [!] نصب وابستگی‌ها ناموفق بود. اتصال اینترنت را بررسی کنید.
    pause
    exit /b 1
  )
  echo.
)

REM ---------- راه‌اندازی ----------
call npm run setup
if errorlevel 1 (
  echo.
  echo   راه‌اندازی کامل نشد. پیام بالا را بخوانید.
  echo.
  pause
  exit /b 1
)

echo.
echo   ==========================================
echo     برای دیدن برنامه، روی فایل زیر دوبار کلیک کنید:
echo         «اجرای نمایشی (ویندوز).bat»
echo   ==========================================
echo.
pause
