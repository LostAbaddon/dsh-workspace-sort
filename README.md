# dsh-workspace-sort

DeepSeek Harness（DSH）插件，两组能力装在一个包里。

**侧边栏**：在「按工作区」和「按工作区树」两种分组方式下，把工作区按其中**最新一条对话的时间戳降序**排列；每个工作区**显示多少条对话**可在设置里改（系统默认 5 条）；**每个工作区独立记忆模型与思考深度**，点工作区的新会话按钮时自动套用该工作区上次的选择。「单列表」模式保持 DSH 自己的排序，插件不干预。每条用户消息的时间与复制之间还有一个「修改」按钮：改写这条历史输入，插件会**分岔出新会话、发送改写后的输入、切换过去，并把原会话归档**。

**模型请求的出口**：按 Provider 决定 DSH 的模型请求走不走代理——需要翻墙才能访问的 Provider（Gemini、OpenRouter、Agnes 等）走代理，国内可直连的 Provider（DeepSeek、Kimi、MiniMax、GLM 等）保持直连。代理地址与「哪些 Provider 走代理」都在 DSH 的设置页里配置，保存即生效、不用重启。

> English: a DSH plugin with two halves. In the sidebar it orders Workspaces (Workspace and Workspace-Tree grouping) by their newest conversation, makes the per-Workspace visible conversation count configurable (default 5), remembers the last selected model and thinking depth independently for each workspace, and adds an Edit button between the timestamp and the copy button of every user message that forks a corrected conversation, sends the rewritten input, switches to it, and archives the original. On the network path it decides per provider whether LLM requests reach the network through a proxy — Gemini, OpenRouter and Agnes through it, DeepSeek, Kimi, MiniMax and GLM straight out — with the proxy URL and the provider rules configured on a Settings page that applies on save.

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

## 侧边栏

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

### 修改历史输入

每条**你自己发的**消息，其下方操作行在「时间」与「复制」之间多一个**铅笔图标按钮**（与复制按钮同尺寸、同描边的宿主图标，悬停提示「修改这条输入，其后的对话将被替换」，屏幕阅读器读作「修改这条输入」）。

1. 点「修改」，消息上方展开 Markdown 原文编辑框，预填的就是你当初发出去的内容。`Esc` 取消，`Cmd/Ctrl+Enter` 提交。
2. 改完点「提交」，确认框写明**这条输入之后有几条对话会被移除**。
3. 确认后依次完成四步：把当前回复停掉 → **分岔**一个新会话（切点在这条输入前一个事件）→ **把改写后的输入发进新会话**并执行 → **切换到新会话**，再把**原会话归档**。

结果：侧边栏里原会话的位置上出现的是新会话，里面是「历史前缀 + 修改后的输入 + 新回答」。原会话只是**归档**，随时可以从「显示已归档」里找回来。

**为什么是归档而不是删除**：DSH 的会话持久层是只追加的（契约原文 "events are contiguous from seq 0 and never rewritten"），Host 也没有任何删除单个会话的接口——`workspaceRegistry.delete` 删的是工作区，会话层面只有 `archiveSession`。归档是可逆的，删除不可逆。

**被归档的内容仍然完整留在磁盘上**（`~/.dsh/sessions/<工作区>/<会话>/session.jsonl.zstd`），也仍能被会话搜索与导出查到。

### 被拒绝的几种情况

- 目标不是你自己发的消息（注入上下文等）。
- 目标已经是当前加载窗口里看不到的更早事件——先往下滚动把它加载出来。
- 会话的第一条消息，前面没有可保留的历史。
- 当前回复停不下来（15 秒内没能进入空闲）。
- 分岔失败、或改写后的输入没能送进新会话。后者会把刚分岔出来的空会话一并归档，不留孤儿。

失败时编辑框里显示具体原因，已完成的部分不会静默留在原地。

## 代理路由

### 它解决什么问题

DSH 里同时挂了很多家模型。把代理塞进进程环境变量（`HTTPS_PROXY`）是全局的：一旦设上，DeepSeek 这类本来直连更快、更稳的请求也会被绕进代理，延迟变高，还多一层失败点。反过来不设代理，Gemini、OpenRouter 又完全用不了。

本插件把「走不走代理」变成按请求主机名判断的逐条规则，并且规则可以在界面上改，改完立即生效、不用重启。

### 判定规则

一次请求按下面的顺序判定，先命中先算：

1. 路由总开关关闭 → 直连。
2. 没填代理地址 → 直连。
3. 目标主机是本机（`localhost`、`127.0.0.1`、`::1`、`*.local`）→ 直连。
4. 目标主机命中某条主机规则 → 走代理。
5. 其余 → 直连。

主机规则来自两处，按顺序拼接：

- **Provider 行**：勾选「走代理」的 Provider 自带一组主机名。例如 Gemini 是 `generativelanguage.googleapis.com`，OpenRouter 是 `openrouter.ai` 与 `*.openrouter.ai`，Agnes 是 `apihub.agnes-ai.com`（对应其 `https://apihub.agnes-ai.com/v1` 接口）。每行还可以追加自定义主机名（内网网关、自建反代）。
- **额外主机规则**：与 Provider 无关的独立主机名条目，支持 `*` 通配。

主机名支持三种写法：精确匹配 `api.openai.com`；子域通配 `*.openrouter.ai`（不匹配裸域）；全通配 `*`。

无论配置怎么写，下面这些 Provider 永远不会走代理：`deepseek`、`deepseek-official`、`ollama`、`lmstudio`。

### 设置页

设置 → 一级页签下的「**代理路由**」页：

| 区域 | 作用 |
| --- | --- |
| 总开关 | 关掉后所有请求立即恢复直连，配置保留 |
| 代理地址 | `http://127.0.0.1:7890` 这类地址，省略协议时按 `http://` 处理；支持 `http://用户:口令@主机:端口` |
| 测试代理 | 向代理发起一次真实的 `CONNECT` 隧道握手并回报结果与耗时，不经过任何第三方探测服务 |
| Provider 列表 | 逐行勾选是否走代理；显示该行当前覆盖的主机名，可追加自定义主机名 |
| 额外主机规则 | 独立的主机名条目，可单条停用 |
| 状态行 | 当前生效的代理地址、规则条数，以及宿主是否已接管 `fetch`、最近一次错误 |

保存即落盘、立即生效。配置写在 `$DSH_HOME/workspace-sort/proxy-config.json`（原子写入），不写 profile 的 patch 层，因此升级不会冲掉它。

### 配置文件

```json
{
  "enabled": true,
  "proxyUrl": "http://127.0.0.1:7890",
  "providers": {
    "gemini": { "enabled": true, "extraHosts": [] },
    "openrouter": { "enabled": true, "extraHosts": ["openrouter.internal"] },
    "deepseek": { "enabled": false, "extraHosts": [] }
  },
  "hosts": [
    { "pattern": "*.openrouter.ai", "enabled": true, "note": "" }
  ]
}
```

装载行配置可以给一个初始值（用户第一次保存后以配置文件为准）：

```yaml
- id: workspace-sort
  name: 'dsh-workspace-sort'
  config:
    enabled: false
    proxyUrl: ''
    configPath: ''
    defaultEnabledProviders: []
    reportPath: ''
```

### 实现方式

Host 半边在进程的 `globalThis.fetch` 上装一层路由补丁。选这个接入点的原因有两条：

1. 这套 profile 里每个模型适配器最终都走 `globalThis.fetch`——pi-ai 的 OpenAI / Anthropic / Google 三条协议、DSH 自己的 DeepSeek 适配器、各家 SDK 都一样，一个口子覆盖全部。
2. pi-ai 的 Google 适配器会主动拒绝自定义 `fetch`（源码里明确判断 `options.fetch !== globalThis.fetch` 就抛错），所以没法用「给适配器塞自定义 fetch」这种更局部的办法。

命中代理规则时，请求交给 undici 的 `ProxyAgent` 走 `CONNECT` 隧道；未命中的请求原样交回进程原来的 `fetch`，不做任何包装。补丁在插件卸载时完整还原。

undici 从**运行中应用自己的** `node_modules` 解析，而不是从 profile。原因是 `fetch` 只认「装上了全局 dispatcher 的那个 undici 实例」造出来的 dispatcher：另装一份 undici 属于不同实例，它造的 `ProxyAgent` 会被 `fetch` 以 `UND_ERR_INVALID_ARG` 拒绝。同理，工作区目录安装的插件按真实路径解析模块，所以 `undici`、`@deepseek-ai/schemastery` 这类依赖不能用裸模块名导入，必须从应用目录解析。

Host 暴露的接口（供设置页与诊断使用）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/dsh-workspace-sort/proxy/state` | 配置、Provider 列表、生效主机规则、运行状态 |
| POST | `/api/dsh-workspace-sort/proxy/config` | 保存配置并立即生效 |
| POST | `/api/dsh-workspace-sort/proxy/test` | 测试代理连通性 |
| POST | `/api/dsh-workspace-sort/proxy/reset` | 恢复默认配置 |
| POST | `/api/dsh-workspace-sort/proxy/selftest` | 用一次真实请求验证路由补丁的判定 |
| GET | `/api/dsh-workspace-sort/proxy/diagnostics` | 解析结果、补丁统计、最近判定记录 |

浏览器半边的代理设置页是一个自包含的客户端模块（无构建步骤，React 通过浏览器模块表取得，不导入任何 `@deepseek-ai/dsh-client-*` 包），在 `settings.section` 槽位注册，通过上表这些接口读写配置。

### 已知边界

- 补丁按**主机名**判定，不是按「哪家 Provider 发的」。同进程里任何访问这些主机的请求都会走代理，同进程访问其它主机的请求都不会——这正是期望行为，但需要知道它不等同于「按 Provider 隔离」。
- 隧道不对目标证书做二次校验（`requestTls.rejectUnauthorized: false`）。走私有 MITM 代理时这是必要的，代价是这一层不做证书校验。
- 代理协议只支持 HTTP / HTTPS 代理，不支持 SOCKS。
- 只影响模型请求。搜索、抓取网页、MCP 连接等其它网络流量默认直连，除非它们访问的主机被显式写进规则。

## 工作方式

| 层 | 文件 | 作用 |
| --- | --- | --- |
| Host 半 | `lib/index.js` | 插件入口：装配 `fetch` 路由补丁、注册代理设置页的 HTTP 接口、声明装载行配置模式 |
| Host 半 | `lib/proxy-core.js` | 纯路由判定与配置归一化，无 I/O，可独立测试 |
| Host 半 | `lib/proxy-transport.js` | undici 解析、`ProxyAgent` 池、代理连通性探测、`fetch` 补丁 |
| Host 半 | `lib/proxy-config.js` | 代理配置文档的原子读写 |
| 浏览器半 | `lib/client.js` | 注册 `settings.general.item` 设置行与 `settings.section` 代理设置页；订阅工作区与会话快照，按最新对话时间戳计算目标顺序并调用 `ctx.get('workspaces').insertBefore` 逐项落地；对已渲染的侧边栏做条数折叠；拦截 `remote.session.selectModel` 与 `uiWorkspace.connectWorkspace` 实现按工作区记忆模型；注入「修改」按钮与就地编辑框，并编排「停机 → 分岔 → 发送 → 切换 → 归档」五步 |
| 清单 | `package.json` | `dsh.bundle.patch`（装载行）+ `dsh.client`（浏览器半）+ `exports["./client"]`，被 `dsh-client-modules` 扫描发现——无构建步骤，`lib/` 即产物 |
| 清单 | `locale/{zh,en}.json` | 插件在插件列表里的中英文标题与描述 |

## 兼容性与已知边界

- 在 **DSH 0.2.0-rc.2**（macOS 桌面端 + `dsh web`）上实测通过。侧边栏只用 `slots` / `locale` / `workspaces` / `sessions` / `uiSession` 这几个客户端服务，并以此声明 `inject`；代理设置页只用 `slots` 与 `locale`，是这两个的子集。
- 模型记忆额外需要 `uiWorkspace` 与 `remote.session`，它们**不在** `inject` 里声明，而是用 `ctx.inject` 延后挂载：缺哪个都只让这一项功能关闭（控制台打印 `... the per-Workspace model memory is off`），排序、折叠与设置行照常工作。
- Host 半声明的 `inject` 只有 `webServer`。`llm` 服务是可选的，用 `ctx.get('llm')` 读取——读不到时设置页只列出内置 Provider 列表，不影响任何路由判定。缺 `undici` 时只打印一条警告并把设置页标成「宿主未接管 fetch」，请求全部直连，profile 照常启动。
- 读服务一律走 `ctx.get(...)`，不用 `ctx.<服务名>`：Cordis 的 Context 是代理，读一个没在 `inject` 里声明的服务会**抛** `cannot get property "..." without inject`，而可选链 `?.` 挡不住抛出的取值器——一度因此让整个浏览器半挂载失败。
- 拦截服务方法时按属性种类分别处理：远程命名空间（`RemoteNamespaceService.install`）把每个方法装成**只有 getter、没有 setter** 的自有访问器，而本包是**经典脚本**（非严格模式）——对它直接赋值会被**静默丢弃**，不报错。因此这种情况改为**包裹 getter**；原型方法（`uiWorkspace.connectWorkspace`）则用自有数据属性遮蔽。用错方式的表现是「插件挂载正常、设置行也在，但模型记忆完全不生效且毫无提示」。
- 若宿主重装远程命名空间（`RemoteNamespaceService.remove()` 会删掉该包装），本插件的包装不会自动补挂；刷新窗口即可恢复。
- 刷新窗口时若「上次选中的会话」正好是一个空会话，DSH 走 `restoreSelection` 直接复用该空会话（不经过新会话按钮），本插件因此不重新套用工作区偏好。该空会话此前若已被套用过，它自己的会话记录里就带着那个模型，刷新后仍在。
- 条数折叠依赖侧边栏自身的 DOM 约定：分组节点 class 以 `_groupSection` 结尾，行与展开控件带 `data-row-key="session:<id>" / "overflow:<key>"`。DSH 若改名，排序照常工作，折叠会静默失效；启动时控制台会打印 `[dsh-workspace-sort] mounted: ...` 便于判断。
- 排序取会话列表的 `updatedAt`，所以在一个工作区里对话会让它跳到最前——这是预期行为。
- 插件不改变会话在工作区**内部**的排序，那部分由 DSH 自己的「最后更新 / 手动」选项负责。
- 修改历史输入依赖三处宿主约定：`data-chat-node-key` 的格式（`${kind.length}:${kind}${id}`，据此从 DOM 反解消息 id）、用户消息操作行的第一个 `button` 就是复制按钮、以及会话事件窗口能读到目标消息。DSH 若改其中任一处，修改按钮会静默不出现，侧边栏功能不受影响。
- 分岔的切点取「目标消息的前一个 seq」。会话 seq 从 0 连续，所以这个切点**永远是真实存在的事件**，与客户端加载了多少历史无关。切点落在目标消息所属回合的内部，宿主会在分岔时补上合成的回合与工具闭合事件。
- 「修改」功能依赖 `uiWorkspace`，它**不在** `inject` 里声明，而是用 `ctx.inject` 延后挂载：缺它只让这一项功能不挂载，排序、折叠、设置行照常工作。
- 消息行的「修改」按钮在注入时**抄走同一个操作行里宿主按钮的 class**，因此它的尺寸、灰度和悬停态完全由宿主样式表决定，插件不再声明任何颜色或背景——一旦自己声明 `background`，就会因为 `!important` 压过宿主的 `:hover` 规则而让悬停失灵。插件只做一件事：`-webkit-appearance:none`，用来关掉 macOS 给裸 `<button>` 涂的 `buttonface`，那是宿主 reset 管不到插件注入节点的唯一一处。
- 弹窗内的控件没有宿主 class 可抄，因此显式保持无底色、无边框、无阴影，悬停只换文字颜色。
- 代理设置页的样式表只用 `--dsw-*` 主题 token 与版式数字，类名一律带 `dwsp-` 前缀，随组件卸载一并移除，不触碰组件树以外的 DOM。
- 代理设置页注册在 `settings.section` 槽位（order 152，用量分组之下）。该槽位的类型由宿主的设置外壳声明，因此清单里的 `dsh.client.inject` 保留了 `@deepseek-ai/dsh-client-ui-settings` 与 `@deepseek-ai/dsh-client-ui-renderer`——它们决定激活顺序，本模块并不导入它们。

## 开发与验证

```bash
npm test              # 111 项单测：侧边栏决策、会话改写、代理判定、宿主接口、代理端到端、代理设置页
npm run test:cordis   # 真 Cordis 挂载校验
```

单测分六个文件：

- `test/core.test.mjs` —— 纯决策函数（条数折叠、排序、工作区移动计划、DOM 读行），按工作区记忆模型的读写与归属判定，以及**按 Cordis 与 DSH 的真实形状挂载整个浏览器半**。上下文替身做到了三件事：读未声明的服务直接抛错、`ctx.get(...)` 答 `undefined`、`ctx.inject(deps, cb)` 只在依赖齐备时回调；`ctx.get` 返回**每次读取新建的跟踪代理**（`cordis.original` 可取回原服务）；`remote.session.selectModel` 装成**只有 getter 的访问器**、`uiWorkspace.connectWorkspace` 放在**原型**上。模型服务缺席时浏览器半仍须挂载成功并注册设置行，这条是针对挂载失败缺陷的回归测试；访问器那条是针对「赋值被静默丢弃」缺陷的回归测试。
- `test/conversation-edit.test.mjs` —— 分岔改写历史输入的消息解析、切点计算与失败处理。
- `test/proxy-core.test.mjs` —— 纯路由判定、主机模式匹配、配置归一化与容错。
- `test/proxy-host.test.mjs` —— 宿主入口：六条路由的注册表与前缀、`fetch` 补丁装上与卸载后原样还原、保存即生效并归一化地址、永不代理的 Provider 在入口处就被拒、错误方法与坏请求体得到 405／400 而不是抛异常。配置文件写在系统临时目录下一个固定名下。
- `test/proxy-routing.test.mjs` —— 起本地源站与本地代理，验证走代理的请求确实进了代理、直连的请求代理一条都没看到、关闭开关后恢复直连、`fetch` 补丁卸载后完整还原。`DSH_WORKSPACE_SORT_PROXY_UNDICI` 只在应用外跑测试、且自动解析找不到 undici 时需要，用来指认一份已安装的 undici。
- `test/proxy-page.test.mjs` —— 用一个最小 React/hook 运行时驱动**真实产物**里的代理设置页，mock 掉宿主接口与主题。覆盖注册常量、zh/en 键位对齐、页面内不存在硬编码中文、校验与线格式、就绪／保存／重置／探测／失败各状态，以及样式表只用主题 token 且类名带 `dwsp-` 前缀。设 `DSH_THEME_TOKENS` 指向一份每行一个 `--dsw-*` token 的文件，还会核对样式表里的 token 是否都在该清单里。

真 Cordis 端到端校验（自动从 `dsh` 命令或已安装位置找 Cordis，找不到就设 `DSH_CORDIS` 指向它的 `lib/index.js`）：

```bash
node test/cordis/run.mjs
```

它把**真实浏览器半**挂到**真实 Cordis** 上，服务按出厂形状搭：远程命名空间的方法装成只有 getter 的自有访问器、`uiWorkspace.connectWorkspace` 放在原型上，单测里唯一剩下的替身（`inject` 同步回调、`effect` 普通回调）在这里被换成真实 fiber，因此它能抓到单测替身漏掉的问题——「赋值被静默丢弃」那个缺陷正是这样被它抓到的。它同时核对两个槽位的注册契约：设置行注册进 `settings.general.item`，代理设置页注册进 `settings.section`，并带上正确的 id、locale 与本地化标题。

真客户端校验（需要 3.x 以上 Chrome、一个已登录的 DSH Web 客户端与它的浏览器会话 cookie）：

```bash
DSH_COOKIE='dsh-auth-<hash>=v1.<payload>.<sig>' CDP_PORT=9333 node test/browser/run.mjs
```

它会：用假服务跑四种「分组 × 开关」组合，确认只有「按工作区」「按工作区树」且开关打开时才下发排序；再在真实渲染出的侧边栏上按 `5 / 12 / 100` 三种条数各跑一遍，核对可见条数、隐藏条数与被接管的展开控件。`DSH_COOKIE` 取自该客户端已认证会话的 cookie（名字形如 `dsh-auth-<authority 的 sha256>`），不要写进文件或提交。

## 卸载

- 桌面端：「插件」页里卸载，或先禁用。
- Web 端：`dsh plugin --profile web remove <来源>`。

工作区顺序已经写到 Host，卸载后仍保持卸载时的顺序；代理配置文档留在 `$DSH_HOME/workspace-sort/proxy-config.json`，重新安装后继续生效。

## 许可

MIT
