# dsh-rightclick

给 **DeepSeek Harness** 的 Web GUI 加一个右键菜单：在**对话区空白处**或**侧边栏空白处**右键，弹出上下文菜单。

```
┌─ 对话区空白处右键 ────────────┐
│  刷新                         │
│  归档                         │
│  ──────────────────────────   │
│  撤销                  Ctrl+Z │
│  重做                  Ctrl+Y │
│  复制                  Ctrl+C │
│  粘贴                  Ctrl+V │
│  ──────────────────────────   │
│  打开新对话                   │
│  打开分支对话                 │
└───────────────────────────────┘
```

这是一个 **DSH 插件 bundle**（`dsh.bundle.patch` + `dsh.client`），只含一个浏览器半模块，不依赖任何第三方包。

---

## 菜单与行为

| 分组 | 条目 | 快捷键提示 | 行为 |
|---|---|---|---|
| 动作 | 刷新 Refresh | — | 重新加载页面。装了 `dsh-desktop-web-refresh` 时先查它的 `/api/active`：**有对话在跑就拒绝并提示**（不截断运行中的对话）；接口问不到时按你的意图直接刷新 |
| | 归档 Archive | — | 归档当前会话。若会话**仍有运行中的工作**（`turn` / `subagent` / `job` / `schedule`），官方会拒绝，菜单改为提示并给出「停止并归档」（等价官方 `{ stopActivity: true }`），不静默强杀 |
| 编辑 | 撤销 Undo | `Ctrl+Z` | 输入框编辑器历史后退 |
| | 重做 Redo | `Ctrl+Y` | 输入框编辑器历史前进 |
| | 复制 Copy | `Ctrl+C` | 有选中文本 → 复制选区；否则复制当前会话最后一条助手回复的纯文本 |
| | 粘贴 Paste | `Ctrl+V` | 把剪贴板文本插入输入框光标处 |
| 会话 | 打开新对话 New conversation | — | 在当前 / 最近工作区新建会话 |
| | 打开分支对话 Branch conversation | — | 从当前会话最后一个已完成轮次分叉，并打开子会话；没有可分支轮次时提示 |

（macOS 上快捷键提示显示为 `⌘Z` 这类形式。）

**置灰条件**（灰化 + 悬停显示原因）：

| 条件 | 受影响条目 |
|---|---|
| 没有当前会话 | 归档、打开分支对话 |
| 输入框不可用 | 撤销、重做、粘贴 |
| 环境不支持读剪贴板 | 粘贴 |

**失败与二次确认**都写在菜单底部（`role="alert"`），菜单保持打开，按 `Esc` 或点别处关闭。

## 什么算「空白」

**会接管**：

- 对话消息列表里，消息之外的留白 —— 末尾消息下方的空白、内容列左右两侧的 padding 区、空会话（Hero）态的空白；
- 侧边栏会话浏览区里，不在任何会话行上的部分 —— 列表末尾下方的空白、列表容器左右的 padding、底部渐变条、空列表态上方。

**不接管**（原生右键菜单照旧）：

- 任何按钮、链接、输入框、下拉框、`contenteditable`、`role=button/menuitem/tab/...`；
- 消息气泡、工具调用行（`data-chat-*` / `data-tool`）；
- 输入框所在的 composer 座（`data-composer-seat`）；
- 侧边栏里的会话行（`data-row-key`）；
- 窗口其它任何位置。

## 操作

| 动作 | 行为 |
|---|---|
| 右键空白处 | 在光标处弹出菜单；贴到视口右/下边缘时自动内收 |
| 再次右键空白处 | 菜单移到新位置 |
| 右键非空白处 | 关闭菜单，并放行原生菜单 |
| `↑` `↓` | 在条目间移动高亮 |
| `Enter` / `Space` | 触发当前高亮条目 |
| `Esc` | 关闭 |
| 点击菜单外 | 关闭 |
| 滚动页面 / 改变窗口大小 / 窗口失焦 | 关闭 |

---

## 安装

### 作为 bundle 装进 profile

把本目录 `link:` 进目标 profile（示例用 `desktop`）：

```jsonc
// ~/.dsh/profiles/desktop/package.json
"dependencies": {
  "dsh-rightclick": "link:<本仓库绝对路径>"
},
"dsh": { "profile": { "bundles": [ ..., "dsh-rightclick" ] } }
```

改完在 `~/.dsh/profiles/desktop` 跑一次 `pnpm install`，然后**重启 DSH**（bundle 在启动时装载）。

卸载：从 `dependencies` 与 `dsh.profile.bundles` 里移除，再 `pnpm install` + 重启。

### 注意事项

- **profile 用的是 `nodeLinker: hoisted`，`pnpm install` 会重建整个 `node_modules`。** 若 registry 不可达，pnpm 会**中途失败并留下被清空的目录**。装之前先确认源可用；在国内建议：
  ```powershell
  pnpm install --registry=https://registry.npmmirror.com
  ```
  或在 `~/.npmrc` 写 `registry=https://registry.npmmirror.com`。

---

## 验证清单

1. 消息下方空白右键 → 出菜单，定位在光标处。
2. 消息气泡上右键 → 原生行为照旧。
3. 输入框里右键 → 原生菜单照旧。
4. 侧边栏会话列表下方空白右键 → 出菜单。
5. 某条会话行上右键 → 原生菜单照旧。
6. `Esc` / 点击空白 / 滚动列表 → 菜单关闭。
7. 窗口右下角附近右键 → 菜单内收，不出界。
8. 明暗主题切换 → 菜单配色跟随。
9. **刷新**：静态时点它应重载页面；有对话在跑时点它应提示「有 n 个对话正在运行，暂不能刷新」。
10. **归档**：点它后该会话从侧栏消失；若会话在跑，应提示「该会话仍有 n 项运行中的工作」并出现「停止并归档」。
11. **撤销 / 重做**：在输入框里打几个字（先不要发送），到空白处右键点撤销 → 文字应回退一步；点重做 → 恢复。
12. **复制**：先在消息里选中一段文字再右键复制 → 粘贴到别处应得到该选区；不选中直接复制 → 应得到最后一条助手回复。
13. **粘贴**：复制一段文字后，在空白处右键粘贴 → 文本应出现在输入框光标处。
14. **打开新对话**：应新建并切到一个空会话。
15. **打开分支对话**：应生成一个标题带 `(1)` 的子会话并切过去；若当前轮次未完成，应提示无法分支。
16. Console 无 `slot entry crashed in 'shell.overlay'`。

## 自检

```powershell
node scripts/check.mjs
```

校验 manifest、入口文件、locale 元数据、JS 语法，以及 Client 半的硬约束：不 require Harness Client 包、不碰文档根、ctx 服务都在 `inject` 里声明、样式只出现 `--dsw-alias-*` 主题 token、区域判定选择器未被改掉、八个动作都有实现。

---

## 实现说明

### 为什么是「自己监听 + 自绘」

- DSH **没有**通用右键菜单插槽 —— 131 个客户端 bundle 里 `onContextMenu` 零命中；现有的右键菜单在 Electron 主进程（`desktop-main.js`），客户端插件够不到。
- DSH 也**没有占用** `contextmenu` 事件，不存在 `preventDefault` 竞争；所以本插件挂 `document` 捕获阶段监听，判定不命中时一律放行，让原生菜单照旧工作。

### 落点：`shell.overlay`

菜单注册进 `shell.overlay` 槽（`list` / `root`）。这一层由 `ui-layout` 渲染成：

```css
.BynINW_overlayLayer { position: absolute; inset: 0; z-index: 20; pointer-events: none }
.BynINW_overlayLayer > * { pointer-events: auto }
```

浮层覆盖整窗、菜单可点、菜单之外的点击**穿透回页面** —— 所以「点击外部关闭」必须靠 document 监听，不能用遮罩层。

锚点与宿主的实际 DOM 结构无关的部分，靠 `closest()` 判定：

```js
// 一次性排除所有交互控件与输入区
if (el.closest('button, a, input, textarea, [role="menuitem"], [contenteditable="true"]')) return;
if (el.closest('[data-composer-seat], [data-conversation-region="composer"]')) return;

// 对话区空白：在滚动容器内，但不在任何消息 / 工具行上
if (el.closest('[data-conversation-scroll]')) {
  if (el.closest('[data-chat-anchor-key], [data-chat-flow-key], [data-chat-group-key], [data-tool]')) return;
  return 'conversation';
}

// 侧边栏空白：在会话浏览区内，但不在任何一行上
if (el.closest('[data-slot="sidebar.workspaces"]') && !el.closest('[data-row-key]')) return 'sidebar';
```

### 选择器的稳定性

只用两类锚点，**不用** CSS-module 的哈希类名（`BynINW_` / `_2H3hWW_` / `_9lTDKa_` / `xz4KEq_` 这类，跨版本必变）：

1. 框架级契约 `[data-slot="…"]` —— `ui-renderer` 给每个插槽出口都渲染一个 `div[data-slot="<key>"]{display:contents}` 锚点，宿主自己的 CSS 也在依赖它；
2. 宿主 JS 自身在用的 `data-*` 属性（`data-conversation-scroll`、`data-chat-*`、`data-row-key`、`data-tool`、`data-composer-seat`）。

`scripts/check.mjs` 里把这些选择器**钉成了契约**：上游改名会让自检先失败。

### 八个动作调了什么

| 动作 | 官方 API / 机制 |
|---|---|
| 刷新 | `window.location.reload()`；运行保护来自 `GET /plugins/dsh-desktop-web-refresh/api/active` |
| 归档 | `uiWorkspace.archiveSession(sessionId[, { stopActivity: true }])`；拒绝码 `workspace/session-active`，活动清单在 `error.rpcError.details.activity` |
| 撤销 / 重做 | 聚焦 composer 的 `contenteditable` → `document.execCommand('undo'\|'redo')`。Chromium 会转成 `beforeinput`（`inputType: historyUndo/Redo`），Lexical 在此接管编辑历史 |
| 复制 | `navigator.clipboard.writeText`，失败退到离屏 textarea + `execCommand('copy')` |
| 粘贴 | `navigator.clipboard.readText()` → 聚焦 composer → `document.execCommand('insertText', …)` |
| 打开新对话 | `uiWorkspace.startSession()` |
| 打开分支对话 | `uiWorkspace.forkSession(sessionId)` → `uiWorkspace.openSession(childId)`；不可用码 `session/fork-unavailable` |

当前会话 id 取自会话投影里 `retainedBy.mainView > 0` 的那条（与官方 `dsh-client-ui-workspace` 同款取法），取不到时退回读 DOM 的 `[data-conversation-session]`。

## 已知限制

- **撤销 / 重做是编辑器级的**，不是会话级。DSH 不存在「撤回已发送消息」的能力（会话日志是唯一事实源，且发送后会主动切断编辑器的 undo 历史）。这两个条目只作用于输入框里还没发出去的内容。
- 它们依赖已废弃的 `document.execCommand`。若某个 DSH 版本下 Lexical 不再接管该路径，菜单会提示「编辑器不支持撤销，请按 Ctrl+Z」。
- `Ctrl+Z/Y/C/V/X/A/Q/H` 是桌面壳的**保留键**，插件无法把它们注册成自己的快捷键 —— 菜单里只是提示，不是本插件注册的绑定。
- 复制的兜底取的是消息节点的 `innerText`，因此会包含消息里**可见**的文本（hover 才出现的按钮文字不计入）。
- 菜单浮层在 `shell.overlay`（`z-index:20`）内；若有 portal 到 body 的更高层弹窗打开，菜单会被它遮住。
- 选择器依赖 DSH 0.2.x 的 `data-*` 契约；上游改名会让 `scripts/check.mjs` 的选择器契约检查先失败。
