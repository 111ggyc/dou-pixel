/**
 * 图纸库内容
 *
 * 分两级：**用途**（拼豆 / 刺绣 / 像素画）× **系列**（水果 / 甜点 / 山水 …）。
 * 三级结构是因为只有用途一级的话，一类十几款铺平了找起来很累。
 *
 * 每个图案的 `colors` 是**本色**（形状函数返回的色号），
 * 真正渲染出来的调色板比它多 —— 描边和明暗会从本色派生出色调，
 * 详见 data/shade.js。所以库页显示的色数取的是**渲染后**的值
 * （presets.measure().colorCount），不是 colors.length。
 *
 * ⚠️ 点赞数和评分是**演示数据**（写死在下面的 likes / rating / rateCount）。
 * 没有后端就没有真实数据。界面上会标明是演示。
 * **用户自己点的赞和发的评论是真的**，但只存在本机。
 *
 * 图案有两类，都**不涉及任何人的版权** —— 没有动漫角色、品牌 logo 这类，
 * 图纸类作品最容易踩的就是这个坑：
 *   · 形状类（本文件里的 PRESETS）—— 公式生成的通用几何图形；
 *   · 素材类（data/patterns-img.js，见下面的 IMG）—— AI 生成的动物 / 水果 / 风景
 *     插画量化而来，已去掉水印和纯色背景。
 */

const shapes = require('./shapes.js')
const shade = require('./shade.js')
const imgData = require('./patterns-img.js')
// 只为了拿符号表。符号必须和 buildChart 用同一张表 ——
// 否则同一个色号在照片图纸和预设图纸上会显示成两个不同的符号
const pattern = require('../utils/pattern.js')

/**
 * 平涂名单。
 *
 * 这些图案**不加**描边和明暗，理由见 shade.js 抬头：
 *   - 线描类（竹 / 梅 / 兰 / 云纹 / 山水 / 音符）本来就是"线"，
 *     笔画只有两格多宽，往外膨胀一格会糊成一团黑边；而且细线的深度
 *     处处是 1，会被整根压成暗调，把竹节、兰叶那点颜色变化全吃掉。
 *   - 表情包是**扁平**风格，emoji 本来就没有明暗，加了反而脏。
 *
 * 其余图案默认都走明暗（拼豆、甜点、植物、器皿、实心图标）。
 * 名单以渲染出来的效果为准，改这里就重跑 _presettest.js 看图。
 */
const FLAT = {
  's-bamboo': 1, 's-plum': 1, 's-orchid': 1, 's-cloud': 1, 's-scape': 1,
  'x-note': 1,
  'x-smile': 1, 'x-laugh': 1, 'x-love': 1, 'x-cry': 1,
  'x-angry': 1, 'x-shock': 1, 'x-wink': 1, 'x-speechless': 1
}

/**
 * 系列（二级分类）。
 *
 * 一级是「用途」（拼豆 / 刺绣 / 像素画），二级是**题材**。
 * 参考电商上的图纸大全，都是「先按用途分、再按题材分」的两级结构 ——
 * 只有一级的话，一类十几款铺平了看，找起来很累。
 */
const SERIES = {
  bead: [
    { key: 'fruit', name: '水果' },
    { key: 'dessert', name: '甜点' },
    { key: 'plant', name: '植物' },
    { key: 'animal', name: '动物' }
  ],
  stitch: [
    { key: 'flora', name: '花木' },
    { key: 'scape', name: '山水' },
    { key: 'ware', name: '器物' }
  ],
  pixel: [
    { key: 'emoji', name: '表情' },
    { key: 'icon', name: '图标' }
  ]
}

// 演示用的赞数和评分。数字大小和"好不好做"大致对应，看着才合理
const PRESETS = [
  // ── 拼豆 · 水果 ────────────────────────────────────
  { id: 'b-apple', kind: 'bead', series: 'fruit', name: '苹果', en: 'APPLE', shape: 'apple',
    w: 28, h: 28, colors: ['#e0453f', '#5aa84f', '#6b4a2f'],
    likes: 328, rating: 4.7, rateCount: 96,
    note: '色块大、边缘圆，新手第一个作品通常选它' },

  { id: 'b-straw', kind: 'bead', series: 'fruit', name: '草莓', en: 'STRAWBERRY', shape: 'strawberry',
    w: 28, h: 28, colors: ['#e03e50', '#f5e08a', '#4f9e4a'],
    likes: 402, rating: 4.8, rateCount: 131,
    note: '籽是散点，摆的时候要数清楚' },

  { id: 'b-melon', kind: 'bead', series: 'fruit', name: '西瓜', en: 'WATERMELON', shape: 'watermelon',
    w: 28, h: 28, colors: ['#e8455a', '#8fd06a', '#3f8f4a', '#2a2620'],
    likes: 517, rating: 4.9, rateCount: 188,
    note: '四色，块面分明，适合练换色' },

  // 原来是「柠檬」一个光椭圆。改成切片 —— 柑橘切片的果肉分瓣是
  // 一堆圆滚滚的水果里最有内部结构的一个，参考图里的橙片就是这个
  { id: 'b-lemon', kind: 'bead', series: 'fruit', name: '柠檬片', en: 'LEMON SLICE', shape: 'citrusSlice',
    w: 28, h: 28, colors: ['#e8bd2a', '#f7d84a', '#d9a516', '#fdf6e0'],
    likes: 186, rating: 4.4, rateCount: 47,
    note: '八瓣果肉被白筋分开，摆的时候一瓣一瓣来最不容易错' },

  // 三个色缺一不可：0 = 果身，1 = 每颗左上那点高光，2 = 梗和叶。
  // （早先只声明了两个色，梗和叶一直落在 toChart 的 '#888888' 兜底上）
  { id: 'b-grape', kind: 'bead', series: 'fruit', name: '葡萄', en: 'GRAPES', shape: 'grapes',
    w: 28, h: 28, colors: ['#7c5a9e', '#cbabe2', '#4a7a3a'],
    likes: 243, rating: 4.5, rateCount: 68,
    note: '十颗独立的果，每颗左上一点高光，照着亮点定位最不容易错' },

  { id: 'b-cherry', kind: 'bead', series: 'fruit', name: '樱桃', en: 'CHERRY', shape: 'cherry',
    w: 28, h: 28, colors: ['#d63a4a', '#5aa84f'],
    likes: 211, rating: 4.6, rateCount: 55,
    note: '两根梗是斜线，容易摆歪' },

  { id: 'b-pine', kind: 'bead', series: 'fruit', name: '菠萝', en: 'PINEAPPLE', shape: 'pineapple',
    w: 28, h: 28, colors: ['#e8b23a', '#c9922a', '#4f9e4a'],
    likes: 297, rating: 4.5, rateCount: 82,
    note: '格纹是重点，错一格整片就歪' },

  { id: 'b-banana', kind: 'bead', series: 'fruit', name: '香蕉', en: 'BANANA', shape: 'banana',
    w: 28, h: 28, colors: ['#f0d04a', '#d8b02a'],
    likes: 174, rating: 4.3, rateCount: 41,
    note: '弯月形，弧线不好对齐，算中等难度' },

  // ── 拼豆 · 甜点 ────────────────────────────────────
  { id: 'b-donut', kind: 'bead', series: 'dessert', name: '甜甜圈', en: 'DONUT', shape: 'donut',
    w: 28, h: 28, colors: ['#e88fb0', '#5a4638'],
    likes: 366, rating: 4.7, rateCount: 108,
    note: '环宽约 8 格，中间的洞是空的，不用摆' },

  { id: 'b-cake', kind: 'bead', series: 'dessert', name: '蛋糕', en: 'CAKE', shape: 'cake',
    w: 28, h: 28, colors: ['#f2d9a8', '#e8735f', '#7ab0d8', '#f5c542'],
    likes: 431, rating: 4.8, rateCount: 139,
    note: '三层都是方块，蜡烛和火苗是小格子，注意别串色' },

  { id: 'b-icecream', kind: 'bead', series: 'dessert', name: '冰淇淋', en: 'ICE CREAM', shape: 'iceCream',
    w: 28, h: 28, colors: ['#f2b8c6', '#e8c88a', '#c99a5a', '#8fd0a0'],
    likes: 389, rating: 4.7, rateCount: 121,
    note: '蛋筒是斜格纹，球和筒交界处容易数错一格' },

  { id: 'b-lollipop', kind: 'bead', series: 'dessert', name: '棒棒糖', en: 'LOLLIPOP', shape: 'lollipop',
    w: 28, h: 28, colors: ['#f2f0ea', '#e0574f', '#d8cdb8'],
    likes: 275, rating: 4.5, rateCount: 78,
    note: '漩涡是三条臂交替，顺着同色一路摆下去最快' },

  // ── 拼豆 · 植物 ────────────────────────────────────
  { id: 'b-cactus', kind: 'bead', series: 'plant', name: '仙人掌', en: 'CACTUS', shape: 'cactus',
    w: 28, h: 28, colors: ['#5aa84f', '#2f6f3a', '#c98a5a'],
    likes: 342, rating: 4.6, rateCount: 97,
    note: '花盆比主体好摆，手臂和主体的接缝处是重点' },

  { id: 'b-mushroom', kind: 'bead', series: 'plant', name: '蘑菇', en: 'MUSHROOM', shape: 'mushroom',
    w: 28, h: 28, colors: ['#d05a4a', '#f5efe0', '#f0e2c8'],
    likes: 318, rating: 4.6, rateCount: 88,
    note: '伞盖上的四个斑点是独立的圆，别摆漏' },

  { id: 'b-flower', kind: 'bead', series: 'plant', name: '小花', en: 'FLOWER', shape: 'flower',
    w: 28, h: 28, colors: ['#e07aa8', '#f5c542', '#5aa84f'],
    likes: 407, rating: 4.8, rateCount: 126,
    note: '六瓣大小一样，可以拿一瓣当模板比着摆' },

  // ── 刺绣 · 花木 ────────────────────────────────────
  { id: 's-bamboo', kind: 'stitch', series: 'flora', name: '竹', en: 'BAMBOO', shape: 'bamboo',
    w: 28, h: 28, colors: ['#5f8f4a', '#3f6f3a', '#7fa85a'],
    likes: 452, rating: 4.9, rateCount: 143,
    note: '三竿竹配叶，是字画里最经典的题材' },

  { id: 's-plum', kind: 'stitch', series: 'flora', name: '梅', en: 'PLUM', shape: 'plum',
    w: 28, h: 28, colors: ['#6b4a3a', '#d05a6a'],
    likes: 498, rating: 4.9, rateCount: 167,
    note: '斜枝配五点花，留白多，成品很有味道' },

  { id: 's-orchid', kind: 'stitch', series: 'flora', name: '兰', en: 'ORCHID', shape: 'orchid',
    w: 28, h: 28, colors: ['#6f9e5a', '#b07ac0'],
    likes: 334, rating: 4.6, rateCount: 89,
    note: '细长弯叶，线迹连贯，考验针脚均匀' },

  { id: 's-chrys', kind: 'stitch', series: 'flora', name: '菊', en: 'CHRYSANTHEMUM', shape: 'chrysanth',
    w: 28, h: 28, colors: ['#e8b83a', '#c98a2a'],
    likes: 371, rating: 4.7, rateCount: 104,
    note: '花瓣是放射状，中心向外一层层来' },

  // ── 刺绣 · 山水 ────────────────────────────────────
  { id: 's-mountain', kind: 'stitch', series: 'scape', name: '远山', en: 'MOUNTAIN', shape: 'mountain',
    w: 28, h: 28, colors: ['#5f7a9e', '#eef3f8'],
    likes: 386, rating: 4.8, rateCount: 112,
    note: '格数多但只有两色，绣起来反而快' },

  { id: 's-moon', kind: 'stitch', series: 'scape', name: '月夜', en: 'MOON NIGHT', shape: 'moonNight',
    w: 28, h: 28, colors: ['#3a4455', '#f5f0d8'],
    likes: 429, rating: 4.8, rateCount: 126,
    note: '月与山，深底浅月对比强，挂着好看' },

  { id: 's-cloud', kind: 'stitch', series: 'scape', name: '云纹', en: 'CLOUD', shape: 'cloudPattern',
    w: 28, h: 28, colors: ['#8fb0d0', '#6d92b5'],
    likes: 268, rating: 4.5, rateCount: 73,
    note: '两色层次，下半压深一档就是云的厚度' },

  { id: 's-scape', kind: 'stitch', series: 'scape', name: '山水', en: 'LANDSCAPE', shape: 'landscape',
    w: 28, h: 28, colors: ['#5a7a8a', '#a8c4d4'],
    likes: 412, rating: 4.8, rateCount: 118,
    note: '远山近水，格数最多的一幅，属于进阶' },

  // ── 刺绣 · 器物 ────────────────────────────────────
  { id: 's-fan', kind: 'stitch', series: 'ware', name: '团扇', en: 'FAN', shape: 'fan',
    w: 28, h: 28, colors: ['#efe6d2', '#a8763f', '#3f6f8a'],
    likes: 359, rating: 4.7, rateCount: 102,
    note: '三道同心弧线，从里往外一圈圈绣不容易错' },

  { id: 's-vase', kind: 'stitch', series: 'ware', name: '花瓶', en: 'VASE', shape: 'vase',
    w: 28, h: 28, colors: ['#6f9eb0', '#f0f5f8'],
    likes: 384, rating: 4.7, rateCount: 113,
    note: '只有两个色，横纹靠数行数就能对齐' },

  { id: 's-lantern', kind: 'stitch', series: 'ware', name: '灯笼', en: 'LANTERN', shape: 'lantern',
    w: 28, h: 28, colors: ['#d0403a', '#e8b054', '#5a4638'],
    likes: 436, rating: 4.8, rateCount: 141,
    note: '竖骨四道，上下盖是木色，收口要左右对称' },

  // ── 像素画 · 表情 ──────────────────────────────────
  { id: 'x-smile', kind: 'pixel', series: 'emoji', name: '笑脸', en: 'SMILE', shape: 'faceSmile',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 623, rating: 4.9, rateCount: 241,
    note: '最基础的一款，改表情只要动嘴和眼' },

  { id: 'x-laugh', kind: 'pixel', series: 'emoji', name: '大笑', en: 'LAUGH', shape: 'faceLaugh',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 578, rating: 4.8, rateCount: 196,
    note: '眯眼加张嘴，是表情包里最常用的' },

  { id: 'x-love', kind: 'pixel', series: 'emoji', name: '爱心眼', en: 'LOVE', shape: 'faceLove',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 691, rating: 5.0, rateCount: 287,
    note: '眼睛换成爱心，画起来比想象中简单' },

  { id: 'x-cry', kind: 'pixel', series: 'emoji', name: '哭脸', en: 'CRY', shape: 'faceCry',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 445, rating: 4.7, rateCount: 138,
    note: '八字嘴加两行泪' },

  { id: 'x-angry', kind: 'pixel', series: 'emoji', name: '生气', en: 'ANGRY', shape: 'faceAngry',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 312, rating: 4.6, rateCount: 91,
    note: '斜眼是关键，画平了就没气势' },

  { id: 'x-shock', kind: 'pixel', series: 'emoji', name: '惊讶', en: 'SHOCK', shape: 'faceShock',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 287, rating: 4.5, rateCount: 76,
    note: '大眼加圆嘴，注意眼的比例' },

  { id: 'x-wink', kind: 'pixel', series: 'emoji', name: '眨眼', en: 'WINK', shape: 'faceWink',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 356, rating: 4.7, rateCount: 103,
    note: '一睁一闭，两只眼要区别处理' },

  { id: 'x-speechless', kind: 'pixel', series: 'emoji', name: '无语', en: 'SPEECHLESS', shape: 'faceSpeechless',
    w: 28, h: 28, colors: ['#f5c518', '#2a2620'],
    likes: 264, rating: 4.4, rateCount: 62,
    note: '三条横线，最简单的一款' },

  // ── 像素画 · 图标 ──────────────────────────────────
  { id: 'x-heart', kind: 'pixel', series: 'icon', name: '爱心', en: 'HEART', shape: 'heartIcon',
    w: 28, h: 28, colors: ['#e8455a'],
    likes: 702, rating: 4.9, rateCount: 268,
    note: '单色、形状对称，是图标里最好做的一款' },

  { id: 'x-star', kind: 'pixel', series: 'icon', name: '星星', en: 'STAR', shape: 'starIcon',
    w: 28, h: 28, colors: ['#f5c518'],
    likes: 654, rating: 4.9, rateCount: 233,
    note: '五个尖角，半径是算出来的，照着格子数就好' },

  { id: 'x-note', kind: 'pixel', series: 'icon', name: '音符', en: 'NOTE', shape: 'musicNote',
    w: 28, h: 28, colors: ['#2a6cb8'],
    likes: 398, rating: 4.6, rateCount: 112,
    note: '符尾是弯的，是最容易摆歪的一处' },

  { id: 'x-bolt', kind: 'pixel', series: 'icon', name: '闪电', en: 'BOLT', shape: 'bolt',
    w: 28, h: 28, colors: ['#f5c542'],
    likes: 476, rating: 4.7, rateCount: 154,
    note: '折线的两个转角是尖的，别摆成圆弧' },

  { id: 'x-gem', kind: 'pixel', series: 'icon', name: '钻石', en: 'GEM', shape: 'gem',
    w: 28, h: 28, colors: ['#4aa8d8', '#a8dcf0'],
    likes: 528, rating: 4.8, rateCount: 179,
    note: '刻面是两条斜线，跟着轮廓等比收窄' }
]

/**
 * 素材图纸（由 tools/build-patterns.js 从 AI 生成素材量化而来）。
 *
 * ⚠️ 它们和上面那批**不是一回事**，混在一起之前先看清差别：
 *   形状类 —— 形状函数画出色块，是平的，描边和明暗由 shade.js 后加；
 *   素材类 —— 从图量化出来的网格，**本身已经带明暗**，
 *             再叠一层描边只会把它糊掉（白猫会变成一坨）。所以 render 走另一条路。
 *
 * 网格里的空格（'.'）是原图的纯色背景，已经抠掉了 ——
 * 不抠的话一张 32×32 有六成是背景色，等于白摆几百颗豆子。
 *
 * 演示用的赞数和评分也在生成文件里（没有后端，都是编的）。
 * 界面上会标明是演示数据，和形状那批一个口径。
 */
const IMG = imgData.ITEMS.map(function (it) {
  return {
    id: it.id,
    kind: it.kind,
    series: it.series,
    name: it.name,
    en: it.en,
    tag: it.tag,
    w: it.w,
    h: it.h,
    colors: it.colors,
    likes: it.likes,
    rating: it.rating,
    rateCount: it.rateCount,
    note: it.note,
    img: { colors: it.colors, grid: it.grid }
  }
})

/** 库里真正的内容 = 形状类 + 素材类。下面的查询一律走这个 */
const ALL_PRESETS = PRESETS.concat(IMG)

/**
 * 把一个图案光栅化成字符网格。
 *
 * 取格子**中心**判断，避免边界上的半个像素落在哪边不确定 ——
 * 用左上角的话，图案会整体偏半格。
 */
function rasterize(preset) {
  const fn = shapes[preset.shape]
  if (!fn) return null

  const w = preset.w
  const h = preset.h
  const grid = []

  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1
      const ny = ((y + 0.5) / h) * 2 - 1
      const c = fn(nx, ny)
      row += c < 0 ? '.' : String.fromCharCode(65 + c)
    }
    grid.push(row)
  }

  return { grid: grid, w: w, h: h, colors: preset.colors }
}

/**
 * 素材图纸的渲染：把字符网格还原成 assign + 调色板。
 *
 * 不走 shade.build —— 见 IMG 上面的说明，量化出来的图案本身就带明暗，
 * 再描一圈边会把它糊掉。
 */
function renderImage(preset) {
  const grid = preset.img.grid
  const h = grid.length
  const w = grid[0].length
  const assign = new Int32Array(w * h).fill(-1)
  const counts = new Int32Array(preset.img.colors.length)

  for (let y = 0; y < h; y++) {
    const row = grid[y]
    for (let x = 0; x < w; x++) {
      const ch = row.charAt(x)
      if (ch === '.') continue
      const i = imgData.CHAR_SET.indexOf(ch)
      if (i < 0) continue
      assign[y * w + x] = i
      counts[i]++
    }
  }

  const palette = preset.img.colors.map(function (hex, i) {
    const rgb = shade.hexToRgb(hex)
    return {
      hex: hex,
      rgb: rgb,
      count: counts[i],
      // 按实际亮度定，不能写死 —— 暗色格子上画黑符号等于看不见
      dark: shade.isDark(rgb)
    }
  })

  return { w: w, h: h, assign: assign, palette: palette }
}

/**
 * 光栅化 + 描边明暗，一步到位。
 *
 * 形状函数只管"是什么形状、哪个部位是哪个本色"，
 * 描边和明暗由 data/shade.js 统一加 —— 形状类才会是一套。
 * 素材类（IMG）已经带明暗，直接还原网格。
 */
function render(preset) {
  if (preset.img) return renderImage(preset)

  const r = rasterize(preset)
  if (!r) return null
  return shade.build(r, !FLAT[preset.id])
}

/**
 * 转成和 buildChart 一致的输出结构，
 * 这样预设图案和照片生成的图纸在详情页走同一套渲染。
 */
function toChart(preset) {
  const res = render(preset)
  if (!res) return null

  // 符号必须来自 pattern.SYMBOLS（32 个）。
  // 这里原来自带 8 个再 slice —— 色数一超过 8，symbols 就比 palette 短，
  // 而 paintChart 只判 palette[i] 不判 symbols[i]，
  // 于是多出来的格子里会被画出**字面量 "undefined"**。
  const palette = res.palette.map(function (p, i) {
    return {
      hex: p.hex,
      rgb: p.rgb,
      count: p.count,
      // 按实际亮度定，不能写死 false —— 暗色调上画黑符号等于看不见
      dark: p.dark,
      // 详情页用色表的符号列读的是这个字段。以前两边都没塞，
      // 那一列一直空着
      symbol: pattern.SYMBOLS[i % pattern.SYMBOLS.length]
    }
  })

  return {
    cols: res.w,
    rows: res.h,
    assign: res.assign,
    palette: palette,
    symbols: palette.map(function (p) { return p.symbol }),
    total: res.w * res.h,
    fromPreset: preset.id
  }
}

/**
 * 一次光栅化，同时给出**渲染后**的实际格数和色数。
 *
 * 库页要显示色数、难度要用格数，两边以前分别算（色数取声明值、
 * 格数取未加描边的值），加明暗之后必然对不上。合到一起只跑一趟，
 * 而且两个数说的是同一张图。
 */
function measure(preset) {
  const res = render(preset)
  if (!res) return { filled: 0, colorCount: 0 }

  let filled = 0
  for (let i = 0; i < res.palette.length; i++) filled += res.palette[i].count

  return { filled: filled, colorCount: res.palette.length }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16)
  ]
}

function byId(id) {
  for (let i = 0; i < ALL_PRESETS.length; i++) {
    if (ALL_PRESETS[i].id === id) return ALL_PRESETS[i]
  }
  return null
}

/** 按用途取 */
function forKind(kind) {
  return ALL_PRESETS.filter(function (p) { return p.kind === kind })
}

/**
 * 按用途 + 系列取。
 * seriesKey 省略或给 'all' 时等价于 forKind —— 分类栏的「全部」那一格走这条路。
 */
function forKindSeries(kind, seriesKey) {
  return ALL_PRESETS.filter(function (p) {
    if (p.kind !== kind) return false
    if (!seriesKey || seriesKey === 'all') return true
    return p.series === seriesKey
  })
}

/**
 * 要摆/要绣的格子数。
 *
 * 算的是**渲染之后**的格数，包含描边那一圈 —— 描边也是要一颗颗摆上去的，
 * 不算进去的话难度会少算一成多。空格不算工作量，一个外接框里只有一半
 * 有图案的，比填满的省事得多。
 */
function filledCells(preset) {
  return measure(preset).filled
}

module.exports = {
  SERIES: SERIES,
  // 整个库的内容（形状类 + 素材类）。库页、排序、详情一律用这个
  PRESETS: ALL_PRESETS,
  // 只暴露形状类，给测试分别校验两类
  SHAPE_PRESETS: PRESETS,
  IMG_PRESETS: IMG,
  FLAT: FLAT,
  rasterize: rasterize,
  render: render,
  toChart: toChart,
  measure: measure,
  byId: byId,
  forKind: forKind,
  forKindSeries: forKindSeries,
  filledCells: filledCells
}
