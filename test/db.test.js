'use strict';
// SQL mantiqini haqiqiy node:sqlite bazasida tekshiradi (express kerak emas)
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dori-')), 'test.db');
const db = require('../src/db');
const U = require('../src/utils');

function user(name, phone, role = 'user') {
  return Number(db.prepare('INSERT INTO users (full_name, phone, password_hash, role) VALUES (?,?,?,?)').run(name, phone, 'x', role).lastInsertRowid);
}
function request(uid, license) {
  return db.prepare("INSERT INTO pharmacy_requests (user_id,name,license_number,city,address,phone,lat,lng) VALUES (?,?,?,?,?,?,?,?)")
    .run(uid, 'D', license, 'Andijon', 'Manzil 1', '+998900000000', 40.7, 72.3);
}

test('bitta foydalanuvchida faqat bitta pending ariza', () => {
  const u = user('A', '+998901111111');
  request(u, 'L1');
  assert.throws(() => request(u, 'L2'), /UNIQUE/);
  db.prepare("UPDATE pharmacy_requests SET status='rejected' WHERE user_id=?").run(u);
  request(u, 'L3'); // rad etilgandan keyin yangi ariza mumkin
});

test('transaction: xatoda ROLLBACK, ichma-ich chaqiruv ishlaydi', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  assert.throws(() => db.transaction(() => {
    user('T', '+998902222222');
    throw new Error('boom');
  })());
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before);
  db.transaction(() => { db.transaction(() => user('N', '+998903333333'))(); })();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before + 1);
});

test('LIKE qidiruvida % va _ oddiy belgi sifatida ishlaydi', () => {
  db.prepare("INSERT INTO medicines (name, active_ingredient) VALUES ('Vit_C','x'), ('VitXC','x'), ('50% sirop','y')").run();
  const pat = `%${U.escapeLike('vit_c')}%`;
  const rows = db.prepare("SELECT name FROM medicines WHERE LOWER(name) LIKE LOWER(?) ESCAPE '\\'").all(pat);
  assert.deepEqual(rows.map(r => r.name), ['Vit_C']);
  const pct = db.prepare("SELECT name FROM medicines WHERE name LIKE ? ESCAPE '\\'").all(`%${U.escapeLike('50%')}%`);
  assert.equal(pct.length, 1);
});

test('migratsiya: eski dublikat pending bo‘lsa ham db.js yiqilmaydi (safeExec)', () => {
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_requests_one_pending'").get());
});

test('VACUUM INTO zaxira ishlaydi', () => {
  const out = path.join(path.dirname(process.env.DB_PATH), 'backup.db');
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  assert.ok(fs.statSync(out).size > 0);
});
