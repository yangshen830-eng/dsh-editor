# 安装说明

## 方式 A：动态安装（当前可立即使用）

本仓库的 `src/host.js` 与 `src/client.js` 是 DSH 动态插件（dynamic Cordis Plugin）的**函数体源码**，分别对应 `cordis_define` 的 `code.host` 与 `code.client`。

### 步骤

1. 在 DSH 会话中，让 Agent 读取两个源码文件：

```
请读 /home/ys/dsh-code-editor/src/host.js 和 src/client.js，
用 cordis_define 定义一个名为「DSH Code Editor」的插件：
  plugin: { kind: 'new', idPrefix: 'editr' }
  code: { host: <host.js 内容>, client: <client.js 内容> }
然后 cordis_run 激活它（mode: 'run'）。
```

2. 激活成功后，会话主区顶部会出现「文件」标签页，点击即可进入编辑器。

### 限制

- 动态插件**只存在于当前 DSH 进程内存**，不落盘。
- **进程重启后失效**，需重新执行一次上面的安装步骤。
- 这是 DSH 动态插件的固有机制，与代码质量无关。

---

## 方式 B：迁移为正式 npm 包（重启不丢、一键安装）

这是「开源出去让别人使用」的最终形态。DSH 的浏览器 UI 插件以 npm 包形式分发（参考已安装的 `dsh-better-sidebar`）。

### 需要做的事

1. **补全 `package.json`**：本仓库已提供模板骨架，需补 `name`、`version`、`dsh.client.inject` 等真实字段。
2. **补全 `cordis.patch.yml`**：用一个 `insert` 条目把 Host 端插件行挂进 profile。
3. **重写 Host 半**（工作量最大的部分）：
   - 当前 `src/host.js` 用 `harness.handle('fs:read', …)` 暴露私有 RPC —— 这是**动态插件专用** API。
   - 正式插件里，Host 端是标准 Cordis 插件：用 `ctx` 消费 `fs` / `subprocess` / `sandboxPolicy` 等 Service，用 `@deepseek-ai/dsh-tools` 的 `defineTool` 注册工具，或通过 DSH 的 client↔host RPC 机制暴露方法给浏览器。
4. **适配 Client 半**：
   - `slots.inject` / `styles.insert` / `theme` 在正式插件里用法基本一致。
   - `host.call(...)` 需要换成 client runtime 提供的 RPC 通道（`dsh-better-sidebar` 的 `lib/client.js` 有对应写法可参考）。
5. **构建与发布**：`tsdown` / `tsc` 打包成 `lib/`，`npm publish`，或在 `package.json` 用 `file:` 本地依赖 + `dsh plugin --profile <name> add` 安装。

### 关键参考

- 已安装示例：`~/.dsh/profiles/web/node_modules/dsh-better-sidebar/`
  - `package.json` 的 `dsh.bundle.patch` 与 `dsh.client` 字段
  - `cordis.patch.yml` 的 `insert` 写法
  - `lib/index.js`（Host 半，标准 Cordis 插件 + `defineTool`）
  - `lib/client.js`（Client 半，浏览器 UI）

### 建议

可以先发布「方式 A」的源码仓库（本仓库现状），让 DSH 用户手动安装；等有人实际使用后，再按「方式 B」投入迁移，收益最明显。
