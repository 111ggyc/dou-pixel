const presets = require('../../data/presets.js')
const pattern = require('../../utils/pattern.js')
const rank = require('../../utils/rank.js')
const collect = require('../../utils/collect.js')

const app = getApp()

const KINDS = [
  { key: 'bead', name: '拼豆', en: 'BEAD' },
  { key: 'stitch', name: '刺绣', en: 'STITCH' },
  { key: 'pixel', name: '像素画', en: 'PIXEL' }
]

/**
 * 每个分类一套主题色。
 *
 * 用 CSS 变量注入页面根节点，而不是给每个元素绑内联样式 ——
 * 换分类时整个界面的渐变顶、选中态、数据条一起换。
 * 只换一处的话会显得半吊子。
 *
 * 配色的依据是各分类的内容气质，不是随便选的：
 *   拼豆   → 橙红，果实的暖、亮、饱满
 *   刺绣   → 竹青，水墨青绿
 *   像素画 → 亮蓝，屏幕和数字的冷感
 */
const THEMES = {
  bead: { accent: '#d94f2b', lite: '#ea7a55', heroA: '#2b2420', heroB: '#d94f2b' },
  stitch: { accent: '#2f7a5e', lite: '#4fa07f', heroA: '#1c2a25', heroB: '#2f7a5e' },
  pixel: { accent: '#2a6cb8', lite: '#4a90dc', heroA: '#1c2530', heroB: '#2a6cb8' }
}

Page({
  data: {
    statusBarHeight: 20,

    kinds: KINDS,
    kind: 'bead',

    // 二级分类。第一格永远是「全部」
    series: [],
    seriesKey: 'all',

    // 排序口径（原来是「榜单」，现在是网格的排序控件）
    modes: rank.MODES,
    mode: 'hot',
    modeNote: '',

    theme: THEMES.bead,

    cards: [],
    cellPx: 150,
    kindTotal: 0
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const modeKey = this.data.mode
    const kindKey = this.data.kind
    const seriesKey = this.data.seriesKey

    const g = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()

    // 缩略图边长按屏宽算：屏宽减两侧留白，乘卡片占比，再扣掉卡片自己的左右内边距。
    // 图案都是 28×28 的正方形，所以缩略图也取方形。
    // 这几个系数必须和 gallery.wxss 里的 .page padding / .card width / padding 对上，
    // 改样式没改这里的话画布会和卡片错位。
    const rpx = g.windowWidth / 750
    const contentW = g.windowWidth - 28 * 2 * rpx
    const cardW = contentW * 0.488
    const cellPx = Math.floor(cardW - 20 * 2 * rpx)

    const mine = collect.likes()
    const all = rank.decorate(presets.forKindSeries(kindKey, seriesKey), presets.measure, mine)
    const sorted = rank.sortBy(all, modeKey)

    // 数据条按**当前列表的最大值**归一，条长才有可比性
    let maxLikes = 1
    sorted.forEach(function (x) { if (x.likes > maxLikes) maxLikes = x.likes })

    const cards = sorted.map(function (x) {
      return {
        id: x.id,
        name: x.name,
        en: x.preset.en,
        w: x.w,
        h: x.h,
        colorCount: x.colorCount,
        difficultyName: x.difficultyName,
        likes: x.likes,
        myLike: x.myLike,
        rating: x.demoRating.toFixed(1),
        likePct: Math.round((x.likes * 100) / maxLikes)
      }
    })

    // 注意别在这里用 forEach + function 回调：回调里的 this 不是页面的 this，
    // 读 this.data 会直接抛 TypeError。用 filter 或者先存一份 self
    const modeObj = rank.MODES.filter(function (m) { return m.key === modeKey })[0]
    const baseNote = modeObj ? modeObj.note : ''

    const modeNote = modeKey === 'easy'
      ? '难度由实际工作量、用色数、工艺耗时算出 —— 这一档是真实计算'
      : baseNote + ' · 点赞与评分为演示数据（没有后端），你自己点的赞会加在上面'

    this.setData({
      series: [{ key: 'all', name: '全部' }].concat(presets.SERIES[kindKey] || []),
      kindTotal: presets.forKind(kindKey).length,
      cards: cards,
      cellPx: cellPx,
      modeNote: modeNote,
      theme: THEMES[kindKey] || THEMES.bead
    }, () => this.drawAll())
  },

  setKind(e) {
    const k = e.currentTarget.dataset.k
    if (k === this.data.kind) return
    // 换用途要连系列一起复位 —— 系列是挂在用途下面的
    this.setData({ kind: k, seriesKey: 'all' }, () => this.refresh())
  },

  setSeries(e) {
    const k = e.currentTarget.dataset.k
    if (k === this.data.seriesKey) return
    this.setData({ seriesKey: k }, () => this.refresh())
  },

  setMode(e) {
    const m = e.currentTarget.dataset.k
    if (m === this.data.mode) return
    this.setData({ mode: m }, () => this.refresh())
  },

  /**
   * 逐个画缩略图。
   *
   * 缩略图**一律走像素画画法**（不画网格线）—— 格子只有几个像素，
   * 画上网格线整个图案就糊了。图纸本身该用什么画法，详情页里会按用途走。
   *
   * 一次 selectAll 取回**全部**画布节点，而不是每张图查一次。
   * 图案从 8 个涨到 15 个之后，一张一张查的往返开销不划算。
   * 节点和数据靠 data-id 对号，不靠下标 —— 下标在列表变化时容易错位。
   */
  drawAll(retry) {
    wx.createSelectorQuery().in(this).selectAll('.g-cv')
      .fields({ node: true, size: true, dataset: true })
      .exec((res) => {
        const nodes = (res && res[0]) || []

        // wx:for 刚展开那一帧节点偶尔还没就绪，隔一拍重试一次。
        // 重试也不能无限 —— 真取不到就是真取不到，别把页面卡在这
        if (nodes.length !== this.data.cards.length && retry !== false) {
          setTimeout(() => this.drawAll(false), 60)
          return
        }

        const g = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = Math.min(g.pixelRatio || 2, 2)

        nodes.forEach(function (r) {
          if (!r || !r.node || !r.dataset) return
          const p = presets.byId(r.dataset.id)
          const chart = p ? presets.toChart(p) : null
          if (!chart) return

          const canvas = r.node
          const W = Math.round(r.width * dpr)
          const H = Math.round(r.height * dpr)
          if (canvas.width !== W) canvas.width = W
          if (canvas.height !== H) canvas.height = H

          pattern.paintChart(canvas.getContext('2d'), W, H, chart, 'pixel')
        })
      })
  },

  toDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?preset=' + e.currentTarget.dataset.id })
  },

  onShareAppMessage() {
    return {
      title: '图纸 · 拼豆 / 刺绣 / 像素画的现成图纸',
      path: '/pages/gallery/gallery'
    }
  }
})
