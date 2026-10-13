const express = require('express');
const db = require('../db');

module.exports = function(authMiddleware) {
  const router = express.Router();

  // 获取定价配置（公开接口，不需要登录）
  router.get('/pricing', (req, res) => {
    const configs = db.prepare('SELECT * FROM pricing_config WHERE is_active = 1 ORDER BY id').all();
    res.json({ code: 0, data: configs });
  });

  // 获取服务信息
  router.get('/service-info', (req, res) => {
    res.json({
      code: 0,
      data: {
        name: '新能源应急充电救援',
        power: '60kW大功率直流移动补电',
        area: '绵阳及周边30公里',
        phone: '15228301555',
        hours: '24小时服务',
        features: [
          '60kW大功率直流快充',
          '30分钟内快速到达',
          '上门救援，无需拖车',
          '专业团队，安全可靠'
        ]
      }
    });
  });

  return router;
};
