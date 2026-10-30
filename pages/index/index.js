const pattern = require('../../utils/pattern.js')
const mat = require('../../utils/materials.js')

const app = getApp()

// 分析用的源图先缩到这个尺寸以内再取像素。
// 直接读原图的话，4000px 的照片 getImageData 一次就是 64MB。
const ANALYZE_MAX = 600

// 导出画布宽度。1600 下 60 格的格子边长约 26px，符号和网格都清楚。
const EXPORT_W = 1600

/**
 * 用途的叫法有两套：绘制模块（pattern.js）里十字绣叫 'cross'，
 * 材料模块（materials.js）里叫 'stitch'。这里映射一次，
 * 别让它扩散到页面其它地方。
 */
function matKind(kind) {
  return kind === 'cross' ? 'stitch' : kind
}

/**
 * 预览画布的尺寸（CSS px）。
 *
 * ⚠️ **高度必须封顶**，否则竖图的预览会把下面的控制区整个顶出屏幕。
 * 实测：1:2.33 的长图在 80 格时是 80×187，按 319px 宽算出来 744px 高 ——
 * 比整屏还高，裁剪提示、格数滑杆、导出按钮全在屏幕外面。
 * 而长图恰恰是**最需要看到裁剪提示**的那种图。
 *
 * 和详情页用同一个比例（窗口高的 42%），两边显示同一张图纸时观感一致。
 *
 * @param {number} aspect 宽 / 高
 */
function fitPreview(aspect) {
  const g = app.globalData
  const maxW = Math.min(g.winW - 56, 420)
  const maxH = Math.round(g.winH * 0.42)

  let w = maxW
  let h = w / aspect
  if (h > maxH) {
    h = maxH
    w = h * aspect
  }
  return { w: Math.round(w), h: Math.round(h) }
}

Page({
  data: {
    statusBarHeight: 20,
    safeBottom: 0,

    src: '',
    cvW: 0,
    cvH: 0,

    kinds: [
      { key: 'cross', name: '十字绣', en: 'CROSS' },
      { key: 'bead', name: '拼豆', en: 'BEAD' },
      { key: 'pixel', name: '像素画', en: 'PIXEL' }
    ],
    kind: 'cross',

    // 默认 80 格。实测 60 格时画面偏块状、不好辨认，
    // 80 格可辨识度明显更好，同时还是一个做得完的手工量
    cols: 80,
    colors: 16,

    // 有序抖动。默认关 —— 十字绣是一针一针绣的，抖出来的零散单格
    // 既费工又容易数错，不该替用户默认打开
    dither: false,

    chartCols: 0,
    chartRows: 0,
    legend: [],
    totalCells: 0,

    // ── 图片比例与尺寸 ──
    origW: 0,
    origH: 0,
    ratioText: '',   // '3:4'
    orientText: '',  // '竖图'
    // 裁剪：null = 用整张原图；给了数就是「居中裁成这个宽高比」
    cropRatio: 0,
    cropLabel: '',   // '4:3'
    suggest: null,   // 推荐格数
    cropTip: null,   // 比例太极端时的裁剪建议
    sizeText: '',    // 当前格数对应的成品尺寸

    // 空状态那一小片方格纸，6×6
    emptyGrid: Array.from({ length: 36 }, function (_, i) {
      return { i: i }
    }),

    busy: false
  },

  onLoad() {
    const g = app.globalData
    this.setData({
      statusBarHeight: g.statusBarHeight,
      safeBottom: g.safeBottom
    })

    this.canvas = null
    this.chart = null
    this.lastData = null // 留着做参数变化时重建，省得重新读图
  },

  onReady() {
    // canvas 在 wx:if="{{src}}" 里，此刻还没挂载，这里查不到是正常的
    this.bindCanvas()
  },

  bindCanvas(done, retry) {
    wx.createSelectorQuery()
      .in(this)
      .select('#cv')
      .fields({ node: true, size: true })
      .exec((res) => {
        const r = res && res[0]

        if (r && r.node) {
          this.canvas = r.node
        } else if (retry !== false) {
          // wx:if 刚展开那一帧节点偶尔还没就绪，隔一拍重试一次
          setTimeout(() => this.bindCanvas(done, false), 60)
          return
        }

        if (typeof done === 'function') done()
      })
  },

  // ── 选图 ──────────────────────────────────────────

  pick() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (f) this.prepare(f.tempFilePath)
      },
      fail: () => {
        /* 取消 */
      }
    })
  },

  prepare(path) {
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const box = fitPreview(info.width / info.height)

        this.setData({
          src: path,
          origW: info.width,
          origH: info.height,
          // 换一张图，之前的裁剪不跟着走
          cropRatio: 0,
          cropLabel: '',
          cvW: box.w,
          cvH: box.h,
          busy: true
        }, () => {
          this.refreshDerived()
          this.bindCanvas(() => this.analyze(path, info.width, info.height))
        })
      },
      fail: () => {
        wx.showToast({ title: '图片读取失败', icon: 'none' })
      }
    })
  },

  // ── 比例 / 推荐 / 裁剪 ────────────────────────────

  /** 有效比例：裁过就用裁剪比例，没裁就用原图 */
  effectiveAspect() {
    const s = this.data
    if (s.cropRatio) return s.cropRatio
    return s.origW && s.origH ? s.origW / s.origH : 1
  },

  /**
   * 比例标签、朝向、推荐格数、裁剪提示、成品尺寸 —— 一起算，一次 setData。
   *
   * 这几个都只依赖「原图尺寸 + 裁剪 + 用途 + 当前格数」。
   * 放在一处算，免得换用途、换格数、裁剪三处各自漏更新一个。
   * 比例标签本来是在 prepare() 里算的，也收进来了 —— 它同样只是
   * origW/origH 的函数，跟着大部队走就不用记「哪个在哪儿算」。
   */
  refreshDerived() {
    const s = this.data
    if (!s.origW || !s.origH) return

    const mk = matKind(s.kind)
    const aspect = this.effectiveAspect()
    const r = mat.recommendCols(mk, aspect)

    const suggest = Object.assign({}, r, {
      text: r.widthCm
        ? r.cols + ' × ' + r.rows + ' 格 · 成品 ' + r.widthCm + ' × ' + r.heightCm + ' cm'
        : r.cols + ' × ' + r.rows + ' 格 · 共 ' + r.cells + ' 格'
    })

    // 裁剪建议只针对**原图**比例；已经裁过了就不再念叨
    let cropTip = null
    if (!s.cropRatio) {
      const advice = mat.cropAdvice(s.origW / s.origH)
      if (advice) {
        cropTip = {
          label: advice.label,
          reason: advice.reason,
          toRatio: advice.toRatio,
          rowsNow: mat.rowsFor(s.cols, s.origW / s.origH),
          rowsAfter: mat.rowsFor(s.cols, advice.toRatio)
        }
      }
    }

    const size = s.chartCols
      ? mat.sizeCm(mk, s.chartCols, s.chartRows)
      : null

    this.setData({
      ratioText: mat.ratioLabel(s.origW, s.origH),
      orientText: mat.orientation(s.origW, s.origH),
      suggest: suggest,
      cropTip: cropTip,
      sizeText: size ? size.widthCm + ' × ' + size.heightCm + ' cm' : ''
    })
  },

  /** 采用推荐格数 */
  applyRecommend() {
    const sg = this.data.suggest
    if (!sg) return
    if (sg.cols === this.data.cols) {
      wx.showToast({ title: '已经是推荐格数了', icon: 'none' })
      return
    }
    this.setData({ cols: sg.cols }, () => this.rebuild())
  },

  /** 居中裁成建议的比例 */
  applyCrop() {
    const tip = this.data.cropTip
    if (!tip) return
    this.setData({
      cropRatio: tip.toRatio,
      cropLabel: tip.label,
      cropTip: null
    }, () => {
      this.refreshDerived()
      this.reanalyze()
    })
  },

  /** 还原成整张原图 */
  clearCrop() {
    if (!this.data.cropRatio) return
    this.setData({ cropRatio: 0, cropLabel: '' }, () => {
      this.refreshDerived()
      this.reanalyze()
    })
  },

  /** 裁剪变了得重新取像素 —— lastData 是裁之前那张，不能复用 */
  reanalyze() {
    if (!this.data.src) return
    this.setData({ busy: true })
    this.analyze(this.data.src, this.data.origW, this.data.origH)
  },

  /**
   * 取像素做分析。
   *
   * 注意 image 对象是在**离屏画布**上创建的，不是预览画布 ——
   * 预览画布画的是图纸（由数据算出来的），根本不需要这张原图。
   * 两张画布各管各的，避免跨画布使用 image 对象的兼容问题。
   */
  analyze(path, iw, ih) {
    // 裁剪：从原图里取**居中**的那块最大矩形。
    // 不做交互式拖框 —— 居中裁切是确定性的，够用，也好解释。
    const cr = this.data.cropRatio
    let cx = 0
    let cy = 0
    let cw = iw
    let ch = ih
    if (cr) {
      if (iw / ih > cr) {
        cw = Math.round(ih * cr)          // 原图更宽 → 左右各裁一点
        cx = Math.round((iw - cw) / 2)
      } else {
        ch = Math.round(iw / cr)          // 原图更高 → 上下各裁一点
        cy = Math.round((ih - ch) / 2)
      }
    }

    let sw = cw
    let sh = ch
    const long = Math.max(sw, sh)

    if (long > ANALYZE_MAX) {
      const s = ANALYZE_MAX / long
      sw = Math.max(1, Math.round(sw * s))
      sh = Math.max(1, Math.round(sh * s))
    }

    const off = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh })
    const octx = off.getContext('2d')
    const img = off.createImage()

    img.onload = () => {
      // 源矩形是原图坐标，目标矩形是缩放后的画布 —— 缩放和裁剪一步做完，
      // 不用先裁再缩（那样白白解一次中间图）
      octx.drawImage(img, cx, cy, cw, ch, 0, 0, sw, sh)
      const data = octx.getImageData(0, 0, sw, sh)
      this.lastData = data
      this.build(data)
    }

    img.onerror = () => {
      this.setData({ busy: false })
      wx.showToast({ title: '图片解码失败', icon: 'none' })
    }

    img.src = path
  },

  // ── 生成图纸 ──────────────────────────────────────

  build(data) {
    const t0 = Date.now()
    const chart = pattern.buildChart(
      data,
      this.data.cols,
      this.data.colors,
      this.data.dither
    )
    const buildMs = Date.now() - t0
    this.chart = chart

    // 真机调试时这行会打到开发者工具的控制台。
    // 图纸的生成是迭代算法（中位切分 + 12 轮 k-means），比另外三个作品的
    // 一趟扫像素重得多，所以耗时需要能在真机上看到，不能靠模拟器猜。
    console.log(
      '[图纸] ' + chart.cols + '×' + chart.rows + ' 格 · ' +
      chart.palette.length + ' 色 · ' +
      (this.data.dither ? '抖动' : '无抖动') + ' · 生成 ' + buildMs + 'ms'
    )

    // 图例。buildChart 已经按用量从多到少排好了序
    const legend = chart.palette.map((p, i) => ({
      hex: p.hex,
      symbol: chart.symbols[i],
      count: p.count,
      pct: Math.round((p.count * 1000) / chart.total) / 10
    }))

    // 预览高度按图纸的格数比例算，不能沿用原图比例
    const box = fitPreview(chart.cols / chart.rows)

    this.setData(
      {
        legend: legend,
        totalCells: chart.total,
        chartCols: chart.cols,
        chartRows: chart.rows,
        cvW: box.w,
        cvH: box.h,
        busy: false
      },
      () => {
        this.draw()
        // chartCols / chartRows 刚更新，成品尺寸要跟着刷新；
        // 顺便也让裁剪提示里的「不裁是 X × Y 格」跟上当前格数
        this.refreshDerived()
      }
    )
  },

  /** 参数变了但原图还在，直接拿缓存的像素重算 */
  rebuild() {
    if (!this.lastData) return
    this.setData({ busy: true })
    setTimeout(() => this.build(this.lastData), 0)
  },

  // ── 绘制 ──────────────────────────────────────────

  draw() {
    const { cvW, cvH, kind } = this.data
    if (!this.canvas || !this.chart || !cvW) return

    const dpr = Math.min(app.globalData.pixelRatio, 2)
    const W = Math.round(cvW * dpr)
    const H = Math.round(cvH * dpr)

    const canvas = this.canvas
    if (canvas.width !== W) canvas.width = W
    if (canvas.height !== H) canvas.height = H

    const t0 = Date.now()
    pattern.paintChart(canvas.getContext('2d'), W, H, this.chart, kind)

    // 只在慢的时候打，免得刷屏
    const paintMs = Date.now() - t0
    if (paintMs > 60) {
      console.log('[图纸] 绘制 ' + W + '×' + H + ' 耗时 ' + paintMs + 'ms')
    }
  },

  // ── 交互 ──────────────────────────────────────────

  /** 换类型不用重算调色板，只是换个画法，所以立刻重绘 */
  setKind(e) {
    const key = e.currentTarget.dataset.k
    if (key === this.data.kind) return
    this.setData({ kind: key }, () => {
      // 推荐值跟用途走：拼豆按 5mm 豆、刺绣按 14CT，两者差一倍多
      this.refreshDerived()
      this.draw()
    })
  },

  onCols(e) {
    const v = e.detail.value
    // 重建整套调色板不便宜（中位切分 + k-means），拖动过程中只更新数字，
    // 松手才算 —— 否则滑杆会拖不动
    if (e.type === 'changing') {
      this.setData({ cols: v })
      return
    }
    this.setData({ cols: v }, () => this.rebuild())
  },

  onColors(e) {
    const v = e.detail.value
    if (e.type === 'changing') {
      this.setData({ colors: v })
      return
    }
    this.setData({ colors: v }, () => this.rebuild())
  },

  toggleDither() {
    this.setData({ dither: !this.data.dither }, () => this.rebuild())
  },

  /**
   * 去详情页看材料方案。
   *
   * 图纸通过 globalData 传 —— 一张 80×60 的图纸有几千个格子，
   * 塞进 URL 参数是不可能的。详情页读 app.globalData.currentChart。
   */
  toPlan() {
    if (!this.chart) {
      wx.showToast({ title: '先生成一张图纸', icon: 'none' })
      return
    }
    app.globalData.currentChart = this.chart
    wx.navigateTo({ url: '/pages/detail/detail' })
  },

  toGallery() {
    wx.switchTab({ url: '/pages/gallery/gallery' })
  },

  // ── 导出 ──────────────────────────────────────────

  export() {
    if (this.data.busy || !this.chart) return

    this.setData({ busy: true })
    wx.showLoading({ title: '生成中', mask: true })

    const chart = this.chart
    const W = EXPORT_W
    const H = Math.round((W * chart.rows) / chart.cols)

    const off = wx.createOffscreenCanvas({ type: '2d', width: W, height: H })
    pattern.paintChart(off.getContext('2d'), W, H, chart, this.data.kind)

    wx.canvasToTempFilePath({
      canvas: off,
      x: 0,
      y: 0,
      width: W,
      height: H,
      destWidth: W,
      destHeight: H,
      // 图纸用 PNG。JPG 会在网格线和符号边缘产生压缩杂色，
      // 而图纸是要放大照着数格子的，糊了就没用
      fileType: 'png',
      quality: 1,
      success: (r) => this.save(r.tempFilePath),
      fail: () => {
        wx.hideLoading()
        this.setData({ busy: false })
        wx.showToast({ title: '导出失败', icon: 'none' })
      }
    })
  },

  save(path) {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => {
        wx.hideLoading()
        this.setData({ busy: false })
        wx.showToast({ title: '图纸已存入相册', icon: 'success' })
      },
      fail: (err) => {
        wx.hideLoading()
        this.setData({ busy: false })

        const msg = String((err && err.errMsg) || '')
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置里打开「保存到相册」，否则存不了图纸',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting()
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  }
})
