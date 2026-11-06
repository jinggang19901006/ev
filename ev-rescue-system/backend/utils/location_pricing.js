const db = require('../db');
const { calculatePrice } = require('./pricing');

const LOCATION_MAX_AGE_MS = 15 * 60 * 1000;
const ROUTE_CACHE_TTL_MS = 60 * 1000;
const ROUTE_TIMEOUT_MS = 5000;
const TENCENT_DIRECTION_ENDPOINT = 'https://apis.map.qq.com/ws/direction/v1/driving/';
const ACTIVE_ORDER_STATUSES = ['accepted', 'dispatched', 'arrived', 'charging'];
const routeCache = new Map();

function normalizeCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeLocation(lat, lng) {
  const latitude = normalizeCoordinate(lat, -90, 90);
  const longitude = normalizeCoordinate(lng, -180, 180);
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) return null;
  return { lat: latitude, lng: longitude };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const from = normalizeLocation(lat1, lng1);
  const to = normalizeLocation(lat2, lng2);
  if (!from || !to) return null;
  const radiusKm = 6371.0088;
  const toRad = degree => (degree * Math.PI) / 180;
  const deltaLat = toRad(to.lat - from.lat);
  const deltaLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function getTencentMapKey() {
  return String(process.env.TENCENT_MAP_KEY || db.getConfig('tencent_map_key', '') || '').trim();
}

function getDrivingPolicy() {
  const value = String(db.getConfig('tencent_map_driving_policy', 'SHORT_DISTANCE') || '').trim();
  return ['SHORT_DISTANCE', 'LEAST_TIME'].includes(value) ? value : 'SHORT_DISTANCE';
}

function coordinateText(location) {
  return `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`;
}

function cacheKey(from, to, policy) {
  return `${coordinateText(from)}|${coordinateText(to)}|${policy}`;
}

function readCachedRoute(key) {
  const item = routeCache.get(key);
  if (!item) return null;
  if (Date.now() - item.cachedAt > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return { ...item.value, cached: true };
}

async function getTencentDrivingRoute(lat1, lng1, lat2, lng2, options = {}) {
  const from = normalizeLocation(lat1, lng1);
  const to = normalizeLocation(lat2, lng2);
  if (!from || !to) throw new Error('起点或救援点坐标无效，无法计算驾车路线');

  const key = getTencentMapKey();
  if (!key) throw new Error('腾讯地图路线规划尚未配置，请管理员先填写腾讯位置服务 WebService Key');

  const policy = getDrivingPolicy();
  const keyForCache = cacheKey(from, to, policy);
  const cached = readCachedRoute(keyForCache);
  if (cached) return cached;

  const endpoint = process.env.TENCENT_MAP_API_BASE || TENCENT_DIRECTION_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set('from', coordinateText(from));
  url.searchParams.set('to', coordinateText(to));
  url.searchParams.set('key', key);
  url.searchParams.set('output', 'json');
  url.searchParams.set('policy', policy);
  url.searchParams.set('no_step', '1');
  url.searchParams.set('get_mp', '0');
  if (Number(options.accuracy) > 0) {
    url.searchParams.set('accuracy', String(Math.round(Number(options.accuracy))));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  let response;
  let body;
  try {
    response = await fetch(url, { signal: controller.signal });
    body = await response.json();
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? '腾讯地图路线规划请求超时，请稍后重试'
      : '腾讯地图路线规划网络异常，请稍后重试';
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`腾讯地图路线规划服务异常（HTTP ${response.status}）`);
  if (!body || Number(body.status) !== 0) {
    throw new Error(`腾讯地图路线规划失败：${String(body?.message || '未知错误').slice(0, 80)}`);
  }
  const route = body.result && Array.isArray(body.result.routes) ? body.result.routes[0] : null;
  const distanceMeters = Number(route?.distance);
  if (!route || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error('腾讯地图未返回有效驾车路线，请检查司机和救援点坐标');
  }

  const value = {
    distanceKm: Math.round(distanceMeters / 10) / 100,
    distanceMeters: Math.round(distanceMeters),
    durationMinutes: Number(route.duration) || 0,
    toll: Number(route.toll) || 0,
    policy,
    requestId: String(body.request_id || ''),
    source: 'tencent_driving_route',
    cached: false
  };
  routeCache.set(keyForCache, { cachedAt: Date.now(), value });
  return value;
}

function parseLocationTime(value) {
  if (!value) return null;
  const normalized = String(value).replace(' ', 'T');
  const timestamp = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z').getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseDatabaseTime(value) {
  if (!value) return new Date();
  const normalized = String(value).replace(' ', 'T');
  const date = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z');
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function hasFreshDriverLocation(driver, now = Date.now()) {
  if (!driver || !normalizeLocation(driver.lat, driver.lng)) return false;
  const updatedAt = parseLocationTime(driver.location_updated_at);
  return updatedAt !== null && now - updatedAt >= 0 && now - updatedAt <= LOCATION_MAX_AGE_MS;
}

function driverHasActiveOrder(driverId, exceptOrderId) {
  return (db.data.orders || []).some(order =>
    Number(order.driver_id) === Number(driverId) &&
    Number(order.id) !== Number(exceptOrderId) &&
    ACTIVE_ORDER_STATUSES.includes(order.status)
  );
}

function isApproved(driver) {
  return driver && (driver.approved === 1 || driver.approved === true || String(driver.approved) === '1');
}

async function findNearestAvailableDriver(pickupLat, pickupLng, options = {}) {
  const pickup = normalizeLocation(pickupLat, pickupLng);
  if (!pickup) return null;
  const allowBusy = options.allowBusy === true;
  const maxDistanceKm = Number.isFinite(Number(options.maxDistanceKm))
    ? Number(options.maxDistanceKm)
    : Infinity;

  const preliminary = (db.data.drivers || [])
    .filter(driver =>
      isApproved(driver) &&
      (driver.status === 'online' || (allowBusy && driver.status === 'busy')) &&
      !driverHasActiveOrder(driver.id, options.exceptOrderId) &&
      hasFreshDriverLocation(driver)
    )
    .map(driver => ({
      driver,
      straightLineKm: haversineKm(driver.lat, driver.lng, pickup.lat, pickup.lng)
    }))
    .filter(item => item.straightLineKm !== null && item.straightLineKm <= maxDistanceKm)
    .sort((a, b) => a.straightLineKm - b.straightLineKm)
    .slice(0, Math.min(20, Math.max(1, Number(options.maxCandidates) || 10)));

  if (!preliminary.length) return null;
  const settled = await Promise.allSettled(preliminary.map(async item => ({
    driver: item.driver,
    route: await getTencentDrivingRoute(
      item.driver.lat,
      item.driver.lng,
      pickup.lat,
      pickup.lng,
      { accuracy: item.driver.location_accuracy }
    )
  })));
  const successful = settled
    .filter(item => item.status === 'fulfilled')
    .map(item => item.value)
    .filter(item => item.route.distanceKm <= maxDistanceKm)
    .sort((a, b) => a.route.distanceKm - b.route.distanceKm);
  if (successful.length) {
    const nearest = successful[0];
    return { driver: nearest.driver, ...nearest.route };
  }
  const failure = settled.find(item => item.status === 'rejected');
  if (failure) throw failure.reason;
  return null;
}

async function calculateDistanceToOrder(order, driver) {
  if (!order || !driver || !hasFreshDriverLocation(driver)) return null;
  return getTencentDrivingRoute(
    driver.lat,
    driver.lng,
    order.pickup_lat,
    order.pickup_lng,
    { accuracy: driver.location_accuracy }
  );
}

async function applyAssignedDriverPricing(order, driver) {
  const route = await calculateDistanceToOrder(order, driver);
  if (!route) {
    return { ok: false, message: '司机定位无效或已超过15分钟，请司机重新上报当前位置后再接单' };
  }
  const result = calculatePrice(
    order.vehicle_type,
    route.distanceKm,
    parseDatabaseTime(order.created_at),
    Number(order.extra_fee || 0)
  );
  order.distance_km = route.distanceKm;
  order.base_price = result.basePrice;
  order.distance_fee = result.distanceFee;
  order.extra_fee = result.extraFee;
  order.total_price = result.totalPrice;
  order.is_night = result.isNight;
  order.distance_source = 'tencent_driving_route';
  order.distance_is_estimate = 0;
  order.distance_calculated_at = db.now();
  order.pricing_driver_id = driver.id;
  order.driver_start_lat = Number(driver.lat);
  order.driver_start_lng = Number(driver.lng);
  order.route_duration_minutes = route.durationMinutes;
  order.route_toll = route.toll;
  order.route_policy = route.policy;
  order.route_request_id = route.requestId;
  return { ok: true, distanceKm: route.distanceKm, route, price: result };
}

module.exports = {
  LOCATION_MAX_AGE_MS,
  normalizeLocation,
  haversineKm,
  getTencentDrivingRoute,
  hasFreshDriverLocation,
  findNearestAvailableDriver,
  calculateDistanceToOrder,
  applyAssignedDriverPricing
};
