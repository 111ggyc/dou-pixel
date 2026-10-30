/**
 * 把素材量化成图纸数据，写 data/patterns-img.js
 *
 *     node tools/build-patterns.js            # 先看报告
 *     node tools/build-patterns.js --write    # 写文件
 *
 * 前置：python tools/clean-watermark.py <素材目录> && python tools/prep-images.py
 *
 * ── 为什么走 node 而不是在 python 里做 ──
 * 量化用的是 utils/pattern.js 的 buildChart ——**就是 App 里「导入照片生成图纸」
 * 用的那一个**。在 python 里另写一份，两边算法一漂，素材图纸和用户自己导入的
 * 照片图纸就不是一套东西了。所以 python 只负责读图/去水印/裁剪/导出像素，
 * 真正的量化交给项目自己的代码。
 *
 * ── 背景怎么去掉的 ──
 * 不在像素上抠（那会留下一圈半透明的边，降采样之后反而更脏），
 * 而是在**量化完的网格上**做：先看四条边是不是同一种调色板色，
 * 是的话就从边上一圈圈往里推，把连通的同色格子标成空。
 * 纯色底会整片消失，留白处按空格处理 —— 和库里其它图纸的 '.' 是一回事。
 *
 * 加了两道保险：边上的主色要占够比例（不然风景那种会被误判），
 * 而且要抠掉的格子不能超过整幅的大半（不然就是把图抠没了）。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PREP = path.join(ROOT, 'tools', 'work', 'prep')
const OUT = path.join(ROOT, 'data', 'patterns-img.js')

const pattern = require(path.join(ROOT, 'utils', 'pattern.js'))

// 网格字符：'.' = 空格，其余按顺序对应调色板下标。
// 32 个字符正好等于符号表长度（色数上限也就是 32）
const CHARS = '0123456789abcdefghijklmnopqrstuv'

// 一个格子里有多少比例是背景，就算整个格子是空的
const MASK_CUT = 0.5
// 最多允许抠掉整幅的这么多 —— 超过就认为判错了，整个回滚
const MAX_REMOVE = 0.75

/**
 * 每张图对应什么。**按文件名排序后的下标硬编码**，是逐张看图认出来的。
 * 素材文件名是图床哈希，认不出内容；认错了界面上不会报错，
 * 只会「打盹的猫」点进去是一只青蛙。
 */
const MAP = [
  { id: 'p-cat-nap', name: '打盹的猫', en: 'SLEEPY CAT', kind: 'bead', series: 'animal', tag: '猫科',
    likes: 486, rating: 4.8, rateCount: 152,
    note: '横躺的姿势，先定轮廓再填身上的斑纹' },
  { id: 'p-valley', name: '山谷', en: 'VALLEY', kind: 'stitch', series: 'scape', tag: '风景',
    likes: 402, rating: 4.7, rateCount: 118,
    note: '远山只有两三个色，近处草地用色多，分区域绣不容易乱' },
  { id: 'p-apple', name: '红苹果', en: 'RED APPLE', kind: 'bead', series: 'fruit', tag: '水果',
    likes: 574, rating: 4.9, rateCount: 201,
    note: '果身是两档红过渡，左上那块浅色别漏' },
  { id: 'p-dino', name: '小恐龙', en: 'DINO', kind: 'bead', series: 'animal', tag: '幻想',
    likes: 389, rating: 4.6, rateCount: 104,
    note: '大色块、用色少，新手可以从它开始' },
  { id: 'p-panda', name: '熊猫', en: 'PANDA', kind: 'bead', series: 'animal', tag: '国宝',
    likes: 638, rating: 4.9, rateCount: 233,
    note: '黑白分明，但耳朵和眼圈那几小块容易串色' },
  { id: 'p-corgi', name: '柯基', en: 'CORGI', kind: 'bead', series: 'animal', tag: '犬科',
    likes: 552, rating: 4.8, rateCount: 187,
    note: '耳尖和两颊的浅色是最容易摆错的地方' },
  { id: 'p-watertown', name: '水乡', en: 'WATERTOWN', kind: 'stitch', series: 'scape', tag: '风景',
    likes: 341, rating: 4.6, rateCount: 92,
    note: '细节最密的一张，颜色过渡细，建议一格一格对着数' },
  { id: 'p-fox', name: '狐狸', en: 'FOX', kind: 'bead', series: 'animal', tag: '犬科',
    likes: 601, rating: 4.9, rateCount: 214,
    note: '脸颊那两块白决定像不像，摆歪了就不是狐狸了' },
  { id: 'p-sunset', name: '海边日落', en: 'SUNSET', kind: 'stitch', series: 'scape', tag: '风景',
    likes: 428, rating: 4.7, rateCount: 126,
    note: '天空是横向渐变，按行对齐就不会乱' },
  { id: 'p-cherry', name: '双樱桃', en: 'CHERRIES', kind: 'bead', series: 'fruit', tag: '水果',
    likes: 466, rating: 4.8, rateCount: 143,
    note: '两颗各带一块高光，梗和叶是深色的细条' },
  { id: 'p-rabbit', name: '兔子', en: 'RABBIT', kind: 'bead', series: 'animal', tag: '兔科',
    likes: 519, rating: 4.8, rateCount: 168,
    note: '白毛和底色很接近，靠描边定位最稳' },
  { id: 'p-cat-cool', name: '墨镜猫', en: 'COOL CAT', kind: 'bead', series: 'animal', tag: '猫科',
    likes: 587, rating: 4.9, rateCount: 205,
    note: '墨镜是一整块黑，和白毛的交界要数准' },
  { id: 'p-orange', name: '橙子片', en: 'ORANGE', kind: 'bead', series: 'fruit', tag: '水果',
    likes: 372, rating: 4.6, rateCount: 98,
    note: '果肉分瓣，每一瓣的深浅都不一样' },
  { id: 'p-frog', name: '青蛙', en: 'FROG', kind: 'bead', series: 'animal', tag: '两栖',
    likes: 445, rating: 4.7, rateCount: 131,
    note: '腮红和眼睛是小色块，先把大片的绿摆完' },
  { id: 'p-cat-sad', name: '委屈猫', en: 'SAD CAT', kind: 'bead', series: 'animal', tag: '猫科',
    likes: 493, rating: 4.8, rateCount: 156,
    note: '灰毛分三层，眼神全靠眼睛那一小块' },
  { id: 'p-octopus', name: '章鱼', en: 'OCTOPUS', kind: 'bead', series: 'animal', tag: '海洋',
    likes: 358, rating: 4.6, rateCount: 95,
    note: '圆脑袋好办，八条腿的走向容易摆乱' },
  { id: 'p-lake', name: '湖畔', en: 'LAKESIDE', kind: 'stitch', series: 'scape', tag: '风景',
    likes: 296, rating: 4.5, rateCount: 78,
    note: '整幅铺满、格数最多的一张，属于进阶里的进阶' },
  { id: 'p-cat-tabby', name: '橘猫', en: 'TABBY', kind: 'bead', series: 'animal', tag: '猫科',
    likes: 531, rating: 4.8, rateCount: 174,
    note: '虎斑是散点，先定眼睛和鼻子的位置再往外铺' },
  { id: 'p-grape', name: '紫葡萄', en: 'GRAPES', kind: 'bead', series: 'fruit', tag: '水果',
    likes: 407, rating: 4.7, rateCount: 112,
    note: '每颗深浅都不同，按颜色分组摆比按位置更快' },
  { id: 'p-cat-shock', name: '震惊猫', en: 'SHOCKED CAT', kind: 'bead', series: 'animal', tag: '猫科',
    likes: 562, rating: 4.9, rateCount: 192,
    note: '嘴张得大，黑块和橘毛的交界处要数清楚' }
]

/** 风景细节多，格子给大一点；动物/水果是大色块，小格子反而干净 */
const COLS = { bead: 32, stitch: 40 }

/**
 * 把逐像素的背景掩膜降到网格：每个格子里有多少比例是背景。
 *
 * 分块方式和 pattern.downsample 完全一致（同样的 floor 边界），
 * 否则掩膜和颜色会错半格，边缘上就会抠出一个锯齿。
 */
function maskToGrid(mask, w, h, cols, rows) {
  const out = new Float32Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * h) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / rows))
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * w) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / cols))

      let s = 0
      let c = 0
      for (let y = y0; y < y1; y++) {
        const row = y * w
        for (let x = x0; x < x1; x++) { s += mask[row + x]; c++ }
      }
      out[cy * cols + cx] = c ? s / c : 0
    }
  }
  return out
}

/**
 * 按掩膜把背景格子标成空。
 *
 * 掩膜是**预处理阶段在像素级**算出来的（和画布边连通、且颜色贴着底色），
 * 不是在这里按调色板色号判断的。这一点是踩过坑才改的：
 * 白猫那张的猫毛和米色底只差 45，量化之后并成了同一个色号，
 * 在网格上**再也分不开**，连通填充会把猫一起吃进去。
 */
function applyMask(chart, frac) {
  const assign = Int32Array.from(chart.assign)
  const n = assign.length

  let removed = 0
  for (let i = 0; i < n; i++) {
    if (frac[i] < MASK_CUT) continue
    if (assign[i] >= 0) removed++
    assign[i] = -1
  }

  if (removed / n > MAX_REMOVE) {
    // 判错了，别把图抠没
    return {
      assign: chart.assign,
      removed: 0,
      why: '要抠 ' + (removed / n * 100).toFixed(0) + '%，超过上限'
    }
  }
  return { assign: assign, removed: removed, why: '' }
}

/** 丢掉没人用的色号，并把 assign 重排 —— 不然调色板里会留空位 */
function compact(chart, assign) {
  const counts = new Int32Array(chart.palette.length)
  for (let i = 0; i < assign.length; i++) {
    if (assign[i] >= 0) counts[assign[i]]++
  }

  const order = []
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) order.push(i)
  order.sort(function (a, b) {
    if (counts[b] !== counts[a]) return counts[b] - counts[a]
    return a - b
  })

  const remap = new Int32Array(chart.palette.length).fill(-1)
  const colors = []
  order.forEach(function (old, idx) {
    remap[old] = idx
    colors.push(chart.palette[old].hex)
  })

  const grid = []
  for (let y = 0; y < chart.rows; y++) {
    let row = ''
    for (let x = 0; x < chart.cols; x++) {
      const v = assign[y * chart.cols + x]
      row += v < 0 ? '.' : CHARS[remap[v]]
    }
    grid.push(row)
  }

  let filled = 0
  for (let i = 0; i < assign.length; i++) if (assign[i] >= 0) filled++

  return { colors: colors, grid: grid, filled: filled }
}

/** 预处理写出来的是按序号命名的原始 RGBA（%02d.bin），不是原文件名 */
function loadBin(meta) {
  const name = (meta.index < 10 ? '0' : '') + meta.index + '.bin'
  return fs.readFileSync(path.join(PREP, name))
}

/** 配套的背景掩膜，一像素一字节 */
function loadMask(meta) {
  const name = (meta.index < 10 ? '0' : '') + meta.index + '.msk'
  return fs.readFileSync(path.join(PREP, name))
}

function main() {
  const write = process.argv.indexOf('--write') >= 0
  const meta = JSON.parse(fs.readFileSync(path.join(PREP, 'meta.json'), 'utf8'))

  if (meta.length !== MAP.length) {
    console.error('素材 %d 张 / 对照表 %d 条 —— 对不上，先核对 MAP', meta.length, MAP.length)
    process.exit(1)
  }

  const items = []
  const report = []

  meta.forEach(function (m, i) {
    const def = MAP[i]
    const cols = COLS[def.kind] || 32
    const colors = def.kind === 'stitch' ? 20 : 16

    const data = new Uint8ClampedArray(loadBin(m))
    const chart = pattern.buildChart(
      { data: data, width: m.w, height: m.h }, cols, colors, false)

    const stripped = m.plain
      ? applyMask(chart, maskToGrid(loadMask(m), m.w, m.h, chart.cols, chart.rows))
      : { assign: chart.assign, removed: 0, why: '整幅铺满，没有纯色底' }

    const assign = stripped.assign
    const cut = stripped.removed

    const packed = compact(chart, assign)
    const n = chart.cols * chart.rows

    items.push(Object.assign({}, def, {
      w: chart.cols,
      h: chart.rows,
      colors: packed.colors,
      grid: packed.grid
    }))

    report.push({
      id: def.id,
      name: def.name,
      size: chart.cols + '×' + chart.rows,
      palette: packed.colors.length,
      filled: packed.filled,
      ratio: packed.filled / n,
      cut: cut,
      why: stripped.why || ''
    })
  })

  // 不用 %-14s 那种宽度写法 —— node 的 console.log 只认 %s/%d/%f，
  // 不认宽度，写上去会原样打出来
  const pad = function (s, n) {
    s = String(s)
    while (s.length < n) s += ' '
    return s
  }

  console.log('\n图案            尺寸    色数   填充    占比    抠掉')
  report.forEach(function (r) {
    console.log('  ' + pad(r.id, 14) + pad(r.size, 7) + pad(r.palette, 6) +
      pad(r.filled, 7) + pad((r.ratio * 100).toFixed(1) + '%', 8) + pad(r.cut, 6) + r.why)
  })

  const over = report.filter(function (r) { return r.ratio > 0.8 || r.ratio < 0.15 })
  if (over.length) {
    console.log('\n⚠ 填充率超出 15–80%（library-test 会拦）：' +
      over.map(function (r) { return r.id + ' ' + (r.ratio * 100).toFixed(0) + '%' }).join(', '))
  }
  const big = report.filter(function (r) { return r.palette > pattern.SYMBOLS.length })
  if (big.length) {
    console.log('⚠ 色数超过符号表：' + big.map(function (r) { return r.id }).join(', '))
  }

  if (!write) {
    console.log('\n（没写文件，加 --write 才写入 data/patterns-img.js）')
    return
  }

  const lines = []
  lines.push('/**')
  lines.push(' * 素材图纸（由 tools/build-patterns.js 生成，**别手改**）')
  lines.push(' *')
  lines.push(' * 来源：用户提供的 AI 生成素材，经过去水印 → 裁剪 → 量化。')
  lines.push(' * 量化用的是 utils/pattern.js 的 buildChart，和 App 里「导入照片生成图纸」')
  lines.push(' * 是同一套算法 —— 所以这些图纸和用户自己导出来的是一套东西。')
  lines.push(' *')
  lines.push(' * grid 每行一个字符串：\'.\' 是空格，其余字符按顺序对应 colors 里的下标。')
  lines.push(' * 纯色背景已经在网格上抠成空格了（见 build-patterns.js 的说明）。')
  lines.push(' *')
  lines.push(' * ⚠️ 素材是 AI 生成的通用形象（动物脸、水果、风景），')
  lines.push(' *    不含任何受版权保护的角色或商标 —— 这是图纸类作品最容易踩的坑。')
  lines.push(' */')
  lines.push('')
  lines.push('const CHAR_SET = ' + JSON.stringify(CHARS))
  lines.push('')
  lines.push('const ITEMS = [')
  items.forEach(function (it) {
    lines.push('  {')
    lines.push('    id: ' + JSON.stringify(it.id) + ',')
    lines.push('    kind: ' + JSON.stringify(it.kind) + ',')
    lines.push('    series: ' + JSON.stringify(it.series) + ',')
    lines.push('    name: ' + JSON.stringify(it.name) + ',')
    lines.push('    en: ' + JSON.stringify(it.en) + ',')
    lines.push('    tag: ' + JSON.stringify(it.tag) + ',')
    // 这几个是演示数据（没有后端）。放在这里而不是手写进 presets.js，
    // 是为了重跑生成脚本时不会把它们冲掉 —— 生成文件是自洽的
    lines.push('    likes: ' + it.likes + ', rating: ' + it.rating +
      ', rateCount: ' + it.rateCount + ',')
    lines.push('    note: ' + JSON.stringify(it.note) + ',')
    lines.push('    w: ' + it.w + ', h: ' + it.h + ',')
    lines.push('    colors: [' + it.colors.map(function (c) { return JSON.stringify(c) }).join(', ') + '],')
    lines.push('    grid: [')
    it.grid.forEach(function (row) { lines.push('      ' + JSON.stringify(row) + ',') })
    lines.push('    ]')
    lines.push('  },')
  })
  lines.push(']')
  lines.push('')
  lines.push('module.exports = { CHAR_SET: CHAR_SET, ITEMS: ITEMS }')
  lines.push('')

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log('\n已写入 data/patterns-img.js（%d 个图案，%.0f KB）',
    items.length, fs.statSync(OUT).size / 1024)
}

main()
