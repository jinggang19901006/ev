const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

const dbFile = path.join(os.tmpdir(), `ev-settlement-${process.pid}.json`);
const port = 31992;
const baseUrl = `http://127.0.0.1:${port}/api`;
process.env.RESCUE_DB_FILE = dbFile;

const db = require('../db');
const now = db.now();
db.data.users.push({
  id: 1,
  openid: 'settlement-user',
  phone: '13800000001',
  nickname: '结算测试用户',
  total_orders: 0,
  total_spent: 0,
  created_at: now
});
db.data.drivers.push({
  id: 1,
  openid: 'settlement-driver',
  phone: '13900000001',
  name: '结算测试司机',
  approved: 1,
  status: 'busy',
  rating: 5,
  total_orders: 0,
  total_earnings: 0,
  wallet_balance: 0,
  level_id: 1,
  lat: 31.47,
  lng: 104.74,
  created_at: now
});
db.data.orders.push({
  id: 1,
  order_no: 'EV_SETTLEMENT_TEST',
  user_id: 1,
  driver_id: 1,
  vehicle_type: 'small',
  pickup_address: '结算测试地址',
  status: 'charging',
  payment_status: 'deposit_paid',
  deposit_status: 'paid',
  deposit_amount: 30,
  total_price: 100,
  base_price: 100,
  distance_fee: 0,
  extra_fee: 0,
  settlement_status: 'unsettled',
  created_at: now
});
db.counters.users = 1;
db.counters.drivers = 1;
db.counters.orders = 1;
db.save();

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(port), RESCUE_DB_FILE: dbFile },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk.toString(); });

async function request(apiPath, options = {}) {
  const response = await fetch(baseUrl + apiPath, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return response.json();
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const result = await request('/health');
      if (result.code === 0) return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error(`测试服务启动失败: ${serverError}`);
}

async function run() {
  await waitForServer();
  const secret = 'ev-rescue-secret-2024';
  const driverHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 1, openid: 'settlement-driver', role: 'driver' }, secret)}`
  };
  const userHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 1, openid: 'settlement-user', role: 'user' }, secret)}`
  };

  const completed = await request('/driver/update-status/1', {
    method: 'POST',
    headers: driverHeaders,
    body: JSON.stringify({ progress: 'completed', after_photo: '/uploads/test.jpg' })
  });
  assert.strictEqual(completed.code, 0, completed.message);
  assert.strictEqual(completed.data.settlement_status, 'pending');

  const beforePay = await request('/driver/wallet', { headers: driverHeaders });
  assert.strictEqual(beforePay.data.balance, 0);
  assert.strictEqual(beforePay.data.total_earnings, 0);

  const pendingEarnings = await request('/driver/earnings', { headers: driverHeaders });
  assert.strictEqual(pendingEarnings.data.today.earnings, 0);
  assert.strictEqual(pendingEarnings.data.total.earnings, 0);
  assert.strictEqual(pendingEarnings.data.pending_earnings, 80);

  const summary = await request('/payments/order/1/summary', { headers: userHeaders });
  assert.strictEqual(summary.data.order.status, 'completed');
  assert.strictEqual(summary.data.order.payment_status, 'unpaid');
  assert.strictEqual(summary.data.order.settlement_status, 'pending');
  const ratingBeforePayment = await request('/orders/rate/1', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ rating: 5, comment: '不应提交成功' })
  });
  assert.notStrictEqual(ratingBeforePayment.code, 0);

  const paid = await request('/payments/order/1/final', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ mode: 'mock', pay_type: 'mock' })
  });
  assert.strictEqual(paid.code, 0, paid.message);
  assert.strictEqual(paid.data.payment_status, 'paid');
  assert.strictEqual(paid.data.settlement_status, 'settled');
  assert.strictEqual(paid.data.driver_income, 80);

  const afterPay = await request('/driver/wallet', { headers: driverHeaders });
  assert.strictEqual(afterPay.data.balance, 80);
  assert.strictEqual(afterPay.data.total_earnings, 80);

  const rated = await request('/orders/rate/1', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ rating: 4, comment: '响应及时，服务规范' })
  });
  assert.strictEqual(rated.code, 0, rated.message);
  assert.strictEqual(rated.data.driver_rating, 4);
  assert.strictEqual(rated.data.driver_rating_count, 1);
  const driverAfterRating = await request('/driver/info', { headers: driverHeaders });
  assert.strictEqual(driverAfterRating.data.rating, 4);
  assert.strictEqual(driverAfterRating.data.rating_count, 1);

  const repeatedRating = await request('/orders/rate/1', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ rating: 5, comment: '重复评价' })
  });
  assert.notStrictEqual(repeatedRating.code, 0);

  const paidAgain = await request('/payments/order/1/final', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ mode: 'mock', pay_type: 'mock' })
  });
  assert.strictEqual(paidAgain.code, 0);
  assert.strictEqual(paidAgain.data.already_paid, true);

  const afterRepeat = await request('/driver/wallet', { headers: driverHeaders });
  assert.strictEqual(afterRepeat.data.balance, 80);
  assert.strictEqual(afterRepeat.data.total_earnings, 80);

  const settledEarnings = await request('/driver/earnings', { headers: driverHeaders });
  assert.strictEqual(settledEarnings.data.today.earnings, 80);
  assert.strictEqual(settledEarnings.data.today.orders, 1);
  assert.strictEqual(settledEarnings.data.pending_earnings, 0);

  console.log(JSON.stringify({
    balanceBeforePayment: beforePay.data.balance,
    pendingIncome: pendingEarnings.data.pending_earnings,
    balanceAfterPayment: afterPay.data.balance,
    balanceAfterRepeatedPayment: afterRepeat.data.balance,
    settlementStatus: paid.data.settlement_status,
    driverRating: driverAfterRating.data.rating,
    repeatedRatingBlocked: true
  }, null, 2));
}

run()
  .catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill('SIGTERM');
    try { fs.unlinkSync(dbFile); } catch (error) {}
  });
