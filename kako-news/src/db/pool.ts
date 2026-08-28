/**
 * استخر اتصال PostgreSQL.
 *
 * یک استخر مشترک برای کل برنامه؛ همهٔ ماژول‌ها از همین‌جا کوئری می‌زنند
 * تا تعداد اتصال‌ها کنترل‌شده بماند.
 */
import pg from 'pg';
import { env } from '../config/env.ts';
import { createLogger } from '../lib/logger.ts';

const logger = createLogger('db');

// تاریخ‌ها را به‌صورت رشتهٔ خام نگیریم؛ pg خودش Date می‌سازد. اما
// BIGINT (oid 20) به‌صورت پیش‌فرض رشته برمی‌گردد تا دقت از دست نرود؛
// شناسه‌های ما در محدودهٔ امن عدد جاوااسکریپت هستند، پس تبدیلش می‌کنیم.
pg.types.setTypeParser(20, (value: string) => Number(value));
// NUMERIC نیز به عدد
pg.types.setTypeParser(1700, (value: string) => Number(value));

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const e = env();
  pool = new pg.Pool({
    connectionString: e.DATABASE_URL,
    ssl: e.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'kako-news',
  });

  pool.on('error', (err) => {
    // خطای اتصال بی‌کار نباید پروسه را بکشد
    logger.error('خطای غیرمنتظره در استخر اتصال دیتابیس', {}, err);
  });

  return pool;
}

export type QueryParams = readonly unknown[];

/** اجرای یک کوئری و گرفتن سطرها. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T[]> {
  const started = performance.now();
  const result = await getPool().query<T>(text, params as unknown[]);
  const ms = Math.round(performance.now() - started);
  if (ms > 500) {
    logger.warn('کوئری کند', { ms, sql: text.replace(/\s+/g, ' ').slice(0, 120) });
  }
  return result.rows;
}

/** اجرای کوئری‌ای که حداکثر یک سطر برمی‌گرداند. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** اجرای چند کوئری در یک تراکنش؛ در صورت خطا همه برمی‌گردند. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** بررسی در دسترس بودن دیتابیس. */
export async function ping(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    logger.error('اتصال به دیتابیس برقرار نشد', {}, err);
    return false;
  }
}

/** بستن تمیز اتصال‌ها هنگام خاموش شدن برنامه. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
