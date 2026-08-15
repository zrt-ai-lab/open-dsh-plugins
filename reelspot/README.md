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

在 DSH 会话中让 Cordis 代理安装（或自行调用 `cordis_define`）：

```bash
node build.mjs
# 生成 dist/reelspot-dsh.client.js 和 dist/reelspot-dsh.host.js
# 将两个文件内容分别作为 cordis_define 的 code.client / code.host
```

安装后对话框（会话头部）右上角出现 **🔍 🎤 ● 录屏** 按钮组；停止录制后弹出预览面板，可播放、下载或保存到工作区 `recordings/` 目录。

## 开发 / Development

```
src/reelspot.js            核心库（零依赖，纯浏览器 API）
src/dsh-plugin/client.js   DSH 插件客户端壳（UI）
src/dsh-plugin/host.js     DSH 插件 Host 端（保存到工作区）
examples/standalone.html   独立演示页
build.mjs                  生成 dist/ 下可直接安装的插件文件
```

## License

[MIT](LICENSE) © 2026 ReelSpot contributors
