# 发布与分发（维护者）

当前分发方式：**GitHub 仓库**。npm 通道暂时不走（原因见第二节），留作以后可选。

## 一、把目录变成可推送的仓库

本目录位于 `~/MyApps/dsh-workspace-sort`（与 `~/MyApps/ai-cli-bridge` 同一约定：自身是独立仓库，并在 `~/MyApps/.gitignore` 里被忽略，因此不会成为 MyApps 仓库的嵌套仓库）。它已经是独立的 git 仓库（`main` 分支，含首次提交），把它推到一个**新的 GitHub 仓库**即可：

```bash
cd ~/MyApps/dsh-workspace-sort
git remote add origin git@github.com:<用户名>/dsh-workspace-sort.git
git push -u origin main
```

`lib/` 是直接提交的产物（本包无构建步骤），所以对方拿到仓库就能用，不需要装依赖或跑构建。

推送后补两处元数据（可选，只影响 npm/GitHub 页面的展示）：

```json
"repository": { "type": "git", "url": "git+https://github.com/<用户名>/dsh-workspace-sort.git" },
"homepage": "https://github.com/<用户名>/dsh-workspace-sort"
```

## 二、让别人能搜到：加 topic `dsh-plugin`

DSH 生态里的「插件市场」就是搜索 GitHub 的 **`dsh-plugin`** topic（见 `dsh-plugin-marketplace` 的实现：它调用 GitHub 公开搜索 API 拉这个 topic 下的仓库）。给仓库加上这个 topic，别人才能在市场里看到它。

别人的安装命令（README 里也写了）：

```
插件页 → 添加插件 → github:<用户名>/dsh-workspace-sort
dsh plugin --profile web add github:<用户名>/dsh-workspace-sort
```

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
- **`dsh.client.inject` 列出 `@deepseek-ai/dsh-client-locale` / `-ui-primitives` / `-ui-slots`。** 这三个包在任何带侧边栏的 Web 组合里都存在；列出来既表明互操作面，也保证本插件的浏览器半在它们之后加载。

## 五、发布后自检

在一个干净的 profile 上按 README 走一遍：

```bash
dsh plugin --profile web add github:<用户名>/dsh-workspace-sort
dsh web
```

确认：设置 → 通用 里有「工作区对话排序」；侧边栏工作区按最新对话排序；某个会话数超过设定值的工作区只显示设定条数且没有「展开其余会话」按钮；控制台出现 `[dsh-workspace-sort] mounted: ...`。
