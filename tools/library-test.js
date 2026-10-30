/**
 * 图纸 PATTERN —— 图纸库内容自检
 *
 * data/presets.js / data/shapes.js / utils/rank.js 都不引用 wx，
 * 所以能在 Node 里直接跑，不开微信开发者工具也能确认图纸库没写崩。
 *
 *   node tools/library-test.js
 *
 * 检查项：
 *   1. 每个图案都归在一个**存在的**系列下（分类栏点进去不会是空的）
 *   2. 每个系列在它所属的用途下**非空**
 *   3. 每个图案引用的 shape 真的存在，且光栅化之后不是空的
 *   4. **成品填充率落在合理区间** —— 太稀图案读不出来，太密就是顶满画布。
 *      注意查的是**加了描边之后**的成品，描边会让填充率涨一成多
 *   5. 色数不超过符号表长度 —— 超了 paintChart 会在格子里画出字面量 "undefined"
 *   6. 调色板的不变量：色号合法、每个色号都被用到、每个都有符号、
 *      没有 '#888888' 兜底
 *   7. 声明的颜色数组和形状实际返回的色**数量一致** ——
 *      少了会落到兜底色（图上一个没定义的颜色，很隐蔽）；
 *      多了说明有元素没画出来（草莓的绿冠就这么漏了很久）
 *   8. 难度分在每个用途下都有区分度，且 WORK_REF 跟得上内容
 *   9. id 不重复
 *
 * 注：与 tools/selftest.js（量化算法）、tools/materials-test.js（用料）分开，
 * 这里只管**内容**。
 */

const root = require('./_root.js')

const presets = root.req('data', 'presets.js')
const shapes = root.req('data', 'shapes.js')
const shade = root.req('data', 'shade.js')
const rank = root.req('utils', 'rank.js')
const pattern = root.req('utils', 'pattern.js')

let failed = 0

function check(label, ok, detail) {
  if (ok) {
    console.log('  ok    ' + label + (detail ? '  ' + detail : ''))
  } else {
    failed++
    console.log('  FAIL  ' + label + (detail ? '  ' + detail : ''))
  }
}

// 成品填充率的合理区间。看着宽松，但它是**照相机**：
// 只要某个图案的公式写崩了（比如半径给大了、厚度写小了），一定会掉出去。
//
// 上限从 0.75 放宽到 0.80 —— 描边往外膨胀一圈会让填充率整体涨一成多。
// 但也不能再高：爱心早先没加描边时是 68%，加了之后到了 80%，
// 图上就是**顶满画布**的样子，比别的图案挤一大截，所以把半径收小了一档。
// 这一条真正守的是"图案要留出边距"。
const FILL_MIN = 0.15
const FILL_MAX = 0.8

const SERIES = presets.SERIES
const ALL = presets.PRESETS
// 库里是两类东西，校验方式不同，分开走：
//   形状类 —— 形状函数光栅化 + shade.js 加描边明暗
//   素材类 —— 从 AI 生成素材量化来的网格，自带明暗，没有形状函数
const SHAPES = presets.SHAPE_PRESETS
const IMGS = presets.IMG_PRESETS
const imgData = root.req('data', 'patterns-img.js')
const KINDS = Object.keys(SERIES)

console.log('\n图纸库 —— ' + ALL.length + ' 个图案 / ' + KINDS.length + ' 个用途')

// ── 1. id 唯一 ──────────────────────────────────────

console.log('\n编号')

;(function () {
  const seen = {}
  let dup = null
  ALL.forEach(function (p) {
    if (seen[p.id]) dup = p.id
    seen[p.id] = true
  })
  check('id 不重复', !dup, dup ? '重复：' + dup : ALL.length + ' 个')
})()

// ── 2. 归属合法 ─────────────────────────────────────

console.log('\n分类归属')

;(function () {
  const badKind = ALL.filter(function (p) { return KINDS.indexOf(p.kind) < 0 })
  check('每个图案的用途合法', badKind.length === 0,
    badKind.length ? badKind.map(function (p) { return p.id }).join(', ') : '')

  const badSeries = ALL.filter(function (p) {
    const list = SERIES[p.kind] || []
    return !list.some(function (s) { return s.key === p.series })
  })
  check('每个图案的系列存在', badSeries.length === 0,
    badSeries.length ? badSeries.map(function (p) { return p.id + '/' + p.series }).join(', ') : '')

  // 空系列 = 分类栏点进去一片空白，比缺图案更难看
  const empties = []
  KINDS.forEach(function (k) {
    SERIES[k].forEach(function (s) {
      const n = ALL.filter(function (p) { return p.kind === k && p.series === s.key }).length
      if (n === 0) empties.push(k + '/' + s.key)
    })
  })
  check('没有空系列', empties.length === 0,
    empties.length ? '空：' + empties.join(', ') : KINDS.map(function (k) {
      return presets.forKind(k).length + ' 款'
    }).join(' / '))
})()

// ── 3. 逐图案：形状、填充率、调色板 ─────────────────

console.log('\n形状图案（' + SHAPES.length + ' 个）')

SHAPES.forEach(function (p) {
  const tag = p.id + ' ' + p.name

  const fn = shapes[p.shape]
  if (typeof fn !== 'function') {
    check(tag + ' · shape 存在', false, 'shapes.' + p.shape + ' 未定义')
    return
  }

  const r = presets.rasterize(p)
  if (!r) {
    check(tag + ' · 可光栅化', false)
    return
  }

  // ── 造型层：形状函数直接吐出来的本色网格 ──
  let baseFilled = 0
  let maxIdx = -1
  const used = {}
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const ch = r.grid[y][x]
      if (ch === '.') continue
      const idx = ch.charCodeAt(0) - 65
      baseFilled++
      if (idx > maxIdx) maxIdx = idx
      used[idx] = (used[idx] || 0) + 1
    }
  }

  // 声明的颜色数组必须和形状实际返回的**完全对上**：
  //   少了 → 派生色调时取不到本色，落到 '#888888' 兜底，
  //          图上出现一个没定义的颜色（隐蔽）
  //   多了 → 要么是没画出来的元素（草莓的绿冠就是这样漏了很久），
  //          要么是白声明了一个色号，两种都该查出来
  const usedN = Object.keys(used).length
  check(tag + ' · 声明色数 = 形状用色数', p.colors.length === usedN,
    '用到 ' + usedN + ' 色 / 声明 ' + p.colors.length + ' 色')

  // ── 成品层：加上描边和明暗之后真正画出来的那张 ──
  const chart = presets.toChart(p)
  if (!chart) {
    check(tag + ' · toChart', false)
    return
  }

  const filled = chart.palette.reduce(function (a, c) { return a + c.count }, 0)
  const ratio = filled / (chart.cols * chart.rows)
  const pct = (ratio * 100).toFixed(1) + '%'

  check(tag + ' · 成品非空', filled > 0, '填充 ' + pct)
  check(tag + ' · 成品填充率在 ' + (FILL_MIN * 100) + '–' + (FILL_MAX * 100) + '%',
    ratio >= FILL_MIN && ratio <= FILL_MAX,
    pct + '（形状 ' + (baseFilled / (r.w * r.h) * 100).toFixed(0) + '%，描边会推高）')

  // 色数不能超过符号表长度 —— 超了 paintChart 会在格子里画出字面量 "undefined"
  check(tag + ' · 色数 ≤ 符号表', chart.palette.length <= pattern.SYMBOLS.length,
    chart.palette.length + ' ≤ ' + pattern.SYMBOLS.length)

  // 每个调色板条目都要真的被用到。派生的思路是"用到才进表"，
  // 出现 count 为 0 的条目说明派生逻辑漏了
  const unused = chart.palette.filter(function (c) { return !c.count }).length
  check(tag + ' · 每个色号都被用到', unused === 0, unused ? unused + ' 个空色号' : '')

  const badAssign = (function () {
    for (let i = 0; i < chart.assign.length; i++) {
      const v = chart.assign[i]
      if (v < -1 || v >= chart.palette.length) return i
    }
    return -1
  })()
  check(tag + ' · 色号合法', badAssign < 0,
    badAssign < 0 ? '' : '第 ' + badAssign + ' 格 = ' + chart.assign[badAssign])

  check(tag + ' · 符号数 = 色数', chart.symbols.length === chart.palette.length,
    chart.symbols.length + ' / ' + chart.palette.length)

  // 详情页用色表读的是 palette 条目上的 symbol，以前两边都没塞，那列一直空着
  const noSym = chart.palette.filter(function (c) { return !c.symbol }).length
  check(tag + ' · 每个色号都有符号', noSym === 0, noSym ? noSym + ' 个没符号' : '')

  // '#888888' 是兜底色，出现就说明本色取不到
  const fallback = chart.palette.filter(function (c) { return c.hex === '#888888' })
  check(tag + ' · 没有兜底色', fallback.length === 0,
    fallback.length ? fallback.length + ' 个色落到 #888888' : '')
})

// ── 3b. 逐图案：素材类 ──────────────────────────────
//
// 校验方式和形状类不同：
//   · 没有形状函数，验的是**网格本身**（尺寸、字符、色号）
//   · 填充率不设上限 —— 「留出边距」那条是给形状类定的；
//     素材类的前身就是一张铺满的画，湖畔那张 100% 是正常的
//   · 不查「声明色数 = 形状用色数」—— 那是形状函数的契约

console.log('\n素材图案（' + IMGS.length + ' 个）')

const IMG_FILL_MIN = 0.15

IMGS.forEach(function (p) {
  const tag = p.id + ' ' + p.name
  const spec = p.img

  if (!spec || !spec.grid || !spec.colors) {
    check(tag + ' · 有网格和调色板', false)
    return
  }

  const w = spec.grid[0] ? spec.grid[0].length : 0
  const ragged = spec.grid.filter(function (r) { return r.length !== w })
  check(tag + ' · 网格是规整的矩形',
    w > 0 && spec.grid.length === p.h && w === p.w && ragged.length === 0,
    spec.grid.length + '×' + w + ' / 声明 ' + p.w + '×' + p.h)

  const chars = imgData.CHAR_SET
  const badChar = []
  for (let y = 0; y < spec.grid.length; y++) {
    for (let x = 0; x < spec.grid[y].length; x++) {
      const ch = spec.grid[y][x]
      if (ch === '.') continue
      const i = chars.indexOf(ch)
      if (i < 0 || i >= spec.colors.length) badChar.push(ch)
    }
  }
  check(tag + ' · 网格字符都对得上色号', badChar.length === 0,
    badChar.length ? '越界字符 ' + badChar.slice(0, 3).join('') : '')

  const badHex = spec.colors.filter(function (c) { return !/^#[0-9a-f]{6}$/.test(c) })
  check(tag + ' · 色号是合法的十六进制', badHex.length === 0, badHex.slice(0, 2).join(','))

  const chart = presets.toChart(p)
  if (!chart) {
    check(tag + ' · toChart', false)
    return
  }

  check(tag + ' · 尺寸还原正确', chart.cols === p.w && chart.rows === p.h,
    chart.cols + '×' + chart.rows)

  const filled = chart.palette.reduce(function (a, c) { return a + c.count }, 0)
  const ratio = filled / (chart.cols * chart.rows)
  check(tag + ' · 成品非空', filled > 0)
  check(tag + ' · 填充率 ≥ ' + (IMG_FILL_MIN * 100) + '%', ratio >= IMG_FILL_MIN,
    (ratio * 100).toFixed(1) + '%')

  check(tag + ' · 色数 ≤ 符号表', chart.palette.length <= pattern.SYMBOLS.length,
    chart.palette.length + ' ≤ ' + pattern.SYMBOLS.length)

  // 抠完背景之后，剩下的色号必须都还在用 —— 有一个是空的就说明
  // 压缩调色板那一步漏了（生成脚本里的 compact）
  const unused = chart.palette.filter(function (c) { return !c.count }).length
  check(tag + ' · 每个色号都被用到', unused === 0, unused ? unused + ' 个空色号' : '')

  const badAssign = (function () {
    for (let i = 0; i < chart.assign.length; i++) {
      if (chart.assign[i] < -1 || chart.assign[i] >= chart.palette.length) return i
    }
    return -1
  })()
  check(tag + ' · 色号合法', badAssign < 0,
    badAssign < 0 ? '' : '第 ' + badAssign + ' 格 = ' + chart.assign[badAssign])

  check(tag + ' · 符号数 = 色数', chart.symbols.length === chart.palette.length)

  const noSym = chart.palette.filter(function (c) { return !c.symbol }).length
  check(tag + ' · 每个色号都有符号', noSym === 0)

  // 符号画黑还是画白靠这个字段，缺了整个图纸的可读性就没了
  const noDark = chart.palette.filter(function (c) {
    return typeof c.dark !== 'boolean'
  }).length
  check(tag + ' · 明暗标记齐全', noDark === 0, noDark ? noDark + ' 个没标' : '')
})

// ── 4. 排序口径 ─────────────────────────────────────

console.log('\n排序')

;(function () {
  const list = rank.decorate(presets.forKind('bead'), presets.measure, {})
  check('decorate 透出 series', list.every(function (x) { return !!x.series }))

  // 库页显示的色数必须和详情页一致 —— 两边都取**渲染后**的值。
  // 早先库页取声明色数、详情页取调色板长度，加明暗之后这两个数差了快一倍
  const mismatch = list.filter(function (x) {
    return x.colorCount !== presets.measure(x.preset).colorCount
  })
  check('库页色数 = 渲染色数', mismatch.length === 0,
    mismatch.length ? mismatch.map(function (x) { return x.name }).join(', ') : '')

  rank.MODES.forEach(function (m) {
    const sorted = rank.sortBy(list, m.key)
    const n = sorted.length
    const ranksOk = sorted.every(function (x, i) { return x.rank === i + 1 })
    check('排序「' + m.name + '」名次连续', ranksOk, n + ' 项')
  })

  // 易做档必须真的是从小到大 —— 这是三个口径里唯一真实计算的那个
  const easy = rank.sortBy(list, 'easy')
  let sortedOk = true
  for (let i = 1; i < easy.length; i++) {
    if (easy[i].difficulty < easy[i - 1].difficulty) sortedOk = false
  }
  check('易做档难度递增', sortedOk)

  // 难度要有区分度。曾经所有图案都是 28×28，难度全挤在少数几档，
  // 更糟的是 像素画 整类被工艺系数压到同一档，「易做」对那一类等于失效。
  // 所以这里**按用途分开查**，不能只看全库的总档数 —— 总档数够、
  // 单类只有一档，正是当初那个 bug 的样子。
  const span = {}
  KINDS.forEach(function (k) {
    const lv = {}
    rank.decorate(presets.forKind(k), presets.measure, {})
      .forEach(function (x) { lv[x.difficulty] = true })
    span[k] = Object.keys(lv).sort().join('/')
  })
  const thin = KINDS.filter(function (k) { return span[k].split('/').length < 2 })
  check('每个用途的难度至少分 2 档', thin.length === 0,
    KINDS.map(function (k) { return k + ':' + span[k] }).join('  '))

  // 全库合起来看要有真正的跨度
  const allLevels = {}
  ALL.forEach(function (p) {
    const m = presets.measure(p)
    allLevels[rank.difficulty(p, m.filled, m.colorCount)] = true
  })
  check('全库难度覆盖 3 档以上', Object.keys(allLevels).length >= 3,
    Object.keys(allLevels).sort().join('/'))

  // WORK_REF 是"量出来"的：每类里最费事的那件应该接近参考值。
  // 差太远说明参考值没跟着内容更新 —— 要么整类挤在低档（参考值太大），
  // 要么一堆图案顶到满分（参考值太小）。改图案规格或描边粗细之后
  // 这条会先报警，把新数字填回 rank.js 的 WORK_REF 就行
  const refDrift = []
  KINDS.forEach(function (k) {
    const ref = rank.WORK_REF[k]
    const max = Math.max.apply(null, presets.forKind(k).map(function (p) {
      return presets.measure(p).filled
    }))
    const ratio = max / ref
    if (ratio < 0.85 || ratio > 1.15) {
      refDrift.push(k + ' 最大 ' + max + ' / 参考 ' + ref +
        '（' + Math.round(ratio * 100) + '%）')
    }
  })
  check('WORK_REF 跟得上内容', refDrift.length === 0,
    refDrift.length ? refDrift.join('  ') : KINDS.map(function (k) {
      return k + ':' + rank.WORK_REF[k]
    }).join('  '))

  // 分类栏的「全部」等价于 forKind
  const allBead = presets.forKindSeries('bead', 'all')
  check('forKindSeries(全部) = forKind',
    allBead.length === presets.forKind('bead').length, allBead.length + ' 款')

  const oneSeries = presets.forKindSeries('bead', 'dessert')
  check('forKindSeries(单系列) 只返回该系列',
    oneSeries.length > 0 && oneSeries.every(function (p) { return p.series === 'dessert' }),
    oneSeries.length + ' 款')
})()

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项失败') + '\n')
process.exitCode = failed === 0 ? 0 : 1
