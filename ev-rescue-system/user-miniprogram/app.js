/**
 * app.js - 全局逻辑
 * 绵阳24小时新能源应急充电救援 - 用户端
 */
const api = require('./utils/api.js')

App({
  globalData: {
    userInfo: null,
    token: null,
    loginCode: null,
    apiUrl: 'http://localhost:3000/api',
    servicePhone: '15228301555',
    systemInfo: null,
    statusBarHeight: 20,
    navBarHeight: 44
  },

  onLaunch() {
    // 获取系统信息（用于适配不同手机屏幕）
    try {
      const res = wx.getWindowInfo()
      this.globalData.systemInfo = res
      this.globalData.statusBarHeight = res.statusBarHeight || 20
    } catch (e) {
      console.error('获取系统信息失败', e)
    }

    // 尝试获取菜单按钮位置计算导航栏高度
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      this.globalData.navBarHeight = (menu.top - this.globalData.statusBarHeight) * 2 + menu.height
    } catch (e) {
      this.globalData.navBarHeight = 44
    }

    // 检查登录状态
    const token = wx.getStorageSync('token')
    if (token) {
      this.globalData.token = token
      this.getUserInfo()
    }

    // 预获取登录code（用于后续登录）
    this.getLoginCode()

    // 检查更新
    const updateManager = wx.getUpdateManager()
    updateManager.onCheckForUpdate(() => {})
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已就绪，是否重启应用？',
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate()
          }
        }
      })
    })
  },

  /**
   * 获取微信登录code
   */
  getLoginCode() {
    wx.login({
      success: (res) => {
        if (res.code) {
          this.globalData.loginCode = res.code
        }
      },
      fail: (err) => {
        console.error('获取登录code失败', err)
      }
    })
  },

  /**
   * 获取用户信息
   */
  getUserInfo() {
    api.getUserInfo().then(data => {
      this.globalData.userInfo = data
    }).catch(err => {
      console.error('获取用户信息失败', err)
      // token失效，清除并重新获取code
      wx.removeStorageSync('token')
      this.globalData.token = null
      this.globalData.userInfo = null
      this.getLoginCode()
    })
  },

  /**
   * 检查是否有进行中的订单
   */
  checkActiveOrder() {
    if (!this.globalData.token) return Promise.resolve(null)
    return api.getActiveOrder().then(data => {
      return data
    }).catch(() => {
      return null
    })
  }
})
