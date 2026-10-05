# dsh-workspace-sort

DeepSeek Harness（DSH）侧边栏插件：在「按工作区」和「按工作区树」两种分组方式下，把工作区按其中**最新一条对话的时间戳降序**排列；每个工作区**显示多少条对话**可在设置里改（系统默认 5 条）。「单列表」模式保持 DSH 自己的排序，插件不干预。

> English: a DSH sidebar plugin. It orders Workspaces (WorkSpace and Workspace-Tree grouping) by their newest conversation, and makes the per-Workspace visible conversation count configurable in Settings (default 5). The single-list mode keeps DSH's own ordering.

## 安装

DSH 的插件安装入口接受三种来源：**npm 包名**、**GitHub 仓库地址**、**本机目录路径**。本仓库尚未发布到 npm，用后两种。

### 桌面端（Electron 应用）

侧边栏「**插件**」页 →「**添加插件**」→ 在「包名或地址」里填：

```
github:LostAbaddon/dsh-workspace-sort
```

或先 `git clone` 到本机，再填克隆后的**绝对路径**：

```
/Users/you/code/dsh-workspace-sort
```

安装完成后按提示**重启应用**（新 bundle 在启动时挂载）。

> `dsh plugin --profile desktop ...` 会被拒绝：`desktop` profile 由 Electron 应用独占管理。

### Web 端（`dsh web`，CLI 管理的 profile）

```bash
# 任选一种来源
dsh plugin --profile web add github:LostAbaddon/dsh-workspace-sort
dsh plugin --profile web add /Users/you/code/dsh-workspace-sort
dsh plugin --profile web add dsh-workspace-sort        # 发布到 npm 之后

# 重启 dsh web 生效
```

卸载：

```bash
dsh plugin --profile web remove <安装时用的同一个来源>
```

包声明了 `dsh.bundle.patch`，所以这一条命令同时完成「装依赖 + 挂进 `dsh.profile.bundles`」，不需要手工改任何 profile 文件。

### 从 GitHub 安装失败时

pnpm 解析 git 依赖走的是 HTTPS。如果所在网络访问 github.com 只能走 SSH（HTTPS 443 不通），会看到 `ERR_PNPM_GIT_RESOLVE_FAILED` / `Failed to resolve git dependency`。按 pnpm 的提示给本机加一条传输改写再重试：

```bash
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

或者绕开 git：把仓库 `git clone` 到本机，用克隆后的**绝对路径**安装（上面两处都支持）。

> 安装失败时 `dsh plugin` 可能附带一句「git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed」。本包没有 `prepare`/`install` 脚本，正常情况下不需要任何构建许可——那句话是包装层对 git 类依赖失败的固定追注。

### npm

本插件尚未发布到 npm；发布步骤见 [PUBLISHING.md](PUBLISHING.md)（注意 npm 上的 `dsh-workspace-sort` 已被他人占用，发布前必须换名）。

## 使用

安装并刷新窗口后：**设置 → 通用 → 工作区对话排序**（位于「繁忙时的发送行为」和「性能与用量」之间）。

| 控件 | 默认 | 作用 |
| --- | --- | --- |
| 每个工作区显示 `N` 条对话 | `5` | 每个工作区**收拢时**显示 `N` 条空闲对话（1~100） |
| 工作区按最新对话排序 | 开 | 关掉后工作区恢复 DSH 自身的排列顺序 |

侧边栏本身不需要任何配置：装好即按「最新对话在最上」排；「单列表」模式不受影响。

### 折叠与展开

一个工作区的对话还有没显示出来的，收拢时该工作区对话列表的**下方**会多出一行：

| 状态 | 列表下方显示 | 点击后 |
| --- | --- | --- |
| 收拢（默认） | `还有 22 条对话` | 展开该工作区，列出全部对话 |
| 展开 | `收拢` | 收回 `N` 条 |

展开状态下，这一行留在它原来的位置（即折叠线处），后面才是被展开出来的对话；收拢状态下它位于所有已显示对话的下方。每个工作区各自独立，默认都是收拢状态，刷新后回到收拢。

工作区**自身**收起来时（点工作区标题折叠该工作区）一条对话都不显示，这行折叠提示也随之不显示；重新展开该工作区后，恢复它原来的收拢/展开状态。

### 条数口径

- 只有**空闲**对话占用配额。**正在运行**的对话、**新会话占位**的空行、**正在等待回答**的对话始终显示，不计入 `N`。
- 收拢时列表下方的数字是**这个工作区里没显示出来的对话总数**，包含系统五条上限还没来得及渲染的那些，因此可能大于列表里被收起的行数。
- `N = 5` 时默认观感与 DSH 原生一致（原生固定显示 5 条空闲对话），区别只在于多了一行可展开/收拢的折叠提示：系统自带的那行「展开其余会话」被本插件接管并隐藏。

### 排序口径

- 工作区的时间戳 = 该工作区里最新一条**普通对话**的更新时间。未命名空会话不计入；已归档对话按 DSH 默认的「隐藏归档」口径不计入。一个工作区没有这类对话时退化为它的创建时间。
- 时间戳相同时保持原有相对顺序，结果稳定可复现。
- 顺序通过 Host 的工作区顺序（`insertBefore`）落地，因此刷新、重开、换客户端都保持；代价是手动拖动工作区分组后，下一次重新排序会把它拨回按时间戳的顺序——需要固定顺序时关掉开关。
- 「单列表」模式不下发任何排序写入。

### 偏好存放位置

两个设置项存在**浏览器本地**（`localStorage` 的 `dsh.workspace-sort.v1`），与 DSH 自己的视图选项 `dsh.workspace.view.v5`（分组方式 / 手动排序）同层同寿命：同一 profile 下，桌面窗口与各浏览器标签各自独立。工作区顺序的写入是 **Host 级**的，同一 profile 内所有客户端共享。

## 工作方式

| 层 | 文件 | 作用 |
| --- | --- | --- |
| Host 半 | `lib/index.js` | 空入口，不注册服务、工具、路由与配置模式，只为让 Loader 拥有本包的装载行、从而让浏览器半被下发 |
| 浏览器半 | `lib/client.js` | 注册 `settings.general.item` 设置行；订阅工作区与会话快照，按最新对话时间戳计算目标顺序并调用 `ctx.get('workspaces').insertBefore` 逐项落地；对已渲染的侧边栏做条数折叠 |
| 清单 | `package.json` | `dsh.bundle.patch`（装载行）+ `dsh.client`（浏览器半）+ `exports["./client"]`，被 `dsh-client-modules` 扫描发现——无构建步骤，`lib/` 即产物 |

## 兼容性与已知边界

- 在 **DSH 0.2.0-rc.2**（macOS 桌面端 + `dsh web`）上实测通过。插件只使用 `slots` / `locale` / `workspaces` / `sessions` / `uiSession` 这几个客户端服务，未使用任何未公开 API。
- 条数折叠依赖侧边栏自身的 DOM 约定：分组节点 class 以 `_groupSection` 结尾，行与展开控件带 `data-row-key="session:<id>" / "overflow:<key>"`。DSH 若改名，排序照常工作，折叠会静默失效；启动时控制台会打印 `[dsh-workspace-sort] mounted: ...` 便于判断。
- 排序取会话列表的 `updatedAt`，所以在一个工作区里对话会让它跳到最前——这是预期行为。
- 插件不改变会话在工作区**内部**的排序，那部分由 DSH 自己的「最后更新 / 手动」选项负责。

## 开发与验证

```bash
node --test test/core.test.mjs     # 19 项纯逻辑单测
```

真客户端校验（需要 3.x 以上 Chrome、一个已登录的 DSH Web 客户端与它的浏览器会话 cookie）：

```bash
DSH_COOKIE='dsh-auth-<hash>=v1.<payload>.<sig>' CDP_PORT=9333 node test/browser/run.mjs
```

它会：用假服务跑四种「分组 × 开关」组合，确认只有「按工作区」「按工作区树」且开关打开时才下发排序；再在真实渲染出的侧边栏上按 `5 / 12 / 100` 三种条数各跑一遍，核对可见条数、隐藏条数与被接管的展开控件。`DSH_COOKIE` 取自该客户端已认证会话的 cookie（名字形如 `dsh-auth-<authority 的 sha256>`），不要写进文件或提交。

## 卸载

- 桌面端：「插件」页里卸载，或先禁用。
- Web 端：`dsh plugin --profile web remove <来源>`。

工作区顺序已经写到 Host，卸载后仍保持卸载时的顺序。

## 许可

MIT
