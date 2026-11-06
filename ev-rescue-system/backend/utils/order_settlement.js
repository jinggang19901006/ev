const db = require('../db');

function calculateIncome(order) {
  const total = Number(order?.total_price || 0);
  const commissionRate = Number(db.getConfig('commission_rate', '0.2'));
  const safeRate = Number.isFinite(commissionRate)
    ? Math.max(0, Math.min(1, commissionRate))
    : 0.2;
  const platformIncome = Math.round(total * safeRate * 100) / 100;
  const driverIncome = Math.round((total - platformIncome) * 100) / 100;
  return { total, commissionRate: safeRate, driverIncome, platformIncome };
}

function markPending(order) {
  if (!order) return { ok: false, message: '订单不存在' };
  const income = calculateIncome(order);
  order.driver_income = income.driverIncome;
  order.platform_income = income.platformIncome;
  order.settlement_status = 'pending';
  order.settled_at = null;
  return { ok: true, ...income };
}

function settleOrder(order, options = {}) {
  if (!order) return { ok: false, message: '订单不存在' };
  if (order.status !== 'completed') return { ok: false, message: '订单尚未完成' };
  if (order.payment_status !== 'paid') return { ok: false, message: '用户尚未完成支付' };
  if (order.settlement_status === 'settled') {
    return {
      ok: true,
      alreadySettled: true,
      driverIncome: Number(order.driver_income || 0),
      settledAt: order.settled_at
    };
  }

  const driver = (db.data.drivers || []).find(item => Number(item.id) === Number(order.driver_id));
  if (!driver) return { ok: false, message: '订单关联司机不存在' };

  const income = calculateIncome(order);
  const settledAt = options.settledAt || db.now();
  order.driver_income = income.driverIncome;
  order.platform_income = income.platformIncome;
  order.settlement_status = 'settled';
  order.settled_at = settledAt;
  order.user_confirmed_at = order.user_confirmed_at || settledAt;

  driver.total_earnings = Math.round((Number(driver.total_earnings || 0) + income.driverIncome) * 100) / 100;
  driver.wallet_balance = Math.round((Number(driver.wallet_balance || 0) + income.driverIncome) * 100) / 100;
  db.save();

  return {
    ok: true,
    alreadySettled: false,
    driverIncome: income.driverIncome,
    platformIncome: income.platformIncome,
    settledAt
  };
}

module.exports = {
  calculateIncome,
  markPending,
  settleOrder
};
