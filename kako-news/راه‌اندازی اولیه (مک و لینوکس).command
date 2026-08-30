#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  =========================================="
echo "    کاکو نیوز — راه‌اندازی اولیه"
echo "  =========================================="
echo ""

# ---------- بررسی Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  echo "  [!] نرم‌افزار Node.js روی این رایانه نصب نیست."
  echo ""
  echo "  نسخهٔ LTS را از https://nodejs.org دانلود و نصب کنید،"
  echo "  سپس دوباره این فایل را اجرا کنید."
  echo ""
  read -r -p "برای بستن Enter بزنید…"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "  [!] نسخهٔ Node.js شما $NODE_MAJOR است، ولی نسخهٔ ۲۲ یا بالاتر لازم است."
  echo "      نسخهٔ LTS را از https://nodejs.org نصب کنید."
  echo ""
  read -r -p "برای بستن Enter بزنید…"
  exit 1
fi

# ---------- نصب وابستگی‌ها ----------
if [ ! -d "node_modules" ]; then
  echo "  در حال نصب وابستگی‌ها… (این مرحله چند دقیقه طول می‌کشد)"
  echo ""
  if ! npm install; then
    echo ""
    echo "  [!] نصب وابستگی‌ها ناموفق بود. اتصال اینترنت را بررسی کنید."
    read -r -p "برای بستن Enter بزنید…"
    exit 1
  fi
  echo ""
fi

# ---------- راه‌اندازی ----------
if ! npm run setup; then
  echo ""
  echo "  راه‌اندازی کامل نشد. پیام بالا را بخوانید."
  echo ""
  read -r -p "برای بستن Enter بزنید…"
  exit 1
fi

echo ""
echo "  =========================================="
echo "    برای دیدن برنامه، این فایل را اجرا کنید:"
echo "        «اجرای نمایشی (مک و لینوکس).command»"
echo "  =========================================="
echo ""
read -r -p "برای بستن Enter بزنید…"
