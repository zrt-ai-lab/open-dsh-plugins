# open-dsh-plugins

[DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) 的开源动态 Cordis 插件合集。每个子目录是一个独立插件，内含源码、构建脚本和安装说明。

Open-source dynamic Cordis plugins for the DSH Web GUI. Each subdirectory is a self-contained plugin with source, build script, and install instructions.

## 插件列表 / Plugins

| 插件 | 说明 |
| --- | --- |
| [`reelspot`](./reelspot) | 浏览器录屏：对话框右上角一键录制屏幕/窗口/标签页，MP4 输出（WebM 回退）、麦克风混音、光标跟随放大聚焦。核心同时可作为独立 JS 库嵌入任何网页。 |

## 一键安装 / One-line Install

**不需要 clone、不需要构建、不需要碰任何文件。** 在 DSH 对话框里发送一句话即可（以 reelspot 为例）：

```
安装 ReelSpot 录屏插件：读取 https://raw.githubusercontent.com/zrt-ai-lab/open-dsh-plugins/main/reelspot/dist/reelspot-dsh.client.js 和 https://raw.githubusercontent.com/zrt-ai-lab/open-dsh-plugins/main/reelspot/dist/reelspot-dsh.host.js ，分别作为 code.client 和 code.host 调用 cordis_define（idPrefix 用 reelsp），然后 cordis_run 运行
```

DSH 代理会自动拉取插件文件并完成安装，你只需在弹出的批准卡片上点一下 ✓（点 ✓✓ 可授权该插件的未来版本，以后更新免确认）。

> 说明：DSH 动态插件是**进程级**的——DSH 重启后插件会消失，重新发送上面这句话即可重装（10 秒）。这是 DSH 当前的设计，不是插件的缺陷。

## 手动安装 / Manual Install

```bash
git clone https://github.com/zrt-ai-lab/open-dsh-plugins.git
cd open-dsh-plugins
```

每个插件的 `dist/` 目录已包含构建产物，**无需运行任何构建命令**：在 DSH 会话中让 Cordis 代理读取插件 `dist/` 下的 `*.client.js` / `*.host.js`，分别作为 `cordis_define` 的 `code.client` / `code.host` 并运行即可。各插件子目录的 README 有详细说明。

## License

各插件目录内含自己的 LICENSE（如无特殊说明均为 MIT）。
