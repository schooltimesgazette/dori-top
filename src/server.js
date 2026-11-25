'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { signToken, requireAuth, requireRole } = require('./auth');
const U = require('./utils');

const isProd = process.env.NODE_ENV === 'production';
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

// =========================================================================
// MIDDLEWARE
// =========================================================================
const cspEnabled = process.env.CSP_ENABLED !== 'false';
app.use(helmet({
  contentSecurityPolicy: cspEnabled ? {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://unpkg.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'self'"],
      'upgrade-insecure-requests': isProd ? [] : null
    }
  } : false
}));

// Frontend shu serverning o'zidan beriladi, shuning uchun CORS faqat alohida domen kerak bo'lsa yoqiladi.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) }));
}
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60000)).unref();
  return (req, res, next) => {
    const now = Date.now();
    let rec = hits.get(req.ip);
    if (!rec || rec.reset <= now) { rec = { count: 0, reset: now + windowMs }; hits.set(req.ip, rec); }
    rec.count++;
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, message: 'So‘rovlar juda ko‘p. Birozdan so‘ng urinib ko‘ring.' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Kirishga juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.' });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Ro‘yxatdan o‘tishga juda ko‘p urinish. Keyinroq urinib ko‘ring.' });
app.use('/api', apiLimiter);

// =========================================================================
// HELPERS
// =========================================================================
const ROLES = ['user', 'pharmacy_owner', 'admin'];
const STATUSES = ['available', 'low', 'out'];
const MAX_PRICE = 100000000;
const MAX_CSV_ROWS = 2000;
const DUMMY_HASH = bcrypt.hashSync('dori-top-dummy-password', 10);

const ADMIN_PHONE = process.env.ADMIN_PHONE ? U.normalizePhone(process.env.ADMIN_PHONE) : '';

function adminCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
}

// Birinchi foydalanuvchini avtomatik admin qilish faqat ADMIN_PHONE berilmagan va production bo'lmaganda ishlaydi.
function bootstrapOpen() {
  return !isProd && !ADMIN_PHONE && adminCount() === 0;
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function pharmacyView(p) {
  return { ...p, is_247: Boolean(p.is_247), open_now: U.isOpenNow(p) };
}

// Dorixona maydonlarini tekshiradi va tozalaydi. { value } yoki { error } qaytaradi.
function validatePharmacy(input, { requireLicense }) {
  const name = U.cleanStr(input.name, 120);
  const license = U.cleanStr(input.license_number, 60);
  const city = U.cleanStr(input.city, 80);
  const address = U.cleanStr(input.address, 200);
  const phone = U.cleanStr(input.phone, 30);
  const lat = typeof input.lat === 'number' ? input.lat : parseFloat(input.lat);
  const lng = typeof input.lng === 'number' ? input.lng : parseFloat(input.lng);
  const is247 = toBool(input.is_247) ? 1 : 0;
  const open = U.normalizeTime(input.open_time || '08:00');
  const close = U.normalizeTime(input.close_time || '22:00');

  if (name.length < 2 || !city || address.length < 3 || !phone) {
    return { error: 'Dorixona nomi, shahar, manzil va telefon majburiy.' };
  }
  if (requireLicense && !license) return { error: 'Litsenziya raqami majburiy.' };
  if (phone.replace(/\D/g, '').length < 5) return { error: 'Telefon raqami noto‘g‘ri.' };
  if (!U.validCoords(lat, lng)) return { error: 'Xaritadan dorixona joylashuvini to‘g‘ri belgilang.' };
  if (!open || !close) return { error: 'Ish vaqti formati noto‘g‘ri (SS:DD).' };
  return { value: { name, license_number: license, city, address, phone, lat, lng, is_247: is247, open_time: open, close_time: close } };
}

function licenseTaken(license, { exceptPharmacyId = null } = {}) {
  if (!license) return false;
  const inPharmacies = db.prepare(
    'SELECT id FROM pharmacies WHERE LOWER(license_number) = LOWER(?) AND id != ?'
  ).get(license, exceptPharmacyId ?? -1);
  if (inPharmacies) return true;
  return Boolean(db.prepare(
    "SELECT id FROM pharmacy_requests WHERE LOWER(license_number) = LOWER(?) AND status IN ('pending', 'approved')"
  ).get(license)) && exceptPharmacyId === null;
}

function canManagePharmacy(user, pharmacyId) {
  if (user.role === 'admin') return Boolean(db.prepare('SELECT id FROM pharmacies WHERE id = ?').get(pharmacyId));
  return Boolean(db.prepare('SELECT id FROM pharmacies WHERE id = ? AND owner_id = ?').get(pharmacyId, user.id));
}

function cleanMedicine(input) {
  return {
    name: U.cleanStr(input.name, 150),
    active_ingredient: U.cleanStr(input.active_ingredient, 150),
    manufacturer: U.cleanStr(input.manufacturer, 100),
    dosage: U.cleanStr(input.dosage, 50),
    category: U.cleanStr(input.category, 60) || 'Umumiy',
    prescription: toBool(input.prescription) ? 1 : 0
  };
}

// Katta-kichik harfga e'tiborsiz dublikatni topadi, bo'lmasa yaratadi.
function findOrCreateMedicine(m, userId) {
  const existing = db.prepare(`
    SELECT * FROM medicines
    WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(dosage)) = LOWER(?) AND LOWER(TRIM(manufacturer)) = LOWER(?)
  `).get(m.name, m.dosage, m.manufacturer);
  if (existing) return { medicine: existing, created: false };
  const info = db.prepare(`
    INSERT INTO medicines (name, active_ingredient, manufacturer, dosage, category, prescription, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category, m.prescription, userId);
  return { medicine: db.prepare('SELECT * FROM medicines WHERE id = ?').get(Number(info.lastInsertRowid)), created: true };
}

function buildSearchClause(q, columns) {
  const variants = U.searchVariants(q);
  if (!variants.length) return { sql: '1 = 1', params: [] };
  const conds = [];
  const params = [];
  for (const v of variants) {
    const pattern = `%${U.escapeLike(v)}%`;
    for (const col of columns) {
      conds.push(`LOWER(${col}) LIKE LOWER(?) ESCAPE '\\'`);
      params.push(pattern);
    }
  }
  return { sql: '(' + conds.join(' OR ') + ')', params };
}

function paging(req, defLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defLimit, 1), maxLimit);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return { limit, offset };
}

// Ega rolidagi foydalanuvchi uchun admin: telefon yoki id bo'yicha foydalanuvchini topish
function findUserByRef({ id, phone }) {
  if (id !== undefined && id !== null && id !== '') {
    const uid = parseInt(id, 10);
    if (Number.isInteger(uid)) return db.prepare('SELECT id, full_name, phone, role FROM users WHERE id = ?').get(uid);
  }
  if (phone) {
    const p = U.normalizePhone(phone);
    return db.prepare('SELECT id, full_name, phone, role FROM users WHERE phone = ? OR phone = ?').get(p, U.legacyNormalizePhone(phone));
  }
  return undefined;
}

// =========================================================================
// STARTUP: ADMIN_PHONE
// =========================================================================
if (ADMIN_PHONE) {
  db.prepare("UPDATE users SET role = 'admin' WHERE (phone = ? OR phone = ?) AND role != 'admin'")
    .run(ADMIN_PHONE, U.legacyNormalizePhone(process.env.ADMIN_PHONE));
}
if (isProd && !ADMIN_PHONE && adminCount() === 0) {
  console.error('[OGOHLANTIRISH] Tizimda admin yo‘q. Productionda birinchi foydalanuvchi avtomatik admin bo‘lmaydi — .env ga ADMIN_PHONE kiriting.');
}

// =========================================================================
// AUTH
// =========================================================================
app.get('/api/auth/bootstrap-status', (req, res) => {
  res.json({ hasAdmin: adminCount() > 0, bootstrapOpen: bootstrapOpen() });
});

app.post('/api/auth/register', registerLimiter, (req, res) => {
  const fullName = U.cleanStr(req.body.full_name, 100);
  const phone = U.normalizePhone(req.body.phone);
  const password = String(req.body.password || '');

  if (fullName.length < 2) {
    return res.status(400).json({ error: 'Ism-familiya kamida 2 ta belgidan iborat bo‘lishi kerak.' });
  }
  if (!U.isValidUserPhone(phone)) {
    return res.status(400).json({ error: 'To‘g‘ri telefon raqamini kiriting (masalan: +998901234567).' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.' });
  }
  if (password.length > 72) {
    return res.status(400).json({ error: 'Parol 72 ta belgidan oshmasligi kerak.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR phone = ?')
    .get(phone, U.legacyNormalizePhone(req.body.phone));
  if (existing) {
    return res.status(409).json({ error: 'Bu telefon raqami allaqachon ro‘yxatdan o‘tgan.' });
  }

  const role = (ADMIN_PHONE && phone === ADMIN_PHONE) || bootstrapOpen() ? 'admin' : 'user';
  const info = db.prepare(
    'INSERT INTO users (full_name, phone, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(fullName, phone, bcrypt.hashSync(password, 10), role);

  const user = { id: Number(info.lastInsertRowid), full_name: fullName, phone, role };
  return res.status(201).json({ user, token: signToken(user) });
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const phone = U.normalizePhone(req.body.phone);
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE phone = ? OR phone = ? ORDER BY (phone = ?) DESC LIMIT 1')
    .get(phone, U.legacyNormalizePhone(req.body.phone), phone);
  // Foydalanuvchi topilmasa ham bcrypt ishlatiladi (vaqt bo'yicha farqlab bo'lmasligi uchun)
  const passwordOk = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !passwordOk) {
    return res.status(401).json({ error: 'Telefon raqami yoki parol noto‘g‘ri.' });
  }
  const user = { id: row.id, full_name: row.full_name, phone: row.phone, role: row.role };
  return res.json({ user, token: signToken(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

// =========================================================================
// OCHIQ (LOGINSIZ) QIDIRUV ROUTE'LARI
// =========================================================================
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.get('/api/health', (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count;
  res.json({ status: 'ok', counts: { pharmacies: count('pharmacies'), medicines: count('medicines'), inventory: count('inventory') } });
});

app.get('/api/cities', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT city FROM pharmacies ORDER BY city ASC').all();
  res.json({ cities: rows.map(r => r.city) });
});

app.get('/api/medicines/popular', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, COUNT(i.id) AS offers_count,
           MIN(CASE WHEN i.status != 'out' THEN i.price END) AS min_price
    FROM medicines m
    LEFT JOIN inventory i ON i.medicine_id = m.id
    GROUP BY m.id
    ORDER BY offers_count DESC, m.id DESC
    LIMIT 8
  `).all();
  res.json({ medicines: rows });
});

app.get('/api/medicines/autocomplete', (req, res) => {
  const q = U.cleanStr(req.query.q, 100);
  const city = U.cleanStr(req.query.city || 'all', 80) || 'all';
  const clause = buildSearchClause(q, ['m.name', 'm.active_ingredient', 'm.category']);

  const rows = db.prepare(`
    SELECT m.*,
           COUNT(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN 1 END) AS available_count,
           MIN(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN i.price END) AS min_price
    FROM medicines m
    LEFT JOIN inventory i ON i.medicine_id = m.id
    LEFT JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE ${clause.sql}
    GROUP BY m.id
    ORDER BY available_count DESC, m.name ASC
    LIMIT 10
  `).all(city, city, city, city, ...clause.params);

  res.json({ medicines: rows });
});

app.get('/api/medicines/:id/offers', (req, res) => {
  const medId = parseInt(req.params.id, 10);
  if (!Number.isInteger(medId)) return res.status(400).json({ error: 'Noto‘g‘ri dori identifikatori.' });
  const med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(medId);
  if (!med) return res.status(404).json({ error: 'Dori topilmadi.' });

  const city = U.cleanStr(req.query.city || 'all', 80) || 'all';
  const availableOnly = req.query.availableOnly === 'true';
  const openNowOnly = req.query.openNow === 'true';
  const is247Only = req.query.is247 === 'true';
  const sortBy = req.query.sort === 'distance' ? 'distance' : 'price';
  const userLat = req.query.lat !== undefined ? parseFloat(req.query.lat) : NaN;
  const userLng = req.query.lng !== undefined ? parseFloat(req.query.lng) : NaN;
  const hasLocation = U.validCoords(userLat, userLng);

  const rawOffers = db.prepare(`
    SELECT i.id AS inventory_id, i.price, i.status, i.updated_at,
           p.id AS pharmacy_id, p.name AS pharmacy_name, p.city, p.address,
           p.phone, p.lat, p.lng, p.is_247, p.open_time, p.close_time
    FROM inventory i
    JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id = ? AND (? = 'all' OR p.city = ?)
  `).all(medId, city, city);

  const enrichedAll = rawOffers.map(r => ({
    ...r,
    is_247: Boolean(r.is_247),
    open_now: U.isOpenNow(r),
    distance_km: hasLocation ? U.haversineKm(userLat, userLng, r.lat, r.lng) : null,
    updated_days: U.daysSince(r.updated_at)
  }));

  const inStockAll = enrichedAll.filter(o => o.status !== 'out');
  const stats = {
    total_offers: enrichedAll.length,
    available_offers: inStockAll.length,
    min_price: inStockAll.length ? Math.min(...inStockAll.map(o => o.price)) : null,
    max_price: inStockAll.length ? Math.max(...inStockAll.map(o => o.price)) : null,
    avg_price: inStockAll.length
      ? Math.round(inStockAll.reduce((s, o) => s + o.price, 0) / inStockAll.length / 100) * 100
      : null
  };

  const filtered = enrichedAll.filter(o => {
    if (availableOnly && o.status === 'out') return false;
    if (openNowOnly && !o.open_now) return false;
    if (is247Only && !o.is_247) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'distance' && a.distance_km !== null && b.distance_km !== null) {
      return a.distance_km - b.distance_km;
    }
    const aOut = a.status === 'out' ? 1 : 0;
    const bOut = b.status === 'out' ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return a.price - b.price;
  });

  const analogs = db.prepare(`
    SELECT m.*,
           COUNT(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN 1 END) AS available_count,
           MIN(CASE WHEN i.status != 'out' AND (? = 'all' OR p.city = ?) THEN i.price END) AS min_price
    FROM medicines m
    LEFT JOIN inventory i ON i.medicine_id = m.id
    LEFT JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE m.id != ? AND LOWER(TRIM(m.active_ingredient)) = LOWER(TRIM(?))
    GROUP BY m.id
    ORDER BY min_price ASC
  `).all(city, city, city, city, medId, med.active_ingredient);

  res.json({ medicine: { ...med, prescription: Boolean(med.prescription) }, stats, offers: filtered, analogs });
});

// =========================================================================
// DORIXONA ARIZALARI (oddiy foydalanuvchi / ega -> admin tasdiqlaydi)
// =========================================================================
app.get('/api/my/pharmacy-requests', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM pharmacy_requests WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ requests: rows.map(r => ({ ...r, is_247: Boolean(r.is_247) })) });
});

app.post('/api/pharmacy-requests', requireAuth, (req, res) => {
  const v = validatePharmacy(req.body, { requireLicense: true });
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.value;

  if (db.prepare("SELECT id FROM pharmacy_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id)) {
    return res.status(409).json({ error: 'Sizda allaqachon ko‘rib chiqilayotgan ariza bor. Natijasini kuting.' });
  }
  if (licenseTaken(d.license_number)) {
    return res.status(409).json({ error: 'Bu litsenziya raqami bilan dorixona yoki ariza allaqachon mavjud.' });
  }

  const info = db.prepare(`
    INSERT INTO pharmacy_requests (user_id, name, license_number, city, address, phone, lat, lng, is_247, open_time, close_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, d.name, d.license_number, d.city, d.address, d.phone, d.lat, d.lng, d.is_247, d.open_time, d.close_time);

  const created = db.prepare('SELECT * FROM pharmacy_requests WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ request: { ...created, is_247: Boolean(created.is_247) } });
});

// =========================================================================
// DORIXONA EGASI ROUTE'LARI ('pharmacy_owner' va 'admin')
// =========================================================================
const ownerOrAdmin = [requireAuth, requireRole('pharmacy_owner', 'admin')];

app.get('/api/my/pharmacies', ...ownerOrAdmin, (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM pharmacies ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM pharmacies WHERE owner_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ pharmacies: rows.map(pharmacyView) });
});

// Ega: telefon, manzil, shahar, xarita nuqtasi, ish vaqti. Nom va litsenziyani faqat admin o'zgartiradi.
app.put('/api/pharmacies/:id', ...ownerOrAdmin, (req, res) => {
  const pharmacyId = parseInt(req.params.id, 10);
  const existing = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId)
    : db.prepare('SELECT * FROM pharmacies WHERE id = ? AND owner_id = ?').get(pharmacyId, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Dorixona topilmadi yoki sizga tegishli emas.' });

  const isAdmin = req.user.role === 'admin';
  const merged = {
    name: isAdmin && req.body.name !== undefined ? req.body.name : existing.name,
    license_number: isAdmin && req.body.license_number !== undefined ? req.body.license_number : existing.license_number,
    city: req.body.city ?? existing.city,
    address: req.body.address ?? existing.address,
    phone: req.body.phone ?? existing.phone,
    lat: req.body.lat ?? existing.lat,
    lng: req.body.lng ?? existing.lng,
    is_247: req.body.is_247 !== undefined ? req.body.is_247 : existing.is_247,
    open_time: req.body.open_time ?? existing.open_time,
    close_time: req.body.close_time ?? existing.close_time
  };
  const v = validatePharmacy(merged, { requireLicense: false });
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.value;
  if (isAdmin && d.license_number !== existing.license_number && licenseTaken(d.license_number, { exceptPharmacyId: pharmacyId })) {
    return res.status(409).json({ error: 'Bu litsenziya raqami boshqa dorixonada mavjud.' });
  }

  db.prepare(`
    UPDATE pharmacies
    SET name = ?, license_number = ?, city = ?, address = ?, phone = ?, lat = ?, lng = ?,
        is_247 = ?, open_time = ?, close_time = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(d.name, d.license_number, d.city, d.address, d.phone, d.lat, d.lng, d.is_247, d.open_time, d.close_time, pharmacyId);

  return res.json({ pharmacy: pharmacyView(db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId)) });
});

app.post('/api/medicines', ...ownerOrAdmin, (req, res) => {
  const m = cleanMedicine(req.body);
  if (!m.name || !m.active_ingredient) {
    return res.status(400).json({ error: 'Dori nomi va ta\'sir etuvchi moddasini kiriting.' });
  }
  try {
    const { medicine, created } = findOrCreateMedicine(m, req.user.id);
    const body = { medicine: { ...medicine, prescription: Boolean(medicine.prescription) } };
    if (!created) body.existed = true;
    return res.status(created ? 201 : 200).json(body);
  } catch (err) {
    console.error('[medicines] saqlashda xatolik:', err);
    return res.status(500).json({ error: 'Dorini saqlashda xatolik yuz berdi.' });
  }
});

// Admin va egalar uchun dorilar ro'yxati (qidiruv + sahifalash)
app.get('/api/medicines', ...ownerOrAdmin, (req, res) => {
  const { limit, offset } = paging(req);
  const clause = buildSearchClause(req.query.q, ['m.name', 'm.active_ingredient', 'm.manufacturer']);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM medicines m WHERE ${clause.sql}`).get(...clause.params).c;
  const rows = db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM inventory i WHERE i.medicine_id = m.id) AS offers_count
    FROM medicines m WHERE ${clause.sql} ORDER BY m.name ASC LIMIT ? OFFSET ?
  `).all(...clause.params, limit, offset);
  res.json({ medicines: rows.map(r => ({ ...r, prescription: Boolean(r.prescription) })), total, limit, offset });
});

app.get('/api/pharmacies/:id/inventory', ...ownerOrAdmin, (req, res) => {
  const pharmacyId = parseInt(req.params.id, 10);
  if (!canManagePharmacy(req.user, pharmacyId)) return res.status(403).json({ error: 'Ruxsat yo‘q.' });

  const items = db.prepare(`
    SELECT i.id, i.pharmacy_id, i.medicine_id, i.price, i.status, i.updated_at,
           m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id
    WHERE i.pharmacy_id = ? ORDER BY i.updated_at DESC
  `).all(pharmacyId);
  res.json({ inventory: items });
});

app.post('/api/pharmacies/:id/inventory', ...ownerOrAdmin, (req, res) => {
  const pharmacyId = parseInt(req.params.id, 10);
  if (!canManagePharmacy(req.user, pharmacyId)) return res.status(403).json({ error: 'Ruxsat yo‘q.' });

  const medicineId = parseInt(req.body.medicine_id, 10);
  const price = parseInt(req.body.price, 10);
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'available';
  if (!medicineId || Number.isNaN(price) || price < 0 || price > MAX_PRICE) {
    return res.status(400).json({ error: 'Dori va narxni to‘g‘ri kiriting.' });
  }
  if (!db.prepare('SELECT id FROM medicines WHERE id = ?').get(medicineId)) {
    return res.status(404).json({ error: 'Dori topilmadi.' });
  }

  db.prepare(`
    INSERT INTO inventory (pharmacy_id, medicine_id, price, status, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(pharmacy_id, medicine_id)
    DO UPDATE SET price = excluded.price, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).run(pharmacyId, medicineId, price, status);

  return res.status(201).json({ ok: true });
});

app.patch('/api/inventory/:id', ...ownerOrAdmin, (req, res) => {
  const invId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM inventory WHERE id = ?').get(invId);
  if (!existing || !canManagePharmacy(req.user, existing.pharmacy_id)) {
    return res.status(403).json({ error: 'Ombor yozuvi topilmadi yoki ruxsat yo‘q.' });
  }
  const price = req.body.price !== undefined ? parseInt(req.body.price, 10) : existing.price;
  const status = STATUSES.includes(req.body.status) ? req.body.status : existing.status;
  if (Number.isNaN(price) || price < 0 || price > MAX_PRICE) return res.status(400).json({ error: 'Narx noto‘g‘ri.' });

  db.prepare('UPDATE inventory SET price = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(price, status, invId);
  return res.json({ ok: true });
});

app.delete('/api/inventory/:id', ...ownerOrAdmin, (req, res) => {
  const invId = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM inventory WHERE id = ?').get(invId);
  if (!existing || !canManagePharmacy(req.user, existing.pharmacy_id)) {
    return res.status(403).json({ error: 'Ruxsat yo‘q.' });
  }
  db.prepare('DELETE FROM inventory WHERE id = ?').run(invId);
  return res.json({ deleted: true });
});

app.post('/api/pharmacies/:id/inventory/import-csv', ...ownerOrAdmin, (req, res) => {
  const pharmacyId = parseInt(req.params.id, 10);
  if (!canManagePharmacy(req.user, pharmacyId)) return res.status(403).json({ error: 'Ruxsat yo‘q.' });

  const csvText = String(req.body.csv || '').replace(/^\uFEFF/, '').trim();
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV faylda kamida sarlavha va 1 qator bo‘lishi kerak.' });
  if (lines.length - 1 > MAX_CSV_ROWS) {
    return res.status(400).json({ error: `Bir martada ko‘pi bilan ${MAX_CSV_ROWS} ta qator yuklash mumkin.` });
  }

  const delimiter = U.detectDelimiter(lines[0]);
  const upsertInv = db.prepare(`
    INSERT INTO inventory (pharmacy_id, medicine_id, price, status, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(pharmacy_id, medicine_id)
    DO UPDATE SET price = excluded.price, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `);

  const importTx = db.transaction((rows) => {
    let imported = 0;
    let skipped = 0;
    for (const cols of rows) {
      const price = parseInt(String(cols[5] || '').replace(/\s+/g, ''), 10);
      const statusRaw = U.cleanStr(cols[6] || 'available', 20).toLowerCase();
      const m = cleanMedicine({
        name: cols[0], active_ingredient: cols[1], manufacturer: cols[2],
        dosage: cols[3], category: cols[4],
        prescription: ['1', 'true', 'ha', 'yes', 'retsept'].includes(U.cleanStr(cols[7] || '', 10).toLowerCase())
      });
      if (!m.name || !m.active_ingredient || Number.isNaN(price) || price < 0 || price > MAX_PRICE) { skipped++; continue; }
      const { medicine } = findOrCreateMedicine(m, req.user.id);
      upsertInv.run(pharmacyId, medicine.id, price, STATUSES.includes(statusRaw) ? statusRaw : 'available');
      imported++;
    }
    return { imported, skipped };
  });

  return res.json(importTx(lines.slice(1).map(l => U.parseCsvLine(l, delimiter))));
});

// =========================================================================
// ADMIN PANEL ('admin')
// =========================================================================
const adminOnly = [requireAuth, requireRole('admin')];

app.get('/api/admin/overview', ...adminOnly, (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count;
  const stats = {
    users: count('users'),
    pharmacies: count('pharmacies'),
    pending_requests: db.prepare("SELECT COUNT(*) AS count FROM pharmacy_requests WHERE status = 'pending'").get().count,
    medicines: count('medicines'),
    inventory: count('inventory')
  };

  const requests = db.prepare(`
    SELECT r.*, u.full_name AS owner_name, u.phone AS owner_phone
    FROM pharmacy_requests r
    JOIN users u ON u.id = r.user_id
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC
  `).all();

  const users = db.prepare(`
    SELECT u.id, u.full_name, u.phone, u.role, u.created_at,
           (SELECT COUNT(*) FROM pharmacies p WHERE p.owner_id = u.id) AS pharmacy_count
    FROM users u ORDER BY u.id DESC
  `).all();

  const pharmacies = db.prepare(`
    SELECT p.*, u.full_name AS owner_name, u.phone AS owner_phone
    FROM pharmacies p JOIN users u ON u.id = p.owner_id
    ORDER BY p.id DESC
  `).all();

  res.json({ stats, requests, users, pharmacies });
});

app.post('/api/admin/requests/:id/approve', ...adminOnly, (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const appReq = db.prepare('SELECT * FROM pharmacy_requests WHERE id = ?').get(reqId);
  if (!appReq) return res.status(404).json({ error: 'Ariza topilmadi.' });
  if (appReq.status !== 'pending') return res.status(400).json({ error: 'Bu ariza allaqachon ko‘rib chiqilgan.' });
  if (db.prepare('SELECT id FROM pharmacies WHERE LOWER(license_number) = LOWER(?)').get(appReq.license_number)) {
    return res.status(409).json({ error: 'Bu litsenziya raqamli dorixona allaqachon mavjud. Arizani rad eting.' });
  }

  db.transaction(() => {
    db.prepare("UPDATE pharmacy_requests SET status = 'approved', admin_note = 'Tasdiqlandi', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reqId);
    db.prepare(`
      INSERT INTO pharmacies (owner_id, name, license_number, city, address, phone, lat, lng, is_247, open_time, close_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(appReq.user_id, appReq.name, appReq.license_number, appReq.city, appReq.address, appReq.phone, appReq.lat, appReq.lng, appReq.is_247, appReq.open_time, appReq.close_time);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(appReq.user_id);
  })();

  return res.json({ approved: true });
});

app.post('/api/admin/requests/:id/reject', ...adminOnly, (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const note = U.cleanStr(req.body.admin_note, 300) || 'Litsenziya yoki ma\'lumotlar tasdiqlanmadi.';
  const info = db.prepare(`
    UPDATE pharmacy_requests SET status = 'rejected', admin_note = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `).run(note, reqId);
  if (!info.changes) return res.status(404).json({ error: 'Kutilayotgan ariza topilmadi.' });
  return res.json({ rejected: true });
});

// Rol o'zgartirish. Egani oddiy foydalanuvchiga tushirishda uning dorixonalari taqdiri aniq tanlanishi shart:
// pharmacy_action = 'keep' | 'delete' | 'transfer' (+ transfer_to_phone / transfer_to_id)
app.patch('/api/admin/users/:id/role', ...adminOnly, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const role = req.body.role;
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Noto‘g‘ri rol.' });

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
  if (targetId === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'O‘zingizdan admin rolini olib tashlay olmaysiz.' });
  }
  if (target.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Tizimda kamida bitta admin qolishi kerak.' });
  }

  const pharmacyCount = db.prepare('SELECT COUNT(*) AS c FROM pharmacies WHERE owner_id = ?').get(targetId).c;
  const demotingToUser = role === 'user' && pharmacyCount > 0;
  const action = req.body.pharmacy_action;

  if (demotingToUser && !['keep', 'delete', 'transfer'].includes(action)) {
    return res.status(409).json({
      error: `Bu foydalanuvchining ${pharmacyCount} ta dorixonasi bor. Ular bilan nima qilish kerakligini tanlang.`,
      needs_decision: true,
      pharmacy_count: pharmacyCount
    });
  }

  let newOwner = null;
  if (demotingToUser && action === 'transfer') {
    newOwner = findUserByRef({ id: req.body.transfer_to_id, phone: req.body.transfer_to_phone });
    if (!newOwner) return res.status(404).json({ error: 'Dorixonalar o‘tkaziladigan foydalanuvchi topilmadi.' });
    if (newOwner.id === targetId) return res.status(400).json({ error: 'Dorixonalarni boshqa foydalanuvchiga o‘tkazing.' });
  }

  db.transaction(() => {
    if (demotingToUser && action === 'delete') {
      db.prepare('DELETE FROM pharmacies WHERE owner_id = ?').run(targetId);
    } else if (newOwner) {
      db.prepare('UPDATE pharmacies SET owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?').run(newOwner.id, targetId);
      db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(newOwner.id);
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  })();

  const body = { updated: true };
  if (role === 'pharmacy_owner' && pharmacyCount === 0) body.warning = 'no_pharmacy';
  return res.json(body);
});

// Mavjud dorixonani boshqa foydalanuvchiga biriktirish (u avtomatik "dorixona egasi" bo'ladi)
app.post('/api/admin/pharmacies/:id/owner', ...adminOnly, (req, res) => {
  const pharmacyId = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT id FROM pharmacies WHERE id = ?').get(pharmacyId)) {
    return res.status(404).json({ error: 'Dorixona topilmadi.' });
  }
  const user = findUserByRef({ id: req.body.owner_id, phone: req.body.owner_phone });
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });

  db.transaction(() => {
    db.prepare('UPDATE pharmacies SET owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id, pharmacyId);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(user.id);
  })();
  return res.json({ ok: true, owner: { id: user.id, full_name: user.full_name } });
});

app.post('/api/admin/pharmacies', ...adminOnly, (req, res) => {
  const owner = findUserByRef({ id: req.body.owner_id || req.user.id });
  if (!owner) return res.status(400).json({ error: 'Ega foydalanuvchi topilmadi.' });
  const v = validatePharmacy(req.body, { requireLicense: false });
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.value;
  if (d.license_number && licenseTaken(d.license_number)) {
    return res.status(409).json({ error: 'Bu litsenziya raqami bilan dorixona yoki ariza allaqachon mavjud.' });
  }

  const id = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO pharmacies (owner_id, name, license_number, city, address, phone, lat, lng, is_247, open_time, close_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(owner.id, d.name, d.license_number, d.city, d.address, d.phone, d.lat, d.lng, d.is_247, d.open_time, d.close_time);
    db.prepare("UPDATE users SET role = 'pharmacy_owner' WHERE id = ? AND role = 'user'").run(owner.id);
    return Number(info.lastInsertRowid);
  })();
  return res.status(201).json({ id });
});

app.delete('/api/admin/pharmacies/:id', ...adminOnly, (req, res) => {
  const info = db.prepare('DELETE FROM pharmacies WHERE id = ?').run(parseInt(req.params.id, 10));
  if (!info.changes) return res.status(404).json({ error: 'Dorixona topilmadi.' });
  return res.json({ deleted: true });
});

// ---- Dorilarni boshqarish (tahrirlash, o'chirish, dublikatlarni birlashtirish)
app.put('/api/admin/medicines/:id', ...adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Dori topilmadi.' });

  const m = cleanMedicine({ ...existing, ...req.body });
  if (!m.name || !m.active_ingredient) return res.status(400).json({ error: 'Dori nomi va ta\'sir etuvchi moddasi majburiy.' });
  const clash = db.prepare(`
    SELECT id FROM medicines WHERE id != ? AND LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(dosage)) = LOWER(?) AND LOWER(TRIM(manufacturer)) = LOWER(?)
  `).get(id, m.name, m.dosage, m.manufacturer);
  if (clash) return res.status(409).json({ error: `Bunday dori allaqachon mavjud (ID ${clash.id}). Dublikatni birlashtiring.`, existing_id: clash.id });

  db.prepare(`
    UPDATE medicines SET name = ?, active_ingredient = ?, manufacturer = ?, dosage = ?, category = ?, prescription = ? WHERE id = ?
  `).run(m.name, m.active_ingredient, m.manufacturer, m.dosage, m.category, m.prescription, id);
  return res.json({ ok: true });
});

app.delete('/api/admin/medicines/:id', ...adminOnly, (req, res) => {
  const info = db.prepare('DELETE FROM medicines WHERE id = ?').run(parseInt(req.params.id, 10));
  if (!info.changes) return res.status(404).json({ error: 'Dori topilmadi.' });
  return res.json({ deleted: true });
});

// from_id dorining barcha narxlarini to_id ga ko'chiradi (bir dorixonada ikkalasi bo'lsa, yangirog'i qoladi)
app.post('/api/admin/medicines/merge', ...adminOnly, (req, res) => {
  const fromId = parseInt(req.body.from_id, 10);
  const toId = parseInt(req.body.to_id, 10);
  if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId === toId) {
    return res.status(400).json({ error: 'Birlashtirish uchun ikkita turli dori ID kiriting.' });
  }
  if (!db.prepare('SELECT id FROM medicines WHERE id = ?').get(fromId) || !db.prepare('SELECT id FROM medicines WHERE id = ?').get(toId)) {
    return res.status(404).json({ error: 'Dorilardan biri topilmadi.' });
  }

  const moved = db.transaction(() => {
    let n = 0;
    for (const inv of db.prepare('SELECT * FROM inventory WHERE medicine_id = ?').all(fromId)) {
      const dup = db.prepare('SELECT * FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?').get(inv.pharmacy_id, toId);
      if (dup) {
        if (inv.updated_at > dup.updated_at) {
          db.prepare('UPDATE inventory SET price = ?, status = ?, updated_at = ? WHERE id = ?').run(inv.price, inv.status, inv.updated_at, dup.id);
        }
        db.prepare('DELETE FROM inventory WHERE id = ?').run(inv.id);
      } else {
        db.prepare('UPDATE inventory SET medicine_id = ? WHERE id = ?').run(toId, inv.id);
      }
      n++;
    }
    db.prepare('DELETE FROM medicines WHERE id = ?').run(fromId);
    return n;
  })();
  return res.json({ merged: true, moved_offers: moved });
});

// =========================================================================
// 404 / SPA / XATO HANDLER
// =========================================================================
app.use('/api', (req, res) => res.status(404).json({ error: 'Bunday API manzil topilmadi.' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'So‘rov formati noto‘g‘ri (JSON).' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Yuborilgan ma‘lumot juda katta.' });
  console.error('[xato]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: 'Serverda ichki xatolik yuz berdi.' });
});

// =========================================================================
// SQLITE ZAXIRA (BACKUP_DIR berilsa)
// =========================================================================
function startBackups() {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return;
  const hours = Math.max(parseFloat(process.env.BACKUP_EVERY_HOURS || '24'), 0.01);
  const keep = parseInt(process.env.BACKUP_KEEP || '7', 10);
  fs.mkdirSync(dir, { recursive: true });

  const run = () => {
    try {
      const file = path.resolve(dir, `dori_top_${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const old = fs.readdirSync(dir).filter(f => /^dori_top_.*\.db$/.test(f)).sort().reverse().slice(keep);
      old.forEach(f => fs.unlinkSync(path.join(dir, f)));
      console.log('[backup] saqlandi:', file);
    } catch (err) { console.error('[backup] xatolik:', err.message); }
  };
  run();
  setInterval(run, hours * 3600 * 1000).unref();
}

process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));

const server = app.listen(PORT, () => {
  console.log(`DORI TOP serveri ishga tushdi: http://localhost:${PORT}`);
  startBackups();
});

function shutdown() {
  server.close(() => { try { db.close(); } catch (_) {} process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
