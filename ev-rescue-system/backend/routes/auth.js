/**
 * 统一认证路由 - 解决：
 *   需求1：用户端+司机端小程序合并到一个小程序，登录时选角色
 *   需求2：新用户注册/老用户登录分离，不再是填了账号就直接注册
 *
 * 表：unified_accounts 主账号 + users/drivers 两个角色表
 * JWT 载荷格式：{ id, openid, role: 'user'|'driver'|'admin', account_id }
 */

const helpers = require('../utils/helpers');

module.exports = function (jwt, JWT_SECRET, authMiddleware, uploadMiddleware) {
  const router = require('express').Router();
  const db = require('../db');

  // 统一签发JWT
  const sign = (payload, expiresIn = '30d') => jwt.sign(payload, JWT_SECRET, { expiresIn });

  // -----------------------------------------------------------
  // 公开接口：不需要登录
  // -----------------------------------------------------------

  /**
   * 1. 检查账号状态（注册/登录分流前置）
   * GET /api/auth/check-account?phone=xxx&wx_code=xxx（二选一）
   * 返回：{ exists, roles:['user'|'driver'], canLogin:boolean, needRegister:boolean, suggestNext:'login'|'register'|'role_switch' }
   */
  router.get('/check-account', async (req, res) => {
    try {
      const { phone, wx_code } = req.query;
      let openid = null, account = null;
      if (wx_code) {
        const wx = await helpers.wxCode2Session(wx_code);
        if (wx.error) return res.json({ code: 400, message: wx.error });
        openid = wx.openid;
        account = (db.data.unified_accounts || []).find(a => a.wx_openid === openid);
      } else if (phone) {
        if (!/^1[3-9]\d{9}$/.test(phone)) return res.json({ code: 400, message: '手机号格式不正确' });
        account = (db.data.unified_accounts || []).find(a => a.phone === phone);
      } else {
        return res.json({ code: 400, message: '请提供手机号或wx_code' });
      }

      if (!account) {
        return res.json({
          code: 0, message: 'ok',
          data: { exists: false, roles: [], canLogin: false, needRegister: true, suggestNext: 'register', openid }
        });
      }
      const roles = [];
      if (account.user_id) roles.push('user');
      if (account.driver_id) roles.push('driver');
      return res.json({
        code: 0, message: 'ok',
        data: {
          exists: true,
          account_id: account.id,
          phone: account.phone,
          nickname: account.nickname,
          avatar: account.avatar,
          roles,
          canLogin: roles.length > 0,
          needRegister: roles.length === 0,
          suggestNext: roles.length === 0 ? 'register' : (roles.length > 1 ? 'role_switch' : 'login'),
          last_login_role: account.last_login_role
        }
      });
    } catch (e) {
      res.status(500).json({ code: 500, message: e.message });
    }
  });

  /**
   * 2. 发送短信验证码（注册/登录/找回密码 场景）
   * POST /api/auth/send-sms  { phone, scene: 'login'|'register'|'bind' }
   */
  router.post('/send-sms', (req, res) => {
    const raw = req.body || {};
    const { phone } = raw;
    // 兼容别名：前端可能传 scene / sms_type / type，任取一个非空值
    const scene = (raw.scene || raw.sms_type || raw.type || 'login');
    const r = helpers.sendSmsCaptcha(phone, scene);
    res.json({ code: r.ok ? 0 : 400, message: r.message, data: r.devCode ? { dev_code: r.devCode } : undefined });
  });

  /**
   * 3. 老用户登录（手机号 + 短信验证码 + 选择role）
   * POST /api/auth/login-by-sms { phone, code, role, wx_code? }
   * 条件：账号必须已存在(needRegister=false) 且 已具备role对应的用户记录
   */
  router.post('/login-by-sms', async (req, res) => {
    try {
      const { phone, code, role, wx_code } = req.body || {};
      if (!['user', 'driver'].includes(role)) return res.json({ code: 400, message: '请选择登录身份' });
      const chk = helpers.verifySmsCaptcha(phone, code, 'login');
      if (!chk.ok) return res.json({ code: 400, message: chk.message });

      const account = (db.data.unified_accounts || []).find(a => a.phone === phone);
      if (!account) return res.json({ code: 400, message: '该手机号尚未注册，请先注册', suggestNext: 'register' });

      // 若用户有微信code：补充绑定openid
      if (wx_code) {
        const wx = await helpers.wxCode2Session(wx_code);
        if (wx && wx.openid) {
          account.wx_openid = account.wx_openid || wx.openid;
          // 同步写入 user.driver 的openid（兜底）
          if (role === 'user') {
            const u = (db.data.users || []).find(x => x.id === account.user_id);
            if (u && !u.openid) u.openid = wx.openid;
          } else {
            const d = (db.data.drivers || []).find(x => x.id === account.driver_id);
            if (d && !d.openid) d.openid = wx.openid;
          }
        }
      }

      const roleId = role === 'user' ? account.user_id : account.driver_id;
      if (!roleId) return res.json({ code: 400, message: `您还未开通${role === 'user' ? '普通用户' : '救援司机'}身份，请先注册该角色`, suggestNext: 'register' });

      account.last_login_at = db.now();
      account.last_login_role = role;
      db.save();

      const profile =
        role === 'user' ?
          (db.data.users || []).find(x => x.id === roleId) :
          (db.data.drivers || []).find(x => x.id === roleId);
      const token = sign({
        id: roleId,
        account_id: account.id,
        openid: account.wx_openid || profile.openid || '',
        role
      });
      res.json({
        code: 0, message: '登录成功',
        data: { token, role, profile, account: { id: account.id, phone: account.phone, nickname: account.nickname, avatar: account.avatar } }
      });
    } catch (e) {
      res.status(500).json({ code: 500, message: e.message });
    }
  });

  /**
   * 4. 微信一键登录（已绑定openid的老用户）
   * POST /api/auth/login-by-wx { code, role }
   * 若没注册，返回 suggestNext: register + openid
   */
  router.post('/login-by-wx', async (req, res) => {
    try {
      const { code, role } = req.body || {};
      const wx = await helpers.wxCode2Session(code);
      if (wx.error) return res.json({ code: 400, message: wx.error });
      const account = (db.data.unified_accounts || []).find(a => a.wx_openid === wx.openid);
      if (!account) return res.json({ code: 400, message: '该微信账号尚未绑定，请使用手机号注册', suggestNext: 'register', openid: wx.openid });
      const useRole = role || account.last_login_role || (account.user_id ? 'user' : 'driver');
      const roleId = useRole === 'user' ? account.user_id : account.driver_id;
      if (!roleId) return res.json({ code: 400, message: '账号未开通任何角色', suggestNext: 'register', openid: wx.openid });
      account.last_login_at = db.now();
      account.last_login_role = useRole;
      db.save();
      const profile = useRole === 'user' ? (db.data.users || []).find(x => x.id === roleId) : (db.data.drivers || []).find(x => x.id === roleId);
      const token = sign({ id: roleId, account_id: account.id, openid: wx.openid, role: useRole });
      res.json({ code: 0, message: 'ok', data: { token, role: useRole, profile, account: { id: account.id, phone: account.phone, nickname: account.nickname, avatar: account.avatar } } });
    } catch (e) { res.status(500).json({ code: 500, message: e.message }); }
  });

  /**
   * 5. 新用户注册（注册+指定角色）
   * POST /api/auth/register { phone, code, role, nickname?, avatar?, openid?, driverExtra? }
   * - 手机号必须未注册，且验证码必须是 register 场景
   * - role=user  → 创建users记录
   * - role=driver → 创建drivers记录（默认待审核 approved=0，后台审核后可接单）
   * - 两个角色可并存（同一个手机号+unified_account）
   */
  router.post('/register', async (req, res) => {
    try {
      const body = req.body || {};
      const { phone, code, role, nickname, avatar, openid } = body;
      const { driverExtra = {} } = body;
      if (!['user', 'driver'].includes(role)) return res.json({ code: 400, message: '请选择注册身份（用户或司机）' });
      if (!/^1[3-9]\d{9}$/.test(phone)) return res.json({ code: 400, message: '手机号格式不正确' });
      const chk = helpers.verifySmsCaptcha(phone, code, 'register');
      if (!chk.ok) return res.json({ code: 400, message: chk.message });

      let account = (db.data.unified_accounts || []).find(a => a.phone === phone);
      if (!account) {
        account = {
          id: db.nextId('unified_accounts'),
          phone,
          nickname: nickname || (role === 'driver' ? (driverExtra.name || '救援司机') : '微信用户'),
          avatar: avatar || '',
          wx_openid: openid || null,
          password_hash: null,
          status: 'active',
          user_id: null, driver_id: null,
          last_login_role: role,
          last_login_at: db.now(),
          created_at: db.now()
        };
        (db.data.unified_accounts = db.data.unified_accounts || []).push(account);
      } else {
        // 同一个主账号注册第二个角色（如从用户升级为司机）
        account.nickname = nickname || account.nickname;
        account.avatar = avatar || account.avatar;
        if (openid && !account.wx_openid) account.wx_openid = openid;
      }

      let roleId;
      if (role === 'user') {
        if (account.user_id) return res.json({ code: 409, message: '该手机号已注册用户身份，可直接登录', suggestNext: 'login' });
        const row = {
          id: db.nextId('users'),
          openid: account.wx_openid || '',
          phone,
          nickname: account.nickname,
          avatar: account.avatar,
          total_orders: 0,
          total_spent: 0,
          created_at: db.now()
        };
        db.data.users.push(row);
        account.user_id = row.id;
        roleId = row.id;
      } else {
        if (account.driver_id) return res.json({ code: 409, message: '该手机号已注册司机身份，可直接登录', suggestNext: 'login' });
        const row = {
          id: db.nextId('drivers'),
          openid: account.wx_openid || '',
          phone,
          name: driverExtra.name || account.nickname || '司机',
          avatar: account.avatar,
          id_card_no: driverExtra.id_card_no || '',
          status: 'offline',
          approved: 0, // 司机默认待审核
          rating: 5.0,
          total_orders: 0,
          total_earnings: 0,
          wallet_balance: 0,
          level_id: 1,
          accept_count_7d: 0,
          last_order_at: null,
          lat: 0,
          lng: 0,
          created_at: db.now()
        };
        db.data.drivers.push(row);
        account.driver_id = row.id;
        roleId = row.id;
        // 顺便初始化该司机信用积分(100)流水记录，便于后台查询
        db.data.credit_scores = db.data.credit_scores || [];
      }

      account.last_login_at = db.now();
      account.last_login_role = role;
      db.save();

      const profile = role === 'user' ?
        db.data.users.find(u => u.id === roleId) :
        db.data.drivers.find(d => d.id === roleId);
      const token = sign({ id: roleId, account_id: account.id, openid: account.wx_openid || '', role });
      return res.json({
        code: 0,
        message: role === 'driver' ? '注册成功，请等待后台审核（approved=1）后接单' : '注册成功',
        data: { token, role, profile, account: { id: account.id, phone: account.phone, nickname: account.nickname, avatar: account.avatar }, driver_need_approve: role === 'driver' }
      });
    } catch (e) { res.status(500).json({ code: 500, message: e.message }); }
  });

  /**
   * 6. 同一账号切换角色（用户 ↔ 司机）
   * POST /api/auth/switch-role { role }  需要已登录
   */
  router.post('/switch-role', authMiddleware, (req, res) => {
    const { role } = req.body || {};
    if (!['user', 'driver'].includes(role)) return res.json({ code: 400, message: '目标角色不正确' });
    const account = (db.data.unified_accounts || []).find(a => a.id === req.user.account_id);
    if (!account) return res.json({ code: 404, message: '账号不存在' });
    const targetId = role === 'user' ? account.user_id : account.driver_id;
    if (!targetId) return res.json({ code: 400, message: `您还未开通${role === 'user' ? '普通用户' : '救援司机'}身份，请先注册该角色` });
    account.last_login_role = role;
    account.last_login_at = db.now();
    db.save();
    const profile = role === 'user' ? db.data.users.find(u => u.id === targetId) : db.data.drivers.find(d => d.id === targetId);
    const token = sign({ id: targetId, account_id: account.id, openid: account.wx_openid || '', role });
    res.json({ code: 0, message: '切换成功', data: { token, role, profile } });
  });

  /**
   * 7. 查询当前账号信息（含所有可切换角色）
   * GET /api/auth/me  需要已登录
   */
  router.get('/me', authMiddleware, (req, res) => {
    const account = (db.data.unified_accounts || []).find(a => a.id === req.user.account_id);
    if (!account) return res.status(401).json({ code: 401, message: '账号不存在' });
    const roles = [];
    if (account.user_id) roles.push({ role: 'user', id: account.user_id });
    if (account.driver_id) roles.push({ role: 'driver', id: account.driver_id, approved: (db.data.drivers.find(d => d.id === account.driver_id) || {}).approved });
    const credit = helpers.getCreditScore(account.user_id);
    res.json({ code: 0, message: 'ok', data: { account, roles, credit_score: credit, current_role: req.user.role } });
  });

  return router;
};
