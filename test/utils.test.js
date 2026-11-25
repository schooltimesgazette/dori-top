'use strict';
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/utils');

test('isOpenNow: O‘zbekiston vaqti bo‘yicha hisoblaydi (UTC serverda ham)', () => {
  // 2026-11-25 05:00 UTC = 10:00 Toshkent
  const t = new Date('2026-11-25T05:00:00Z');
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '08:00', close_time: '22:00' }, t), true);
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '11:00', close_time: '22:00' }, t), false);
  // 18:00 UTC = 23:00 Toshkent -> 22:00 da yopiladi
  const late = new Date('2026-11-25T18:00:00Z');
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '08:00', close_time: '22:00' }, late), false);
});

test('isOpenNow: tungi smena, 24/7 va noto‘g‘ri format', () => {
  const night = new Date('2026-11-25T20:00:00Z'); // 01:00 Toshkent
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '20:00', close_time: '06:00' }, night), true);
  assert.equal(U.isOpenNow({ is_247: 1, open_time: '', close_time: '' }, night), true);
  assert.equal(U.isOpenNow({ is_247: 0, open_time: 'abc', close_time: '22:00' }, night), false);
  // yopilish vaqtining o'zida yopiq
  const exact = new Date('2026-11-25T17:00:00Z'); // 22:00 Toshkent
  assert.equal(U.isOpenNow({ is_247: 0, open_time: '08:00', close_time: '22:00' }, exact), false);
});

test('normalizePhone', () => {
  assert.equal(U.normalizePhone('90 123 45 67'), '+998901234567');
  assert.equal(U.normalizePhone('+998 (90) 123-45-67'), '+998901234567');
  assert.equal(U.normalizePhone('998901234567'), '+998901234567');
  assert.equal(U.isValidUserPhone(U.normalizePhone('abc')), false);
});

test('parseCsvLine: qo‘shtirnoq, "" va ; ajratgich', () => {
  assert.deepEqual(U.parseCsvLine('Aspirin,"Atsetilsalitsil, kislota",Bayer'), ['Aspirin', 'Atsetilsalitsil, kislota', 'Bayer']);
  assert.deepEqual(U.parseCsvLine('A,"5"" kattalik",B'), ['A', '5" kattalik', 'B']);
  assert.deepEqual(U.parseCsvLine('a;b;c', ';'), ['a', 'b', 'c']);
  assert.equal(U.detectDelimiter('name;active;price'), ';');
  assert.equal(U.detectDelimiter('name,active,price'), ',');
});

test('searchVariants: kirill -> lotin', () => {
  const v = U.searchVariants('Парацетамол');
  assert.ok(v.includes('paratsetamol') && v.includes('paracetamol'));
  assert.deepEqual(U.searchVariants('Analgin'), ['Analgin']);
  assert.deepEqual(U.searchVariants('   '), []);
});

test('escapeLike', () => {
  assert.equal(U.escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('validCoords / normalizeTime / daysSince', () => {
  assert.equal(U.validCoords(40.78, 72.34), true);
  assert.equal(U.validCoords(95, 10), false);
  assert.equal(U.validCoords(NaN, 10), false);
  assert.equal(U.normalizeTime('8:05'), '08:05');
  assert.equal(U.normalizeTime('25:00'), null);
  const twoDaysAgo = new Date(Date.now() - 2.5 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  assert.equal(U.daysSince(twoDaysAgo), 2);
});
