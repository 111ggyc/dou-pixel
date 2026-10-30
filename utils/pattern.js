/**
 * 图纸生成核心
 *
 * 和另外三个作品的根本区别：这里输出的**不是照片，是图纸**。
 * 照片有百万种颜色，图纸只有十几到几十种 —— 中间隔着一次量化，
 * 而且要告诉用户「每种色各用多少格」。
 *
 * 处理链：
 *   降采样 → 中位切分(median cut)建调色板 → k-means 精修 → 映射 → 统计
 *
 * 为什么用中位切分而不是直接上 k-means：
 *   k-means 的结果依赖初始点，同样的图跑两次可能给出不同的调色板。
 *   图纸是要照着做的东西，**同一个参数必须每次给出同一张图纸**，
 *   所以用确定性的中位切分建初始调色板，再用 k-means 精修
 *   （精修是从确定的初始点出发，结果仍然是确定的）。
 */

// 十字绣格子底色往白色混多少。
//
// 试过 0.68，符号确实清楚，但**画面被冲淡得认不出来** —— 图纸首先是给人
// 看出「这是个什么」，符号清晰是第二位的。所以改回 0（填原色），
// 符号的清晰度改用「按格子亮度选黑或白 + 加粗放大」来解决。
const CROSS_TINT = 0

// 图纸上给每种色分配的符号。十字绣图纸的传统做法就是用符号标色，
// 因为印出来往往是黑白的。取 32 个，正好覆盖最大色数。
const SYMBOLS = [
  '●', '○', '◆', '◇', '■', '□', '▲', '△',
  '★', '☆', '♦', '♠', '♣', '♥', '✓', '✕',
  '⊕', '⊗', '⊙', '◐', '◑', '▣', '▤', '▥',
  '▦', '▧', '▨', '▩', '≡', '≠', '※', '⌂'
]

/**
 * 降采样：把 srcW×srcH 的像素**按面积平均**成 cols×rows 个格子。
 *
 * 不用最近邻取样 —— 那会让图纸上出现原图根本没有的杂点，
 * 摆出来就是错的。面积平均相当于每个格子取它覆盖区域的平均色。
 */
function downsample(data, srcW, srcH, cols) {
  const rows = Math.max(1, Math.round((srcH / srcW) * cols))
  const n = cols * rows
  const cells = new Float32Array(n * 3)

  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * srcH) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * srcH) / rows))

    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * srcW) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * srcW) / cols))

      let r = 0
      let g = 0
      let b = 0
      let cnt = 0

      for (let y = y0; y < y1; y++) {
        let i = (y * srcW + x0) * 4
        for (let x = x0; x < x1; x++) {
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          cnt++
          i += 4
        }
      }

      const o = (cy * cols + cx) * 3
      cells[o] = r / cnt
      cells[o + 1] = g / cnt
      cells[o + 2] = b / cnt
    }
  }

  return { cells: cells, cols: cols, rows: rows }
}

/**
 * 亮度分位数（两端各截 0.5%）。
 * 用分位数而不是 min/max —— 个别极端像素不该决定整幅图的映射范围。
 */
function percentiles(hist, total) {
  const cut = Math.max(1, Math.floor(total * 0.005))

  let acc = 0
  let lo = 0
  for (let l = 0; l < 256; l++) {
    acc += hist[l]
    if (acc > cut) {
      lo = l
      break
    }
  }

  acc = 0
  let hi = 255
  for (let l = 255; l >= 0; l--) {
    acc += hist[l]
    if (acc > cut) {
      hi = l
      break
    }
  }

  return { lo: lo, hi: hi }
}

function lumaBucket(r, g, b) {
  let l = (0.299 * r + 0.587 * g + 0.114 * b) | 0
  return l < 0 ? 0 : l > 255 ? 255 : l
}

function lumaHistFromPixels(data, count) {
  const hist = new Int32Array(256)
  for (let i = 0; i < count; i++) {
    const p = i * 4
    hist[lumaBucket(data[p], data[p + 1], data[p + 2])]++
  }
  return hist
}

function lumaHistFromCells(cells, n) {
  const hist = new Int32Array(256)
  for (let i = 0; i < n; i++) {
    hist[lumaBucket(cells[i * 3], cells[i * 3 + 1], cells[i * 3 + 2])]++
  }
  return hist
}

/**
 * 把降采样损失的对比度**还回去**。在降采样之后、量化之前做。
 *
 * 为什么要还：面积平均会压缩动态范围。一个格子 70% 白 + 30% 黑，
 * 平均下来是浅灰 —— 原来的纯黑没了。实测一张文字文档：原图跨 0~255，
 * 降采样后只剩 154~255，再量化到 16 色最深也就到中灰，整幅发灰失真。
 *
 * 关键点：**只还原损失掉的那部分，不是把范围硬拉到 0~255。**
 *
 *   早期版本是无脑拉满量程。在文字文档上效果很好（0~255 压成 154~255，
 *   拉回去正好），但换到风景照片就崩了 —— 风景本来就是中间调（实测约 90~230），
 *   硬拉到 0~255 会把草地整片压成近黑，画面比不拉还糟。
 *
 * 正确做法是拿**原图的分位数**当目标：
 *   原图 90~230，降采样后 95~228  →  映射回 90~230（几乎不动）
 *   原图 0~255，降采样后 154~255  →  映射回 0~255（对比度恢复）
 *
 * 三个通道共用同一组映射 —— 是整体缩放，色相不会被拉偏。
 */
function restoreContrast(cells, n, srcLo, srcHi) {
  const cellRange = percentiles(lumaHistFromCells(cells, n), n)

  const srcSpan = srcHi - srcLo
  const cellSpan = cellRange.hi - cellRange.lo

  // 两边都要有足够跨度才动，否则会把纯色块拉出噪点
  if (srcSpan < 8 || cellSpan < 8) return cells

  const scale = srcSpan / cellSpan
  const out = new Float32Array(cells.length)

  for (let i = 0; i < cells.length; i++) {
    let v = srcLo + (cells[i] - cellRange.lo) * scale
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v
  }

  return out
}

/** 一个盒子在某个通道上的跨度 */
function extent(cells, idx, from, to) {
  let rmin = 255
  let rmax = 0
  let gmin = 255
  let gmax = 0
  let bmin = 255
  let bmax = 0

  for (let i = from; i < to; i++) {
    const p = idx[i] * 3
    const r = cells[p]
    const g = cells[p + 1]
    const b = cells[p + 2]
    if (r < rmin) rmin = r
    if (r > rmax) rmax = r
    if (g < gmin) gmin = g
    if (g > gmax) gmax = g
    if (b < bmin) bmin = b
    if (b > bmax) bmax = b
  }

  return [rmax - rmin, gmax - gmin, bmax - bmin]
}

/**
 * 中位切分：从「所有格子」这一个盒子开始，每次挑跨度最大的盒子，
 * 沿它最宽的那个通道按中位数切成两半，重复到盒子数等于目标色数。
 * 每个盒子的平均色就是一个调色板色。确定性算法。
 */
function medianCut(cells, n, k) {
  const idx = new Int32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i

  const boxes = [{ from: 0, to: n }]

  while (boxes.length < k) {
    let best = -1
    let bestSpan = 0
    let bestCh = 0

    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]
      if (b.to - b.from < 2) continue

      const e = extent(cells, idx, b.from, b.to)
      let ch = 0
      if (e[1] > e[ch]) ch = 1
      if (e[2] > e[ch]) ch = 2

      if (e[ch] > bestSpan) {
        bestSpan = e[ch]
        best = bi
        bestCh = ch
      }
    }

    // 所有盒子都切不动了（图本身就是单色）—— 提前结束
    if (best < 0 || bestSpan <= 0) break

    const b = boxes[best]
    const seg = []
    for (let i = b.from; i < b.to; i++) seg.push(idx[i])
    seg.sort((p, q) => cells[p * 3 + bestCh] - cells[q * 3 + bestCh])
    for (let i = 0; i < seg.length; i++) idx[b.from + i] = seg[i]

    const mid = b.from + (seg.length >> 1)
    boxes.splice(best, 1, { from: b.from, to: mid }, { from: mid, to: b.to })
  }

  const palette = []
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    let r = 0
    let g = 0
    let bl = 0
    let c = 0

    for (let j = b.from; j < b.to; j++) {
      const p = idx[j] * 3
      r += cells[p]
      g += cells[p + 1]
      bl += cells[p + 2]
      c++
    }

    palette.push(c ? [r / c, g / c, bl / c] : [0, 0, 0])
  }

  return palette
}

/**
 * k-means 精修：把每个格子归到最近的调色板色，再用各簇的均值更新调色板。
 * 初始点来自中位切分，所以整个过程仍然是确定性的。
 */
function kmeansRefine(cells, n, palette, iters) {
  const k = palette.length
  const assign = new Int32Array(n)
  let nearest = null

  for (let it = 0; it < iters; it++) {
    let moved = 0

    for (let i = 0; i < n; i++) {
      const p = i * 3
      const r = cells[p]
      const g = cells[p + 1]
      const b = cells[p + 2]

      let bi = 0
      let bd = Infinity

      for (let c = 0; c < k; c++) {
        const dr = r - palette[c][0]
        const dg = g - palette[c][1]
        const db = b - palette[c][2]
        const d = dr * dr + dg * dg + db * db
        if (d < bd) {
          bd = d
          bi = c
        }
      }

      if (assign[i] !== bi) {
        assign[i] = bi
        moved++
      }
    }

    const sumR = new Float64Array(k)
    const sumG = new Float64Array(k)
    const sumB = new Float64Array(k)
    const cnt = new Int32Array(k)

    for (let i = 0; i < n; i++) {
      const c = assign[i]
      const p = i * 3
      sumR[c] += cells[p]
      sumG[c] += cells[p + 1]
      sumB[c] += cells[p + 2]
      cnt[c]++
    }

    for (let c = 0; c < k; c++) {
      if (cnt[c]) {
        palette[c] = [sumR[c] / cnt[c], sumG[c] / cnt[c], sumB[c] / cnt[c]]
      }
    }

    if (!moved) break // 已经收敛
  }

  return { palette: palette, assign: assign }
}

/**
 * 把颜色朝白色混 amount（0~1）。十字绣图纸的格子底色用它。
 * amount = 1 得到纯白，0 保持原色。
 */
function tint(rgb, amount) {
  return [
    rgb[0] + (255 - rgb[0]) * amount,
    rgb[1] + (255 - rgb[1]) * amount,
    rgb[2] + (255 - rgb[2]) * amount
  ]
}

// 有序抖动用的 Bayer 4×4 阈值矩阵
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

/**
 * 有序抖动（Bayer 4×4）。
 *
 * 用途：风景这类大片平滑渐变，压到十几色必然出色带（天空最明显）。
 *
 * 思路：不直接取最近的调色板色，而是找出**最近的两个**色，
 * 按它们与该像素的距离之比、配合 Bayer 阈值决定取哪个。
 * 两个色越接近，越容易被阈值翻到另一个 —— 于是渐变区域出现两色交错的小点阵，
 * 远看就是中间色。色带被打散成纹理。
 *
 * **为什么做成可选项而不是默认开**：抖动会产生大量零散的单格。
 * 对像素画和拼豆没影响，但十字绣是要一针一针绣的，
 * 散落的单格既费工又容易数错。所以让用户自己取舍。
 */
function ditherAssign(cells, cols, rows, palette) {
  const n = cols * rows
  const out = new Int32Array(n)
  const k = palette.length

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      const r = cells[i * 3]
      const g = cells[i * 3 + 1]
      const b = cells[i * 3 + 2]

      let c1 = 0
      let d1 = Infinity
      let c2 = 0
      let d2 = Infinity

      for (let c = 0; c < k; c++) {
        const dr = r - palette[c][0]
        const dg = g - palette[c][1]
        const db = b - palette[c][2]
        const dd = dr * dr + dg * dg + db * db
        if (dd < d1) {
          d2 = d1
          c2 = c1
          d1 = dd
          c1 = c
        } else if (dd < d2) {
          d2 = dd
          c2 = c
        }
      }

      const ratio = d1 / (d1 + d2 + 1e-9)
      const t = (BAYER4[y & 3][x & 3] + 0.5) / 16
      out[i] = t < ratio ? c1 : c2
    }
  }

  return out
}

function toHex(rgb) {
  let s = '#'
  for (let i = 0; i < 3; i++) {
    let v = Math.round(rgb[i])
    if (v < 0) v = 0
    if (v > 255) v = 255
    const h = v.toString(16)
    s += h.length === 1 ? '0' + h : h
  }
  return s
}

/** 亮度，用来决定符号画成黑的还是白的 */
function luma(rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
}

/**
 * 生成一张完整图纸。
 *
 * @param {ImageData} imgData  原图（建议先缩到 600px 以内再取，别直接读大图）
 * @param {number} cols        图纸宽度格数
 * @param {number} colors      用几种色
 * @param {boolean} dither     是否用有序抖动打散色带
 * @returns {{cols,rows,assign,palette,counts,symbols,cellColors,cells}}
 */
function buildChart(imgData, cols, colors, dither) {
  const d = imgData.data
  const srcW = imgData.width
  const srcH = imgData.height

  const k = Math.max(2, Math.min(32, Math.round(colors)))
  const c = Math.max(8, Math.min(200, Math.round(cols)))

  // 原图的动态范围 —— 拿来当还原目标
  const srcRange = percentiles(lumaHistFromPixels(d, srcW * srcH), srcW * srcH)

  const ds = downsample(d, srcW, srcH, c)
  const n = ds.cols * ds.rows

  // 降采样把动态范围压扁了，量化之前按原图的范围还回去
  const cells = restoreContrast(ds.cells, n, srcRange.lo, srcRange.hi)

  let palette = medianCut(cells, n, k)
  const refined = kmeansRefine(cells, n, palette, 12)

  palette = refined.palette

  // 抖动必须在**调色板定下来之后**做 —— 它改的是「每格归到哪个色」，
  // 如果放在前面，k-means 会把抖出来的点阵当成真实颜色去拟合，结果一塌糊涂
  const assign = dither
    ? ditherAssign(cells, ds.cols, ds.rows, palette)
    : refined.assign

  // 统计每色用多少格 —— 图纸上必须标，用户按这个数备料
  const counts = new Int32Array(palette.length)
  for (let i = 0; i < n; i++) counts[assign[i]]++

  // 按用量从多到少排序，图例读起来更合理
  const order = []
  for (let i = 0; i < palette.length; i++) {
    if (counts[i] > 0) order.push(i)
  }
  order.sort((a, b) => counts[b] - counts[a])

  const outPalette = []
  const outSymbols = []
  const remap = new Int32Array(palette.length)
  for (let i = 0; i < palette.length; i++) remap[i] = -1

  for (let i = 0; i < order.length; i++) {
    const src = order[i]
    remap[src] = i
    outPalette.push({
      hex: toHex(palette[src]),
      rgb: palette[src],
      // 128 是黑白符号对比度相等的分界点
      dark: luma(palette[src]) < 128,
      count: counts[src]
    })
    outSymbols.push(SYMBOLS[i % SYMBOLS.length])
  }

  const outAssign = new Int32Array(n)
  for (let i = 0; i < n; i++) outAssign[i] = remap[assign[i]]

  return {
    cols: ds.cols,
    rows: ds.rows,
    assign: outAssign,
    palette: outPalette,
    symbols: outSymbols,
    total: n
  }
}

/**
 * 画图纸。
 *
 * 预览和导出**共用这一个函数** —— 所以「所见即所得」是结构上保证的，
 * 不是靠两处代码碰巧写得一样。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H   画布像素尺寸
 * @param {object} chart  buildChart 的返回值
 * @param {string} kind   cross（十字绣）| bead（拼豆）| pixel（像素画）
 */
function paintChart(ctx, W, H, chart, kind) {
  // 别名统一。画法模块这边十字绣叫 'cross'，材料模块那边叫 'stitch' ——
  // 与其让页面层来回翻译（翻译漏一处就是画错），不如在这里吸收掉
  if (kind === 'stitch') kind = 'cross'

  const cw = W / chart.cols
  const ch = H / chart.rows

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // 色块。
  //
  // 十字绣填的是**浅色调**，不是原色 —— 这是真实图纸的画法，也是必须的：
  // 填满饱和度时，符号会被颜色淹没，而图纸恰恰靠符号分辨颜色
  // （图纸常常是黑白复印的）。原来的实现在中间调上尤其糊，
  // 因为黑符号和白符号在亮度 130~150 附近的对比度都不够。
  //
  // 色调表按调色板预算好，不要在格循环里算 —— 那是几万次重复计算。
  const fills = []
  for (let i = 0; i < chart.palette.length; i++) {
    fills.push(
      kind === 'cross' ? toHex(tint(chart.palette[i].rgb, CROSS_TINT)) : chart.palette[i].hex
    )
  }

  // +0.6 是为了盖住相邻格之间的亚像素缝隙，否则缩略图上会看到一层灰蒙蒙的网格影
  for (let y = 0; y < chart.rows; y++) {
    for (let x = 0; x < chart.cols; x++) {
      const i = chart.assign[y * chart.cols + x]
      if (i < 0 || i >= fills.length) continue
      ctx.fillStyle = fills[i]
      ctx.fillRect(x * cw, y * ch, cw + 0.6, ch + 0.6)
    }
  }

  // 网格线。像素画不要网格（它就是靠无缝色块成画的）。
  // 十字绣和拼豆都是每 10 格加粗一道 —— 这是图纸的传统画法，方便数格子。
  if (kind !== 'pixel') {
    const fine = kind === 'cross' ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.10)'
    const bold = 'rgba(0,0,0,0.55)'

    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? fine : bold
      ctx.lineWidth = pass === 0 ? 1 : Math.max(1.5, cw * 0.08)
      ctx.beginPath()

      for (let x = 0; x <= chart.cols; x++) {
        const isBold = x % 10 === 0
        if ((pass === 1) !== isBold) continue
        const px = Math.round(x * cw) + 0.5
        ctx.moveTo(px, 0)
        ctx.lineTo(px, H)
      }

      for (let y = 0; y <= chart.rows; y++) {
        const isBold = y % 10 === 0
        if ((pass === 1) !== isBold) continue
        const py = Math.round(y * ch) + 0.5
        ctx.moveTo(0, py)
        ctx.lineTo(W, py)
      }

      ctx.stroke()
    }
  }

  // 符号。格子太小（<9px）就不画 —— 画了也看不清，还白白拖慢渲染。
  //
  // 按格子亮度分黑白来取对比，阈值取 128：这是黑白两种符号对比度相等的点
  // （和黑的对比 ∝ 亮度，和白的对比 ∝ 255-亮度，交点在中灰）。
  // 加粗并放大到 0.76 —— 0.62 的常规字重在手机上放大看发虚。
  const showSymbol = kind === 'cross' && cw >= 9
  if (showSymbol) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold ' + Math.round(cw * 0.76) + 'px sans-serif'

    for (let y = 0; y < chart.rows; y++) {
      for (let x = 0; x < chart.cols; x++) {
        const i = chart.assign[y * chart.cols + x]
        const p = chart.palette[i]
        if (!p) continue
        ctx.fillStyle = p.dark ? '#ffffff' : '#000000'
        ctx.fillText(chart.symbols[i], x * cw + cw / 2, y * ch + ch / 2)
      }
    }
  }

  return { cw: cw, ch: ch, showSymbol: showSymbol }
}

module.exports = {
  SYMBOLS,
  CROSS_TINT,
  BAYER4,
  ditherAssign,
  buildChart,
  downsample,
  restoreContrast,
  percentiles,
  medianCut,
  kmeansRefine,
  toHex,
  tint,
  luma,
  paintChart
}
