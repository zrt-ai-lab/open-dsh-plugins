# ReelSpot

零依赖的浏览器录屏库 + DSH 对话界面插件。一键录制屏幕 / 窗口 / 标签页，输出 **MP4**（不支持时自动回退 WebM），支持**麦克风混音**和**光标跟随放大聚焦**。

A zero-dependency browser screen recorder — one-click screen / window / tab capture with **MP4** output (WebM fallback), **microphone mixing**, and **cursor-follow zoom**. Ships as a plain JS library plus a plugin for the [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) Web GUI.

> Inspired by [Recordly](https://github.com/webadderallorg/Recordly) (AGPL-3.0 desktop app). ReelSpot is written from scratch in the browser — no Recordly code is used — and is MIT licensed.

---

## 特性 / Features

- 🎥 **屏幕 / 窗口 / 标签页录制** — 基于 `getDisplayMedia` + `MediaRecorder`
- 📼 **MP4 优先** — H.264 + AAC（Chrome/Edge 126+），自动回退 WebM（VP9/VP8 + Opus）
- 🎤 **麦克风混音** — `AudioContext` 将标签页/系统音频与麦克风混成一条音轨
- 🔍 **放大聚焦** — canvas 实时管线：光标移动时平滑放大跟随（默认 1.8×），静止后缩回全景
- 🧩 **两种形态** — 独立 JS 库（任何网页可用）+ DSH 动态 Cordis 插件（对话框右上角按钮）

## 浏览器限制 / Browser limitations

| 场景 | 说明 |
| --- | --- |
| 系统声音 | Windows 上 Chrome 仅**标签页**捕获可带音频（勾选"分享标签页音频"）；录整个屏幕无系统声音 → 用麦克风补充 |
| 聚焦光标跟踪 | 仅录制**本页面标签页**时网页才能拿到光标位置；录其他窗口时保持全景 |
| MP4 录制 | 需要 Chrome/Edge 126+；更老的浏览器自动输出 WebM |

## 用法一：独立库 / As a library

```html
<script src="src/reelspot.js"></script>
<script>
  const recorder = ReelSpot.createRecorder({ mic: true, zoom: true })
  recorder.on('stop', ({ blob, name }) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name // reelspot-YYYYMMDD-HHmmss.mp4
    a.click()
  })
  await recorder.start() // 弹出屏幕选择器；用户取消时返回 null
  // recorder.stop()     // 结束并触发 'stop' 事件
</script>
```

完整可运行示例见 `examples/standalone.html`（需通过 http(s) 或 localhost 打开，`getDisplayMedia` 要求安全上下文）。

### API

```js
const recorder = ReelSpot.createRecorder(options?)
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `mic` | `true` | 请求麦克风并混入 |
| `zoom` | `false` | 启用光标跟随放大聚焦 |
| `zoomFactor` | `1.8` | 放大倍数 |
| `zoomIdleMs` | `2000` | 光标静止多久后缩回全景 |
| `frameRate` | `30` | 帧率 |
| `maxWidth` | `1920` | 聚焦管线画布宽度上限 |
| `videoBitsPerSecond` | `6000000` | 视频码率 |
| `audioBitsPerSecond` | `192000` | 音频码率 |
| `filePrefix` | `'reelspot'` | 生成文件名的前缀 |

| 方法 / 事件 | 说明 |
| --- | --- |
| `start()` | 开始录制；resolve 为 `{ audioMode, zoomed, ext, mime }`，用户取消时 resolve `null` |
| `stop()` | 停止；完成后触发 `'stop'` |
| `getState()` | `'idle'` \| `'recording'` |
| `on('stop', fn)` | `fn({ blob, size, name, ext, mime, audioMode, zoomed, startedAt, durationMs })` |
| `on('state', fn)` | `fn('idle' \| 'recording')` |
| `on('error', fn)` | 非致命错误（如麦克风被拒） |
| `ReelSpot.isSupported()` | 当前浏览器是否支持录屏 |
| `ReelSpot.pickFormat()` | 实际会使用的 `{ mime, ext }` |

`audioMode`：`'system+mic'` \| `'system'` \| `'mic'` \| `'none'`。

## 用法二：DSH 插件 / As a DSH plugin

### npx 持久安装（推荐，永久生效）

```bash
npx dsh-reelspot install
# 然后重启 DSH（停掉当前 dsh web 再启动），硬刷新页面
```

这是 DSH 官方的**组合插件**机制：安装器把包放进 profile 的 `node_modules` 并向 `cordis.patch.yml` 插入一行 loader 配置。装好后**永久生效、无需批准**。卸载：`npx dsh-reelspot uninstall`。

> 未发布 npm 前可本地执行：`node reelspot/dsh/bin/install.mjs install`

### 一句话试用（动态插件，进程级）

在 DSH 对话框里发送这句话即可，无需 clone、无需构建：

```
安装 ReelSpot 录屏插件：读取 https://raw.githubusercontent.com/zrt-ai-lab/open-dsh-plugins/main/reelspot/dist/reelspot-dsh.client.js 和 https://raw.githubusercontent.com/zrt-ai-lab/open-dsh-plugins/main/reelspot/dist/reelspot-dsh.host.js ，分别作为 code.client 和 code.host 调用 cordis_define（idPrefix 用 reelsp），然后 cordis_run 运行
```

在弹出的批准卡片上点 ✓（点 ✓✓ 授权未来版本，以后更新免确认）。DSH 重启后动态插件消失，重发这句话即可重装；想永久生效请用上面的 npx 持久安装。

### 手动安装

**安装不需要构建**——`dist/` 目录已包含构建产物，直接用即可：

```bash
git clone https://github.com/zrt-ai-lab/open-dsh-plugins.git
cd open-dsh-plugins/reelspot
# dist/reelspot-dsh.client.js -> cordis_define 的 code.client
# dist/reelspot-dsh.host.js   -> cordis_define 的 code.host
```

在 DSH 会话中让 Cordis 代理读取这两个文件并完成 `cordis_define` + `cordis_run`，或自行调用。

> 只有**修改了 `src/` 源码**才需要重新构建（注意先 `cd` 到本目录再执行）：
>
> ```bash
> cd open-dsh-plugins/reelspot   # 必须在 reelspot 目录内，否则会报 Cannot find module
> node build.mjs                 # 重新生成 dist/
> ```

安装后对话框（会话头部）右上角出现 **🔍 🎤 ● 录屏** 按钮组；停止录制后弹出预览面板，可播放、下载或保存到工作区 `recordings/` 目录。

## 开发 / Development

```
src/reelspot.js                 核心库（零依赖，纯浏览器 API）
src/dsh-plugin/client.js        动态插件客户端壳（UI，cordis_define 形态）
src/dsh-plugin/host.js          动态插件 Host 端（保存到工作区）
src/dsh-plugin/client.bundle.js 组合插件客户端（dsh.client 模块表形态）
dsh/                            可发布的组合插件包（npx dsh-reelspot install）
  lib/index.js                  Host 端：POST /dsh-reelspot/save 保存路由
  lib/client.js                 构建生成的浏览器 bundle
  bin/install.mjs               安装/卸载器（profile node_modules + cordis.patch.yml）
examples/standalone.html        独立演示页
build.mjs                       生成 dist/ 与 dsh/lib/client.js
```

## License

[MIT](LICENSE) © 2026 ReelSpot contributors
