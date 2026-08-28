/** مسیرهای پایهٔ پروژه، مستقل از اینکه برنامه از کجا اجرا شده باشد. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** ریشهٔ پروژه (پوشهٔ kako-news) */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const configDir = path.join(projectRoot, 'config');
export const migrationsDir = path.join(projectRoot, 'migrations');
export const dataDir = path.join(projectRoot, 'data');

/** مسیر نسبی داخل کانفیگ را به مسیر مطلق تبدیل می‌کند. */
export function fromRoot(...segments: string[]): string {
  return path.resolve(projectRoot, ...segments);
}
