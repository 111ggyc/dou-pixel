/**
 * 收藏与评价的本地存储
 *
 * ⚠️ **评价是本地的，别人看不到。**
 * 没有后端，所以这里存的评分和评论只在这台设备上有效 ——
 * 界面上必须如实说明，不能让用户以为发出去了。
 *
 * 键的规则：
 *   预设图案   直接用 preset id（如 'p-heart'）
 *   照片生成的 用签名 'g-<cols>x<rows>-<调色板哈希>'
 * 签名的作用是让「同一张照片用同样的参数生成两次」得到同一个键，
 * 这样二次生成时能带出之前的收藏和评价。
 */

const FAV_KEY = 'fav_charts'
const RATE_KEY = 'chart_ratings'

function loadMap(key) {
  try {
    const m = wx.getStorageSync(key)
    return m && typeof m === 'object' ? m : {}
  } catch (e) {
    return {}
  }
}

function saveMap(key, m) {
  try {
    wx.setStorageSync(key, m)
    return true
  } catch (e) {
    return false
  }
}

function pad(n) { return n < 10 ? '0' + n : '' + n }

function nowText() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 生成图纸的签名。
 *
 * 用「尺寸 + 调色板」做哈希就够了 —— 同一张照片 + 同样参数
 * 必然得到同样的调色板（算法是确定性的，这一点在 selftest 里验过）。
 * 不需要把整张网格塞进键里。
 */
function signature(cols, rows, palette) {
  let h = 0
  palette.forEach(function (p) {
    const s = p.hex + ':' + p.count
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff
    }
  })
  return 'g-' + cols + 'x' + rows + '-' + h.toString(36)
}

// ── 收藏 ────────────────────────────────────────────

function favs() {
  return loadMap(FAV_KEY)
}

function isFav(key) {
  return !!favs()[key]
}

/**
 * 切换收藏。返回切换后的状态。
 *
 * @param {object} meta 存一份摘要，这样「我的收藏」页不用重新生成图纸
 */
function toggleFav(key, meta) {
  const m = favs()
  if (m[key]) {
    delete m[key]
    saveMap(FAV_KEY, m)
    return false
  }
  m[key] = {
    at: nowText(),
    name: (meta && meta.name) || '',
    kind: (meta && meta.kind) || '',
    cols: (meta && meta.cols) || 0,
    rows: (meta && meta.rows) || 0,
    colors: (meta && meta.colors) || 0,
    presetId: (meta && meta.presetId) || ''
  }
  saveMap(FAV_KEY, m)
  return true
}

/** 收藏列表，新的在前 */
function favList() {
  const m = favs()
  const out = Object.keys(m).map(function (k) {
    return Object.assign({ key: k }, m[k])
  })
  out.sort(function (a, b) {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1
    return a.key < b.key ? 1 : -1 // 同时间用键兜底，保证顺序稳定
  })
  return out
}

// ── 评价 ────────────────────────────────────────────

function ratings() {
  return loadMap(RATE_KEY)
}

function getRating(key) {
  return ratings()[key] || null
}

/**
 * 提交评价。
 *
 * 同一个图纸只保留**一条**评价 —— 再提交就是覆盖。
 * 允许多条的话「我的评价」里会出现同一张图纸好几条，
 * 而且用户没法改自己写错的内容。
 */
function rate(key, stars, note) {
  const m = ratings()
  m[key] = {
    stars: Number(stars),
    note: String(note || '').trim(),
    at: nowText()
  }
  return saveMap(RATE_KEY, m)
}

function removeRating(key) {
  const m = ratings()
  if (!m[key]) return false
  delete m[key]
  saveMap(RATE_KEY, m)
  return true
}

/** 我评价过的，新的在前 */
function ratedList() {
  const m = ratings()
  const out = Object.keys(m).map(function (k) {
    return Object.assign({ key: k }, m[k])
  })
  out.sort(function (a, b) {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1
    return a.key < b.key ? 1 : -1
  })
  return out
}

/** 所有评价的平均分（本地口径） */
function avgRating() {
  const m = ratings()
  const keys = Object.keys(m)
  if (!keys.length) return 0
  let sum = 0
  keys.forEach(function (k) { sum += m[k].stars })
  return Math.round((sum / keys.length) * 10) / 10
}

// ── 点赞 ────────────────────────────────────────────
//
// ⚠️ 本地点赞。没有后端，所以只有你自己看得到 ——
// 界面上作品显示的总赞数是「演示基数 + 你自己这一票」。

const LIKE_KEY = 'chart_likes'

function likes() {
  return loadMap(LIKE_KEY)
}

function isLiked(key) {
  return !!likes()[key]
}

function toggleLike(key) {
  const m = likes()
  if (m[key]) {
    delete m[key]
    saveMap(LIKE_KEY, m)
    return false
  }
  m[key] = 1
  saveMap(LIKE_KEY, m)
  return true
}

function likeCount() {
  return Object.keys(likes()).length
}

// ── 评论 ────────────────────────────────────────────
//
// 同样只有本机可见。展示时会把「演示评论」和「我写的」拼在一起 ——
// 演示的那部分在 data/presets.js 里，标明是演示数据。

const CMT_KEY = 'chart_comments'

function comments(key) {
  const m = loadMap(CMT_KEY)
  return m[key] || []
}

function addComment(key, text) {
  const t = String(text || '').trim()
  if (!t) return false

  const m = loadMap(CMT_KEY)
  const list = m[key] || []
  list.push({ text: t.slice(0, 100), at: nowText(), mine: true })
  m[key] = list
  saveMap(CMT_KEY, m)
  return true
}

function removeComment(key, idx) {
  const m = loadMap(CMT_KEY)
  const list = m[key]
  if (!list || idx < 0 || idx >= list.length) return false
  list.splice(idx, 1)
  if (!list.length) delete m[key]
  saveMap(CMT_KEY, m)
  return true
}

function commentCount() {
  const m = loadMap(CMT_KEY)
  let n = 0
  Object.keys(m).forEach(function (k) { n += m[k].length })
  return n
}

function resetAll() {
  try {
    wx.removeStorageSync(FAV_KEY)
    wx.removeStorageSync(RATE_KEY)
    wx.removeStorageSync(LIKE_KEY)
    wx.removeStorageSync(CMT_KEY)
  } catch (e) { /* 静默 */ }
}

module.exports = {
  signature: signature,
  favs: favs,
  isFav: isFav,
  toggleFav: toggleFav,
  favList: favList,
  getRating: getRating,
  rate: rate,
  removeRating: removeRating,
  ratedList: ratedList,
  avgRating: avgRating,
  likes: likes,
  isLiked: isLiked,
  toggleLike: toggleLike,
  likeCount: likeCount,
  comments: comments,
  addComment: addComment,
  removeComment: removeComment,
  commentCount: commentCount,
  resetAll: resetAll
}
