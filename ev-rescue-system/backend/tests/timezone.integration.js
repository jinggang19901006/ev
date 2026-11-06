const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const time = require('../utils/time');
const clientTime = require('../../unified-miniprogram/utils/time');

const utcLateAfternoon = Date.UTC(2026, 10, 6, 16, 5, 6);
assert.strictEqual(time.format(utcLateAfternoon), '2026-11-07 00:05:06');
assert.strictEqual(time.dateKey(utcLateAfternoon), '2026-11-07');
assert.strictEqual(time.monthKey(utcLateAfternoon), '2026-11');
assert.strictEqual(time.nowISO().endsWith('+08:00'), true);

const parsedBeijing = time.parse('2026-11-07 00:05:06');
assert.strictEqual(parsedBeijing.getTime(), utcLateAfternoon);
assert.strictEqual(
  time.parse('2026-11-07T00:05:06+08:00').getTime(),
  utcLateAfternoon
);
assert.strictEqual(
  time.parse('2026-11-07').getTime(),
  Date.UTC(2026, 10, 6, 16, 0, 0)
);
assert.strictEqual(
  time.shiftUtcNaiveToBeijing('2026-11-06 16:05:06'),
  '2026-11-07 00:05:06'
);
assert.strictEqual(clientTime.formatDateTime('2026-11-06T16:05:06Z'), '2026-11-07 00:05');
assert.strictEqual(clientTime.formatDateTime('2026-11-07 00:05:06'), '2026-11-07 00:05');

const dbFile = path.join(os.tmpdir(), `ev-timezone-${process.pid}.json`);
fs.writeFileSync(dbFile, JSON.stringify({
  data: {
    users: [{ id: 1, created_at: '2026-11-06 16:05:06' }],
    service_cards: [{ id: 1, expired_at: '2026-12-01 23:59:59' }]
  },
  counters: { users: 1, service_cards: 1 }
}));
process.env.RESCUE_DB_FILE = dbFile;
const db = require('../db');
const { isNightTime } = require('../utils/pricing');

assert.strictEqual(db.data.users[0].created_at, '2026-11-07 00:05:06');
assert.strictEqual(db.data.service_cards[0].expired_at, '2026-12-01 23:59:59');
assert.strictEqual(db.counters.__beijing_time_v1, 1);
assert.match(db.now(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
db.initDefaults();
assert.strictEqual(db.data.users[0].created_at, '2026-11-07 00:05:06');
assert.strictEqual(isNightTime(time.parse('2026-11-07 23:00:00')), true);
assert.strictEqual(isNightTime(time.parse('2026-11-07 07:00:00')), false);

try { fs.unlinkSync(dbFile); } catch (error) {}

console.log(JSON.stringify({
  timezone: 'Asia/Shanghai',
  utcToBeijingBoundary: 'passed',
  naiveBeijingParsing: 'passed',
  clientFormatting: 'passed',
  nightPricingBoundary: 'passed',
  legacyMigrationOnce: 'passed'
}, null, 2));
