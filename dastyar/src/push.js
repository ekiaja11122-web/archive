/**
 * ارسال نوتیفیکیشن مرورگری (Web Push)
 * پیاده‌سازی مستقیم استانداردها بدون کتابخانهٔ بیرونی:
 *   - VAPID (RFC 8292) برای احراز هویت سرور
 *   - aes128gcm (RFC 8188 + RFC 8291) برای رمزگذاری محتوای پیام
 */
import { b64uToBytes, bytesToB64u, concatBytes, utf8, now } from './util.js';
import { getSetting, setSetting } from './auth.js';

/* ------------------------------------------------------------ کلیدهای VAPID */

/** کلیدهای VAPID را می‌خواند؛ اگر نبود، یک جفت کلید تازه می‌سازد و ذخیره می‌کند */
export async function ensureVapidKeys(env) {
  let pub = env.VAPID_PUBLIC_KEY || (await getSetting(env, 'vapid_public'));
  let priv = env.VAPID_PRIVATE_KEY || (await getSetting(env, 'vapid_private'));
  if (pub && priv) return { pub, priv };

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  pub = bytesToB64u(rawPub);
  priv = jwk.d;
  await setSetting(env, 'vapid_public', pub);
  await setSetting(env, 'vapid_private', priv);
  return { pub, priv };
}

async function importVapidKey(pub, priv) {
  const raw = b64uToBytes(pub); // 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true, d: priv,
    x: bytesToB64u(raw.slice(1, 33)),
    y: bytesToB64u(raw.slice(33, 65)),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidAuthHeader(env, endpoint) {
  const { pub, priv } = await ensureVapidKeys(env);
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(utf8(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:dastyar@example.com',
  })));
  const key = await importVapidKey(pub, priv);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${payload}`),
  ));
  return { header: `vapid t=${header}.${payload}.${bytesToB64u(sig)}, k=${pub}`, pub };
}

/* ------------------------------------------------------ رمزگذاری محتوای پیام */

async function hkdf(salt, ikm, info, length) {
  const extractKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', extractKey, ikm));
  const expandKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = new Uint8Array(await crypto.subtle.sign('HMAC', expandKey, concatBytes(info, new Uint8Array([1]))));
  return out.slice(0, length);
}

async function encryptPayload(text, p256dh, auth) {
  const uaPublic = b64uToBytes(p256dh);
  const authSecret = b64uToBytes(auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared,
    concatBytes(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concatBytes(utf8(text), new Uint8Array([2])); // ۲ = آخرین قطعه
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concatBytes(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* ------------------------------------------------------------------ ارسال */

/** ارسال یک نوتیفیکیشن به همهٔ دستگاه‌های ثبت‌شده */
export async function sendToAll(env, notification) {
  const { results } = await env.DB.prepare('SELECT * FROM push_subs').all();
  const subs = results || [];
  if (!subs.length) return { sent: 0, failed: 0 };

  const text = JSON.stringify(notification);
  let sent = 0, failed = 0;

  for (const sub of subs) {
    try {
      const body = await encryptPayload(text, sub.p256dh, sub.auth);
      const { header } = await vapidAuthHeader(env, sub.endpoint);
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: header,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'normal',
        },
        body,
      });
      if (res.ok) sent += 1;
      else {
        failed += 1;
        // اشتراک منقضی یا حذف‌شده → پاک شود
        if (res.status === 404 || res.status === 410) {
          await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id).run();
        }
      }
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}

/** ثبت یک دستگاه تازه */
export async function saveSubscription(env, sub, label) {
  const { endpoint, keys } = sub || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('اطلاعات اشتراک ناقص است');
  await env.DB.prepare(
    `INSERT INTO push_subs (id, endpoint, p256dh, auth, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
  ).bind(
    crypto.randomUUID().replace(/-/g, '').slice(0, 24),
    endpoint, keys.p256dh, keys.auth, (label || '').slice(0, 60), now(),
  ).run();
}
