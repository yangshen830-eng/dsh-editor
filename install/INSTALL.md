# 安装说明

DSH Editor 以**标准 Cordis 插件（npm 包）**形式分发，可通过 `dsh plugin add` 一键安装，重启后依然生效。

## 安装

### 从 npm 安装（推荐）

```bash
dsh plugin --profile web add dsh-editor
```

### 从 GitHub 安装

```bash
dsh plugin --profile web add git@github.com:yangshen830-eng/dsh-editor.git
```

### 从本地目录安装

```bash
dsh plugin --profile web add file:/path/to/dsh-editor
```

安装后**重启 DSH**（`dsh web --profile web`）即可在会话主区看到「文件」标签页。

## 动态安装（临时试玩）

`src/host.js` 与 `src/client.js` 是同一编辑器的**动态插件（dynamic Cordis Plugin）**函数体源码，适合在单个 DSH 会话里临时试玩，无需改 profile。缺点是进程重启即失效。

在 DSH 会话中让 Agent：

```
请读 src/host.js 和 src/client.js，用 cordis_define 定义一个插件
（plugin: { kind: 'new', idPrefix: 'editr' }，
  code: { host: <host.js 内容>, client: <client.js 内容> }），
然后 cordis_run 激活它（mode: 'run'）。
```

## 说明

`dsh plugin add` 会把包加入 `dsh.profile.bundles`，profile 启动时依据本包的 `dsh.bundle.patch`（`cordis.patch.yml`）挂载 Host 端，并依据 `dsh.client` 声明加载浏览器端。客户端模块表的扫描结果在进程内缓存，因此**插件集变化需重启 DSH 生效**。
