#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  در حال اجرای نمایشی کل مسیر خبر…"
echo "  (متن خبرها در این حالت نمونه‌اند، نه بازنویسی واقعی)"
echo ""

if ! npm run demo; then
  echo ""
  echo "  [!] اجرای نمایشی ناموفق بود."
  echo "      ابتدا «راه‌اندازی اولیه (مک و لینوکس).command» را اجرا کنید."
  echo ""
  read -r -p "برای بستن Enter بزنید…"
  exit 1
fi

echo ""
echo "  حالا پنل مدیریت باز می‌شود…"
echo ""
sleep 2
( command -v open >/dev/null 2>&1 && open http://127.0.0.1:7799 ) \
  || ( command -v xdg-open >/dev/null 2>&1 && xdg-open http://127.0.0.1:7799 ) &
npm run serve
