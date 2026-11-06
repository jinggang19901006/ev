const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { createTencentMapMock } = require('./tencent-map-mock');

const dbFile = path.join(os.tmpdir(), `ev-dispatch-${process.pid}.json`);
const port = 31991;
const mapPort = 32092;
const baseUrl = `http://127.0.0.1:${port}/api`;
process.env.RESCUE_DB_FILE = dbFile;
process.env.TENCENT_MAP_KEY = 'TEST-TENCENT-MAP-KEY';
process.env.TENCENT_MAP_API_BASE = `http://127.0.0.1:${mapPort}/ws/direction/v1/driving/`;

const db = require('../db');
const mapMock = createTencentMapMock(mapPort);
const now = db.now();
db.data.users.push({
  id: 1,
  openid: 'dispatch-test-user',
  phone: '13800000001',
  nickname: '调度测试用户',
  created_at: now
});
db.data.drivers.push(
  {
    id: 1,
    openid: 'dispatch-driver-near',
    phone: '13900000001',
    name: '近距V2司机',
    approved: 1,
    status: 'online',
    rating: 4.8,
    total_orders: 20,
    total_earnings: 0,
    wallet_balance: 0,
    level_id: 2,
    lat: 31.471,
    lng: 104.741,
    location_updated_at: now,
    created_at: now
  },
  {
    id: 2,
    openid: 'dispatch-driver-far',
    phone: '13900000002',
    name: '远距V4司机',
    approved: 1,
    status: 'online',
    rating: 4.9,
    total_orders: 180,
    total_earnings: 0,
    wallet_balance: 0,
    level_id: 4,
    lat: 31.55,
    lng: 104.82,
    location_updated_at: now,
    created_at: now
  },
  {
    id: 3,
    openid: 'dispatch-driver-spare',
    phone: '13900000003',
    name: '备用司机',
    approved: 1,
    status: 'offline',
    rating: 5,
    total_orders: 500,
    total_earnings: 0,
    wallet_balance: 0,
    level_id: 5,
    lat: 31.47,
    lng: 104.74,
    location_updated_at: now,
    created_at: now
  }
);
db.counters.users = 1;
db.counters.drivers = 3;
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

async function createAndPay(userHeaders, plate, address) {
  const created = await request('/orders/create', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
      vehicleType: 'small',
      vehiclePlate: plate,
      batteryPercent: 10,
      pickupLat: 31.47,
      pickupLng: 104.74,
      pickupAddress: address,
      distanceKm: 199
    })
  });
  assert.strictEqual(created.code, 0, created.message);
  assert.strictEqual(created.data.dispatch_status, 'waiting_deposit');
  assert.strictEqual(created.data.distance_source, 'tencent_driving_route_estimate');
  assert(created.data.distance_km < 30, '客户端伪造的199公里不应进入订单');
  const paid = await request(`/payments/order/${created.data.id}/deposit`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ mode: 'mock', pay_type: 'mock' })
  });
  assert.strictEqual(paid.code, 0, paid.message);
  return { created, paid };
}

async function run() {
  await mapMock.start();
  await waitForServer();
  const adminLogin = await request('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  assert.strictEqual(adminLogin.code, 0);
  const adminHeaders = { Authorization: `Bearer ${adminLogin.data.token}` };
  const userHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 1, openid: 'dispatch-test-user', role: 'user' }, 'ev-rescue-secret-2024')}`
  };

  const invalidSettings = await request('/dispatch/settings', {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      enabled: true,
      strategy: 'auto_assign',
      requireDeposit: true,
      allowBusy: false,
      distance: 0.4,
      rating: 0.4,
      level: 0.4,
      order: 0.4,
      maxDistanceKm: 30,
      maxCandidates: 10
    })
  });
  assert.notStrictEqual(invalidSettings.code, 0);

  const settings = {
    enabled: true,
    strategy: 'auto_assign',
    requireDeposit: true,
    allowBusy: false,
    distance: 0.55,
    rating: 0.2,
    level: 0.15,
    order: 0.1,
    maxDistanceKm: 30,
    maxCandidates: 10
  };
  const saved = await request('/dispatch/settings', {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify(settings)
  });
  assert.strictEqual(saved.code, 0, saved.message);

  const first = await createAndPay(userHeaders, '川BTEST1', '自动派单测试地址');
  assert.strictEqual(first.paid.data.dispatch.assigned, true);
  assert.strictEqual(first.paid.data.dispatch.driver.id, 1);
  assert.strictEqual(first.paid.data.dispatch.order.distance_source, 'tencent_driving_route');
  assert.strictEqual(first.paid.data.dispatch.order.distance_is_estimate, 0);

  const logs = await request('/dispatch/logs?limit=10', { headers: adminHeaders });
  assert(logs.data.some(log =>
    log.order_id === first.created.data.id &&
    log.selected_driver_id === 1 &&
    log.mode === 'auto_assign'
  ));

  const driverHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 1, openid: 'dispatch-driver-near', role: 'driver' }, 'ev-rescue-secret-2024')}`
  };
  const driverInfo = await request('/driver/info', { headers: driverHeaders });
  assert.strictEqual(driverInfo.data.level_info.level, 'V2');
  assert.strictEqual(driverInfo.data.next_level.level, 'V3');

  const recommendSaved = await request('/dispatch/settings', {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ ...settings, strategy: 'recommend_only' })
  });
  assert.strictEqual(recommendSaved.code, 0);
  const spareHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 3, openid: 'dispatch-driver-spare', role: 'driver' }, 'ev-rescue-secret-2024')}`
  };
  const spareOnline = await request('/driver/status', {
    method: 'POST',
    headers: spareHeaders,
    body: JSON.stringify({ status: 'online' })
  });
  assert.strictEqual(spareOnline.code, 0);
  const second = await createAndPay(userHeaders, '川BTEST2', '推荐模式测试地址');
  assert.strictEqual(second.paid.data.dispatch.assigned, false);

  const queue = await request('/dispatch/queue', { headers: adminHeaders });
  assert(queue.data.list.some(order =>
    order.id === second.created.data.id && order.candidate_count > 0
  ));

  const busyAssign = await request(`/admin/orders/${second.created.data.id}/assign`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ driverId: 1 })
  });
  assert.notStrictEqual(busyAssign.code, 0);

  const manualAssign = await request(`/admin/orders/${second.created.data.id}/assign`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ driverId: 3 })
  });
  assert.strictEqual(manualAssign.code, 0, manualAssign.message);
  assert.strictEqual(manualAssign.data.order.dispatch_mode, 'manual');

  console.log(JSON.stringify({
    settingsValidation: 'passed',
    automaticDriver: first.paid.data.dispatch.driver.name,
    recommendOnlyQueue: 'passed',
    busyDriverGuard: 'passed',
    manualAssignment: 'passed',
    driverLevel: driverInfo.data.level_info.level
  }, null, 2));
}

run()
  .catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill('SIGTERM');
    mapMock.close().catch(() => {});
    try { fs.unlinkSync(dbFile); } catch (error) {}
  });
