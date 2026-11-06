const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { createTencentMapMock } = require('./tencent-map-mock');

const dbFile = path.join(os.tmpdir(), `ev-location-pricing-${process.pid}.json`);
const port = 31993;
const mapPort = 32094;
const baseUrl = `http://127.0.0.1:${port}/api`;
process.env.RESCUE_DB_FILE = dbFile;
process.env.TENCENT_MAP_KEY = 'TEST-TENCENT-MAP-KEY';
process.env.TENCENT_MAP_API_BASE = `http://127.0.0.1:${mapPort}/ws/direction/v1/driving/`;

const db = require('../db');
const locationPricing = require('../utils/location_pricing');
const mapMock = createTencentMapMock(mapPort);
const now = db.now();
db.data.users.push({
  id: 1,
  openid: 'location-price-user',
  phone: '13800000009',
  nickname: '定位计价测试用户',
  created_at: now
});
db.data.drivers.push({
  id: 1,
  openid: 'location-price-driver',
  phone: '13900000009',
  name: '定位计价测试司机',
  approved: 1,
  status: 'offline',
  rating: 5,
  level_id: 1,
  lat: null,
  lng: null,
  location_updated_at: null,
  created_at: now
});
db.counters.users = 1;
db.counters.drivers = 1;
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
  await mapMock.start();
  await waitForServer();
  const userHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 1, role: 'user' }, 'ev-rescue-secret-2024')}`
  };
  const driverHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: 1, role: 'driver' }, 'ev-rescue-secret-2024')}`
  };

  const onlineWithoutLocation = await request('/driver/status', {
    method: 'POST',
    headers: driverHeaders,
    body: JSON.stringify({ status: 'online' })
  });
  assert.notStrictEqual(onlineWithoutLocation.code, 0);
  assert.strictEqual(locationPricing.hasFreshDriverLocation({
    lat: 31.47,
    lng: 104.74,
    location_updated_at: '2020-01-01 00:00:00'
  }), false);

  const driverLat = 31.47;
  const driverLng = 104.74;
  const pickupLat = 31.55;
  const pickupLng = 104.74;
  const locationUpdated = await request('/driver/location', {
    method: 'POST',
    headers: driverHeaders,
    body: JSON.stringify({ latitude: driverLat, longitude: driverLng, accuracy: 8 })
  });
  assert.strictEqual(locationUpdated.code, 0, locationUpdated.message);

  const online = await request('/driver/status', {
    method: 'POST',
    headers: driverHeaders,
    body: JSON.stringify({ status: 'online' })
  });
  assert.strictEqual(online.code, 0, online.message);

  const expectedMeters = Math.round(
    locationPricing.haversineKm(driverLat, driverLng, pickupLat, pickupLng) * 1400 + 321
  );
  const expectedDistance = Math.round(expectedMeters / 10) / 100;
  assert(expectedDistance > 5 && expectedDistance < 30);

  const estimated = await request('/orders/estimate', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
      vehicleType: 'small',
      pickupLat,
      pickupLng,
      distanceKm: 199
    })
  });
  assert.strictEqual(estimated.code, 0, estimated.message);
  assert.strictEqual(estimated.data.distance_km, expectedDistance);
  assert.strictEqual(estimated.data.distance_source, 'tencent_driving_route_estimate');
  assert.strictEqual(estimated.data.route_policy, 'SHORT_DISTANCE');
  assert(/^mock-route-/.test(estimated.data.route_request_id));
  assert.strictEqual(
    estimated.data.total_price,
    Math.round((168 + (expectedDistance - 5) * 6) * 100) / 100
  );

  const created = await request('/orders/create', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
      vehicleType: 'small',
      pickupLat,
      pickupLng,
      pickupAddress: '定位计价隔离测试地址',
      distanceKm: 199
    })
  });
  assert.strictEqual(created.code, 0, created.message);
  assert.strictEqual(created.data.distance_km, expectedDistance);
  assert.strictEqual(created.data.total_price, estimated.data.total_price);

  const paid = await request(`/payments/order/${created.data.id}/deposit`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ mode: 'mock', pay_type: 'mock' })
  });
  assert.strictEqual(paid.code, 0, paid.message);
  assert.strictEqual(paid.data.dispatch.order.distance_source, 'tencent_driving_route');
  assert.strictEqual(paid.data.dispatch.order.distance_km, expectedDistance);
  assert.strictEqual(paid.data.dispatch.order.total_price, estimated.data.total_price);
  assert.strictEqual(mapMock.getRequestCount(), 1, '同一路线应命中60秒缓存，避免重复消耗腾讯配额');

  console.log(JSON.stringify({
    locationRequiredBeforeOnline: 'passed',
    clientDistanceIgnored: 'passed',
    calculatedDistanceKm: expectedDistance,
    excessDistancePricing: 'passed',
    assignedDriverRepricing: 'passed'
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
