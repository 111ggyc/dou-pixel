/**
 * 图案的形状函数库
 *
 * 每个函数吃归一化坐标 (nx, ny)，范围 [-1, 1]，y 轴向下，
 * 返回 -1（空格）或 0/1/2…（第几个颜色）。
 *
 * 为什么用数学形状而不是手绘字符网格：
 * 试过手绘 16×16 的猫脸，画出来根本认不出是什么。数学形状至少形状是准的，
 * 而且改尺寸只要改参数，不用重画。
 *
 * 下面按用途分三组 —— 拼豆偏水果、刺绣偏风景字画、像素画偏表情包，
 * 三类的观感刻意拉开，不是同一个图形换个色。
 */

// ── 基础图元 ────────────────────────────────────────

/** 圆盘 */
function disc(cx, cy, r) {
  return function (nx, ny) {
    const dx = nx - cx
    const dy = ny - cy
    return dx * dx + dy * dy <= r * r
  }
}

/** 椭圆盘（rx/ry 分开给） */
function oval(cx, cy, rx, ry) {
  return function (nx, ny) {
    const dx = (nx - cx) / rx
    const dy = (ny - cy) / ry
    return dx * dx + dy * dy <= 1
  }
}

/** 矩形 */
function box(x0, y0, x1, y1) {
  return function (nx, ny) {
    return nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1
  }
}

/** 任意图元的并集 */
function union() {
  const fns = Array.prototype.slice.call(arguments)
  return function (nx, ny) {
    for (let i = 0; i < fns.length; i++) if (fns[i](nx, ny)) return true
    return false
  }
}

/** 横向弧带：以 (0, cy) 为心、半径 r、厚度 t 的一段圆弧 */
function arcBand(cy, r, t, lowerOnly) {
  return function (nx, ny) {
    const dy = ny - cy
    const d = Math.sqrt(nx * nx + dy * dy)
    if (Math.abs(d - r) > t) return false
    if (lowerOnly && dy < 0) return false
    return true
  }
}

/** 倾斜的椭圆（竹叶、花瓣这类） */
function tiltedOval(cx, cy, rx, ry, ang) {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return function (nx, ny) {
    const dx = nx - cx
    const dy = ny - cy
    const u = dx * c + dy * s
    const v = -dx * s + dy * c
    return (u / rx) * (u / rx) + (v / ry) * (v / ry) <= 1
  }
}

/**
 * 沿二次贝塞尔曲线的粗线 —— 用来画弯的枝叶。
 *
 * 做法是把曲线采样成折线，取点到折线的最近距离。
 * 直线形的椭圆做不到弯曲，而梅枝、兰叶、竹叶都是弯的。
 * 采样 16 段够了：再多，格子那么粗也看不出区别。
 */
function curveStroke(x0, y0, cx, cy, x1, y1, w) {
  return function (nx, ny) {
    let best = Infinity
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      const u = 1 - t
      const px = u * u * x0 + 2 * u * t * cx + t * t * x1
      const py = u * u * y0 + 2 * u * t * cy + t * t * y1
      const d = (nx - px) * (nx - px) + (ny - py) * (ny - py)
      if (d < best) best = d
    }
    return best <= w * w
  }
}

/**
 * 沿折线的粗线 —— 闪电这类有尖角的折线用它。
 *
 * 和 curveStroke 一样是「采样 + 取点到线段的最近距离」，
 * 区别在于是**分段直线**而不是一条贝塞尔：闪电的转角是尖的，
 * 用平滑曲线画出来会变成一根面条。
 */
function polylineStroke(pts, w) {
  return function (nx, ny) {
    let best = Infinity
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0]
      const ay = pts[i][1]
      const bx = pts[i + 1][0]
      const by = pts[i + 1][1]
      const vx = bx - ax
      const vy = by - ay
      const len2 = vx * vx + vy * vy
      let t = len2 ? ((nx - ax) * vx + (ny - ay) * vy) / len2 : 0
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const px = ax + vx * t
      const py = ay + vy * t
      const d = (nx - px) * (nx - px) + (ny - py) * (ny - py)
      if (d < best) best = d
    }
    return best <= w * w
  }
}

/**
 * 确定性散点（糖针、斑点、刺）。用格子坐标做哈希，不用随机数 ——
 * 随机的话每次生成的图案都不一样，图纸就没法照着做了。
 */
function speckle(freq, mod, phase) {
  return function (nx, ny) {
    const gx = Math.floor((nx + 1) * freq)
    const gy = Math.floor((ny + 1) * freq)
    return (gx * 5 + gy * 3 + (phase || 0) * 7) % mod === 0
  }
}

/** 等间距横纹（花瓶、灯笼的骨） */
function stripes(axis, freq, t) {
  return function (nx, ny) {
    const v = ((axis === 'y' ? ny : nx) + 1) * freq
    return Math.abs(v - Math.round(v)) < t
  }
}

// ── 拼豆：水果 ──────────────────────────────────────

function apple(nx, ny) {
  // 果身：三个圆叠出苹果的轮廓（中间宽、上下收）
  if (union(disc(-0.24, 0.02, 0.6), disc(0.24, 0.02, 0.6), disc(0, 0.22, 0.66))(nx, ny)) return 0
  // 梗
  if (nx > -0.05 && nx < 0.05 && ny > -1 && ny < -0.5) return 2
  // 叶
  if (oval(0.28, -0.72, 0.24, 0.11)(nx, ny)) return 1
  return -1
}

function strawberry(nx, ny) {
  // 叶冠要**先判**。
  // 原来写在果身后面，但果身在最上面那几行（ny≈-0.75）宽度还有 0.84，
  // 叶冠那一段全被果身先返回了 —— 这个分支从来没执行到过，
  // 声明里的绿色也就一直没出现在图上。形状的先后顺序就是遮挡顺序。
  //
  // 冠要**上窄下宽**、只占正中一块。铺满整条顶边的话渲染出来像个绿盖子，
  // 不像张开的萼片
  if (ny < -0.68) {
    const t = (ny + 1) / 0.32 // 0 顶 → 1 冠底
    if (Math.abs(nx) < 0.24 + t * 0.42) return 2
  }

  // 下尖的果身：越往下越窄
  const t = (ny + 1) / 2 // 0 顶 → 1 底
  const halfw = 0.85 * (1 - t * t * 1.15)
  if (t <= 1 && Math.abs(nx) <= halfw) {
    // 籽
    const gx = Math.round(nx * 5 + 5)
    const gy = Math.round(ny * 5 + 5)
    if ((gx + gy) % 4 === 0) return 1
    return 0
  }
  return -1
}

function watermelon(nx, ny) {
  // 半个西瓜：下半圆 + 两层皮
  const d = nx * nx + ny * ny
  if (ny >= -0.15 && d <= 1.0) {
    if (d > 0.82) return 2 // 深绿皮
    if (d > 0.68) return 1 // 浅绿皮
    // 籽
    const gx = Math.round(nx * 4)
    const gy = Math.round(ny * 4)
    if ((gx * 3 + gy * 5) % 7 === 0 && d < 0.55) return 3
    return 0 // 红瓤
  }
  return -1
}

function citrusSlice(nx, ny) {
  // 柑橘切片：果皮、白色筋络层、被筋络分成 8 瓣的果肉。
  //
  // 原来就是个光秃秃的椭圆（加了个暗面之后更像煎蛋）。
  // 切片是**内部结构**最丰富的柑橘画法，参考图里的橙片就是这个，
  // 在一堆圆滚滚的水果里也最跳得出来。
  // 外径 0.86 而不是 0.94 —— 0.94 加上描边那圈就顶满画布了（82.7%），
  // 在一堆 50% 上下的图案里显得挤
  const d = Math.sqrt(nx * nx + ny * ny)
  if (d > 0.86) return -1
  if (d > 0.77) return 2 // 果皮
  if (d > 0.7) return 3 // 白色筋络层

  // 8 瓣。瓣与瓣之间的缝也是白的 —— 缝占每瓣的 20%，
  // 再宽就只剩白线了，再窄两瓣会糊在一起
  const a = Math.atan2(ny, nx)
  const seg = ((a + Math.PI) / (Math.PI * 2)) * 8
  const off = Math.abs(seg - Math.floor(seg) - 0.5)
  if (off > 0.4) return 3

  // 果肉：靠核心那圈深一档，外圈浅 —— 切片的果肉本来就是外亮内深
  return d > 0.42 ? 1 : 0
}

function grapes(nx, ny) {
  // 葡萄串：**一颗颗独立的圆**，每颗左上角一点高光。
  //
  // 之前两版都用"整体轮廓 + 散点"糊过去，理由写在注释里是"圆挨着就糊成一坨"。
  // 那个结论是错的 —— 糊是因为半径给了 0.42（六格多）而圆心只隔 0.84，
  // 交叠太多。收到 0.22（约 3 格）之后，颗与颗之间留得住缝，
  // 一颗一颗能读出来。参考图里的葡萄正是这个做法。
  const R = 0.22
  const berries = [
    [-0.56, -0.58], [-0.19, -0.58], [0.19, -0.58], [0.56, -0.58],
    [-0.37, -0.18], [0, -0.18], [0.37, -0.18],
    [-0.19, 0.22], [0.19, 0.22],
    [0, 0.6]
  ]

  for (let i = 0; i < berries.length; i++) {
    const dx = nx - berries[i][0]
    const dy = ny - berries[i][1]
    if (dx * dx + dy * dy > R * R) continue
    // 每颗左上一点高光。偏移和半径都按"一格"来定：
    // 一格 = 2/28 ≈ 0.071，所以偏移 0.06、半径 0.075 差不多就是一颗一格的亮点
    const hx = dx + 0.06
    const hy = dy + 0.06
    if (hx * hx + hy * hy <= 0.0056) return 1
    return 0
  }

  // 梗
  if (Math.abs(nx) < 0.05 && ny < -0.76) return 2
  // 叶
  if (tiltedOval(0.36, -0.82, 0.26, 0.1, -0.32)(nx, ny)) return 2
  return -1
}

function cherry(nx, ny) {
  // 两颗果。半径 0.42、圆心间距 0.84 —— 略微相交（樱桃本来就挨着）
  // 但不会糊成一块。0.46 试过，两颗完全并成一体了
  if (disc(-0.42, 0.38, 0.42)(nx, ny) || disc(0.42, 0.38, 0.42)(nx, ny)) return 0

  // 两根梗：从左果顶往右上收拢（樱桃的梗是并拢的）
  if (ny < 0.02) {
    const t = (ny + 1) / 1.02 // 0 顶 → 1 果顶
    const leftX = -0.05 - 0.37 * (1 - t)
    const rightX = -0.05 + 0.47 * (1 - t)
    if (Math.abs(nx - leftX) < 0.055) return 1
    if (Math.abs(nx - rightX) < 0.055) return 1
  }
  return -1
}

function pineapple(nx, ny) {
  // 果身
  if (oval(0, 0.12, 0.62, 0.82)(nx, ny)) {
    // 斜格纹
    const g = Math.round((nx + ny) * 3.5)
    return g % 2 === 0 ? 0 : 1
  }
  // 顶叶
  if (ny > -1 && ny < -0.6) {
    const t = (ny + 1) / 0.4
    if (Math.abs(nx) < 0.5 * (1 - t * 0.6)) return 2
  }
  return -1
}

function banana(nx, ny) {
  // 弯月形。
  //
  // 原来用"大圆减小圆"，两个圆的偏移没调好，出来是条很细的月牙
  // （填充率只有 21%，和别的水果差一倍）。改成**弧带** ——
  // 直接给弧线一个厚度，粗细可控。
  // 月牙形：以 (0,-0.35) 为心、半径 0.8 的弧带，**厚度随 |nx| 收窄**，
  // 两端收成尖 —— 这才像香蕉。
  //
  // 之前是等厚的弧带，末端是平切的，看着像个"U 形碗"。
  // 它在早期版本里之所以像香蕉，是因为当时渲染在 24×18 的格子里被横向
  // 拉伸了 —— 换成 28×28 之后就露馅了。
  const dy = ny + 0.35
  const d = Math.sqrt(nx * nx + dy * dy)
  const t = 0.27 * (1 - Math.pow(Math.abs(nx) / 0.92, 2))

  if (dy > 0.02 && t > 0.02 && Math.abs(d - 0.8) < t) {
    // 外弧面压暗一档，做出圆柱的转折。两个色都是黄的，深浅差一点就够
    return d > 0.8 ? 1 : 0
  }
  return -1
}

// ── 刺绣：风景字画 ──────────────────────────────────

function mountain(nx, ny) {
  // 两座山峰
  const p1 = 0.55 + Math.abs(nx - 0.25) * 1.5
  const p2 = 0.95 + Math.abs(nx + 0.45) * 1.1
  const h = Math.min(p1, p2)
  if (ny >= h - 0.95 && ny <= 1) return ny < h - 0.55 ? 1 : 0
  return -1
}

function bamboo(nx, ny) {
  // 三竿竹。竿必须**够细** —— 第一版宽度 0.1 配 0.5 的间距，
  // 三竿直接连成一片网格，渲染出来像个绿色的"H"。
  // 竿和叶都要细。加粗到 0.105 之后竿叶连成一片绿网格，不再是竹
  const stalks = [-0.56, 0.0, 0.5]
  const widths = [0.09, 0.098, 0.085]

  for (let i = 0; i < stalks.length; i++) {
    if (Math.abs(nx - stalks[i]) < widths[i]) {
      // 竹节：隔一段换个色，做出"节"的感觉
      const seg = Math.floor((ny + 1) * 3.5)
      return seg % 2 === 0 ? 0 : 1
    }
  }

  // 叶：斜向细长。加粗到 0.075 时和竿连成一片了，收回到 0.06 上下
  const leaves = [
    tiltedOval(0.36, -0.44, 0.32, 0.06, -0.5),
    tiltedOval(0.46, -0.16, 0.28, 0.055, -0.22),
    tiltedOval(-0.3, -0.64, 0.3, 0.06, 0.45),
    tiltedOval(-0.36, 0.44, 0.28, 0.055, 0.28),
    tiltedOval(0.34, 0.56, 0.26, 0.055, -0.32)
  ]
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i](nx, ny)) return 2
  }
  return -1
}

function plum(nx, ny) {
  // 梅枝。
  //
  // 前两版都画成了"X"：主枝往右下、侧枝往右上，在中心交叉。
  // 问题出在**主枝的走向** —— 真梅枝是从下往斜上长的，
  // 侧枝再从它身上分出去，全都朝上，就不会交叉。
  // 枝要细。加粗到 0.13 之后枝和花糊成一坨棕色，读不出是梅枝了
  const main = curveStroke(-0.88, 0.74, -0.1, 0.1, 0.74, -0.72, 0.085)
  // 侧枝都从主枝上分出、朝上方走
  const twig1 = curveStroke(0.15, -0.16, 0.42, -0.5, 0.62, -0.84, 0.062)
  const twig2 = curveStroke(-0.39, 0.33, -0.56, 0.12, -0.64, -0.12, 0.058)

  if (main(nx, ny) || twig1(nx, ny) || twig2(nx, ny)) return 0

  // 花：小格子里画不出六瓣，用圆点表示花朵。沿枝条分布，不撒在空处。
  // 原来只有 9 朵、半径 0.1，整幅填充率 14%，比别的稀疏一半
  const buds = [
    [-0.74, 0.46], [-0.5, 0.16], [-0.16, -0.1], [0.18, -0.32], [0.44, -0.56],
    [-0.58, -0.02], [0.3, -0.16], [0.02, 0.18], [-0.24, 0.42],
    [-0.4, 0.6], [0.36, 0.02], [-0.66, -0.34], [0.56, -0.74]
  ]
  for (let i = 0; i < buds.length; i++) {
    if (disc(buds[i][0], buds[i][1], 0.135)(nx, ny)) return 1
  }
  return -1
}

function orchid(nx, ny) {
  // 几片从底部中心弯出去的细长叶。
  // 第一版用多项式算叶子的横坐标，系数没调好，算出来是个 X。
  // 叶要更粗 —— 原来 0.05 左右，填充率只有 15%
  // 叶要细才能分出片。加粗到 0.11 之后连成实心绿块，没了兰叶的样子
  const leaves = [
    curveStroke(0, 0.95, -0.78, 0.3, -0.82, -0.56, 0.082),
    curveStroke(0, 0.95, -0.36, 0.34, -0.26, -0.82, 0.078),
    curveStroke(0, 0.95, 0.3, 0.38, 0.46, -0.62, 0.074),
    curveStroke(0, 0.95, 0.66, 0.48, 0.86, -0.12, 0.07)
  ]
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i](nx, ny)) return 0
  }
  // 花
  if (disc(-0.04, -0.6, 0.15)(nx, ny)) return 1
  return -1
}

function chrysanth(nx, ny) {
  const d = Math.sqrt(nx * nx + ny * ny)
  const ang = Math.atan2(ny, nx)
  // 多层花瓣
  const r = 0.55 + 0.28 * Math.abs(Math.cos(ang * 6))
  if (d <= r) {
    return d < 0.2 ? 1 : 0
  }
  return -1
}

function moonNight(nx, ny) {
  // 月亮
  const moonOut = disc(-0.45, -0.42, 0.44)(nx, ny)
  const moonCut = disc(-0.26, -0.5, 0.4)(nx, ny)
  if (moonOut && !moonCut) return 1
  // 远山。原来脊线从 0.35 起，只占下半部的三分之一，填充率 19%
  const h = -0.22 + Math.abs(nx) * 0.82
  if (ny >= h) return 0
  return -1
}

function cloudPattern(nx, ny) {
  // 云：三个圆头 + 一条平底。
  //
  // 原来用四段圆弧拼，渲染出来是一坨认不出的东西。
  // 云的辨识点其实是**几个圆头 + 平底**，直接堆圆反而准。
  const head = union(disc(-0.48, 0.1, 0.38), disc(0.02, -0.12, 0.46), disc(0.5, 0.08, 0.36))
  const body = box(-0.6, 0.1, 0.6, 0.46)

  if (head(nx, ny) || body(nx, ny)) {
    // 下半压深一档，做出云的厚度。整朵一个色的话就是个白团子
    return ny > 0.16 ? 1 : 0
  }
  return -1
}

function landscape(nx, ny) {
  // 山水：远山占上半，水面三条波纹。
  // 第一版填充率只有 11% —— 山太小、波纹太细，整幅读不出内容。
  // 山要够大才读得出来，也要够大才能和别的图案在填充率上对齐。
  // 山用深色（palette[0]）、水用浅色（palette[1]）
  const h1 = -0.5 + Math.abs(nx + 0.42) * 1.0
  const h2 = -0.24 + Math.abs(nx - 0.56) * 0.88
  const top = Math.min(h1, h2)

  if (ny >= top && ny < 0.42) return 0

  // 水波：三条，够粗
  if (ny >= 0.42) {
    const w1 = 0.54 + Math.sin(nx * 3.4) * 0.04
    const w2 = 0.7 + Math.sin(nx * 3.4 + 1.2) * 0.04
    const w3 = 0.86 + Math.sin(nx * 3.4 + 2.4) * 0.04
    if (Math.abs(ny - w1) < 0.055) return 1
    if (Math.abs(ny - w2) < 0.055) return 1
    if (Math.abs(ny - w3) < 0.055) return 1
  }
  return -1
}

// ── 像素画：表情包 ──────────────────────────────────

/**
 * 表情的公共底座：圆脸 + 两只眼 + 一张嘴。
 *
 * 脸半径是 0.80 而不是 0.94 —— 0.94 时填充率 69%，
 * 和另外两类的 40–55% 差太多，放在同一个列表里像另一个产品。
 * 0.80 对应 π·0.8²/4 ≈ 50%，落进同一个区间。
 */
const FACE_R2 = 0.64 // 0.80²

function faceCfg(eyeFn, mouthFn, extraFn) {
  return function (nx, ny) {
    const d = nx * nx + ny * ny
    if (d > FACE_R2) {
      // 超出了脸的范围，看看有没有额外元素（比如爱心眼冒出来的部分）
      if (extraFn && extraFn(nx, ny)) return 1
      return -1
    }
    if (eyeFn && eyeFn(nx, ny)) return 1
    if (mouthFn && mouthFn(nx, ny)) return 1
    if (extraFn && extraFn(nx, ny)) return 1
    return 0 // 脸
  }
}

/** 两只普通眼睛 */
function twoDots(r) {
  return function (nx, ny) {
    return disc(-0.34, -0.18, r)(nx, ny) || disc(0.34, -0.18, r)(nx, ny)
  }
}

/** 向下的笑弧：以 (0,-0.5) 为心、半径 0.62，取下半部分 */
function smileArc(cy, r, t) {
  return function (nx, ny) {
    const dy = ny - cy
    const d = Math.sqrt(nx * nx + dy * dy)
    return Math.abs(d - r) <= t && dy > 0
  }
}

/** 向上的弧（哭） */
function frownArc(cy, r, t) {
  return function (nx, ny) {
    const dy = ny - cy
    const d = Math.sqrt(nx * nx + dy * dy)
    return Math.abs(d - r) <= t && dy < 0
  }
}

/** 爱心（眼睛用） */
function miniHeart(cx, cy, s) {
  return function (nx, ny) {
    const x = (nx - cx) / s
    const y = -(ny - cy) / s + 0.15
    const t = x * x + y * y - 1
    return t * t * t - x * x * y * y * y <= 0
  }
}

// 八种表情
//
// ⚠️ 这里的厚度都按**20×20 的格子**定的：一个格子 = 0.1 归一化单位。
// 第一版把嘴的厚度写成 0.07，在 16×16（一格 = 0.125）上不到一个格子 ——
// 渲染出来嘴巴直接消失，八个表情全长一个样。这是量化上的错误，
// 不是"画得不够好"。改网格尺寸的话，这些常数要跟着调。
const EYE_R = 0.145
const LINE_T = 0.125
const MOUTH_T = 0.13

function faceSmile(nx, ny) {
  return faceCfg(twoDots(EYE_R), smileArc(-0.42, 0.62, MOUTH_T))(nx, ny)
}

function faceLaugh(nx, ny) {
  // 眯眼（横线）+ 张嘴（实心半圆）
  const eyes = function (x, y) {
    return Math.abs(y + 0.2) < LINE_T && Math.abs(Math.abs(x) - 0.34) < 0.17
  }
  const mouth = function (x, y) {
    return disc(0, -0.32, 0.36)(x, y) && y > -0.36
  }
  return faceCfg(eyes, mouth)(nx, ny)
}

function faceLove(nx, ny) {
  return faceCfg(null, smileArc(-0.42, 0.62, MOUTH_T),
    union(miniHeart(-0.36, -0.16, 0.27), miniHeart(0.36, -0.16, 0.27)))(nx, ny)
}

function faceCry(nx, ny) {
  const eyes = twoDots(EYE_R)
  const mouth = frownArc(0.38, 0.6, MOUTH_T)
  const tears = function (x, y) {
    return disc(-0.34, 0.14, 0.13)(x, y) || disc(0.34, 0.14, 0.13)(x, y)
  }
  return faceCfg(eyes, mouth, tears)(nx, ny)
}

function faceAngry(nx, ny) {
  const eyes = function (x, y) {
    // 斜眼：两条斜线，内低外高
    return Math.abs(y - (Math.abs(x) * 0.55 - 0.32)) < LINE_T &&
      Math.abs(x) > 0.15 && Math.abs(x) < 0.52
  }
  const mouth = frownArc(0.44, 0.58, MOUTH_T)
  return faceCfg(eyes, mouth)(nx, ny)
}

function faceShock(nx, ny) {
  const eyes = twoDots(0.18)
  const mouth = function (x, y) {
    return disc(0, -0.36, 0.22)(x, y)
  }
  return faceCfg(eyes, mouth)(nx, ny)
}

function faceWink(nx, ny) {
  const eyes = function (x, y) {
    // 左眼正常，右眼眯成横线
    if (disc(-0.34, -0.18, EYE_R)(x, y)) return true
    if (Math.abs(y + 0.18) < LINE_T && x > 0.16 && x < 0.52) return true
    return false
  }
  return faceCfg(eyes, smileArc(-0.42, 0.62, MOUTH_T))(nx, ny)
}

function faceSpeechless(nx, ny) {
  const eyes = function (x, y) {
    return Math.abs(y + 0.18) < LINE_T && Math.abs(Math.abs(x) - 0.34) < 0.16
  }
  const mouth = function (x, y) {
    return Math.abs(y + 0.36) < LINE_T && Math.abs(x) < 0.3
  }
  return faceCfg(eyes, mouth)(nx, ny)
}

// ── 拼豆：甜点 ──────────────────────────────────────

function donut(nx, ny) {
  // 甜甜圈：一个环。用两个圆的差，外径 0.84 内径 0.34 ——
  // 环宽 0.5，在 28 格里约 7 格厚，够摆也看得出中间是个洞。
  // 外径原本给到 0.9，加上描边那一圈就顶到画布边了，收到 0.84 留出余量
  const d2 = nx * nx + ny * ny
  if (d2 > 0.7056) return -1
  if (d2 < 0.1156) return -1
  // 糖针
  if (speckle(7, 11)(nx, ny)) return 1
  return 0
}

function cake(nx, ny) {
  // 三层结构：下层最宽、上层窄、顶上插蜡烛。
  // 蜡烛半宽 0.08 —— 0.05 的话在 28 格里不到一格半，采样时会时有时无
  if (disc(0, -0.9, 0.12)(nx, ny)) return 3            // 火苗
  if (Math.abs(nx) < 0.08 && ny >= -0.84 && ny < -0.26) return 2 // 蜡烛
  if (box(-0.56, -0.28, 0.56, 0.14)(nx, ny)) return 0  // 上层
  if (box(-0.56, 0.14, 0.56, 0.26)(nx, ny)) return 1   // 糖霜夹层
  if (box(-0.8, 0.26, 0.8, 0.7)(nx, ny)) return 0      // 下层
  return -1
}

function iceCream(nx, ny) {
  // 蛋筒：从上往下收成一个尖。尖角那里 0.52 的起始半宽收 0.95 倍
  if (ny > 0.06) {
    const t = Math.min(1, (ny - 0.06) / 0.94)
    const halfw = 0.52 * (1 - t * 0.95)
    if (Math.abs(nx) <= halfw) {
      // 斜格纹，是蛋筒的脆皮
      return Math.round((nx + ny) * 5) % 2 === 0 ? 1 : 2
    }
  }
  // 三个球：两下一上，上面的球要**先判**，否则会被下面的盖住
  if (disc(0, -0.56, 0.4)(nx, ny)) return 0
  if (disc(-0.26, -0.2, 0.44)(nx, ny)) return 0
  if (disc(0.26, -0.2, 0.44)(nx, ny)) return 3
  return -1
}

function lollipop(nx, ny) {
  const dx = nx
  const dy = ny + 0.22
  const r = Math.sqrt(dx * dx + dy * dy)
  if (r <= 0.68) {
    // 漩涡。角度按 [0,2π) 归一，绕一圈的相位变化取**整数**（3 臂）——
    // 取非整数的话，0 度和 360 度接不上了，会看到一条缝合线
    const a = Math.atan2(dy, dx)
    const u = a < 0 ? a + Math.PI * 2 : a
    const band = Math.floor(r * 5 + (u / (Math.PI * 2)) * 3)
    return band % 2 === 0 ? 0 : 1
  }
  if (Math.abs(nx) < 0.06 && ny > 0.4 && ny < 0.98) return 2 // 棍
  return -1
}

// ── 拼豆：植物 ──────────────────────────────────────

function cactus(nx, ny) {
  // 花盆
  if (ny > 0.6) {
    const t = Math.min(1, (ny - 0.6) / 0.34)
    const halfw = 0.5 - t * 0.14
    return Math.abs(nx) <= halfw ? 2 : -1
  }
  const body = oval(0, -0.02, 0.3, 0.64)
  // 两条手臂：竖段 + 横段并起来，横段负责和主体接上
  const armL = union(oval(-0.42, -0.16, 0.16, 0.26), box(-0.42, -0.1, -0.22, 0.04))
  const armR = union(oval(0.42, -0.34, 0.15, 0.22), box(0.24, -0.28, 0.42, -0.16))
  if (body(nx, ny) || armL(nx, ny) || armR(nx, ny)) {
    if (speckle(9, 13, 1)(nx, ny)) return 1 // 刺
    return 0
  }
  return -1
}

function mushroom(nx, ny) {
  // 伞盖取上半圆
  const dy = ny - 0.08
  const d2 = nx * nx + dy * dy
  if (dy <= 0 && d2 <= 0.6) {
    const spots = [
      [-0.34, -0.24, 0.15], [0.18, -0.36, 0.13],
      [0.44, -0.08, 0.12], [-0.04, -0.1, 0.14]
    ]
    for (let i = 0; i < spots.length; i++) {
      if (disc(spots[i][0], spots[i][1], spots[i][2])(nx, ny)) return 1
    }
    return 0
  }
  // 柄：略微上窄下宽
  if (ny > 0.14 && ny < 0.88) {
    const t = (ny - 0.14) / 0.74
    if (Math.abs(nx) <= 0.26 + t * 0.08) return 2
  }
  return -1
}

function flower(nx, ny) {
  // 六瓣。花瓣中心排在半径 0.38 的圆上，每瓣自身再按角度倾斜 ——
  // 不倾斜的话六瓣会摆成一个死板的圆环
  const cx = 0
  const cy = -0.28
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3
    const px = cx + Math.cos(a) * 0.38
    const py = cy + Math.sin(a) * 0.38
    if (tiltedOval(px, py, 0.3, 0.2, a)(nx, ny)) return 0
  }
  if (disc(cx, cy, 0.26)(nx, ny)) return 1
  if (Math.abs(nx) < 0.05 && ny > 0.1 && ny < 0.96) return 2 // 茎
  if (tiltedOval(0.32, 0.62, 0.28, 0.11, -0.42)(nx, ny)) return 2
  if (tiltedOval(-0.32, 0.78, 0.26, 0.1, 0.42)(nx, ny)) return 2
  return -1
}

// ── 刺绣：器物 ──────────────────────────────────────

function fan(nx, ny) {
  // 团扇：圆形扇面 + 包边 + **从柄根辐射出去的扇骨** + 柄。
  //
  // 原来是三道同心圆，渲染出来像个靶子。团扇的辨识点是辐射的扇骨，
  // 同心圆只会读成同心圆。扇骨的出发点在柄根 (0, 0.5)，
  // 也就是扇面下缘 —— 真实的团扇就是这样，骨从柄那头散开。
  const dy = ny + 0.2
  const r = Math.sqrt(nx * nx + dy * dy)

  if (r <= 0.7) {
    if (r > 0.6) return 2 // 包边
    const ang = Math.atan2(ny - 0.5, nx)
    const k = (ang + Math.PI / 2) / (Math.PI / 7)
    // 5 道骨，都离中心一点距离再起 —— 骨全挤在柄根会糊成一团
    if (Math.abs(k) <= 2.2 && Math.abs(k - Math.round(k)) < 0.13 && r > 0.26) return 1
    return 0
  }
  if (Math.abs(nx) < 0.06 && ny > 0.5 && ny < 0.98) return 1 // 柄
  return -1
}

function vase(nx, ny) {
  // 花瓶。
  //
  // 原来是"椭圆瓶身 + 一个方块脖子 + 条纹"，渲染出来是个带条纹的球。
  // 瓶子的辨识全在**轮廓的转折**上 —— 口、颈、肩、腹、足。
  // 所以改成半宽随高度变化的折线轮廓，比堆椭圆好控制得多。
  const PROFILE = [
    [-0.95, 0.30], // 口沿
    [-0.82, 0.27], // 口
    [-0.46, 0.15], // 颈 —— 最细处，比 0.1 粗一档，再细就断了
    [-0.14, 0.33], // 肩
    [0.26, 0.52],  // 腹
    [0.72, 0.40],  // 收
    [0.95, 0.34]   // 足
  ]

  let halfw = -1
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const a = PROFILE[i]
    const b = PROFILE[i + 1]
    if (ny >= a[0] && ny <= b[0]) {
      halfw = a[1] + (b[1] - a[1]) * ((ny - a[0]) / (b[0] - a[0]))
      break
    }
  }
  if (halfw < 0 || Math.abs(nx) > halfw) return -1

  if (ny < -0.86 || ny > 0.88) return 1 // 口沿和足的深色收边
  if (Math.abs(ny - 0.06) < 0.05) return 1 // 腹部一道环纹
  return 0
}

function lantern(nx, ny) {
  // 提绳、流苏、上下盖都要**先判**，否则会被椭圆瓶身吃掉
  if (Math.abs(nx) < 0.07 && ny < -0.8) return 2
  if (Math.abs(nx) < 0.07 && ny > 0.8) return 2
  if (Math.abs(nx) < 0.3 && Math.abs(ny) >= 0.66 && Math.abs(ny) < 0.88) return 2
  if (oval(0, 0, 0.62, 0.72)(nx, ny)) {
    if (stripes('x', 4, 0.11)(nx, ny)) return 1 // 竖骨
    return 0
  }
  return -1
}

// ── 像素画：图标 ────────────────────────────────────

function heartIcon(nx, ny) {
  // 直接放大爱心眼的那个隐式函数。0.98 会让上下两个尖超出画面被切掉。
  // 0.86 虽然装得下，但**加上描边那一圈**就占满了整块画布（80%），
  // 比别的图案挤一大截，收到 0.78 才和大家齐平
  return miniHeart(0, -0.04, 0.78)(nx, ny) ? 0 : -1
}

function starIcon(nx, ny) {
  // 五角星：半径随角度起伏，尖角处半径大。
  // 相位加 π/2 是让尖角朝上 —— 不加就是个倒过来的星
  const r = Math.sqrt(nx * nx + ny * ny)
  const ang = Math.atan2(ny, nx)
  const k = 0.5 + 0.5 * Math.cos(ang * 5 + Math.PI / 2)
  const edge = 0.34 + 0.62 * Math.pow(k, 1.6)
  return r <= edge ? 0 : -1
}

function musicNote(nx, ny) {
  // 符干要够粗：0.06 在 28 格里不到两格，采样会断成虚线
  if (Math.abs(nx - 0.12) < 0.09 && ny > -0.72 && ny < 0.66) return 0
  if (tiltedOval(-0.3, 0.62, 0.32, 0.23, -0.38)(nx, ny)) return 0
  if (curveStroke(0.12, -0.68, 0.72, -0.5, 0.56, 0.06, 0.17)(nx, ny)) return 0
  return -1
}

function bolt(nx, ny) {
  // 闪电：折线。转角必须是尖的，所以用 polylineStroke 而不是 curveStroke。
  // 线宽 0.26 约合 3.6 格
  const line = polylineStroke([
    [0.34, -0.92], [-0.34, 0.06], [0.1, 0.06], [-0.26, 0.92]
  ], 0.26)
  return line(nx, ny) ? 0 : -1
}

function gem(nx, ny) {
  // 钻石分上下两段：上面是冠部梯形，下面是亭部三角。
  // 内部两条斜刻面用「距边缘一半宽」来定位，跟着轮廓自动收窄
  if (ny >= -0.62 && ny < -0.16) {
    const t = (ny + 0.62) / 0.46
    const halfw = 0.42 + t * 0.4
    if (Math.abs(nx) > halfw) return -1
    if (Math.abs(Math.abs(nx) - halfw * 0.55) < 0.055) return 1
    return 0
  }
  if (ny >= -0.16 && ny < 0.92) {
    const t = (ny + 0.16) / 1.08
    const halfw = 0.82 * (1 - t * 0.98)
    if (Math.abs(nx) > halfw) return -1
    if (Math.abs(Math.abs(nx) - halfw * 0.5) < 0.05) return 1
    return 0
  }
  return -1
}

module.exports = {
  // 水果
  apple: apple,
  strawberry: strawberry,
  watermelon: watermelon,
  citrusSlice: citrusSlice,
  grapes: grapes,
  cherry: cherry,
  pineapple: pineapple,
  banana: banana,
  // 甜点
  donut: donut,
  cake: cake,
  iceCream: iceCream,
  lollipop: lollipop,
  // 植物
  cactus: cactus,
  mushroom: mushroom,
  flower: flower,
  // 风景字画
  mountain: mountain,
  bamboo: bamboo,
  plum: plum,
  orchid: orchid,
  chrysanth: chrysanth,
  moonNight: moonNight,
  cloudPattern: cloudPattern,
  landscape: landscape,
  // 器物
  fan: fan,
  vase: vase,
  lantern: lantern,
  // 表情包
  faceSmile: faceSmile,
  faceLaugh: faceLaugh,
  faceLove: faceLove,
  faceCry: faceCry,
  faceAngry: faceAngry,
  faceShock: faceShock,
  faceWink: faceWink,
  faceSpeechless: faceSpeechless,
  // 图标
  heartIcon: heartIcon,
  starIcon: starIcon,
  musicNote: musicNote,
  bolt: bolt,
  gem: gem
}
