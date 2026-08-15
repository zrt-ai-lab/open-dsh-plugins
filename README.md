# open-dsh-plugins

[DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) 的开源动态 Cordis 插件合集。每个子目录是一个独立插件，内含源码、构建脚本和安装说明。

Open-source dynamic Cordis plugins for the DSH Web GUI. Each subdirectory is a self-contained plugin with source, build script, and install instructions.

## 插件列表 / Plugins

| 插件 | 说明 |
| --- | --- |
| [`reelspot`](./reelspot) | 浏览器录屏：对话框右上角一键录制屏幕/窗口/标签页，MP4 输出（WebM 回退）、麦克风混音、光标跟随放大聚焦。核心同时可作为独立 JS 库嵌入任何网页。 |

## 安装方式 / Installation

```bash
git clone https://github.com/zrt-ai-lab/open-dsh-plugins.git
cd open-dsh-plugins
```

每个插件的 `dist/` 目录已包含构建产物，**无需运行任何构建命令**：在 DSH 会话中让 Cordis 代理读取插件 `dist/` 下的 `*.client.js` / `*.host.js`，分别作为 `cordis_define` 的 `code.client` / `code.host` 并运行即可。各插件子目录的 README 有详细说明。

## License

各插件目录内含自己的 LICENSE（如无特殊说明均为 MIT）。
