#!/usr/bin/env bash
#
# بازگردانی دیتابیس کاکو نیوز از فایل پشتیبان.
#
#   ./deploy/restore.sh backups/kako-db-20260828-030000.dump
#
# ⚠️ این کار محتوای فعلی دیتابیس را **بازنویسی می‌کند**.
#
set -euo pipefail

DUMP_FILE="${1:-}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
  echo "استفاده: $0 <فایل-پشتیبان.dump>" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f "$PROJECT_DIR/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2-)"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "خطا: مقدار DATABASE_URL پیدا نشد" >&2
  exit 1
fi

# نشانی را بدون رمز نشان می‌دهیم
SAFE_URL="$(echo "$DATABASE_URL" | sed -E 's|(//[^:]+:)[^@]+@|\1***@|')"

echo "⚠️  محتوای فعلی این دیتابیس بازنویسی می‌شود:"
echo "      $SAFE_URL"
echo "    از فایل: $DUMP_FILE"
echo
read -r -p "برای ادامه «بله» را تایپ کنید: " CONFIRM
if [[ "$CONFIRM" != "بله" && "$CONFIRM" != "yes" ]]; then
  echo "لغو شد."
  exit 1
fi

echo "توقف سرویس‌ها (اگر در حال اجرا باشند)…"
sudo systemctl stop kako-worker kako-panel 2>/dev/null || true

echo "بازگردانی…"
pg_restore --clean --if-exists --no-owner --no-privileges \
           --dbname="$DATABASE_URL" "$DUMP_FILE"

echo "اعمال مهاجرت‌های احتمالی جدید…"
cd "$PROJECT_DIR" && npm run migrate --silent

echo "راه‌اندازی دوبارهٔ سرویس‌ها…"
sudo systemctl start kako-worker kako-panel 2>/dev/null || true

echo
echo "بازگردانی تمام شد. برای بررسی سلامت:  npm run doctor"
