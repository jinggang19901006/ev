// custom-tab-bar/index.js
// 角色感知自定义 tabBar：
//  - 用户端（还原老 user-miniprogram）：首页 / 订单 / 我的，纯文字，选中青色 #00d4ff
//  - 司机端（还原老 driver-miniprogram）：订单大厅 / 我的，图标+文字，选中橙色 #f59e0b
const app = getApp()

Component({
  data: {
    role: 'user',
    selected: 0,
    color: '#5a6a7a',
    selectedColor: '#00d4ff',
    list: []
  },

  lifetimes: {
    attached() {
      this.refresh()
    }
  },

  pageLifetimes: {
    // 每次所在 tab 页显示时刷新（角色切换 reLaunch 后也会触发）
    show() {
      this.refresh()
    }
  },

  methods: {
    refresh() {
      const role = (app.globalData && app.globalData.currentRole) === 'driver' ? 'driver' : 'user'
      const list = role === 'driver'
        ? [
            {
              pagePath: '/pages/home-driver/home-driver',
              text: '订单大厅',
              icon: '/assets/tab-orders.png',
              iconActive: '/assets/tab-orders-active.png'
            },
            {
              pagePath: '/pages/mine/mine',
              text: '我的',
              icon: '/assets/tab-mine.png',
              iconActive: '/assets/tab-mine-active.png'
            }
          ]
        : [
            { pagePath: '/pages/home-user/home-user', text: '首页' },
            { pagePath: '/pages/order-user/order-user', text: '订单' },
            { pagePath: '/pages/mine/mine', text: '我的' }
          ]
      const selectedColor = role === 'driver' ? '#f59e0b' : '#00d4ff'

      // 以当前页面路由计算选中项，无需各页面手动 setData
      let selected = 0
      try {
        const pages = getCurrentPages()
        const cur = pages.length ? '/' + pages[pages.length - 1].route : ''
        const idx = list.findIndex(i => i.pagePath === cur)
        if (idx >= 0) selected = idx
      } catch (e) { /* ignore */ }

      this.setData({ role, list, selectedColor, selected })
    },

    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      if (Number(index) === this.data.selected) return
      wx.switchTab({
        url: path,
        fail: () => {
          wx.reLaunch({ url: path })
        }
      })
    }
  }
})
