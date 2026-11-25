'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dori_top.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8'));

// Eski bazalarda dublikat bo'lsa ham server ishga tushaversin deb, migratsiyalar alohida bajariladi.
function safeExec(sql, label) {
  try { db.exec(sql); } catch (err) { console.warn(`[db] migratsiya o‘tkazib yuborildi (${label}): ${err.message}`); }
}
// Bitta foydalanuvchida bir vaqtda faqat bitta kutilayotgan ariza bo'lishi mumkin.
safeExec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_one_pending ON pharmacy_requests(user_id) WHERE status = 'pending'",
  'idx_requests_one_pending'
);

// better-sqlite3 transaction() API'siga mos yordamchi (ichma-ich chaqirishni ham qo'llaydi)
let txDepth = 0;
db.transaction = function (fn) {
  return function (...args) {
    const outer = txDepth === 0;
    if (outer) db.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const result = fn(...args);
      txDepth--;
      if (outer) db.exec('COMMIT');
      return result;
    } catch (err) {
      txDepth--;
      if (outer) { try { db.exec('ROLLBACK'); } catch (_) {} }
      throw err;
    }
  };
};

module.exports = db;
