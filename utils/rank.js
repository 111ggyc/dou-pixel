/**
 * 排序
 *
 * 纯函数，不引用 wx，可以直接在 node 里单测。
 *
 * 三个口径不同，**哪些是真的、哪些是演示数据要分清楚**：
 *
 *   易做 —— **真实计算**。由格数、实际填充量、用色数算出来的难度分。
 *           这个不看任何人为数据，谁做谁知道准不准。
 *   热门 —— 演示数据。点赞数写死在 data/presets.js 里。
 *   好评 —— 演示数据。评分同样写死。
 *
 * 没有后端就没有真实的点赞和评分。界面上标明了这一点 ——
 * 不标的话就是拿假数据骗用户。
 *
 * 这三个原来是一个「榜单」（有第一名大卡和名次徽章），
 * 改成目录网格之后降级成**排序控件** —— 网格才是主角，排序只是换个看法。
 */

/**
 * 每类的「参考工作量」，单位是**填充格数**。
 *
 * 取该类里最费事的那一件的填充量 —— 到了它就算满工作量。
 *
 * 这张表承担的是原来「工艺系数」的职责：同样填 300 格，
 * 一针一针绣比在屏幕上点累得多，所以刺绣的参考值最低、同样格数得分最高。
 *   像素画 —— 没有体力活，最省，参考值最高
 *   拼豆   —— 一格一颗豆，摆完还要熨，居中
 *   刺绣   —— 一格一针，穿针引线最费事，参考值最低
 *
 * ⚠️ 为什么把原来的「整条分数乘 KIND_FACTOR」换成「按类给参考值」：
 * 乘系数是把**整类的分数区间**整体平移，像素画乘 0.6 之后，
 * 13 个图案全部跌到第一个档位（<0.375）以下，难度名清一色是「简单」，
 * 这一档排序等于没有。改成参考值之后，分数是「相对同类的轻重」，
 * 类与类之间的差距还在（靠参考值本身的大小），但类内不再被压扁。
 *
 * ⚠️ 参考值跟着内容走：加了更费事的图案（比如一张填满的大图），
 * 就要把对应那一类的参考值往上提，否则它会顶到满分。
 * 这张表是**量出来的**，不是拍的 —— library-test 里有一条断言
 * 盯着"每类最费事的那件是否接近参考值"，改图案规格或加描边之后
 * 数字会漂，跑一下测试就知道该改成多少。
 */
/**
 * 加了素材图纸之后，刺绣那一类的最费事的一件从原来的 500 格左右
 * 跳到「湖畔」的 1600 格（40×40 整幅铺满），参考值跟着提上来。
 * 连带的效果是：原来那批 28×28 的刺绣图案相对变轻了 ——
 * 这是对的，一张小幅竹子和一幅整幅山水本来就不是一个量级。
 * 拼豆和像素画的最大工作量没被顶破，参考值不动。
 */
const WORK_REF = { pixel: 530, bead: 650, stitch: 1600 }

/**
 * 用色数的参考值。
 *
 * 原来是除以 5，那时候一个图案才 2~4 个色，5 是合理的上限。
 * 加了描边和明暗之后每个图案都涨到 6~13 色，除以 5 全都饱和成 1 ——
 * 用色这一维就**不再区分任何图案**了。跟着改成 12。
 */
const COLOR_REF = 12

/**
 * 难度分：1（最容易）到 5（最难）。
 *
 * 三个因素：
 *   - **实际填充量**：真正要摆/绣多少格。空着的格子不用摆，不算工作量 ——
 *     所以用填充格数而不是整图格数。权重最高，它最接近"累不累"的真实感受。
 *   - **用色数**：换色次数。四色的西瓜比两色的柠檬费心。
 *   - **格数**：整张图多大。现在全是 28×28，这一项其实是常数，
 *     只占位 —— 将来加了别的规格的图案，它会自动重新起作用。
 *
 * @param {object} preset
 * @param {number} filled      渲染后的填充格数（presets.measure 的 filled）
 * @param {number} [colorCount] 渲染后的色数。省略时退回声明色数 ——
 *   只有测试会这么用，正常路径都从 measure 里传进来
 */
function difficulty(preset, filled, colorCount) {
  const cells = preset.w * preset.h
  const ref = WORK_REF[preset.kind] || WORK_REF.bead

  const workScore = Math.min(1, filled / ref)
  // 用**渲染后**的色数：那才是真正要买、要换的色号个数
  const colors = colorCount || preset.colors.length
  const colorScore = Math.min(1, colors / COLOR_REF)
  const gridScore = Math.min(1, cells / 1600)

  const score = workScore * 0.5 + colorScore * 0.3 + gridScore * 0.2

  // 映射到 1–5
  return Math.max(1, Math.min(5, Math.round(score * 4) + 1))
}

const DIFFICULTY_NAME = {
  1: '很简单',
  2: '简单',
  3: '中等',
  4: '偏难',
  5: '很难'
}

/**
 * 算出每个图案的完整信息。
 *
 * @param {Array} presets
 * @param {Function} measureFn  presets.measure —— 返回 {filled, colorCount}
 * @param {object} localLikes  { presetId: true } 本地点过的赞
 *
 * 格数和色数都取**渲染之后**的值（含描边和明暗派生出来的色号）。
 * 以前色数取的是声明值 p.colors.length，加了明暗之后那个数
 * 和详情页显示的对不上 —— 用户会看到库页写 4 色、点进去变 9 色。
 */
function decorate(presets, measureFn, localLikes) {
  return presets.map(function (p) {
    const m = measureFn(p)
    const filled = m.filled
    const diff = difficulty(p, filled, m.colorCount)
    return {
      preset: p,
      id: p.id,
      kind: p.kind,
      series: p.series,
      name: p.name,
      note: p.note,
      w: p.w,
      h: p.h,
      colorCount: m.colorCount,
      accent: p.colors[0],
      filled: filled,
      difficulty: diff,
      difficultyName: DIFFICULTY_NAME[diff],
      // 演示数据
      baseLikes: p.likes || 0,
      demoRating: p.rating || 0,
      rateCount: p.rateCount || 0,
      // 本地：用户自己点过赞的话，在演示数字上加一
      myLike: !!(localLikes && localLikes[p.id]),
      likes: (p.likes || 0) + (localLikes && localLikes[p.id] ? 1 : 0)
    }
  })
}

const MODES = [
  { key: 'hot', name: '热门', note: '按点赞数排' },
  { key: 'good', name: '好评', note: '按评分排' },
  { key: 'easy', name: '易做', note: '按难度分排' }
]

/**
 * 按口径排序。
 * 排序都是**稳定的兜底**：同分时按 id 排，避免每次刷新顺序乱跳。
 */
function sortBy(list, mode) {
  const arr = list.slice()
  const tie = function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 }

  if (mode === 'good') {
    arr.sort(function (a, b) {
      if (b.demoRating !== a.demoRating) return b.demoRating - a.demoRating
      // 同分时评价数多的靠前，更可信
      if (b.rateCount !== a.rateCount) return b.rateCount - a.rateCount
      return tie(a, b)
    })
  } else if (mode === 'easy') {
    arr.sort(function (a, b) {
      if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty
      if (a.filled !== b.filled) return a.filled - b.filled
      return tie(a, b)
    })
  } else {
    arr.sort(function (a, b) {
      if (b.likes !== a.likes) return b.likes - a.likes
      return tie(a, b)
    })
  }

  // 名次
  return arr.map(function (x, i) {
    return Object.assign({}, x, { rank: i + 1 })
  })
}

module.exports = {
  MODES: MODES,
  DIFFICULTY_NAME: DIFFICULTY_NAME,
  // 导出给测试对表用：library-test 会拿它和各类的实际最大工作量比，
  // 差太多就是参考值没跟着内容更新
  WORK_REF: WORK_REF,
  COLOR_REF: COLOR_REF,
  difficulty: difficulty,
  decorate: decorate,
  sortBy: sortBy
}
