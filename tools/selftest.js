/**
 * 图纸 PATTERN —— 算法自检
 *
 * utils/pattern.js 是纯函数，不引用 wx、不碰 canvas，所以能直接在 Node 里跑。
 * 这样不开微信开发者工具也能确认量化算法没写崩。
 *
 *   node tools/selftest.js
 *
 * 检查项：
 *   1. 尺寸按原图比例算出来（格数由参数定，行数由宽高比推）
 *   2. 色数不超过设定值
 *   3. 每一格都映射到合法的色号（没有 -1 / 越界）
 *   4. 各色格数之和 == 总格数（统计没漏没重）
 *   5. 色值是合法的 #rrggbb
 *   6. 图例按用量降序
 *   7. **两次生成结果完全一致** —— 这是图纸能不能用的前提：
 *      图纸是要照着做的，今天生成和明天生成必须是同一张。
 *      k-means 本身依赖随机初始点，这里靠中位切分打底保证了确定性。
 *   8. 全黑 / 全白输入不抛异常
 */

const root = require('./_root.js')

const pattern = root.req('utils', 'pattern.js')

const W = 240
const H = 180

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * 多频纹理 + 渐变 + 亮圆盘。
 *
 * 不能只用光滑渐变 —— 那样的输入对局部对比度算法没有意义。
 * 这里三个频率叠加，模拟真实照片的细节分布：
 * 粗结构 + 中频 + 细颗粒，既有平坦区也有强边缘。
 */
function makeImage() {
  const d = new Uint8ClampedArray(W * H * 4)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const dx = x - W / 2
      const dy = y - H / 2
      const inDisc = dx * dx + dy * dy < 45 * 45

      const tex =
        22 * Math.sin(x * 0.62) * Math.cos(y * 0.83) +
        14 * Math.sin((x + y) * 0.31) +
        9 * Math.sin(x * 1.7)

      d[i] = clamp255((inDisc ? 240 : (255 * x) / W) + tex)
      d[i + 1] = clamp255((inDisc ? 210 : (255 * y) / H) + tex * 0.8)
      d[i + 2] = clamp255((inDisc ? 120 : 255 * (1 - x / W)) + tex * 0.6)
      d[i + 3] = 255
    }
  }

  return { data: d, width: W, height: H }
}

let failed = 0

function check(label, ok, detail) {
  if (ok) {
    console.log('  ok    ' + label + (detail ? '  ' + detail : ''))
  } else {
    failed++
    console.log('  FAIL  ' + label + (detail ? '  ' + detail : ''))
  }
}

// ── 主检 ────────────────────────────────────────────

const COLS = 40
const COLORS = 12

console.log('\nPATTERN —— 调色板与图纸生成（' + COLS + ' 格 / ' + COLORS + ' 色）')

const t0 = Date.now()
const chart = pattern.buildChart(makeImage(), COLS, COLORS)
const ms = Date.now() - t0

const n = chart.cols * chart.rows

check('格数正确', chart.cols === COLS, chart.cols + ' × ' + chart.rows)
check(
  '行数按原图比例',
  chart.rows === Math.round((H / W) * COLS),
  'rows=' + chart.rows
)
check('色数不超过设定', chart.palette.length <= COLORS, chart.palette.length + ' 色')

let assignOk = true
for (let i = 0; i < n; i++) {
  const a = chart.assign[i]
  if (a < 0 || a >= chart.palette.length) { assignOk = false; break }
}
check('每格都映射到合法色号', assignOk)

let sum = 0
for (let i = 0; i < chart.palette.length; i++) sum += chart.palette[i].count
check('各色格数之和 = 总格数', sum === n, sum + ' / ' + n)

const hexOk = chart.palette.every((p) => /^#[0-9a-f]{6}$/i.test(p.hex))
check('色值是合法 #rrggbb', hexOk, chart.palette.slice(0, 4).map((p) => p.hex).join(' ') + ' …')

let desc = true
for (let i = 1; i < chart.palette.length; i++) {
  if (chart.palette[i].count > chart.palette[i - 1].count) { desc = false; break }
}
check('图例按用量降序', desc)

// 确定性 —— 这是整个作品最本质的一条约束
const chart2 = pattern.buildChart(makeImage(), COLS, COLORS)
let same =
  chart2.cols === chart.cols &&
  chart2.rows === chart.rows &&
  chart2.palette.length === chart.palette.length
if (same) {
  for (let i = 0; i < n; i++) {
    if (chart2.assign[i] !== chart.assign[i]) { same = false; break }
  }
}
check('两次生成结果完全一致（确定性）', same)

// 抖动路径也必须确定
const d1 = pattern.buildChart(makeImage(), COLS, COLORS, true)
const d2 = pattern.buildChart(makeImage(), COLS, COLORS, true)
let dSame = d1.palette.length === d2.palette.length
if (dSame) {
  for (let i = 0; i < n; i++) {
    if (d1.assign[i] !== d2.assign[i]) { dSame = false; break }
  }
}
check('开启抖动后依然确定', dSame)

check('抖动确实改变了分格', (() => {
  for (let i = 0; i < n; i++) if (d1.assign[i] !== chart.assign[i]) return true
  return false
})())

console.log('  —     生成耗时 ' + ms + 'ms（' + W + '×' + H + ' 输入）')

// ── 边界 ────────────────────────────────────────────

console.log('\n边界输入')

function flat(v) {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255
  }
  return { data: d, width: W, height: H }
}

let crashed = 0
;['全黑', '全白'].forEach((label, idx) => {
  try {
    const c = pattern.buildChart(flat(idx === 0 ? 0 : 255), COLS, COLORS)
    const cnt = c.palette.reduce((a, p) => a + p.count, 0)
    check(label + '输入不崩且统计正确', cnt === c.cols * c.rows, c.palette.length + ' 色')
  } catch (e) {
    crashed++
    check(label + '输入', false, e.message)
  }
})

failed += crashed

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项失败') + '\n')
process.exitCode = failed === 0 ? 0 : 1
