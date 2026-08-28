#!/usr/bin/env bash
#
# راه‌اندازی کاکو نیوز روی سرور اوبونتو/دبیان.
#
#   sudo ./deploy/install.sh
#
# این اسکریپت کارهای تکراری راه‌اندازی را انجام می‌دهد. هر مرحله را
# پیش از اجرا اعلام می‌کند و اگر چیزی از قبل انجام شده باشد رد می‌شود.
#
set -euo pipefail

APP_USER="kako"
APP_DIR="/opt/kako-news"
DB_NAME="kako_news"
DB_USER="kako"

step() { echo; echo "── $1"; }

if [[ "$EUID" -ne 0 ]]; then
  echo "این اسکریپت باید با sudo اجرا شود." >&2
  exit 1
fi

step "بررسی پیش‌نیازها"
command -v node >/dev/null || { echo "Node.js نصب نیست. نسخهٔ ۲۲ یا بالاتر را نصب کنید." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node.js نسخهٔ $NODE_MAJOR نصب است؛ نسخهٔ ۲۲ یا بالاتر لازم است." >&2
  exit 1
fi
command -v psql >/dev/null || { echo "PostgreSQL نصب نیست." >&2; exit 1; }
echo "  Node.js و PostgreSQL موجودند."

step "ساخت کاربر سرویس"
if id "$APP_USER" &>/dev/null; then
  echo "  کاربر «$APP_USER» از قبل هست."
else
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  echo "  کاربر «$APP_USER» ساخته شد."
fi

step "ساخت دیتابیس"
if su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
  echo "  کاربر دیتابیس از قبل هست."
else
  DB_PASSWORD="$(openssl rand -hex 24)"
  su postgres -c "psql -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'\""
  echo "  کاربر دیتابیس ساخته شد. این نشانی را در .env بگذارید:"
  echo "      DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
fi
if su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1; then
  echo "  دیتابیس از قبل هست."
else
  su postgres -c "createdb -O $DB_USER $DB_NAME"
  echo "  دیتابیس «$DB_NAME» ساخته شد."
fi

step "آماده‌سازی پوشهٔ برنامه"
mkdir -p "$APP_DIR/data/images" "$APP_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"
echo "  مالکیت $APP_DIR به «$APP_USER» داده شد."

if [[ -f "$APP_DIR/.env" ]]; then
  chmod 600 "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo "  دسترسی .env محدود شد (فقط کاربر سرویس)."
else
  echo "  ⚠️  فایل .env هنوز ساخته نشده."
  echo "      cp $APP_DIR/.env.example $APP_DIR/.env  و مقادیر را پر کنید."
fi

step "نصب سرویس‌های systemd"
for unit in kako-worker.service kako-panel.service \
            kako-backup.service kako-backup.timer \
            kako-cleanup.service kako-cleanup.timer; do
  cp "$APP_DIR/deploy/$unit" /etc/systemd/system/
  echo "  $unit"
done
systemctl daemon-reload

echo
echo "──────────────────────────────────────────────"
echo "مراحل باقی‌مانده (دستی):"
echo "  ۱. فایل .env را پر کنید (کلید OpenAI، توکن تلگرام، اطلاعات وردپرس)"
echo "  ۲. cd $APP_DIR && sudo -u $APP_USER npm ci --omit=dev"
echo "  ۳. sudo -u $APP_USER npm run migrate"
echo "  ۴. sudo -u $APP_USER npm run sources:sync"
echo "  ۵. sudo -u $APP_USER npm run doctor -- --deep"
echo "  ۶. systemctl enable --now kako-worker kako-panel"
echo "  ۷. systemctl enable --now kako-backup.timer kako-cleanup.timer"
echo "  ۸. Nginx را تنظیم کنید: deploy/nginx-kako.conf"
echo "──────────────────────────────────────────────"
