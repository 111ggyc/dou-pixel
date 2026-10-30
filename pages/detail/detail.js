const presets = require('../../data/presets.js')
const pattern = require('../../utils/pattern.js')
const mat = require('../../utils/materials.js')
const collect = require('../../utils/collect.js')
const seedComments = require('../../data/comments.js')

const app = getApp()

const KIND_LIST = [
  { key: 'bead', name: '拼豆' },
  { key: 'stitch', name: '刺绣' },
  { key: 'pixel', name: '像素画' }
]

Page({
  data: {
    statusBarHeight: 20,
    title: '',
    fromPreset: '',

    kinds: KIND_LIST,
    kind: 'bead',

    beads: mat.BEADS,
    beadKey: 'midi',

    cloths: mat.CLOUTHS || [],
    clothKey: '14ct',
    marginCm: 5,

    chart: null,
    plan: null,

    cvW: 0,
    cvH: 0,

    fav: false,
    rating: null,

    // 点赞。总数 = 演示基数 + 他自己这一票
    liked: false,
    demoLikes: 0,
    likeTotal: 0,

    // 评论。演示评论 + 本机写的，拼在一起显示
    comments: [],
    commentCount: 0,
    newComment: '',

    // 评价表单
    showRate: false,
    rateStars: 5,
    rateNote: '',

    saved: false
  },

  onLoad(query) {
    this.presetId = query.preset || ''
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      cloths: mat.CLOTHS
    })
  },

  onShow() {
    this.build()
  },

  /** 取到图纸：预设图案，或首页生成好放在 globalData 里的 */
  build() {
    let chart = null
    let title = ''
    let fromPreset = ''

    if (this.presetId) {
      const p = presets.byId(this.presetId)
      chart = p ? presets.toChart(p) : null
      title = p ? p.name : ''
      fromPreset = this.presetId
    } else {
      chart = app.globalData.currentChart
      title = '照片生成'
    }

    if (!chart) {
      wx.showToast({ title: '图纸没了，重新生成一次', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 800)
      return
    }

    // 生成的图纸用尺寸+调色板做签名，这样同样参数再来一次还能带出收藏和评价
    this.key = fromPreset
      ? fromPreset
      : collect.signature(chart.cols, chart.rows, chart.palette)

    // 画布按格子比例适配
    const g = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const maxW = g.windowWidth - 56
    const maxH = g.windowHeight * 0.42
    const ar = chart.cols / chart.rows

    let w = maxW
    let h = maxW / ar
    if (h > maxH) {
      h = maxH
      w = maxH * ar
    }

    // 点赞：预设图案有演示基数，照片生成的是 0
    const p = fromPreset ? presets.byId(fromPreset) : null
    const demoLikes = p ? (p.likes || 0) : 0
    const liked = collect.isLiked(this.key)

    this.setData({
      chart: chart,
      title: title,
      fromPreset: fromPreset,
      cvW: Math.round(w),
      cvH: Math.round(h),
      fav: collect.isFav(this.key),
      rating: collect.getRating(this.key),
      liked: liked,
      demoLikes: demoLikes,
      likeTotal: demoLikes + (liked ? 1 : 0)
    }, () => {
      this.draw()
      this.refreshPlan()
      this.refreshComments()
    })
  },

  /** 演示评论在前（早），自己写的在后（新） */
  refreshComments() {
    const demo = this.data.fromPreset ? seedComments.forPreset(this.data.fromPreset) : []
    const mine = collect.comments(this.key)

    const list = demo.map(function (c) {
      return { text: c.text, at: c.at, mine: false }
    }).concat(mine.map(function (c, i) {
      return { text: c.text, at: c.at, mine: true, idx: i }
    }))

    this.setData({ comments: list, commentCount: list.length })
  },

  // ── 点赞 ──────────────────────────────────────────

  toggleLike() {
    const now = collect.toggleLike(this.key)
    this.setData({
      liked: now,
      likeTotal: this.data.demoLikes + (now ? 1 : 0)
    })
    wx.showToast({ title: now ? '已点赞' : '已取消', icon: 'none' })
  },

  // ── 评论 ──────────────────────────────────────────

  onComment(e) {
    this.setData({ newComment: e.detail.value })
  },

  submitComment() {
    const t = String(this.data.newComment || '').trim()
    if (!t) {
      wx.showToast({ title: '写点什么再发', icon: 'none' })
      return
    }
    collect.addComment(this.key, t)
    this.setData({ newComment: '' })
    this.refreshComments()
    wx.showToast({ title: '已发布', icon: 'success' })
  },

  removeComment(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    wx.showModal({
      title: '删除评论',
      content: '确定要删除这条评论吗？',
      confirmText: '删除',
      confirmColor: '#b8472f',
      success: (r) => {
        if (!r.confirm) return
        collect.removeComment(this.key, idx)
        this.refreshComments()
        wx.showToast({ title: '已删除', icon: 'none' })
      }
    })
  },

  draw() {
    const { cvW, cvH, chart, kind } = this.data
    if (!cvW || !chart) return

    wx.createSelectorQuery().in(this).select('#cv')
      .fields({ node: true, size: true })
      .exec((res) => {
        const r = res && res[0]
        if (!r || !r.node) return

        const canvas = r.node
        const g = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = Math.min(g.pixelRatio || 2, 2)
        const W = Math.round(cvW * dpr)
        const H = Math.round(cvH * dpr)

        if (canvas.width !== W) canvas.width = W
        if (canvas.height !== H) canvas.height = H

        pattern.paintChart(canvas.getContext('2d'), W, H, chart, kind)
      })
  },

  /** 材料方案（拼豆 / 刺绣 / 像素画 三种口径） */
  refreshPlan() {
    const chart = this.data.chart
    if (!chart) return

    const plan = mat.planFor(this.data.kind, chart.cols, chart.rows, chart.palette, {
      bead: this.data.beadKey,
      cloth: this.data.clothKey,
      marginCm: this.data.marginCm
    })

    this.setData({ plan: plan })
  },

  setKind(e) {
    const k = e.currentTarget.dataset.k
    if (k === this.data.kind) return
    this.setData({ kind: k }, () => {
      this.draw()
      this.refreshPlan()
    })
  },

  goBack() {
    wx.navigateBack({
      fail: function () {
        // 从分享链接直接进来的话没有上一页，退回图纸库
        wx.switchTab({ url: '/pages/gallery/gallery' })
      }
    })
  },

  setBead(e) {
    this.setData({ beadKey: e.currentTarget.dataset.k }, () => this.refreshPlan())
  },

  setCloth(e) {
    this.setData({ clothKey: e.currentTarget.dataset.k }, () => this.refreshPlan())
  },

  // ── 收藏 ──────────────────────────────────────────

  toggleFav() {
    const chart = this.data.chart
    const now = collect.toggleFav(this.key, {
      name: this.data.title,
      kind: this.data.kind,
      cols: chart.cols,
      rows: chart.rows,
      colors: chart.palette.length,
      presetId: this.data.fromPreset
    })
    this.setData({ fav: now })
    wx.showToast({ title: now ? '已收藏' : '已取消收藏', icon: 'none' })
  },

  // ── 评价（本地） ──────────────────────────────────

  openRate() {
    const r = this.data.rating
    this.setData({
      showRate: true,
      rateStars: r ? r.stars : 5,
      rateNote: r ? r.note : ''
    })
  },

  closeRate() {
    this.setData({ showRate: false })
  },

  setStars(e) {
    this.setData({ rateStars: Number(e.currentTarget.dataset.v) })
  },

  onNote(e) {
    this.setData({ rateNote: e.detail.value })
  },

  submitRate() {
    collect.rate(this.key, this.data.rateStars, this.data.rateNote)
    this.setData({ showRate: false, rating: collect.getRating(this.key) })
    wx.showToast({ title: '已记录', icon: 'success' })
  },

  clearRate() {
    collect.removeRating(this.key)
    this.setData({ rating: null, showRate: false })
    wx.showToast({ title: '已删除评价', icon: 'none' })
  },

  // ── 分享 ──────────────────────────────────────────

  /**
   * 分享。
   *
   * 分享的是**页面**不是图片 —— 图片分享要先把 canvas 导出成临时文件再
   * 走 wx.showShareImageMenu，那条路要用户再点一次。这里先给页面分享，
   * 点进来就能看到同一张图纸。
   */
  onShareAppMessage() {
    const chart = this.data.chart || { cols: 0, rows: 0 }
    return {
      title: this.data.title + ' · ' + chart.cols + '×' + chart.rows + ' 格图纸',
      path: this.data.fromPreset
        ? '/pages/detail/detail?preset=' + this.data.fromPreset
        : '/pages/gallery/gallery'
    }
  }
})
