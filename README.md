# DSH Code Editor

一个运行在 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 里的 VS Code 风格代码编辑器插件：在会话主区新增一个「文件」标签页，提供文件树、Monaco 编辑器、跨文件搜索/替换、Markdown 预览、Git 状态等能力。

以**标准 Cordis 插件（npm 包）**形式分发，可通过 `dsh plugin add` 一键安装、重启后依然生效。

## 功能

- **文件树**：浏览工作区目录，展开/折叠，Git 状态角标（`M`/`A`/`??`…），点击角标查看 diff。
- **Monaco 编辑器**：多文件标签页、语法高亮、自动换行/Minimap/字号/Tab 宽度可配置、快捷键可自定义。
- **跨文件搜索**：基于 ripgrep，流式增量出结果、命中高亮、虚拟滚动（上限 20000 条）、大小写/全字/正则开关、包含/排除 glob、搜索历史、跨文件替换。
- **Markdown 预览**：源码 / 预览 / 分屏三视图，marked 渲染 + DOMPurify 消毒 + highlight.js 高亮 + mermaid 图表 + KaTeX 公式 + 任务列表勾选。
- **快速打开**：`Ctrl+P` 按相对路径模糊匹配。
- **对话路径跳转**：对话里行内代码形式的文件路径可 `Ctrl+点击`（macOS `Cmd+点击`）直接切到「文件」页并打开。
- **主题同步**：跟随 DSH 明暗主题，Monaco/highlight.js/mermaid 实时切换。

## 安装

### 从 GitHub 安装（推荐）

```bash
dsh plugin --profile web add git@github.com:yangshen830-eng/dsh-editor.git
```

### 从本地目录安装

```bash
dsh plugin --profile web add file:/path/to/dsh-editor
```

### 从 npm 安装（发布后）

```bash
dsh plugin --profile web add dsh-editor
```

安装后**重启 DSH**（`dsh web --profile web`）即可在会话主区看到「文件」标签页。

> 说明：`dsh plugin add` 会把包加入 `dsh.profile.bundles`，profile 启动时依据本包的 `dsh.bundle.patch`（`cordis.patch.yml`）挂载 Host 端，并依据 `dsh.client` 声明加载浏览器端。客户端模块表的扫描结果在进程内缓存，因此**插件集变化需重启 DSH 生效**。

## 目录结构

```
dsh-editor/
├── lib/
│   ├── index.js           # Host 端（Node 进程：fs/git/subprocess 搜索后端 + /editor RPC）
│   └── client.js          # Client 端（浏览器：UI、Monaco、搜索、预览，经 /editor RPC 调 Host）
├── cordis.patch.yml       # dsh.bundle.patch：把 Host 端插件行 insert 进 profile
├── package.json           # dsh.bundle.patch + dsh.client 声明
├── src/                   # 动态插件（dynamic Cordis Plugin）形式的等价源码，供参考/单会话快速安装
├── install/INSTALL.md     # 安装与迁移说明
├── README.md
└── LICENSE
```

## 架构

DSH 的浏览器 UI 插件由两半组成，通过 npm 包的 `dsh` 字段声明挂载：

- **Host 半**（`lib/index.js`）：标准 Cordis 插件，`inject: ['connection']`，在 `apply` 里用 `ctx.connection.rpc.handle('/editor', handler)` 暴露私有 JSON RPC。`fs:*`（文件读写/列举/项目根/搜索）、`git:*`（状态/diff）各端点走一个 dispatch 表。
- **Client 半**（`lib/client.js`）：`window.__ModuleLoader__.load(...)` 模块，`require("react")` 拿 React，`inject: ['slots', 'connection', 'timer']`，用 `ctx.connection.rpc.call('/editor', endpoint, payload)` 调 Host，用 `ctx.slots.inject` 注册「文件」标签页与设置页。

两半之间只传输可 JSON 序列化的数据。

## `src/` 动态插件源码

`src/host.js` 与 `src/client.js` 是同一编辑器的**动态插件（dynamic Cordis Plugin）**形式源码，适合临时试玩：在一个 DSH 会话里让 Agent 用 `cordis_define` + `cordis_run` 安装即可，无需改 profile。缺点是**不落盘、进程重启即失效**。详见 `install/INSTALL.md`。

## 许可证

[MIT](LICENSE)
