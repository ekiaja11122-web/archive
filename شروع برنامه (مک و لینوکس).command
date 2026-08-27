#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] نرم‌افزار Node.js روی این رایانه نصب نیست."
  echo "      لطفاً نسخهٔ LTS را از https://nodejs.org دانلود و نصب کنید،"
  echo "      سپس دوباره این فایل را اجرا کنید."
  echo ""
  read -r -p "برای بستن Enter بزنید…"
  exit 1
fi

echo ""
echo "  در حال راه‌اندازی نرم‌افزار آرشیو…"
echo "  مرورگر به‌صورت خودکار باز می‌شود."
echo "  برای بستن برنامه Ctrl+C را بزنید."
echo ""
node --no-warnings server/index.js
