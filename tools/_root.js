/**
 * 找到小程序本身的目录。
 *
 * 同一套测试脚本要在两种目录布局下都能跑：
 *
 *   开发副本   weapp-new/图纸/tools/        工具在小程序**里面**
 *   提交包     weapp-competition/tools/     工具和小程序**同级**
 *
 * 提交包故意把 tools/ 放在外面 —— 微信打包是把小程序目录整个打进去的，
 * 测试脚本放里面会一起上传，没必要。
 *
 * 与其在两处各维护一份路径（改一处忘一处就会静默指向旧代码），
 * 不如让脚本自己找：两种布局各试一次，谁有 utils/pattern.js 就是谁。
 */

const fs = require('fs')
const path = require('path')

function findRoot() {
  const candidates = [
    path.join(__dirname, '..'),        // 提交包：tools/ 与 图纸/ 同级
    path.join(__dirname, '..', '图纸')  // 开发副本：tools/ 在 图纸/ 里面
  ]

  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(path.join(candidates[i], 'utils', 'pattern.js'))) {
      return candidates[i]
    }
  }

  throw new Error(
    '找不到小程序目录（应含 utils/pattern.js）。找过：\n  ' + candidates.join('\n  ')
  )
}

const ROOT = findRoot()

module.exports = {
  ROOT: ROOT,
  /** 拼一个小程序内部的路径，如 req('utils', 'pattern.js') */
  req: function () {
    return require(path.join.apply(path, [ROOT].concat(
      Array.prototype.slice.call(arguments)
    )))
  }
}
