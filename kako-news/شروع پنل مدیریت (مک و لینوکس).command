#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  در حال باز کردن پنل مدیریت کاکو نیوز…"
echo "  نشانی:  http://127.0.0.1:7799"
echo ""
echo "  این پنجره را نبندید. برای بستن برنامه Ctrl+C را بزنید."
echo ""

sleep 2
( command -v open >/dev/null 2>&1 && open http://127.0.0.1:7799 ) \
  || ( command -v xdg-open >/dev/null 2>&1 && xdg-open http://127.0.0.1:7799 ) &
npm run serve
