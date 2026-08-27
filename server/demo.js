/**
 * ساخت دادهٔ نمونه برای آشنایی با نرم‌افزار
 * اجرا:  npm run demo
 * پاک کردن دادهٔ نمونه:  npm run demo -- --clear
 *
 * توجه: این داده‌ها ساختگی و تنها برای آزمایش هستند.
 */
import { db } from './db.js';
import * as repo from './repo.js';

const CLEAR = process.argv.includes('--clear');

if (CLEAR) {
  db.exec(`DELETE FROM item_tags; DELETE FROM copies; DELETE FROM items;`);
  db.exec(`DELETE FROM drives WHERE notes = 'دادهٔ نمونه';`);
  repo.log('system', null, 'delete', 'دادهٔ نمونه پاک شد');
  console.log('\n  دادهٔ نمونه پاک شد. رکوردها و هاردهای نمونه حذف شدند.\n');
  process.exit(0);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const maybe = (v, chance = 0.7) => (Math.random() < chance ? v : null);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const DRIVES = [
  { name: 'هارد اصلی سخنرانی‌ها', capacity_gb: 2000, location: 'کمد بایگانی — طبقهٔ دوم', color: '#0e6f5c', media_type: 'hdd' },
  { name: 'هارد پشتیبان شمارهٔ ۱', capacity_gb: 2000, location: 'گاوصندوق دفتر', color: '#1d5fa8', is_backup: 1, media_type: 'hdd' },
  { name: 'هارد قدیمی نوارها', capacity_gb: 500, location: 'کمد بایگانی — طبقهٔ سوم', color: '#b4863c', media_type: 'hdd', health: 'warning' },
  { name: 'حافظهٔ SSD کاری', capacity_gb: 1000, location: 'روی میز کار', color: '#6b3fa0', media_type: 'ssd' },
  { name: 'آرشیو دی‌وی‌دی‌ها', capacity_gb: 250, location: 'جعبهٔ A-۳', color: '#c0392f', media_type: 'dvd', status: 'archived' },
];

const SERIES = [
  ['تفسیر سورهٔ بقره', 'تفسیر قرآن', 40],
  ['شرح نهج‌البلاغه', 'نهج‌البلاغه', 25],
  ['گناهان کبیره', 'اخلاق و معارف', 30],
  ['معاد و قیامت', 'اخلاق و معارف', 18],
  ['سخنرانی‌های ماه رمضان', 'ماه رمضان', 22],
  ['مجالس محرم', 'محرم و صفر', 12],
];

const TOPICS = ['تفسیر آیات', 'اخلاق اسلامی', 'معاد', 'توحید', 'نبوت', 'امامت', 'نماز', 'روزه',
  'صبر و استقامت', 'حقوق والدین', 'دنیا و آخرت', 'توبه', 'ولایت', 'شهادت'];
const OCCASIONS = ['ماه رمضان', 'محرم', 'شب قدر', 'عید غدیر', 'نیمهٔ شعبان', 'دههٔ فجر', 'ماه صفر', 'عید فطر'];
const PLACES = ['مسجد جامع عتیق', 'حسینیهٔ اعظم', 'مسجد نو', 'منزل شخصی', 'مصلای شهر', 'حوزهٔ علمیه'];
const CITIES = ['شیراز', 'تهران', 'قم', 'اصفهان'];
const SOURCES = ['نوار کاست اصلی', 'اهدایی خانواده', 'آرشیو صداوسیما', 'ضبط شخصی', 'کپی از دوستان'];
const CONTRIBUTORS = ['حاج آقا محمدی', 'خانوادهٔ مرحوم', 'آقای رضایی', 'هیئت امنا'];
const DEFECTS = [
  { flags: ['noise'], text: 'در سراسر فایل نویز پس‌زمینه شنیده می‌شود.' },
  { flags: ['cut_start'], text: 'حدود سه دقیقهٔ ابتدایی سخنرانی ضبط نشده است.' },
  { flags: ['cut_end', 'missing_part'], text: 'انتهای فایل ناقص است و یک بخش میانی افتاده.' },
  { flags: ['low_volume'], text: 'صدا بسیار کم است و نیاز به تقویت دارد.' },
  { flags: ['unknown_date'], text: 'تاریخ دقیق ایراد سخنرانی مشخص نیست.' },
];
const TAGS = ['مهم', 'نسخهٔ اصلی', 'نیازمند بازسازی', 'کیفیت پایین', 'منتشر شده', 'کمیاب', 'بازبینی شد'];

console.log('\n  در حال ساخت دادهٔ نمونه…');

repo.seedIfEmpty();

// هاردها
const driveIds = [];
for (const d of DRIVES) {
  const saved = repo.saveDrive({ ...d, notes: 'دادهٔ نمونه', last_check: '1404/12/01' }, 'نمونه');
  driveIds.push(saved.id);
}

const categories = repo.listCategories();
const catByName = Object.fromEntries(categories.map((c) => [c.name, c.id]));
const speaker = repo.listSpeakers()[0];

let made = 0;
for (const [seriesName, catName, count] of SERIES) {
  const total = Math.min(count, rint(6, 14));
  for (let i = 1; i <= total; i++) {
    const year = rint(1352, 1360);
    const month = rint(1, 12);
    const day = rint(1, 28);
    const hasDefect = Math.random() < 0.28;
    const defect = hasDefect ? pick(DEFECTS) : null;
    const isVideo = Math.random() < 0.18;

    // نسخه‌ها: بیشتر رکوردها روی هارد اصلی و پشتیبان
    const copies = [];
    const folder = `/Archive/${seriesName.replace(/\s/g, '_')}`;
    const fname = `${String(i).padStart(2, '0')}-${seriesName.replace(/\s/g, '_')}.${isVideo ? 'mp4' : 'mp3'}`;
    const sizeMb = isVideo ? rint(300, 900) : rint(15, 70);
    const roll = Math.random();
    if (roll > 0.08) {
      copies.push({ drive_id: driveIds[0], folder_path: folder, file_name: fname,
        file_format: isVideo ? 'mp4' : 'mp3', size_mb: sizeMb, copy_role: 'master',
        health: Math.random() < 0.05 ? 'corrupt' : 'ok', last_checked: '1404/12/01' });
    }
    if (roll > 0.42) {
      copies.push({ drive_id: driveIds[1], folder_path: '/Backup' + folder, file_name: fname,
        file_format: isVideo ? 'mp4' : 'mp3', size_mb: sizeMb, copy_role: 'backup', health: 'ok' });
    }
    if (Math.random() < 0.12) {
      copies.push({ drive_id: driveIds[2], folder_path: '/Old/Tapes', file_name: fname,
        file_format: 'wav', size_mb: sizeMb * 4, copy_role: 'converted', health: 'unchecked' });
    }

    repo.saveItem({
      title: `${seriesName} — جلسهٔ ${i}`,
      media_kind: isVideo ? 'video' : 'audio',
      speaker_id: speaker?.id,
      category_id: catByName[catName] ?? null,
      series: seriesName,
      part_no: i,
      part_total: count,
      topic: pick(TOPICS),
      occasion: maybe(pick(OCCASIONS), 0.5),
      event_place: pick(PLACES),
      city: pick(CITIES),
      speech_date: Math.random() < 0.85 ? `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}` : '',
      duration_sec: rint(1200, 4500),
      quality: pick(['excellent', 'good', 'good', 'average', 'poor', 'unknown']),
      completeness: hasDefect ? pick(['partial', 'fragment']) : 'complete',
      defect_flags: defect ? defect.flags : [],
      defects: defect ? defect.text : '',
      needs_work: hasDefect && Math.random() < 0.6,
      source: pick(SOURCES),
      contributor: maybe(pick(CONTRIBUTORS), 0.5),
      registered_by: pick(['مدیر آرشیو', 'همکار بایگانی']),
      verified: Math.random() < 0.55,
      published: Math.random() < 0.25,
      rating: rint(0, 5),
      is_favorite: Math.random() < 0.12,
      summary: `در این جلسه دربارهٔ ${pick(TOPICS)} سخن گفته می‌شود.`,
      tags: Math.random() < 0.6 ? [pick(TAGS)] : [],
      copies,
    }, 'نمونه');
    made++;
  }
}

console.log(`  ${made} رکورد نمونه و ${DRIVES.length} هارد نمونه ساخته شد.`);
console.log('  برای پاک کردن آن‌ها:  npm run demo -- --clear\n');
