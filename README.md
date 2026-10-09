# dsh-workspace-sort

DeepSeek Harness（DSH）侧边栏插件：在「按工作区」和「按工作区树」两种分组方式下，把工作区按其中**最新一条对话的时间戳降序**排列；每个工作区**显示多少条对话**可在设置里改（系统默认 5 条）；并支持**每个工作区独立记忆模型与思考深度**，点击工作区的新会话按钮时自动使用该工作区上次所选的模型与思考深度作为默认项，而非全局上次所用模型。「单列表」模式保持 DSH 自己的排序，插件不干预。

> English: a DSH sidebar plugin. It orders Workspaces (Workspace and Workspace-Tree grouping) by their newest conversation, makes the per-Workspace visible conversation count configurable in Settings (default 5), and remembers the last selected model and thinking depth independently for each workspace so that clicking the workspace new-session button defaults to that workspace's own model rather than the global one. The single-list mode keeps DSH's own ordering.

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
| 独立记住模型与思考深度 | 开 | 每个工作区独自记录模型与思考深度，新建会话时作为默认项 |

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

三个设置项存在**浏览器本地**（`localStorage` 的 `dsh.workspace-sort.v1`），与 DSH 自己的视图选项 `dsh.workspace.view.v5`（分组方式 / 手动排序）同层同寿命：同一 profile 下，桌面窗口与各浏览器标签各自独立。每个工作区记住的模型存在同层的 `dsh.workspace-models.v1`。工作区顺序的写入是 **Host 级**的，同一 profile 内所有客户端共享。

### 每个工作区独立的模型与思考深度

DSH 原生只有一个全局的「上次所用模型」，新建会话永远套用它。打开本插件的开关后：

- 你在**某个工作区里**改模型或改思考深度，这次选择被记到**那个工作区**名下；
- 点某个工作区的**新会话按钮**时，该工作区记下的模型与思考深度被写进新建出来的那个会话，于是输入框上方的选择器与这一轮请求都用它——而不是全局上次所用模型；
- **某个工作区从没记录过**选择时，不干预，继续用 DSH 全局默认；
- 选中的会话**已经有对话内容**时一律不覆盖（复用空会话占位的情况会照常套用）。

判断归属按「这个会话属于哪个工作区」，先看工作区的会话成员表，再退回按路径匹配。记录与套用都走同一处：DSH 客户端改模型的唯一通道 `session.selectModel`，所以模型与思考深度一起记、一起用——思考深度只存 DSH 实际接受的那个值，模型不支持思考深度时该字段自然缺席。

> 已知副作用：DSH 的 `selectModel` 在服务端把「本会话的选择」和「全局默认」写在同一次调用里（`agentDefaultModel.saveSelection`，且不等它完成就返回）。因此套用工作区偏好时，全局默认也会跟着变成该工作区的模型。本插件不把全局默认改回去——那要经 `settings/update` 写 `agent-default-model` 条目，既需要条目命名空间与 revision，又会与上面那次「不等完成」的写入抢时序，得不偿失。工作区都没记录过时才会用到全局默认，实际影响只在「刚从有记录的工作区切到没记录的工作区」这一次。

## 工作方式

| 层 | 文件 | 作用 |
| --- | --- | --- |
| Host 半 | `lib/index.js` | 空入口，不注册服务、工具、路由与配置模式，只为让 Loader 拥有本包的装载行、从而让浏览器半被下发 |
| 浏览器半 | `lib/client.js` | 注册 `settings.general.item` 设置行；订阅工作区与会话快照，按最新对话时间戳计算目标顺序并调用 `ctx.get('workspaces').insertBefore` 逐项落地；对已渲染的侧边栏做条数折叠；拦截 `remote.session.selectModel` 与 `uiWorkspace.connectWorkspace` 实现按工作区记忆模型 |
| 清单 | `package.json` | `dsh.bundle.patch`（装载行）+ `dsh.client`（浏览器半）+ `exports["./client"]`，被 `dsh-client-modules` 扫描发现——无构建步骤，`lib/` 即产物 |

## 兼容性与已知边界

- 在 **DSH 0.2.0-rc.2**（macOS 桌面端 + `dsh web`）上实测通过。排序与折叠只用 `slots` / `locale` / `workspaces` / `sessions` / `uiSession` 这几个客户端服务，并以此声明 `inject`。
- 模型记忆额外需要 `uiWorkspace` 与 `remote.session`，它们**不在** `inject` 里声明，而是用 `ctx.inject` 延后挂载：缺哪个都只让这一项功能关闭（控制台打印 `... the per-Workspace model memory is off`），排序、折叠与设置行照常工作。
- 读服务一律走 `ctx.get(...)`，不用 `ctx.<服务名>`：Cordis 的 Context 是代理，读一个没在 `inject` 里声明的服务会**抛** `cannot get property "..." without inject`，而可选链 `?.` 挡不住抛出的取值器——一度因此让整个浏览器半挂载失败。
- 拦截服务方法时按属性种类分别处理：远程命名空间（`RemoteNamespaceService.install`）把每个方法装成**只有 getter、没有 setter** 的自有访问器，而本包是**经典脚本**（非严格模式）——对它直接赋值会被**静默丢弃**，不报错。因此这种情况改为**包裹 getter**；原型方法（`uiWorkspace.connectWorkspace`）则用自有数据属性遮蔽。用错方式的表现是「插件挂载正常、设置行也在，但模型记忆完全不生效且毫无提示」。
- 若宿主重装远程命名空间（`RemoteNamespaceService.remove()` 会删掉该包装），本插件的包装不会自动补挂；刷新窗口即可恢复。
- 刷新窗口时若「上次选中的会话」正好是一个空会话，DSH 走 `restoreSelection` 直接复用该空会话（不经过新会话按钮），本插件因此不重新套用工作区偏好。该空会话此前若已被套用过，它自己的会话记录里就带着那个模型，刷新后仍在。
- 条数折叠依赖侧边栏自身的 DOM 约定：分组节点 class 以 `_groupSection` 结尾，行与展开控件带 `data-row-key="session:<id>" / "overflow:<key>"`。DSH 若改名，排序照常工作，折叠会静默失效；启动时控制台会打印 `[dsh-workspace-sort] mounted: ...` 便于判断。
- 排序取会话列表的 `updatedAt`，所以在一个工作区里对话会让它跳到最前——这是预期行为。
- 插件不改变会话在工作区**内部**的排序，那部分由 DSH 自己的「最后更新 / 手动」选项负责。

## 开发与验证

```bash
node --test test/core.test.mjs     # 42 项单测
```

单测覆盖三块：纯决策函数（条数折叠、排序、工作区移动计划、DOM 读行）、按工作区记忆模型的读写与归属判定，以及**按 Cordis 与 DSH 的真实形状挂载整个浏览器半**。上下文替身做到了三件事：读未声明的服务直接抛错、`ctx.get(...)` 答 `undefined`、`ctx.inject(deps, cb)` 只在依赖齐备时回调；`ctx.get` 返回**每次读取新建的跟踪代理**（`cordis.original` 可取回原服务）；`remote.session.selectModel` 装成**只有 getter 的访问器**、`uiWorkspace.connectWorkspace` 放在**原型**上。模型服务缺席时浏览器半仍须挂载成功并注册设置行，这条是针对挂载失败缺陷的回归测试；访问器那条是针对「赋值被静默丢弃」缺陷的回归测试。

真 Cordis 端到端校验（自动从 `dsh` 命令或已安装位置找 Cordis，找不到就设 `DSH_CORDIS` 指向它的 `lib/index.js`）：

```bash
node test/cordis/run.mjs
```

它把**真实浏览器半**挂到**真实 Cordis** 上，服务按出厂形状搭：远程命名空间的方法装成只有 getter 的自有访问器、`uiWorkspace.connectWorkspace` 放在原型上。单测里唯一剩下的替身（`inject` 同步回调、`effect` 普通回调）在这里被换成真实 fiber，因此它能抓到单测替身漏掉的问题——「赋值被静默丢弃」那个缺陷正是这样被它抓到的。

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
