/**
 * 材料方案计算自检
 *
 *   node tools/materials-test.js
 *
 * 这个模块的输出是**采购清单** —— 算错了用户就买错料，
 * 而且是照着错的数字去买，做完才发现不够。所以数值得钉死。
 */

const root = require('./_root.js')
const mat = root.req('utils', 'materials.js')

let failed = 0

function check(label, ok, detail) {
  if (ok) {
    console.log('  ok    ' + label + (detail ? '  ' + detail : ''))
  } else {
    failed++
    console.log('  FAIL  ' + label + (detail ? '  ' + detail : ''))
  }
}

function near(a, b, tol) {
  return Math.abs(a - b) <= (tol === undefined ? 0.05 : tol)
}

// 造一个假调色板：总量可控
function pal(counts) {
  return counts.map(function (c, i) {
    return { hex: '#' + (100000 + i * 1111).toString(16).slice(0, 6), symbol: '◆', count: c }
  })
}

// ── 拼豆 ────────────────────────────────────────────

console.log('\n拼豆')

const p1 = mat.beadPlan(60, 45, pal([731, 432, 386]), 'midi')

check('总颗数 = 各色之和', p1.total === 731 + 432 + 386, String(p1.total))
check('颗数逐色正确', p1.perColor[0].count === 731, String(p1.perColor[0].count))

// 板数向上取整：60 格要 3 块 29 格的板（2 块只够 58 格）
check('60 格宽 → 3 块板', p1.boardsX === 3, 'ceil(60/29)=' + p1.boardsX)
check('45 格高 → 2 块板', p1.boardsY === 2, 'ceil(45/29)=' + p1.boardsY)
check('总板数 6', p1.boards === 6, String(p1.boards))

// 尺寸：5mm 豆，60 格 = 30cm
check('5mm 豆成品宽 30cm', near(p1.widthCm, 30), p1.widthCm + 'cm')
check('5mm 豆成品高 22.5cm', near(p1.heightCm, 22.5), p1.heightCm + 'cm')

const p2 = mat.beadPlan(60, 45, pal([100]), 'mini')
check('2.6mm 豆成品宽 15.6cm', near(p2.widthCm, 15.6), p2.widthCm + 'cm')

// 正好整除也要正确（58 = 2×29，不该算 3 块）
const p3 = mat.beadPlan(58, 29, pal([10]), 'midi')
check('正好整除 → 2×1 块，不多买', p3.boardsX === 2 && p3.boardsY === 1,
  p3.boardsX + '×' + p3.boardsY)

// 差一格就得多一块
const p4 = mat.beadPlan(59, 29, pal([10]), 'midi')
check('差一格 → 3 块', p4.boardsX === 3, String(p4.boardsX))

// ── 十字绣 ──────────────────────────────────────────

console.log('\n十字绣')

const s1 = mat.stitchPlan(60, 45, pal([731, 432]), '14ct', 5)

check('总针数 = 各色之和', s1.total === 1163, String(s1.total))

// 14CT：60 格 = 60/14 英寸 = 4.2857in = 10.886cm
check('14CT 成品宽 ≈ 10.9cm', near(s1.widthCm, 10.9, 0.15), s1.widthCm + 'cm')
check('14CT 成品高 ≈ 8.2cm', near(s1.heightCm, 8.2, 0.15), s1.heightCm + 'cm')

// 含 5cm 裱边
check('含边宽 ≈ 20.9cm', near(s1.cutWidthCm, 20.9, 0.2), s1.cutWidthCm + 'cm')
check('含边高 ≈ 18.2cm', near(s1.cutHeightCm, 18.2, 0.2), s1.cutHeightCm + 'cm')

// 14CT 两股 → 每束 1700 格
check('14CT 每束约 1700 格', s1.stitchesPerSkein === 1700, String(s1.stitchesPerSkein))

// 731 格 ÷ 1700 = 0.43 束
check('单色束数正确', near(s1.perColor[0].skeins, 0.43, 0.01), String(s1.perColor[0].skeins))

check('总束数向上取整', s1.skeinTotal >= 1, String(s1.skeinTotal))
check('建议多买 15%', s1.recommendSkeins >= s1.skeinTotal,
  s1.skeinTotal + ' → 建议 ' + s1.recommendSkeins)

// 11CT 三股更费线
const s11 = mat.stitchPlan(60, 45, pal([731]), '11ct', 5)
check('11CT 用 3 股', s11.strands === 3)
check('11CT 每束格数少于 14CT', s11.stitchesPerSkein < s1.stitchesPerSkein,
  s11.stitchesPerSkein + ' < ' + s1.stitchesPerSkein)
check('11CT 同样格数更费线', s11.perColor[0].skeins > s1.perColor[0].skeins,
  s11.perColor[0].skeins + ' > ' + s1.perColor[0].skeins)

// 11CT 格子更大 → 成品更大
check('11CT 成品比 14CT 大', s11.widthCm > s1.widthCm,
  s11.widthCm + 'cm > ' + s1.widthCm + 'cm')

// 每色至少 0.05 束（线按束买，再少也得买一束的一部分）
const tiny = mat.stitchPlan(10, 10, pal([1]), '14ct', 5)
check('极少格数时束数不小于 0.05', tiny.perColor[0].skeins >= 0.05,
  String(tiny.perColor[0].skeins))

// ── 像素画 ──────────────────────────────────────────

console.log('\n像素画')

const x1 = mat.pixelPlan(64, 64, pal([1000, 2000]))
check('像素画总格数正确', x1.total === 3000, String(x1.total))
check('放大倍率表正确', x1.scales.length === 4 &&
  x1.scales[3].w === 512 && x1.scales[3].h === 512,
  x1.scales.map(function (s) { return s.scale + 'x→' + s.w }).join(' '))
check('像素画不带物理尺寸字段', x1.widthCm === undefined)

// ── 分派 ────────────────────────────────────────────

console.log('\n按类型分派')

check('bead 分派正确', mat.planFor('bead', 30, 30, pal([10])).kind === 'bead')
check('stitch 分派正确', mat.planFor('stitch', 30, 30, pal([10])).kind === 'stitch')
check('pixel 分派正确', mat.planFor('pixel', 30, 30, pal([10])).kind === 'pixel')
check('未知类型回退到像素画', mat.planFor('???', 30, 30, pal([10])).kind === 'pixel')
check('默认豆规格是 midi', mat.planFor('bead', 30, 30, pal([10])).beadMm === 5)
check('默认绣布是 14CT', mat.planFor('stitch', 30, 30, pal([10])).clothCount === 14)

// ── 边界 ────────────────────────────────────────────

console.log('\n边界')

try {
  const e = mat.beadPlan(10, 10, [], 'midi')
  check('空调色板不崩', e.total === 0 && e.perColor.length === 0)
} catch (e) {
  check('空调色板不崩', false, e.message)
}

try {
  const e = mat.stitchPlan(1, 1, pal([1]), '14ct', 0)
  check('单格不崩', e.total === 1 && e.cutWidthCm > 0)
} catch (e) {
  check('单格不崩', false, e.message)
}

check('未知豆规格回退到中豆', mat.beadPlan(10, 10, pal([1]), 'nope').beadMm === 5)
check('未知绣布回退到 14CT', mat.stitchPlan(10, 10, pal([1]), 'nope').clothCount === 14)
check('裱边为 0 时成品尺寸 = 裁剪尺寸',
  mat.stitchPlan(14, 14, pal([1]), '14ct', 0).cutWidthCm ===
  mat.stitchPlan(14, 14, pal([1]), '14ct', 0).widthCm)

// ── 图片比例 ────────────────────────────────────────

console.log('\n比例标签')

check('3024×4032 认成 3:4', mat.ratioLabel(3024, 4032) === '3:4', mat.ratioLabel(3024, 4032))
check('4032×2268 认成 16:9', mat.ratioLabel(4032, 2268) === '16:9', mat.ratioLabel(4032, 2268))
check('1:1 方图', mat.ratioLabel(1000, 1000) === '1:1')
// 手机图常是互质尺寸，直接约分会得到「1023:767」这种没人说的东西
check('互质尺寸也认成常见比例', mat.ratioLabel(1023, 767) === '4:3', mat.ratioLabel(1023, 767))
check('手机截屏认成 9:19.5', mat.ratioLabel(1080, 2340) === '9:19.5', mat.ratioLabel(1080, 2340))
check('认不出来时退回小数写法',
  /^[\d.]+:1$|^1:[\d.]+$/.test(mat.ratioLabel(4000, 1000)), mat.ratioLabel(4000, 1000))

check('横图朝向', mat.orientation(4000, 3000) === '横图')
check('竖图朝向', mat.orientation(3000, 4000) === '竖图')
check('方图朝向', mat.orientation(1000, 1005) === '方图')

// ── 推荐格数 ────────────────────────────────────────

console.log('\n推荐格数')

const RATIOS = [
  [1, '1:1'], [3 / 4, '3:4'], [4 / 3, '4:3'], [16 / 9, '16:9'],
  [9 / 16, '9:16'], [3, '3:1'], [1 / 3, '1:3'], [9 / 19.5, '手机截屏'], [2, '2:1']
]

let outOfRange = null
let overCap = null
RATIOS.forEach(function (r) {
  ;['bead', 'stitch', 'pixel'].forEach(function (k) {
    const v = mat.recommendCols(k, r[0])
    if (v.cols < mat.COLS_MIN || v.cols > mat.COLS_MAX) {
      outOfRange = k + ' ' + r[1] + ' → ' + v.cols
    }
    if (v.cells > mat.CELLS_MAX) {
      overCap = k + ' ' + r[1] + ' → ' + v.cells + ' 格'
    }
  })
})
check('推荐格数都在滑杆区间内', !outOfRange, outOfRange || '')
// 上限是兜竖图的：不兜的话 9:19.5 那种细长图行数能到一百多，摆不完
check('推荐总格数不超过上限', !overCap, overCap || mat.CELLS_MAX + ' 格以内')

const tall = mat.recommendCols('bead', 3 / 4)
const wide = mat.recommendCols('bead', 4 / 3)
check('同样成品宽度下，横竖图工作量接近',
  Math.max(tall.cells, wide.cells) / Math.min(tall.cells, wide.cells) < 2,
  tall.cells + ' 格 vs ' + wide.cells + ' 格')

check('拼豆推荐宽度 = 目标 20cm', tall.widthCm === 20, tall.widthCm + 'cm')
check('刺绣推荐按 14CT', mat.recommendCols('stitch', 1).widthCm > 12 &&
  mat.recommendCols('stitch', 1).widthCm < 16,
  mat.recommendCols('stitch', 1).widthCm + 'cm')
check('像素画没有物理尺寸', mat.recommendCols('pixel', 1).widthCm === 0)
check('推荐值带说明（界面要写明按什么规格估）',
  !!tall.note && mat.recommendCols('stitch', 1).note.indexOf('14CT') >= 0,
  mat.recommendCols('stitch', 1).note)

// 推荐用的常数必须是材料方案那一套，不能另拍 —— 否则界面上会出现
// 「推荐说 20cm、材料方案说 25cm」这种自相矛盾
const r60 = mat.recommendCols('bead', 1)
const b60 = mat.beadPlan(r60.cols, r60.rows, pal([1]), 'midi')
check('拼豆推荐尺寸 = beadPlan 的成品尺寸',
  r60.widthCm === b60.widthCm && r60.heightCm === b60.heightCm,
  r60.widthCm + '×' + r60.heightCm + ' vs ' + b60.widthCm + '×' + b60.heightCm)

const r14 = mat.recommendCols('stitch', 1)
const s14 = mat.stitchPlan(r14.cols, r14.rows, pal([1]), '14ct')
check('刺绣推荐尺寸 = stitchPlan 的成品尺寸',
  r14.widthCm === s14.widthCm && r14.heightCm === s14.heightCm,
  r14.widthCm + '×' + r14.heightCm + ' vs ' + s14.widthCm + '×' + s14.heightCm)

check('行数按比例算', mat.rowsFor(80, 4 / 3) === 60, mat.rowsFor(80, 4 / 3))
check('像素画没有成品尺寸', mat.sizeCm('pixel', 60, 60) === null)

// ── 裁剪建议 ────────────────────────────────────────

console.log('\n裁剪建议')

check('3:1 全景触发', !!mat.cropAdvice(3))
check('4:1 长图触发', !!mat.cropAdvice(4))
check('手机截屏触发', !!mat.cropAdvice(9 / 19.5))
check('16:9 不触发（1.78 不算极端）', mat.cropAdvice(16 / 9) === null)
check('3:4 不触发', mat.cropAdvice(3 / 4) === null)
check('1:1 不触发', mat.cropAdvice(1) === null)
check('横向给 4:3', mat.cropAdvice(3).label === '4:3')
check('竖向给 3:4', mat.cropAdvice(9 / 19.5).label === '3:4')

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项失败') + '\n')
process.exitCode = failed === 0 ? 0 : 1
