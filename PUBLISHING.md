# 发布与分发（维护者）

当前分发方式：**GitHub 仓库**（已发布：`github.com/LostAbaddon/dsh-workspace-sort`，公开，默认分支 `main`，topic `dsh-plugin`）。npm 通道暂时不走（原因见第三节），留作以后可选。

## 一、仓库与推送

本目录位于 `~/MyApps/dsh-workspace-sort`（与 `~/MyApps/ai-cli-bridge` 同一约定：自身是独立仓库，并在 `~/MyApps/.gitignore` 里被忽略，因此不会成为 MyApps 仓库的嵌套仓库）。

日常推送：

```bash
cd ~/MyApps/dsh-workspace-sort
git push
```

`lib/` 是直接提交的产物（本包无构建步骤），所以对方拿到仓库就能用，不需要装依赖或跑构建。`origin` 已是 `git@github.com:LostAbaddon/dsh-workspace-sort.git`。

别人的安装入口是 GitHub 地址（DSH 的插件入口三种来源之一）：

```
插件页 → 添加插件 → github:LostAbaddon/dsh-workspace-sort
dsh plugin --profile web add github:LostAbaddon/dsh-workspace-sort
```

能被「插件市场」搜到靠的是仓库 topic：市场搜的就是 GitHub 的 `dsh-plugin` topic（见 `dsh-plugin-marketplace` 的实现）。已加上；换机器或换仓库时补：

```bash
gh repo edit LostAbaddon/dsh-workspace-sort --add-topic dsh-plugin
```

仓库里 GitHub 建仓时自带的 `.gitignore` / `LICENSE` 已并入 `main`：LICENSE 两边内容一致（MIT，`Copyright (c) 2026 LostAbaddon`）；`.gitignore` 采用 GitHub 的 Node 模板并追加了 macOS 段（`.DS_Store`、`.AppleDouble`）。建仓时产生的 `master` 分支已删除（它的提交 `1624437` 是 `main` 的祖先，内容没丢）。

## 二、安装侧的传输坑（实测）

从 GitHub 安装时 pnpm 用 **HTTPS** 解析 git 依赖（`git ls-remote https://github.com/...`），即使你本地 git 配的是 SSH。网络只能走 SSH 时（本机就是：443 端口 75 秒超时）会报：

```
ERR_PNPM_GIT_RESOLVE_FAILED
Failed to resolve git dependency "git+https://github.com/...": git ls-remote failed
```

两种解法，都只影响本机、不改仓库记录的 URL：

```bash
# 一次性：只在这次安装里改写传输
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0='url.git@github.com:.insteadOf' \
GIT_CONFIG_VALUE_0='https://github.com/' \
dsh plugin --profile web add github:LostAbaddon/dsh-workspace-sort

# 或长期生效（pnpm 提示的做法）
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

还有一点要澄清：`dsh plugin` 在 git 安装失败时会附一句「git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed …」的**通用**提示。本包没有 `prepare`/`install` 脚本，正常情况下不需要任何 `allowBuilds` 许可——上面的安装实测 `exit 0`，没有改 `pnpm-workspace.yaml`。那句话是包装层对 git 类依赖失败的固定追注，不要被它带偏。

## 三、npm 通道（可选，需要先换名）

`dsh-workspace-sort` **在 npm 上已被占用**（2026-08-27，作者 `moonshile`，0.1.1；功能相近：工作区顺序"每日重排一次、当天保持稳定"）。直接用这个名字 `npm publish` 会 403。

已核实为空的候选：

| 候选 | 状态 |
| --- | --- |
| `dsh-workspace-recency` | 空（registry 404） |
| `dsh-sidebar-workspace-sort` | 空（registry 404） |
| `@<你的npm用户名>/dsh-workspace-sort` | 作用域名不会与占用者冲突 |

换名要同步改四处，缺一处就会"装了但找不到"：

1. `package.json` → `name`
2. `cordis.patch.yml` → `patch.insert[].name`
3. 已经装过的 profile：`$DSH_HOME/profiles/<profile>/package.json` 的 `dependencies` 键与 `dsh.profile.bundles` 条目
4. `$DSH_HOME/profiles/<profile>/node_modules/` 下的软链名（`link:` 安装时）

或者先在 profile 里卸载旧的，换名后重新装一遍。

发布：

```bash
npm login                       # 本机 ~/.npmrc 目前没有 npm 凭据，需要本人登录
npm publish --access public     # 作用域名必须显式 --access public（package.json 已声明 publishConfig）
```

发布前核对打包内容：

```bash
npm pack --dry-run
```

当前只打 6 个文件：`LICENSE`、`README.md`、`cordis.patch.yml`、`lib/client.js`、`lib/index.js`、`package.json`。`test/` 与本文档不进包（由 `files` 字段控制，`LICENSE`/`README` 由 npm 自动带上）。

## 四、两个刻意的清单选择

- **不声明 `peerDependencies`。** DSH 插件管理器会拿包里的 peer 范围与当前运行时比对，不满足就把插件标记为不兼容、**在 profile 启动时拒绝挂载**（本机 `dsh-plugin-marketplace@0.3.1` 现在就卡在这个状态，需要用户手工授予版本豁免）。本插件主机半没有任何 import、浏览器半只 `require('react')`，声明 `@deepseek-ai/cordis` 这类 peer 只会把未来的 DSH 版本变成启动阻塞，因此不声明，兼容范围写在 README 里。
- **`dsh.client.inject` 列出 `@deepseek-ai/dsh-client-locale` / `-ui-primitives` / `-ui-slots`。** 需要澄清的是：这三个包在精简组合（如 `web` profile）里**并不都是装载行**——`ui-slots` 与 `ui-primitives` 是被打进别的客户端 bundle 的库。这不影响加载：读过 `@deepseek-ai/dsh-client-modules` 的 `arriveGraphRow`，注入项是 `const dependency = this.graphRows.get(packageName); if (dependency !== void 0) …`，不在图里就**静默跳过**。所以这份清单是"互操作声明"，不是硬依赖。

## 五、发布后自检

在一个干净的 profile 上按 README 走一遍：

```bash
dsh plugin --profile web add github:LostAbaddon/dsh-workspace-sort
dsh web
```

确认：设置 → 通用 里有「工作区对话排序」；侧边栏工作区按最新对话排序；某个会话数超过设定值的工作区只显示设定条数且没有「展开其余会话」按钮；控制台出现 `[dsh-workspace-sort] mounted: ...`。
