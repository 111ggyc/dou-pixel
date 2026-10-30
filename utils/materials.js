/**
 * 材料方案计算
 *
 * 纯函数，不引用 wx，可以直接在 node 里单测。
 *
 * 这个模块回答的是「照着这张图纸做，我得买什么、买多少」——
 * 光有格子数和色号没用，用户需要的是采购清单。
 *
 * ⚠️ 重要：**十字绣的线量是行业经验估算，不是精确值。**
 * 影响用线的因素很多（针法、松紧、背面走线、浪费），
 * 同一张图不同人做出来的用量能差 20%。所以：
 *   1. 界面上必须标明「估算」
 *   2. 必须提示多买一些 —— 中途接色号很麻烦
 * 拼豆的颗数是精确的（一格一颗，不用估算），绣布尺寸也是精确的。
 */

// ── 拼豆 ────────────────────────────────────────────

/** 常见拼豆规格。5mm（中豆）最普及，2.6mm（迷你豆）适合细节多的小图 */
const BEADS = [
  { key: 'mini', name: '2.6mm 迷你豆', mm: 2.6, note: '细节多，适合小图' },
  { key: 'midi', name: '5mm 中豆', mm: 5, note: '最常见，新手友好' }
]

/** 常见拼豆板的格数。市面主流是 29×29 */
const PEGBOARD = 29

/**
 * 拼豆方案。
 *
 * 颗数是**精确值** —— 一格一颗，不存在估算。
 *
 * @param {number} cols
 * @param {number} rows
 * @param {Array} palette  buildChart 的 palette（含 hex 和 count）
 * @param {string} beadKey 'mini' | 'midi'
 */
function beadPlan(cols, rows, palette, beadKey) {
  const bead = BEADS.filter(function (b) { return b.key === beadKey })[0] || BEADS[1]

  let total = 0
  const perColor = palette.map(function (p) {
    total += p.count
    return { hex: p.hex, symbol: p.symbol, count: p.count }
  })

  // 板数向上取整 —— 差一格也得用一整块板
  const boardsX = Math.ceil(cols / PEGBOARD)
  const boardsY = Math.ceil(rows / PEGBOARD)

  const wCm = (cols * bead.mm) / 10
  const hCm = (rows * bead.mm) / 10

  return {
    kind: 'bead',
    beadName: bead.name,
    beadMm: bead.mm,
    total: total,
    // 每种色按用量降序
    perColor: perColor,
    boardsX: boardsX,
    boardsY: boardsY,
    boards: boardsX * boardsY,
    boardSize: PEGBOARD,
    widthCm: Math.round(wCm * 10) / 10,
    heightCm: Math.round(hCm * 10) / 10
  }
}

// ── 十字绣 ──────────────────────────────────────────

/**
 * 绣布规格。
 *
 * CT 是「每英寸多少格」。CT 越大格子越小、成品越精致，也越费眼。
 * strands 是常用股数 —— 11CT 布粗，一般用 3 股；14CT 用 2 股。
 */
const CLOTHS = [
  { key: '11ct', name: '11CT', count: 11, strands: 3, note: '格子大，好上手' },
  { key: '14ct', name: '14CT', count: 14, strands: 2, note: '最常见' },
  { key: '16ct', name: '16CT', count: 16, strands: 2, note: '更细腻，费眼' }
]

/** 一束绣线约 8 米 */
const SKEIN_METERS = 8

/**
 * 一束线大约能绣多少格。
 *
 * ⚠️ 这是**经验值不是实测值**。以 14CT 两股 1700 格为基准，
 * 按股数反比缩放（股数越多越费线）。
 * 不同资料给的范围大概在 1000–2000 之间，差异来自针法和个人习惯。
 */
function stitchesPerSkein(clothKey) {
  const c = CLOTHS.filter(function (x) { return x.key === clothKey })[0] || CLOTHS[1]
  return Math.round(1700 * (2 / c.strands))
}

/**
 * 十字绣方案。
 *
 * 绣布尺寸是**精确计算**；线量是**估算**。
 *
 * @param {number} marginCm 每边留的裱边，默认 5cm。
 *   不留边的话绣完没法绷框，所以默认给 5。
 */
function stitchPlan(cols, rows, palette, clothKey, marginCm) {
  const cloth = CLOTHS.filter(function (c) { return c.key === clothKey })[0] || CLOTHS[1]
  const margin = marginCm === undefined ? 5 : marginCm

  const perSkein = stitchesPerSkein(clothKey)

  let total = 0
  const perColor = palette.map(function (p) {
    total += p.count
    const skeins = p.count / perSkein
    return {
      hex: p.hex,
      symbol: p.symbol,
      count: p.count,
      // 保留两位小数；束数不足 0.05 也显示成 0.05，
      // 因为线是按束买的，再少也得买一束
      skeins: Math.max(0.05, Math.round(skeins * 100) / 100)
    }
  })

  // 成品尺寸：格数 ÷ 每英寸格数 = 英寸 → 厘米
  const wIn = cols / cloth.count
  const hIn = rows / cloth.count
  const wCm = wIn * 2.54
  const hCm = hIn * 2.54

  // 用线合计（按色累加，因为不足一束的也要买整束）
  let skeinTotal = 0
  perColor.forEach(function (p) { skeinTotal += p.skeins })
  skeinTotal = Math.ceil(skeinTotal)

  // 建议多买 15%（经验值：接色号很麻烦）
  const recommend = Math.ceil(skeinTotal * 1.15)

  return {
    kind: 'stitch',
    clothName: cloth.name,
    clothCount: cloth.count,
    strands: cloth.strands,
    marginCm: margin,
    total: total,
    perColor: perColor,
    stitchesPerSkein: perSkein,
    skeinMeters: SKEIN_METERS,
    skeinTotal: skeinTotal,
    // 含裱边的实际裁剪尺寸
    cutWidthCm: Math.round((wCm + margin * 2) * 10) / 10,
    cutHeightCm: Math.round((hCm + margin * 2) * 10) / 10,
    widthCm: Math.round(wCm * 10) / 10,
    heightCm: Math.round(hCm * 10) / 10,
    recommendSkeins: recommend
  }
}

// ── 像素画 ──────────────────────────────────────────

/**
 * 像素画方案。
 *
 * 像素画本身没有物理尺寸 —— 它是在屏幕上看的。
 * 所以只给格数和几种常见放大倍率下的像素尺寸。
 */
function pixelPlan(cols, rows, palette) {
  let total = 0
  palette.forEach(function (p) { total += p.count })

  return {
    kind: 'pixel',
    total: total,
    perColor: palette.map(function (p) {
      return { hex: p.hex, symbol: p.symbol, count: p.count }
    }),
    // 常见放大倍率
    scales: [1, 2, 4, 8].map(function (s) {
      return { scale: s, w: cols * s, h: rows * s }
    })
  }
}

/** 按图纸类型分派 */
function planFor(kind, cols, rows, palette, opt) {
  const o = opt || {}
  if (kind === 'bead') return beadPlan(cols, rows, palette, o.bead || 'midi')
  if (kind === 'stitch') return stitchPlan(cols, rows, palette, o.cloth || '14ct', o.marginCm)
  return pixelPlan(cols, rows, palette)
}

// ── 图片比例与推荐格数 ──────────────────────────────
//
// 生成页选完图之后要给用户两样东西：这张图是什么比例、格数该拉到多少。
//
// 为什么需要推荐：**同样是 80 格，横图和竖图的工作量差两倍多**。
// 3:4 竖图 80 格 → 80×107 = 8560 格，16:9 横图 80 格 → 80×45 = 3600 格。
// 用户看不出来，只能瞎拉。按成品尺寸反推就一致了。

/**
 * 常见画面比例。用来把「1023 × 767」还原成「4:3」。
 *
 * **不能直接拿 gcd 约分** —— 手机图常是 1023×767 这种互质的尺寸，
 * 约出来是「1023:767」，没人这么说话。做法是跟这张表比，
 * 落在容差内就用表里的名字。
 */
// 名字和数值分开写 —— 手机截屏是 9:19.5，写不成整数对
const COMMON_RATIOS = [
  { label: '1:1', a: 1 },
  { label: '4:3', a: 4 / 3 },
  { label: '3:4', a: 3 / 4 },
  { label: '3:2', a: 3 / 2 },
  { label: '2:3', a: 2 / 3 },
  { label: '16:9', a: 16 / 9 },
  { label: '9:16', a: 9 / 16 },
  { label: '5:4', a: 5 / 4 },
  { label: '4:5', a: 4 / 5 },
  { label: '2:1', a: 2 },
  { label: '1:2', a: 1 / 2 },
  { label: '21:9', a: 21 / 9 },
  { label: '9:21', a: 9 / 21 },
  { label: '9:20', a: 9 / 20 },
  { label: '9:19.5', a: 9 / 19.5 }
]

const RATIO_TOL = 0.02 // 2% 以内就算「是这个比例」

/** 「3:4」这样的比例标签 */
function ratioLabel(w, h) {
  if (!w || !h) return ''
  const a = w / h

  let best = null
  for (let i = 0; i < COMMON_RATIOS.length; i++) {
    const r = COMMON_RATIOS[i]
    const err = Math.abs(a - r.a) / r.a
    if (best === null || err < best.err) best = { err: err, label: r.label }
  }
  if (best && best.err <= RATIO_TOL) return best.label

  // 认不出来就按长边归一到 1，写两位小数
  const num = a >= 1 ? a : 1 / a
  const rounded = Math.round(num * 100) / 100
  return a >= 1 ? rounded + ':1' : '1:' + rounded
}

/** 竖图 / 横图 / 方图 */
function orientation(w, h) {
  if (!w || !h) return ''
  const a = w / h
  if (Math.abs(a - 1) <= RATIO_TOL) return '方图'
  return a > 1 ? '横图' : '竖图'
}

/**
 * 推荐格数用的目标。
 *
 * ⚠️ 这里用的常数必须是**上面 BEADS / CLOTHS 里那几个**，
 * 不能另拍一套 —— 详情页的材料方案用的是同一套常数，
 * 两边对不上，用户会发现"推荐说 28cm，材料方案说 31cm"。
 *
 * 生成页只有用途这一级，没有豆规格 / 绣布规格的选择器（那是详情页才选的），
 * 所以按最普及的规格估，并且**在界面上写明这个前提**。
 */
const RECOMMEND = {
  bead: { mmPerCell: 5, targetCm: 20, note: '按 5mm 中豆估' },
  stitch: { ct: 14, targetCm: 15, note: '按 14CT 估' },
  pixel: { targetCells: 3000, note: '像素画没有物理尺寸，按总格数控制' }
}

// 和滑杆的范围保持一致（pages/index/index.wxml 的 min/max）
const COLS_MIN = 20
const COLS_MAX = 120

// 总格数上限。竖图在同样的"成品宽度"下会把行数顶得很高 ——
// 3:4 竖图按 20cm 目标算是 40×53，还行；但 9:19.5 那种细长图
// 不兜住的话行数能到一百多，总格数翻倍，摆不完
const CELLS_MAX = 6000

/** 一格多少厘米。像素画没有物理尺寸，返回 0 */
function cellCm(kind, opt) {
  const o = opt || {}
  if (kind === 'bead') {
    const b = BEADS.filter(function (x) { return x.key === (o.bead || 'midi') })[0] || BEADS[1]
    return b.mm / 10
  }
  if (kind === 'stitch') {
    const c = CLOTHS.filter(function (x) { return x.key === (o.cloth || '14ct') })[0] || CLOTHS[1]
    return 2.54 / c.count
  }
  return 0
}

/** 夹到滑杆区间并取偶 —— 偶数格数方便对折找中心 */
function snapCols(v) {
  let c = Math.round(v / 2) * 2
  if (!(c > 0)) c = COLS_MIN
  if (c < COLS_MIN) c = COLS_MIN
  if (c > COLS_MAX) c = COLS_MAX
  return c
}

/** 按比例算行数 */
function rowsFor(cols, aspect) {
  return Math.max(1, Math.round(cols / (aspect > 0 ? aspect : 1)))
}

/** 成品尺寸（厘米）。像素画返回 null */
function sizeCm(kind, cols, rows, opt) {
  const cm = cellCm(kind, opt)
  if (!cm) return null
  return {
    widthCm: Math.round(cols * cm * 10) / 10,
    heightCm: Math.round(rows * cm * 10) / 10
  }
}

/**
 * 按成品尺寸推荐格数。
 *
 * @param {string} kind   'bead' | 'stitch' | 'pixel'
 * @param {number} aspect 宽 / 高
 */
function recommendCols(kind, aspect, opt) {
  const a = aspect > 0 ? aspect : 1
  const rule = RECOMMEND[kind] || RECOMMEND.pixel

  let cols
  if (kind === 'pixel') {
    // 没有物理尺寸，只能按总格数反推：cols × rows = cols² / a
    cols = Math.sqrt(rule.targetCells * a)
  } else {
    cols = rule.targetCm / cellCm(kind, opt)
  }
  cols = snapCols(cols)

  // 兜总格数上限。一次按开方缩放是不够的 —— 缩放后还要取偶，
  // 取偶可能又把它顶回上限之上（68×91 就是这么漏出来的），所以一步一步退
  let rows = rowsFor(cols, a)
  let guard = 0
  while (cols * rows > CELLS_MAX && cols > COLS_MIN && guard++ < COLS_MAX) {
    cols -= 2
    rows = rowsFor(cols, a)
  }

  const size = sizeCm(kind, cols, rows, opt)
  return {
    cols: cols,
    rows: rows,
    cells: cols * rows,
    widthCm: size ? size.widthCm : 0,
    heightCm: size ? size.heightCm : 0,
    note: rule.note
  }
}

/**
 * 比例太极端时给裁剪建议。
 *
 * 阈值取 2.0 / 0.5：16:9（1.78）和 3:4（0.75）都算正常，
 * 真正会被点名的只有全景长图（3:1 上下）和手机截屏（9:19.5 ≈ 0.46）这类。
 * 只给建议，**不自动改图**。
 */
const CROP_WIDE = 2.0
const CROP_TALL = 0.5

function cropAdvice(aspect) {
  if (!(aspect > 0)) return null
  if (aspect > CROP_WIDE) {
    return { toRatio: 4 / 3, label: '4:3', reason: '横向太扁，中间内容会被压得很小' }
  }
  if (aspect < CROP_TALL) {
    return { toRatio: 3 / 4, label: '3:4', reason: '纵向太长，两边会空很多' }
  }
  return null
}

module.exports = {
  BEADS: BEADS,
  CLOTHS: CLOTHS,
  PEGBOARD: PEGBOARD,
  SKEIN_METERS: SKEIN_METERS,
  stitchesPerSkein: stitchesPerSkein,
  beadPlan: beadPlan,
  stitchPlan: stitchPlan,
  pixelPlan: pixelPlan,
  planFor: planFor,
  // 图片比例与推荐
  COMMON_RATIOS: COMMON_RATIOS,
  RECOMMEND: RECOMMEND,
  CELLS_MAX: CELLS_MAX,
  COLS_MIN: COLS_MIN,
  COLS_MAX: COLS_MAX,
  ratioLabel: ratioLabel,
  orientation: orientation,
  cellCm: cellCm,
  rowsFor: rowsFor,
  sizeCm: sizeCm,
  recommendCols: recommendCols,
  cropAdvice: cropAdvice
}
