/**
 * 描边 + 明暗
 *
 * 光栅化出来的图案原本是**纯色平涂**的，像剪贴画。参考电商上的拼豆成品
 * （苹果 / 樱桃 / 橙片 / 葡萄）能看出差在哪：每个元素都有
 * **一条深色描边 + 两到三档明暗**。苹果是深红描边 + 左上浅色高光 + 中间本色，
 * 葡萄是每颗独立的圆各带一个高光点。
 *
 * 这里不去改 39 个形状函数，而是做成一趟**通用的后处理** ——
 * 形状只负责"是什么"，明暗由这里统一负责，39 张才会是一套。
 *
 * 输入是 presets.rasterize() 的输出（字符网格 + 本色数组），
 * 输出是**扩张过的**索引网格 + 派生出来的调色板。
 */

// 高光的位置和大小，坐标是**图案外接框**的归一化值（0~1）。
//
// 试过两种都不行：u+v<1 的对角分割会在图案正中切出一条硬邦邦的斜线；
// u<0.52 && v<0.52 的方块会在爱心上糊出一块**看得见边角的矩形** ——
// 一眼就是算法画上去的，不是光。所以用**椭圆**，才是"一团光"的形状。
// 中心偏左上、半径 0.32：大致就是参考图里苹左上那团浅色的大小。
const LIT_CX = 0.32
const LIT_CY = 0.32
const LIT_R = 0.32

// 派生色调的混合比例。亮调混白、暗调混黑，数值是照参考图调的：
// 再大一点就发灰，再小一点就和本色分不出来
const LIGHT_MIX = 0.34
const DARK_MIX = 0.3

// 描边色 = 主色往这个墨色混。混到纯黑会显脏，留一点暖调
const INK = [26, 20, 16]
const INK_MIX = 0.62

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function mix(rgb, target, k) {
  return [
    clamp255(Math.round(rgb[0] + (target[0] - rgb[0]) * k)),
    clamp255(Math.round(rgb[1] + (target[1] - rgb[1]) * k)),
    clamp255(Math.round(rgb[2] + (target[2] - rgb[2]) * k))
  ]
}

function toHex(rgb) {
  const h = function (v) {
    const s = v.toString(16)
    return s.length < 2 ? '0' + s : s
  }
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2])
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16)
  ]
}

// 128 是黑白符号对比度相等的分界点，和 pattern.js 用同一个口径
function isDark(rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128
}

/**
 * 到最近空格的步数（只对实心格有意义）。
 *
 * 多源 BFS：所有空格深度 0，一圈圈往里推。
 * 外面先垫一圈空格再算 —— 不然贴着画布边的图案会以为自己"很深"，
 * 得不到描边那圈暗调。
 */
function depthTransform(solid, w, h) {
  const pw = w + 2
  const ph = h + 2
  const dist = new Int32Array(pw * ph)
  const queue = new Int32Array(pw * ph)
  let head = 0
  let tail = 0

  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const ix = x - 1
      const iy = y - 1
      const isSolid = ix >= 0 && iy >= 0 && ix < w && iy < h &&
        solid[iy * w + ix] === 1
      // 垫的那一圈以及原图的空格，都是深度 0 的源点
      if (!isSolid) {
        dist[y * pw + x] = 0
        queue[tail++] = y * pw + x
      } else {
        dist[y * pw + x] = -1
      }
    }
  }

  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  while (head < tail) {
    const cur = queue[head++]
    const cy = Math.floor(cur / pw)
    const cx = cur - cy * pw
    for (let k = 0; k < 4; k++) {
      const nx = cx + NB[k][0]
      const ny = cy + NB[k][1]
      if (nx < 0 || ny < 0 || nx >= pw || ny >= ph) continue
      const ni = ny * pw + nx
      if (dist[ni] !== -1) continue
      dist[ni] = dist[cur] + 1
      queue[tail++] = ni
    }
  }

  const out = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = dist[(y + 1) * pw + (x + 1)]
    }
  }
  return out
}

/**
 * 描边 = 实心区域向外膨胀一圈。
 *
 * **向外**而不是向内：向里收会把本来就细的笔画（竹竿 2.5 格、梅枝 2.4 格）
 * 整根吃掉。向外至少保留原来的笔画宽度。
 *
 * 用 8 邻域（切比雪夫距离）而不是 4 邻域 —— 4 邻域在斜角处会漏出缺口，
 * 描边不闭合就失去了描边的意义。
 */
function dilate(solid, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (solid[i]) {
        out[i] = 1
        continue
      }
      let found = false
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (solid[ny * w + nx]) { found = true; break }
        }
      }
      out[i] = found ? 1 : 0
    }
  }
  return out
}

/** 用得最多的本色 —— 描边色跟着它走 */
function dominant(src) {
  const counts = {}
  let best = -1
  let bestN = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v < 0) continue
    counts[v] = (counts[v] || 0) + 1
    if (counts[v] > bestN) { bestN = counts[v]; best = v }
  }
  return best
}

function bounds(solid, w, h) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid[y * w + x]) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { x0: x0, y0: y0, x1: x1, y1: y1 }
}

/**
 * 把 key 网格收成调色板。
 *
 * key 是 'b3' / 'l3' / 'd3' / 'o' —— 本色 / 亮调 / 暗调 / 描边。
 * 只有**真的用到的** key 才进调色板，所以一张只有两色的图案
 * 不会因为"理论上可以有三档明暗"就凭空多出六个色号。
 *
 * 调色板按用量降序 —— 和 pattern.buildChart 的口径一致，
 * 详情页的用色表就照这个顺序排。
 */
function finish(key, w, h, baseColors, dom) {
  const order = []
  const seen = {}

  for (let i = 0; i < key.length; i++) {
    const k = key[i]
    if (!k || seen[k]) continue
    seen[k] = true
    order.push(k)
  }

  const rgbOf = function (k) {
    if (k === 'o') {
      return mix(baseColors[dom] ? hexToRgb(baseColors[dom]) : [80, 80, 80], INK, INK_MIX)
    }
    const tone = k.charAt(0)
    const idx = Number(k.substring(1))
    const base = hexToRgb(baseColors[idx] || '#888888')
    if (tone === 'l') return mix(base, [255, 255, 255], LIGHT_MIX)
    if (tone === 'd') return mix(base, [0, 0, 0], DARK_MIX)
    return base
  }

  // 先按 key 收集，再统计用量
  const keyIndex = {}
  order.forEach(function (k, i) { keyIndex[k] = i })

  const assign = new Int32Array(w * h).fill(-1)
  const counts = new Array(order.length).fill(0)
  for (let i = 0; i < key.length; i++) {
    const k = key[i]
    if (!k) continue
    const idx = keyIndex[k]
    assign[i] = idx
    counts[idx]++
  }

  // 按用量降序重排，然后把 assign 也重映射一遍
  const perm = order.map(function (k, i) { return i })
  perm.sort(function (a, b) {
    if (counts[b] !== counts[a]) return counts[b] - counts[a]
    // 同量时按 key 排，保证每次生成顺序一致（图纸要能重复生成）
    return order[a] < order[b] ? -1 : order[a] > order[b] ? 1 : 0
  })

  const remap = {}
  const palette = perm.map(function (oldIdx, newIdx) {
    remap[oldIdx] = newIdx
    const rgb = rgbOf(order[oldIdx])
    return {
      hex: toHex(rgb),
      rgb: rgb,
      count: counts[oldIdx],
      dark: isDark(rgb)
    }
  })

  const out = new Int32Array(w * h).fill(-1)
  for (let i = 0; i < assign.length; i++) {
    if (assign[i] >= 0) out[i] = remap[assign[i]]
  }

  return { w: w, h: h, assign: out, palette: palette }
}

/**
 * 主入口。
 *
 * @param {object} r        presets.rasterize() 的输出
 * @param {boolean} shaded  false = 平涂（线描和 emoji 用），只做本色
 * @returns {{w, h, assign, palette}}
 */
function build(r, shaded) {
  const w = r.w
  const h = r.h
  const n = w * h
  const src = new Int32Array(n).fill(-1)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = r.grid[y][x]
      src[y * w + x] = ch === '.' ? -1 : ch.charCodeAt(0) - 65
    }
  }

  const key = new Array(n).fill(null)

  if (!shaded) {
    for (let i = 0; i < n; i++) if (src[i] >= 0) key[i] = 'b' + src[i]
    return finish(key, w, h, r.colors, 0)
  }

  const solid = new Uint8Array(n)
  for (let i = 0; i < n; i++) solid[i] = src[i] >= 0 ? 1 : 0

  const depth = depthTransform(solid, w, h)
  const box = bounds(solid, w, h)
  const bw = Math.max(1, box.x1 - box.x0)
  const bh = Math.max(1, box.y1 - box.y0)

  // 描边先铺，明暗再盖 —— 顺序不能反，描边落在空处，不会被实心盖掉
  const grown = dilate(solid, w, h)
  for (let i = 0; i < n; i++) {
    if (grown[i] && !solid[i]) key[i] = 'o'
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!solid[i]) continue
      const idx = src[i]

      // 归一化到图案的外接框
      const u = (x - box.x0) / bw
      const v = (y - box.y0) / bh
      const du = (u - LIT_CX) / LIT_R
      const dv = (v - LIT_CY) / LIT_R
      const lit = du * du + dv * dv <= 1

      if (depth[i] <= 1) {
        // 贴边的一圈：迎光面保持本色，背光面压暗
        key[i] = lit ? 'b' + idx : 'd' + idx
      } else {
        // 内部：迎光面提亮，其余本色
        key[i] = lit ? 'l' + idx : 'b' + idx
      }
    }
  }

  return finish(key, w, h, r.colors, dominant(src))
}

module.exports = {
  build: build,
  // 导出给测试用
  depthTransform: depthTransform,
  dilate: dilate,
  dominant: dominant,
  isDark: isDark,
  mix: mix,
  toHex: toHex,
  hexToRgb: hexToRgb
}
