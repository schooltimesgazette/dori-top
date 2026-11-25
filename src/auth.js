'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

const isProd = process.env.NODE_ENV === 'production';

// env.example dagi namunaviy kalitlar hech qachon ishlatilmasligi kerak.
const KNOWN_WEAK = new Set([
  'dori_top_dev_secret_change_in_prod',
  'dori_top_super_secret_key_ozgartiring_2026',
  'CHANGE_ME'
]);

let JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET || JWT_SECRET.length < 32 || KNOWN_WEAK.has(JWT_SECRET)) {
  if (isProd) {
    console.error(
      '[XAVFSIZLIK] JWT_SECRET o‘rnatilmagan yoki juda zaif. Productionda server ishga tushmaydi.\n' +
      'Yangi kalit yarating:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
    process.exit(1);
  }
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[OGOHLANTIRISH] JWT_SECRET zaif/yo‘q: vaqtinchalik kalit ishlatilmoqda (server qayta ishga tushsa, hamma qayta kiradi).');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '14d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Kirish talab qilinadi.' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Sessiya muddati tugagan. Qayta kiring.' });
  }
  const freshUser = db.prepare('SELECT id, full_name, phone, role FROM users WHERE id = ?').get(payload.id);
  if (!freshUser) {
    return res.status(401).json({ error: 'Foydalanuvchi topilmadi.' });
  }
  req.user = freshUser; // rol har doim bazadan olinadi (tokendagi rolga ishonilmaydi)
  return next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bu amal uchun ruxsatingiz yetarli emas.' });
    }
    return next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
