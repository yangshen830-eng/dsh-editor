# DSH Code Editor

一个运行在 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 里的 VS Code 风格代码编辑器插件：在会话主区新增一个「文件」标签页，提供文件树、Monaco 编辑器、跨文件搜索/替换、Markdown 预览、Git 状态等能力。

> 本仓库当前提供的是 **DSH 动态插件（dynamic Cordis Plugin）** 形式的完整可运行源码。
> DSH 的浏览器 UI 插件若要「重启不丢 + 一键安装」，目标形态是一个 npm 包（参考已装好的 `dsh-better-sidebar`），见下方「迁移到正式 npm 包」。

## 功能

- **文件树**：浏览工作区目录，展开/折叠，Git 状态角标（`M`/`A`/`??`…），点击角标查看 diff。
- **Monaco 编辑器**：多文件标签页、语法高亮、自动换行/Minimap/字号/Tab 宽度可配置、快捷键可自定义。
- **跨文件搜索**：基于 ripgrep，流式增量出结果、命中高亮、虚拟滚动（上限 20000 条）、大小写/全字/正则开关、包含/排除 glob、搜索历史、跨文件替换。
- **Markdown 预览**：源码 / 预览 / 分屏三视图，marked 渲染 + DOMPurify 消毒 + highlight.js 高亮 + mermaid 图表 + KaTeX 公式 + 任务列表勾选。
- **快速打开**：`Ctrl+P` 按相对路径模糊匹配。
- **对话路径跳转**：对话里行内代码形式的文件路径可 `Ctrl+点击`（macOS `Cmd+点击`）直接切到「文件」页并打开。
- **主题同步**：跟随 DSH 明暗主题，Monaco/highlight.js/mermaid 实时切换。

## 目录结构

```
dsh-code-editor/
├── README.md                 # 本文件
├── LICENSE                   # MIT
├── src/
│   ├── host.js               # Host 端源码（Node 进程：fs/git/subprocess 搜索后端）
│   └── client.js             # Client 端源码（浏览器：UI、Monaco、搜索、预览）
├── install/
│   └── INSTALL.md            # 安装说明（动态安装 + 迁移路径）
├── package.json              # 正式 npm 包迁移模板（占位）
└── cordis.patch.yml          # 正式插件 host 端 bundle patch 模板（占位）
```

## 架构

DSH 的动态插件由两半组成，通过 `cordis_define` 一次性定义，`cordis_run` 激活：

- **Host 半**（`src/host.js`）运行在 DSH 的 Node 进程里，通过 `harness.handle('method', fn)` 暴露私有 RPC 给浏览器：`fs:*`（文件读写/列举/项目根/搜索）、`git:*`（状态/diff）。
- **Client 半**（`src/client.js`）运行在浏览器里，通过 `host.call('method', args)` 调用 Host，用 `slots.inject('conversation.view', …)` 注册「文件」标签页，用 `slots.inject('settings.section', …)` 注册设置页。

两半之间只传输可 JSON 序列化的数据。

## 安装

见 [`install/INSTALL.md`](install/INSTALL.md)。最快的方式：把下面这句话发给一个 DSH 会话，让它读 `src/host.js` 与 `src/client.js` 后用 `cordis_define` + `cordis_run` 安装：

```
请读 /home/ys/dsh-code-editor/src/host.js 和 src/client.js，
用 cordis_define 定义一个名为「DSH Code Editor」的插件
（plugin: { kind:'new', idPrefix:'editr' }，code.host 与 code.client 分别填这两个文件的内容），
然后 cordis_run 激活它。
```

> 动态插件**不落盘、进程重启即失效**——这是 DSH 动态插件的固有特性，不是本仓库的缺陷。重启后需重新执行一次安装。

## 迁移到正式 npm 包（重启不丢、一键安装）

DSH 的浏览器 UI 插件要持久化，需做成一个 npm 包，参考 `dsh-better-sidebar` 的结构：

1. `package.json` 里声明：
   - `"dsh.bundle.patch": "./cordis.patch.yml"`（Host 端 composition 补丁）
   - `"dsh.client": { "inject": […], "platform": "web" }`（Client 端注入声明）
2. `cordis.patch.yml` 用 `insert` 把 Host 端插件行挂进 profile。
3. 把本仓库 Host 半的 `harness.handle(...)` 重写为**标准 Cordis 插件**（用 `ctx` 与 Services，如 `@deepseek-ai/dsh-tools` 的 `defineTool`），Client 半的 `host.call` 适配 client runtime 的 RPC。
4. 用户执行 `dsh plugin --profile <name> add <包名>@<版本>` 即可安装。

`package.json` 与 `cordis.patch.yml` 已在本仓库提供模板占位；完整的代码迁移是一个独立的工程（见 INSTALL.md），可按需进行。

## 许可证

[MIT](LICENSE)
