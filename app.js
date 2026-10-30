// 图纸 PATTERN —— 全局启动信息
App({
  globalData: {
    statusBarHeight: 20,
    safeBottom: 0,
    winW: 375,
    winH: 667,
    pixelRatio: 2,
    // 首页生成好的图纸，传给详情页用。
    // 走 globalData 而不是 URL —— 一张 80×60 的图纸有几千个格子，
    // 序列化进路径参数不现实
    currentChart: null
  },

  onLaunch() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const g = this.globalData

    g.statusBarHeight = info.statusBarHeight || 20
    g.winW = info.windowWidth || 375
    g.winH = info.windowHeight || 667
    g.pixelRatio = info.pixelRatio || 2

    g.safeBottom = info.safeArea
      ? Math.max(0, (info.screenHeight || 0) - info.safeArea.bottom)
      : 0
  }
})
