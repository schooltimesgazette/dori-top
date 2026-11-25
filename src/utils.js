'use strict';

const TZ = process.env.APP_TIMEZONE || 'Asia/Tashkent';
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

// ---------------------------------------------------------------- vaqt
function parseTime(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function normalizeTime(str) {
  const mins = parseTime(str);
  if (mins === null) return null;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function nowMinutes(date = new Date()) {
  const parts = timeFmt.formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour').value);
  const m = Number(parts.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

// Server qaysi vaqt zonasida ishlashidan qat'i nazar, O'zbekiston vaqti bo'yicha hisoblaydi.
function isOpenNow(pharmacy, date = new Date()) {
  if (pharmacy.is_247) return true;
  const open = parseTime(pharmacy.open_time);
  const close = parseTime(pharmacy.close_time);
  if (open === null || close === null || open === close) return false;
  const now = nowMinutes(date);
  if (close < open) return now >= open || now < close; // tungi smena
  return now >= open && now < close;
}

// ---------------------------------------------------------------- telefon
function legacyNormalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').trim();
}

// 901234567 / 998901234567 / +998 90 123 45 67  ->  +998901234567
function normalizePhone(phone) {
  const cleaned = legacyNormalizePhone(phone);
  const hasPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 9) return '+998' + digits;
  if (digits.length === 12 && digits.startsWith('998')) return '+' + digits;
  return (hasPlus ? '+' : '') + digits;
}

function isValidUserPhone(p) {
  return /^\+?\d{9,15}$/.test(p);
}

// ---------------------------------------------------------------- matn
function cleanStr(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, ch => '\\' + ch);
}

// ---------------------------------------------------------------- kirill -> lotin
const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya',
  ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h'
};

function hasCyrillic(s) {
  return /[\u0400-\u04FF]/.test(s);
}

function transliterate(s, cAsTs = true) {
  return String(s).toLowerCase().replace(/[\u0400-\u04FF]/g, ch => {
    if (ch === 'ц' && !cAsTs) return 'c';
    return CYR[ch] ?? ch;
  });
}

// Qidiruv so'zining variantlari: kirill yozilsa lotin ko'rinishlari ham qidiriladi.
function searchVariants(q) {
  const base = cleanStr(q, 100);
  if (!base) return [];
  const set = new Set([base]);
  if (hasCyrillic(base)) {
    set.add(transliterate(base, true));
    set.add(transliterate(base, false));
  }
  return [...set].filter(Boolean);
}

// ---------------------------------------------------------------- CSV
function detectDelimiter(headerLine) {
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semi > comma ? ';' : ',';
}

function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------- geo
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// SQLite CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS") -> necha kun oldin
function daysSince(sqliteTs) {
  const t = Date.parse(String(sqliteTs || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

module.exports = {
  parseTime, normalizeTime, isOpenNow,
  legacyNormalizePhone, normalizePhone, isValidUserPhone,
  cleanStr, escapeLike, searchVariants, transliterate,
  detectDelimiter, parseCsvLine,
  haversineKm, validCoords, daysSince
};
