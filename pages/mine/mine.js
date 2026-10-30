const collect = require('../../utils/collect.js')
const presets = require('../../data/presets.js')

const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    favs: [],
    rated: [],
    avg: 0,
    tab: 'fav'
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    // 收藏项里存了摘要，但「名称」可能因为来源不同而缺失，
    // 能用预设 id 反查就用反查的名字，更准
    const favs = collect.favList().map(function (f) {
      let name = f.name
      if (f.presetId) {
        const p = presets.byId(f.presetId)
        if (p) name = p.name
      }
      return Object.assign({}, f, { name: name || '未命名图纸' })
    })

    const rated = collect.ratedList().map(function (r) {
      const p = r.key.indexOf('p-') === 0 ? presets.byId(r.key) : null
      return Object.assign({}, r, { name: p ? p.name : '照片生成的图纸' })
    })

    this.setData({
      favs: favs,
      rated: rated,
      avg: collect.avgRating()
    })
  },

  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.k })
  },

  toDetail(e) {
    const id = e.currentTarget.dataset.preset
    if (!id) {
      wx.showToast({ title: '这是照片生成的图纸，重新生成一次才能打开', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/detail/detail?preset=' + id })
  },

  toGallery() {
    wx.switchTab({ url: '/pages/gallery/gallery' })
  },

  reset() {
    wx.showModal({
      title: '清空',
      content: '收藏和评价都会被删除，不可恢复。',
      confirmText: '清空',
      confirmColor: '#b8472f',
      success: (r) => {
        if (!r.confirm) return
        collect.resetAll()
        this.refresh()
        wx.showToast({ title: '已清空', icon: 'none' })
      }
    })
  }
})
