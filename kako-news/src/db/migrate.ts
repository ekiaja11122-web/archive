/**
 * اجراکنندهٔ مهاجرت‌های دیتابیس.
 *
 * فایل‌های SQL داخل `migrations/` به ترتیب نام اجرا می‌شوند و نام هرکدام
 * در جدول `schema_migrations` ثبت می‌شود تا دوباره اجرا نشود.
 * هر فایل داخل یک تراکنش اجرا می‌شود؛ اگر خطا بدهد چیزی نیمه‌کاره نمی‌ماند.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrationsDir } from '../config/paths.ts';
import { getPool, query } from './pool.ts';
import { createLogger } from '../lib/logger.ts';

const logger = createLogger('db');

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

export type MigrationFile = { name: string; sql: string; checksum: string };
export type MigrationStatus = { name: string; applied: boolean; changedSinceApplied: boolean };

function readMigrations(dir = migrationsDir): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16) };
    });
}

async function appliedMigrations(): Promise<Map<string, string>> {
  await query(MIGRATIONS_TABLE);
  const rows = await query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

/** وضعیت مهاجرت‌ها بدون اعمال هیچ تغییری. */
export async function migrationStatus(): Promise<MigrationStatus[]> {
  const applied = await appliedMigrations();
  return readMigrations().map((m) => ({
    name: m.name,
    applied: applied.has(m.name),
    changedSinceApplied: applied.has(m.name) && applied.get(m.name) !== m.checksum,
  }));
}

/** اعمال مهاجرت‌های اجرانشده. تعداد مهاجرت‌های اعمال‌شده را برمی‌گرداند. */
export async function runMigrations(): Promise<number> {
  const applied = await appliedMigrations();
  const pending = readMigrations().filter((m) => !applied.has(m.name));

  if (pending.length === 0) {
    logger.info('دیتابیس به‌روز است؛ مهاجرت جدیدی وجود ندارد');
    return 0;
  }

  const pool = getPool();
  for (const migration of pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum],
      );
      await client.query('COMMIT');
      logger.info('مهاجرت اعمال شد', { migration: migration.name });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('اعمال مهاجرت شکست خورد', { migration: migration.name }, err);
      throw err;
    } finally {
      client.release();
    }
  }

  return pending.length;
}
