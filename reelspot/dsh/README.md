# dsh-reelspot

ReelSpot 录屏 — DeepSeek Harness (DSH) Web 界面的**持久化组合插件**：对话框右上角一键录屏，MP4 输出（WebM 回退）、麦克风混音、光标跟随放大聚焦。

## 安装 / Install

```bash
npx dsh-reelspot install
```

然后**重启 DSH**（停掉当前 `dsh web` 再启动），硬刷新页面即可。无需批准、永久生效。

卸载：

```bash
npx dsh-reelspot uninstall
```

## 原理

安装器做两件事（零依赖、不需要 pnpm）：

1. 把本包复制到 `<DSH_HOME>/profiles/web/node_modules/dsh-reelspot`（profile 的 Node 解析根）
2. 向 `<DSH_HOME>/profiles/web/cordis.patch.yml`（用户 patch 层，升级不覆盖）插入一行 loader 配置

DSH 启动时扫描到本包的 `dsh.client` 声明，自动把客户端 bundle 注入浏览器启动图并挂载。

## 功能

- 🔴 会话头部右上角「录屏」按钮：录制整个屏幕 / 窗口 / 标签页，3-2-1 倒计时开录
- ⏸ 录制中暂停/继续（时长统计扣除暂停段）
- 🎤 麦克风开关（与标签页/系统音频经 AudioContext 混音）
- 🔍 放大聚焦：光标移动时平滑放大跟随（录制本标签页时有效）
- 🖱️ 光标高亮 + 点击波纹（录制本标签页时有效）
- 📹 摄像头气泡（圆形画中画）
- ⌨️ 快捷键 `Alt+Shift+R` 开始/停止
- 停止后弹出预览面板：播放 / 下载 / 保存到 `<工作区>/recordings/`；WebM 可一键转 MP4（需主机 ffmpeg）

## 手动安装（不用 npx）

```bash
git clone https://github.com/zrt-ai-lab/open-dsh-plugins.git
node open-dsh-plugins/reelspot/dsh/bin/install.mjs install
```

## License

MIT © 2026 ReelSpot contributors
