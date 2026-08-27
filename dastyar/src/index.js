/**
 * نقطهٔ ورود برنامه روی Cloudflare Workers
 *   - درخواست‌های /api/*  → مسیریاب API
 *   - بقیهٔ درخواست‌ها     → فایل‌های ظاهری برنامه (پوشهٔ public)
 *   - زمان‌بند (cron)      → یادآوری‌های خودکار
 */
import { handleApi } from './api.js';
import { runReminders } from './reminders.js';
import { json } from './util.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        const res = await handleApi(request, env, ctx);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
      } catch (err) {
        return json({ error: 'خطای سرور: ' + (err?.message || String(err)) }, 500);
      }
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    if (url.pathname === '/sw.js') headers.set('cache-control', 'no-cache');
    return new Response(res.body, { status: res.status, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).catch(() => {}));
  },
};
