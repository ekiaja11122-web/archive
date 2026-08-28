#!/usr/bin/env bash
#
# پشتیبان‌گیری از دیتابیس کاکو نیوز.
#
#   ./deploy/backup.sh              پشتیبان در پوشهٔ پیش‌فرض
#   ./deploy/backup.sh /mnt/backup  پشتیبان در مسیر دلخواه
#
# پشتیبان شامل کل دیتابیس است: خبرها، تنظیمات منابع، کاربران پنل و
# تاریخچه. فایل .env و تصاویر جداگانه پشتیبان‌گیری می‌شوند (پایین‌تر).
#
set -euo pipefail

BACKUP_DIR="${1:-${KAKO_BACKUP_DIR:-/opt/kako-news/backups}}"
KEEP_DAYS="${KAKO_BACKUP_KEEP_DAYS:-14}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  # اگر از خط فرمان اجرا می‌شود، .env را خودمان می‌خوانیم
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "$PROJECT_DIR/.env" | head -1 | cut -d= -f2-)"
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "خطا: مقدار DATABASE_URL پیدا نشد (نه در محیط، نه در .env)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$BACKUP_DIR/kako-db-$STAMP.dump"

echo "پشتیبان‌گیری از دیتابیس…"
# قالب custom فشرده است و امکان بازگردانی گزینشی می‌دهد
pg_dump --format=custom --compress=6 --no-owner --no-privileges \
        --file="$DB_FILE" "$DATABASE_URL"

# --- فایل تنظیمات و واژه‌نامه ---
CONFIG_FILE="$BACKUP_DIR/kako-config-$STAMP.tar.gz"
echo "پشتیبان‌گیری از فایل‌های تنظیمات…"
tar -czf "$CONFIG_FILE" -C "$PROJECT_DIR" config/ 2>/dev/null || true

# ⚠️ فایل .env کلیدهای API دارد و عمداً در این پشتیبان نیست.
#    آن را جداگانه و در جای امن نگه دارید.

DB_SIZE="$(du -h "$DB_FILE" | cut -f1)"
echo "پشتیبان ساخته شد:"
echo "  دیتابیس : $DB_FILE ($DB_SIZE)"
echo "  تنظیمات : $CONFIG_FILE"

# --- حذف پشتیبان‌های قدیمی ---
if [[ "$KEEP_DAYS" -gt 0 ]]; then
  DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'kako-*' -type f -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
  if [[ "$DELETED" -gt 0 ]]; then
    echo "  $DELETED پشتیبان قدیمی‌تر از $KEEP_DAYS روز حذف شد"
  fi
fi

echo
echo "برای بازگردانی:  ./deploy/restore.sh $DB_FILE"
