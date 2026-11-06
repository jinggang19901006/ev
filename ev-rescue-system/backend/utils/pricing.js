const db = require('../db');
const time = require('./time');

// 判断是否夜间时段 (22:00 - 次日06:00)
function isNightTime(date) {
  const hour = time.hour(date);
  return hour >= 22 || hour < 6;
}

// 生成订单号
function generateOrderNo() {
  const now = time.parts();
  const y = now.year;
  const m = String(now.month).padStart(2, '0');
  const d = String(now.day).padStart(2, '0');
  const h = String(now.hour).padStart(2, '0');
  const min = String(now.minute).padStart(2, '0');
  const s = String(now.second).padStart(2, '0');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `EV${y}${m}${d}${h}${min}${s}${rand}`;
}

// 计算订单价格
function calculatePrice(vehicleType, distanceKm, orderTime, extraFee) {
  // 距离校验：防止异常值
  const dist = Math.max(0, Math.min(200, Number(distanceKm) || 0));
  const vType = (vehicleType || 'medium').toString().toLowerCase();

  // ==== 兜底：DB 找不到时用内置默认定价（防止坏 rescue.json 导致价格全空）====
  let config = null;
  try {
    config = db.prepare(`
      SELECT * FROM pricing_config WHERE vehicle_type = ? AND is_active = 1
    `).get(vType);
  } catch (e) { config = null; }

  // 3 车型内置默认（对齐 db.js 种子 + 烟测断言 medium 5km 日间 total=238）
  const FALLBACK = {
    small:  { day_price: 168, night_price: 198, base_distance_km: 5, extra_per_km: 6, vehicle_name: '小型轿车(A级)' },
    medium: { day_price: 238, night_price: 268, base_distance_km: 5, extra_per_km: 7, vehicle_name: '中型轿车/SUV' },
    large:  { day_price: 328, night_price: 368, base_distance_km: 5, extra_per_km: 10, vehicle_name: '大型车(MPV)' }
  };
  if (!config || config.day_price == null || config.night_price == null) {
    const fb = FALLBACK[vType] || FALLBACK.medium;
    // 把兜底写回 DB，下次就命中了
    try {
      const nextId = (db.prepare('SELECT COALESCE(MAX(id),0) m FROM pricing_config').get() || {}).m + 1;
      db.prepare(`
        INSERT INTO pricing_config (id, vehicle_type, vehicle_name, day_price, night_price, base_distance_km, extra_per_km, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(nextId, vType, fb.vehicle_name, fb.day_price, fb.night_price, fb.base_distance_km, fb.extra_per_km);
      config = { id: nextId, vehicle_type: vType, ...fb };
    } catch (e) {
      config = { vehicle_type: vType, ...fb };
    }
  }

  const night = isNightTime(orderTime);
  const basePrice = night ? config.night_price : config.day_price;

  // 超出基础距离的里程费
  let distanceFee = 0;
  if (dist > config.base_distance_km) {
    distanceFee = (dist - config.base_distance_km) * config.extra_per_km;
    distanceFee = Math.round(distanceFee * 100) / 100; // 保留两位小数
  }

  // extraFee可能是对象或数字
  let extra = 0;
  if (typeof extraFee === 'object' && extraFee !== null) {
    extra = Number(extraFee.highway || 0) + Number(extraFee.parking || 0) + Number(extraFee.other || 0);
  } else {
    extra = Number(extraFee) || 0;
  }

  const totalPrice = basePrice + distanceFee + extra;

  return {
    basePrice,
    distanceFee,
    extraFee: extra,
    totalPrice,
    isNight: night ? 1 : 0,
    baseDistance: config.base_distance_km,
    extraPerKm: config.extra_per_km,
    vehicleType: vType,
    vehicleName: config.vehicle_name || ''
  };
}

module.exports = { isNightTime, generateOrderNo, calculatePrice };
