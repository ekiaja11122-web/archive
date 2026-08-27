/**
 * پویش پوشهٔ هارد و استخراج اطلاعات فایل‌ها
 *
 * هیچ فایلی خوانده یا کپی نمی‌شود؛ تنها نام، حجم و قالب فایل‌ها فهرست می‌شود
 * تا کاربر مجبور نباشد اطلاعات ده‌ها جلسه را دستی تایپ کند.
 */
import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';

export const AUDIO_EXT = ['mp3', 'wav', 'wma', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'amr', 'ra', 'rm', 'opus', 'aiff'];
export const VIDEO_EXT = ['mp4', 'mkv', 'avi', 'wmv', 'mov', 'flv', 'mpg', 'mpeg', 'm4v', '3gp', 'webm', 'ts', 'vob', 'rmvb'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp'];
export const DOC_EXT = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];

const MAX_FILES = 3000;

/** حدس نوع رسانه از روی پسوند فایل */
export function kindOfExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (VIDEO_EXT.includes(e)) return 'video';
  if (IMAGE_EXT.includes(e)) return 'image';
  if (DOC_EXT.includes(e)) return 'document';
  return 'other';
}

/**
 * نخستین عدد معنادار در نام فایل را پیدا می‌کند تا شمارهٔ جلسه حدس زده شود.
 * «۰۳-تفسیر بقره.mp3» -> 3 ، «Jalase 12.mp3» -> 12
 * از اعدادی که بخشی از تاریخ یا کیفیت هستند (مثل 1080p یا 1398) پرهیز می‌شود.
 */
export function guessNumber(fileName) {
  const base = basename(String(fileName), extname(String(fileName)));
  const normalized = base.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

  // عددی که بلافاصله پس از واژه‌های «جلسه»/«قسمت»/«شماره» آمده، معتبرترین است
  const labelled = normalized.match(/(?:جلسه|جلسهٔ|قسمت|شماره|شمارهٔ|part|no|ep)\s*[.\-_]?\s*(\d{1,4})/i);
  if (labelled) return Number(labelled[1]);

  const numbers = [...normalized.matchAll(/\d+/g)].map((m) => ({ value: Number(m[0]), raw: m[0], index: m.index }));
  if (!numbers.length) return null;

  // اعداد چهاررقمی که به سال شمسی یا میلادی می‌خورند، شمارهٔ جلسه نیستند
  const plausible = numbers.filter((n) => {
    if (n.raw.length >= 4 && ((n.value >= 1300 && n.value <= 1500) || (n.value >= 1900 && n.value <= 2100))) return false;
    if (/^(?:1080|720|480|360|240|128|192|256|320)$/.test(n.raw)) return false;  // کیفیت یا بیت‌ریت
    return true;
  });
  const pool = plausible.length ? plausible : numbers;
  return pool[0].value;
}

/** مرتب‌سازی طبیعی: «۲» پیش از «۱۰» می‌آید */
const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

/**
 * پویش یک پوشه
 * @returns {Promise<{root: string, files: Array, truncated: boolean}>}
 */
export async function scanFolder({ path, recursive = false, kinds = null }) {
  const root = String(path || '').trim();
  if (!root) throw new Error('مسیر پوشه را وارد کنید');

  let info;
  try { info = await stat(root); }
  catch { throw new Error(`این مسیر پیدا نشد:\n${root}\nمطمئن شوید هارد وصل است و مسیر درست نوشته شده.`); }
  if (!info.isDirectory()) throw new Error('مسیر واردشده یک پوشه نیست');

  const files = [];
  let truncated = false;

  async function walk(dir, depth) {
    if (files.length >= MAX_FILES) { truncated = true; return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }                                   // پوشه‌های بدون دسترسی نادیده گرفته می‌شوند

    const dirs = [];
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) { dirs.push(entry); continue; }
      if (!entry.isFile()) continue;

      const ext = extname(entry.name).slice(1).toLowerCase();
      if (!ext) continue;
      const kind = kindOfExt(ext);
      if (kinds && kinds.length && !kinds.includes(kind)) continue;

      const full = join(dir, entry.name);
      let size = 0;
      try { size = (await stat(full)).size; } catch { /* نادیده */ }

      files.push({
        file_name: entry.name,
        folder_path: dir,
        rel_folder: relative(root, dir) || '',
        full_path: full,
        file_format: ext,
        media_kind: kind,
        size_mb: +(size / 1048576).toFixed(2),
        number: guessNumber(entry.name),
      });
    }

    if (recursive) {
      dirs.sort((a, b) => collator.compare(a.name, b.name));
      for (const d of dirs) await walk(join(dir, d.name), depth + 1);
    }
  }

  await walk(root, 0);

  files.sort((a, b) => collator.compare(a.rel_folder, b.rel_folder)
    || collator.compare(a.file_name, b.file_name));

  return { root, files, truncated };
}

/* ------------------------------------------------- خواندن مدت زمان فایل‌ها */

let ffprobeChecked = false;
let ffprobeAvailable = false;

/** آیا ابزار ffprobe روی این رایانه هست؟ (اختیاری — برای خواندن مدت زمان) */
export function hasFfprobe() {
  if (ffprobeChecked) return Promise.resolve(ffprobeAvailable);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true; ffprobeChecked = true; ffprobeAvailable = v; resolve(v);
    };
    try {
      const p = spawn('ffprobe', ['-version'], { stdio: 'ignore' });
      p.on('error', () => finish(false));
      p.on('close', (code) => finish(code === 0));
      setTimeout(() => { try { p.kill(); } catch { /* نادیده */ } finish(false); }, 3000);
    } catch { finish(false); }
  });
}

/** مدت زمان یک فایل به ثانیه — در صورت نبود ffprobe مقدار null برمی‌گردد */
export function probeDuration(filePath) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
      ]);
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('error', () => finish(null));
      p.on('close', () => {
        const sec = parseFloat(out.trim());
        finish(Number.isFinite(sec) && sec > 0 ? Math.round(sec) : null);
      });
      setTimeout(() => { try { p.kill(); } catch { /* نادیده */ } finish(null); }, 15000);
    } catch { finish(null); }
  });
}

/** خواندن مدت زمان چند فایل (به‌صورت محدود و موازی) */
export async function probeDurations(paths, concurrency = 4) {
  if (!await hasFfprobe()) return null;
  const result = {};
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
    while (index < paths.length) {
      const my = index++;
      result[paths[my]] = await probeDuration(paths[my]);
    }
  });
  await Promise.all(workers);
  return result;
}
