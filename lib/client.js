window.__ModuleLoader__.load({
  id: 'dsh-workspace-sort',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    /** Short alias used by the proxy-routing page; the sidebar half spells `React.createElement`. */
    const h = React.createElement

    //#region core: pure decision helpers
    /** Browser-local preference key, a sibling of the built-in `dsh.workspace.view.v5`. */
    const SETTINGS_KEY = 'dsh.workspace-sort.v1'
    /** Persisted key of the shipped sidebar browser's viewing store. */
    const VIEW_STORE_KEY = 'dsh.workspace.view.v5'
    /** The shipped browser's three viewing modes. */
    const FLAT_MODE = 'flat'
    /** CSS-module suffix of one workspace section rendered by ui-workspace. */
    const GROUP_CLASS_SUFFIX = '_groupSection'
    /** Row-key prefixes of the shipped session rows and its overflow control. */
    const SESSION_KEY_PREFIX = 'session:'
    const OVERFLOW_KEY_PREFIX = 'overflow:'
    /** Upper bound of the configurable per-workspace count. */
    const MAX_VISIBLE = 100
    /** Persisted key of the per-workspace model and thinking preferences. */
    const WORKSPACE_MODELS_KEY = 'dsh.workspace-models.v1'

    /** Shipped defaults: the built-in hardcodes five idle conversations per Workspace. */
    const DEFAULT_SETTINGS = { visiblePerWorkspace: 5, sortWorkspaces: true, rememberWorkspaceModel: true }

    /** Clamp one user-supplied count into the accepted range. */
    function normalizeLimit(value) {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
      if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.visiblePerWorkspace
      const whole = Math.trunc(parsed)
      if (whole < 1) return 1
      return whole > MAX_VISIBLE ? MAX_VISIBLE : whole
    }

    /** Fold a stored/partial preference document into a complete settings object. */
    function normalizeSettings(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        visiblePerWorkspace: normalizeLimit(source.visiblePerWorkspace),
        sortWorkspaces: source.sortWorkspaces !== false,
        rememberWorkspaceModel: source.rememberWorkspaceModel !== false,
      }
    }

    /** Validate and normalize one model preference entry. */
    function normalizeModelPreference(raw) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
      if (typeof raw.provider !== 'string' || raw.provider.trim() === '') return null
      if (typeof raw.model !== 'string' || raw.model.trim() === '') return null
      const entry = {
        provider: raw.provider.trim(),
        model: raw.model.trim(),
      }
      if (typeof raw.reasoningEffort === 'string' && raw.reasoningEffort.trim() !== '') {
        entry.reasoningEffort = raw.reasoningEffort.trim()
      }
      if (Number.isFinite(raw.updatedAt)) {
        entry.updatedAt = raw.updatedAt
      }
      return entry
    }

    /** Load all workspace model preferences from local storage. */
    function loadWorkspaceModels(storage) {
      try {
        const raw = storage?.getItem(WORKSPACE_MODELS_KEY)
        if (raw === null || raw === undefined) return {}
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const result = {}
        for (const [id, value] of Object.entries(parsed)) {
          const normalized = normalizeModelPreference(value)
          if (normalized !== null) result[id] = normalized
        }
        return result
      } catch (_unread) {
        return {}
      }
    }

    /** Persist all workspace model preferences to local storage. */
    function saveWorkspaceModels(storage, map) {
      try {
        storage?.setItem(WORKSPACE_MODELS_KEY, JSON.stringify(map))
      } catch (_unwritable) {
        /* ignore storage failures */
      }
    }

    /** Read one workspace's remembered model selection. */
    function getWorkspaceModel(storage, workspaceId) {
      if (typeof workspaceId !== 'string' || workspaceId === '') return null
      const map = loadWorkspaceModels(storage)
      return map[workspaceId] ?? null
    }

    /** Record one workspace's model selection and persist it. */
    function setWorkspaceModel(storage, workspaceId, selection) {
      if (typeof workspaceId !== 'string' || workspaceId === '') return
      const normalized = normalizeModelPreference({
        ...selection,
        updatedAt: Date.now(),
      })
      if (normalized === null) return
      const map = loadWorkspaceModels(storage)
      map[workspaceId] = normalized
      saveWorkspaceModels(storage, map)
    }

    /** Resolve the owning workspace id for a session, checking sessionIds first and cwd as fallback. */
    function resolveSessionWorkspaceId(sessionId, workspaces, sessionsById) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      const list = Array.isArray(workspaces) ? workspaces : []
      for (const workspace of list) {
        if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) {
          return workspace.workspaceId
        }
      }
      const summary = sessionsById?.[sessionId]
      if (typeof summary?.cwd === 'string' && summary.cwd !== '') {
        for (const workspace of list) {
          if (workspace?.path === summary.cwd) {
            return workspace.workspaceId
          }
        }
      }
      return null
    }

    /** Timestamp of the newest conversation a Workspace holds, ignoring blanks. */
    function workspaceRecency(workspace, sessionsById, archivedIds) {
      const sessionIds = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
      let newestConversation = Number.NEGATIVE_INFINITY
      let newestAny = Number.NEGATIVE_INFINITY
      for (const id of sessionIds) {
        const summary = sessionsById?.[id]
        if (summary === undefined) continue
        const stamp = Number.isFinite(summary.updatedAt) ? summary.updatedAt : 0
        if (stamp > newestAny) newestAny = stamp
        if (summary.blank === true) continue
        if (archivedIds !== undefined && archivedIds.has(id)) continue
        if (stamp > newestConversation) newestConversation = stamp
      }
      if (newestConversation !== Number.NEGATIVE_INFINITY) return newestConversation
      if (newestAny !== Number.NEGATIVE_INFINITY) return newestAny
      const created = Date.parse(workspace?.createdAt ?? '')
      return Number.isFinite(created) ? created : 0
    }

    /**
     * Order Workspace ids by their newest conversation, newest first.
     * Workspaces without a conversation fall back to their creation time, and a
     * tie keeps the caller's relative order (a stable, deterministic sort).
     */
    function sortWorkspacesByRecency(workspaces, sessionsById, archivedIds) {
      const rows = (Array.isArray(workspaces) ? workspaces : []).map((workspace, index) => ({
        workspaceId: workspace.workspaceId,
        rank: workspaceRecency(workspace, sessionsById, archivedIds),
        index,
      }))
      rows.sort((left, right) => {
        if (left.rank !== right.rank) return right.rank - left.rank
        return left.index - right.index
      })
      return rows.map((row) => row.workspaceId)
    }

    /** Insert `id` before `beforeId` in a copy of `ids`, mirroring the Host's own rule. */
    function insertIdBefore(ids, id, beforeId) {
      const at = ids.indexOf(id)
      if (at === -1) return [...ids]
      if (beforeId === id) return [...ids]
      const anchor = beforeId === undefined ? -1 : ids.indexOf(beforeId)
      if (beforeId !== undefined && anchor === -1) return [...ids]
      const without = ids.filter((candidate) => candidate !== id)
      const position = beforeId === undefined ? without.length : without.indexOf(beforeId)
      return [...without.slice(0, position), id, ...without.slice(position)]
    }

    /** The ordered `insertBefore` moves that turn `current` into `desired`. */
    function planWorkspaceMoves(current, desired) {
      const moves = []
      if (current.length !== desired.length) return moves
      let order = [...current]
      for (let index = 0; index < desired.length; index += 1) {
        const target = desired[index]
        const occupant = order[index]
        if (occupant === target) continue
        if (!order.includes(target) || occupant === undefined) return moves
        moves.push({ workspaceId: target, beforeWorkspaceId: occupant })
        order = insertIdBefore(order, target, occupant)
      }
      return moves
    }

    /**
     * Decide which rendered conversation rows a Workspace keeps visible.
     * Blank, running and interaction-pending rows never consume the quota and
     * are never folded away, exactly like the shipped overflow control's rule.
     * @param rows - `{ sessionId, row, wrapper }` entries from {@link directGroupRows}.
     * @param limit - conversations kept per Workspace.
     * @param isIdle - predicate deciding whether one row consumes the quota.
     * @returns each input entry with the hide decision for its DOM node.
     */
    function planVisibleRows(rows, limit, isIdle) {
      let idleSeen = 0
      return rows.map((entry) => {
        const idle = isIdle(entry.sessionId) === true
        if (!idle) return { entry, hidden: false }
        idleSeen += 1
        return { entry, hidden: idleSeen > limit }
      })
    }

    /** Read the sidebar browser's current grouping mode from its persisted store. */
    function readGroupBy(storage) {
      try {
        const raw = storage?.getItem(VIEW_STORE_KEY)
        if (raw === null || raw === undefined) return 'workspace'
        const parsed = JSON.parse(raw)
        const mode = parsed?.groupBy
        return typeof mode === 'string' ? mode : 'workspace'
      } catch (_unreadableViewStore) {
        return 'workspace'
      }
    }

    /** Read the sidebar browser's archived-row filter from the same store. */
    function readArchivedFilter(storage) {
      try {
        const raw = storage?.getItem(VIEW_STORE_KEY)
        if (raw === null || raw === undefined) return 'default'
        const parsed = JSON.parse(raw)
        const filter = parsed?.archivedFilter
        return filter === 'show' || filter === 'only' ? filter : 'default'
      } catch (_unreadableViewStore) {
        return 'default'
      }
    }

    /**
     * The conversations one section actually lists, in the shipped browser's own
     * terms: subagent children stay hidden, only the selected blank row counts,
     * and archived rows follow the visible filter.
     * @param input - member ids plus the current history snapshot and filter.
     * @returns member ids in their given order.
     */
    function visibleConversationIds(input) {
      const archived = input.archivedIds ?? new Set()
      const filter = input.archivedFilter ?? 'default'
      return (input.sessionIds ?? []).filter((id) => {
        const session = input.sessionsById?.[id]
        if (session === undefined) return false
        if (session.origin === 'subagent') return false
        if (session.blank === true && id !== input.currentId) return false
        if (filter === 'only') return archived.has(id)
        if (filter === 'default' && archived.has(id)) return false
        return true
      })
    }

    /**
     * How many conversations a section keeps out of sight at the collapsed count.
     * Only idle rows fold, matching {@link planVisibleRows}.
     * @param ids - visible conversation ids of one section.
     * @param limit - conversations shown while collapsed.
     * @param isIdle - predicate deciding whether one row can fold away.
     * @returns the count of conversations hidden below the fold, never negative.
     */
    function hiddenConversationCount(ids, limit, isIdle) {
      const idle = (ids ?? []).filter((id) => isIdle(id) === true).length
      return Math.max(0, idle - limit)
    }
    //#endregion

    //#region core: value store, storage access and DOM helpers
    /** One immutable snapshot plus listeners, enough for React and for the fold pass. */
    function createValueStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          snapshot = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /** Read preferences, tolerating a storage that is absent or refuses reads. */
    function loadSettings(storage) {
      try {
        const raw = storage?.getItem(SETTINGS_KEY)
        if (raw === null || raw === undefined) return { ...DEFAULT_SETTINGS }
        return normalizeSettings(JSON.parse(raw))
      } catch (_unreadableSettings) {
        return { ...DEFAULT_SETTINGS }
      }
    }

    /** Persist preferences; a refusing storage costs durability, never the session. */
    function saveSettings(storage, settings) {
      try {
        storage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch (_unwritableSettings) {
        /* keep the in-memory value */
      }
    }

    /** True when one element carries a CSS-module class with the given suffix. */
    function hasClassSuffix(element, suffix) {
      const className = element?.className
      if (typeof className !== 'string' || className === '') return false
      return className.split(/\s+/).some((name) => name.endsWith(suffix))
    }

    /** The element carrying a row key directly under `parent`, if any. */
    function directRowChild(parent) {
      if (parent?.hasAttribute?.('data-row-key') === true) return parent
      for (const child of parent?.children ?? []) {
        if (child.hasAttribute?.('data-row-key') === true) return child
      }
      return null
    }

    /**
     * The rows and the overflow control belonging to ONE workspace section.
     * Nested workspace sections (Workspace Tree mode) live inside a
     * `[role=group]` child, so only direct children are considered.
     */
    function directGroupRows(group) {
      const rows = []
      let overflow = null
      for (const child of group?.children ?? []) {
        if (child.getAttribute?.('role') === 'group') continue
        const row = directRowChild(child)
        if (row === null || row === undefined) continue
        const key = row.getAttribute('data-row-key')
        if (typeof key !== 'string') continue
        if (key.startsWith(SESSION_KEY_PREFIX)) rows.push({ sessionId: key.slice(SESSION_KEY_PREFIX.length), row, wrapper: child })
        else if (key.startsWith(OVERFLOW_KEY_PREFIX)) overflow = { row, wrapper: child }
      }
      return { rows, overflow }
    }

    /** Hide or restore one element without disturbing React-owned layout styles. */
    function setHidden(element, hidden) {
      if (element === null || element === undefined || element.style === undefined) return
      element.style.display = hidden ? 'none' : ''
    }

    /** The workspace sections rendered inside one sidebar region. */
    function groupSectionsOf(region) {
      if (region === null || region === undefined) return []
      return [...region.querySelectorAll('[class*="' + GROUP_CLASS_SUFFIX + '"]')]
        .filter((element) => hasClassSuffix(element, GROUP_CLASS_SUFFIX))
    }
    //#endregion

    //#region core: service interception
    /** Cordis keeps the unwrapped service behind this globally registered symbol. */
    const CORDIS_ORIGINAL = Symbol.for('cordis.original')

    /**
     * The plain service object behind the Context's tracking proxy.
     * Interception targets that object so the service's own nested calls and
     * every other reader of the same service observe the change alike.
     * @param service - a service read off a Context, or anything else.
     * @returns the unwrapped service, or the input when it cannot be unwrapped.
     */
    function unwrapService(service) {
      if (service === null || service === undefined) return service
      try {
        return service[CORDIS_ORIGINAL] ?? service
      } catch (_unreadableOriginal) {
        return service
      }
    }

    /**
     * Replace one method on a service object.
     *
     * The two shapes a Client service presents need different handling. A
     * remote namespace installs every method as an OWN GETTER with no setter
     * (`RemoteNamespaceService.install`), and this bundle loads as a classic
     * sloppy-mode script — where `service[method] = wrapper` on such a property
     * is dropped without a word. Its getter is therefore wrapped in place. A
     * prototype method, by contrast, is shadowed by an own data property.
     *
     * @param service - the plain service object to patch.
     * @param method - the method name to intercept.
     * @param wrap - receives the method in place and returns its replacement.
     * @returns the teardown that restores the exact property that was there.
     */
    function interceptMethod(service, method, wrap) {
      const original = Object.getOwnPropertyDescriptor(service, method)
      const getter = original === undefined ? undefined : original.get
      if (typeof getter === 'function' && original.set === undefined) {
        Object.defineProperty(service, method, { ...original, get: () => wrap(getter.call(service)) })
      } else {
        const replacement = {
          configurable: true,
          enumerable: original === undefined ? true : original.enumerable === true,
          writable: true,
          value: wrap(service[method]),
        }
        try {
          Object.defineProperty(service, method, replacement)
        } catch (_unredefinable) {
          service[method] = replacement.value
        }
      }
      return () => {
        if (original === undefined) Reflect.deleteProperty(service, method)
        else Object.defineProperty(service, method, original)
      }
    }
    //#endregion

    //#region browser half: settings row
    const NS = 'workspaceSort'

    const zh = {
      'settings.title': '工作区对话排序与模型记忆',
      'settings.description': '按每个工作区里最新的对话时间戳，为工作区（含工作区树）降序排列；并支持各工作区独立记忆上次所选的模型与思考深度。',
      'settings.countLabel': '每个工作区显示',
      'settings.countSuffix': '条对话',
      'settings.countHint': '系统默认 5 条。超出部分折叠在对话列表下方，收拢时显示还剩多少条，点击展开全部、再点击收拢。',
      'settings.sortLabel': '工作区按最新对话排序',
      'settings.sortHint': '关闭后工作区恢复为系统自身的排列顺序。',
      'settings.modelLabel': '独立记住模型与思考深度',
      'settings.modelHint': '每个工作区独自记录上次所选的模型和思考深度，新建会话时自动作为默认项。',
      'fold.remaining': '还有 {n} 条对话',
      'fold.collapse': '收拢',
    }

    const en = {
      'settings.title': 'Workspace conversation order and model memory',
      'settings.description': 'Sorts Workspaces (and Workspace Tree sections) newest conversation first, and remembers last selected model and thinking depth per workspace.',
      'settings.countLabel': 'Show',
      'settings.countSuffix': 'conversations per Workspace',
      'settings.countHint': 'The system default is 5. Further conversations stay folded under the list: the collapsed line reports how many remain, and clicking it expands everything and then collapses it again.',
      'settings.sortLabel': 'Sort Workspaces by newest conversation',
      'settings.sortHint': 'Turn this off to restore the system’s own Workspace order.',
      'settings.modelLabel': 'Remember model per workspace',
      'settings.modelHint': 'Each workspace remembers its last selected model and thinking depth as default for new sessions.',
      'fold.remaining': '{n} more conversations',
      'fold.collapse': 'Collapse',
    }

    const STYLE_ID = 'dsh-workspace-sort/settings-row.css'
    const css = [
      // The row wraps rather than squeezing: `.dws-text` owns a real flex basis
      // so it can never collapse into a one-character column, and the controls
      // drop onto their own line when the panel is too narrow to hold both.
      '.dws-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dws-text{flex:1 1 280px;min-width:0}',
      '.dws-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dws-description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dws-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px 20px;flex:0 1 auto;min-width:0}',
      '.dws-field{display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dws-input{width:56px;padding:2px 6px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-elevated-fill,#0000);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:right}',
      '.dws-hint{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));overflow-wrap:anywhere}',
      '.dws-toggle{display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dws-fold{box-sizing:border-box;display:block;width:100%;height:28px;padding:0 12px 0 calc(28px + var(--dsh-workspace-indent,0px));border:none;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;text-align:left;font-size:12px;line-height:28px}',
      '.dws-fold:hover{color:var(--dsw-alias-label-secondary)}',
    ].join('')

    /** Insert our stylesheet once per document, keyed like a shipped client bundle. */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspace-sort'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /** One General-settings row: the visible count plus the Workspace sort switch. */
    function WorkspaceSortSettingsRow(props) {
      const t = props.t
      const store = props.settings
      const update = props.update
      const [snapshot, setSnapshot] = React.useState(store.getSnapshot())
      const [draft, setDraft] = React.useState(String(store.getSnapshot().visiblePerWorkspace))

      React.useEffect(() => store.subscribe(() => {
        const next = store.getSnapshot()
        setSnapshot(next)
        setDraft(String(next.visiblePerWorkspace))
      }), [store])

      const commitCount = (value) => {
        setDraft(value)
        const parsed = Number.parseInt(value, 10)
        if (!Number.isFinite(parsed)) return
        update({ visiblePerWorkspace: normalizeLimit(parsed) })
      }

      return React.createElement('div', { className: 'dws-row' }, [
        React.createElement('div', { className: 'dws-text', key: 'text' }, [
          React.createElement('div', { className: 'dws-title', key: 'title' }, t('settings.title')),
          React.createElement('div', { className: 'dws-description', key: 'description' }, t('settings.description')),
          React.createElement('div', { className: 'dws-hint', key: 'hint' }, t('settings.countHint')),
        ]),
        React.createElement('div', { className: 'dws-controls', key: 'controls' }, [
          React.createElement('label', { className: 'dws-field', key: 'count' }, [
            React.createElement('span', { key: 'label' }, t('settings.countLabel')),
            React.createElement('input', {
              key: 'input',
              className: 'dws-input',
              type: 'number',
              min: 1,
              max: MAX_VISIBLE,
              step: 1,
              value: draft,
              'aria-label': t('settings.countLabel'),
              onChange: (event) => commitCount(event.target.value),
              onBlur: () => setDraft(String(snapshot.visiblePerWorkspace)),
            }),
            React.createElement('span', { key: 'suffix' }, t('settings.countSuffix')),
          ]),
          React.createElement('label', { className: 'dws-toggle', key: 'toggle' }, [
            React.createElement('input', {
              key: 'box',
              type: 'checkbox',
              checked: snapshot.sortWorkspaces,
              'aria-label': t('settings.sortLabel'),
              onChange: (event) => update({ sortWorkspaces: event.target.checked }),
            }),
            React.createElement('span', { key: 'text' }, t('settings.sortLabel')),
          ]),
          React.createElement('label', { className: 'dws-toggle', key: 'modelToggle' }, [
            React.createElement('input', {
              key: 'modelBox',
              type: 'checkbox',
              checked: snapshot.rememberWorkspaceModel,
              'aria-label': t('settings.modelLabel'),
              onChange: (event) => update({ rememberWorkspaceModel: event.target.checked }),
            }),
            React.createElement('span', { key: 'text' }, t('settings.modelLabel')),
          ]),
        ]),
      ])
    }
    //#endregion

    //#region core: conversation-history edit (fork based)
    /** Locale namespace owned by the edit half. */
    const EDIT_NS = 'workspaceSortEdit'
    /** The shipped user-message context kind, whose nodes carry a message id. */
    const INPUT_MESSAGE_KIND = 'input-message'
    /** Rendered conversation rows, in document order. */
    const FLOW_ROW_SELECTOR = '[data-chat-flow-key]'
    /** Rows that are user bubbles rather than assistant ones. */
    const USER_ROW_SELECTOR = '[data-chat-flow-kind="user"]'
    /** The action row a user bubble renders, identified by its clock side. */
    const ACTION_ROW_SELECTOR = '[data-clock="start"]'
    /** Conversation occurrences carry the session id they render. */
    const OCCURRENCE_SELECTOR = '[data-conversation-session]'
    /** Marker attribute on the injected row edit button, used to skip re-injecting. */
    const EDIT_BUTTON_ATTR = 'data-ws-edit'
    /** Marker attribute on every icon-only control this half adds. */
    const ICON_BUTTON_ATTR = 'data-ws-icon'
    /** Marker attribute on the edit dialog's scrim. */
    const EDIT_DIALOG_ATTR = 'data-ws-edit-dialog'
    /** Marker attribute on the dialog's card. */
    const EDIT_DIALOG_CARD_ATTR = 'data-ws-edit-card'
    /** How long the submit waits for a running turn to stop. */
    const EDIT_IDLE_TIMEOUT_MS = 15000
    /** How long the button scanner waits after a DOM change before it runs. */
    const EDIT_SCAN_DELAY_MS = 60

    /** Chinese dictionary for the edit half. */
    const editZh = {
      'action.edit': '修改这条输入',
      'action.title': '修改这条输入，其后的对话将被替换',
      'dialog.title': '修改这条输入',
      'dialog.count': '这条输入之后的 {count} 条对话会被移除',
      'dialog.placeholder': '用 Markdown 原文改写这条输入',
      'panel.submit': '提交',
      'panel.cancel': '取消',
      'panel.empty': '改写后的内容不能为空',
      'confirm.title': '确认修改这条输入？',
      'confirm.count': '这条输入之后的 {count} 条对话将被移除，原会话会被归档。',
      'confirm.note': '原会话只是归档，随时可以取消归档找回来；修改后的输入会立刻发送。',
      'stage.stopping': '正在停止当前回复…',
      'stage.forking': '正在分岔会话…',
      'stage.prompting': '正在发送修改后的输入…',
      'stage.opening': '正在切换到新会话…',
      'stage.archiving': '正在归档原会话…',
      'error.noChannel': '这个会话没有可用的通道',
    }
    /** English dictionary for the edit half, checked complete against the zh key set. */
    const editEn = {
      'action.edit': 'Edit this input',
      'action.title': 'Rewrite this input and replace everything after it',
      'dialog.title': 'Edit this input',
      'dialog.count': 'The following {count} messages will be removed',
      'dialog.placeholder': 'Rewrite this input as Markdown source',
      'panel.submit': 'Submit',
      'panel.cancel': 'Cancel',
      'panel.empty': 'The rewritten text cannot be empty',
      'confirm.title': 'Confirm the edit?',
      'confirm.count': 'The following {count} messages will be removed and the original conversation archived.',
      'confirm.note': 'Archiving is reversible. The rewritten input is sent immediately.',
      'stage.stopping': 'Stopping the current reply…',
      'stage.forking': 'Forking the conversation…',
      'stage.prompting': 'Sending the rewritten input…',
      'stage.opening': 'Opening the new conversation…',
      'stage.archiving': 'Archiving the original conversation…',
      'error.noChannel': 'this conversation has no usable channel',
    }

    /**
     * Recover the message id from one rendered row's conversation node key.
     * The key is `${kind.length}:${kind}${id}` (dsh-client-ui-conversation).
     * @param {unknown} raw - a `data-chat-node-key` attribute value.
     * @returns {string | undefined} the message id, or undefined when the row is not a user message.
     */
    function parseChatNodeKey(raw) {
      if (typeof raw !== 'string') return undefined
      const separator = raw.indexOf(':')
      if (separator <= 0) return undefined
      const length = Number.parseInt(raw.slice(0, separator), 10)
      if (!Number.isSafeInteger(length) || length <= 0) return undefined
      if (raw.slice(separator + 1, separator + 1 + length) !== INPUT_MESSAGE_KIND) return undefined
      const id = raw.slice(separator + 1 + length)
      return id === '' ? undefined : id
    }

    /**
     * Concatenate a user message's text blocks back into Markdown source.
     * @param {unknown} content - the message `content` array.
     * @returns {string} the original text, empty when the message carried only attachments.
     */
    function messageTextOf(content) {
      if (!Array.isArray(content)) return ''
      return content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
    }

    /**
     * Pull the durable events out of one session event window.
     * The window is paginated and also carries assistant stream transients.
     * @param {unknown} window - a `SessionEventWindow` snapshot.
     * @returns {object[]} its session events.
     */
    function windowEvents(window) {
      const entries = window?.entries
      if (!Array.isArray(entries)) return []
      return entries.filter((entry) => entry?.type === 'event' && entry.event !== null && typeof entry.event === 'object').map((entry) => entry.event)
    }

    /**
     * Count the conversation messages an edit would remove, for the confirm dialog.
     * @param {object[]} events - the window's session events.
     * @param {number} fromSeq - the edited message's sequence, inclusive.
     * @returns {number} how many user and assistant messages sit at or after it.
     */
    function countRemovedMessages(events, fromSeq) {
      let count = 0
      for (const event of events) {
        if (event.seq < fromSeq) continue
        if (event.type === 'user/message' || event.type === 'assistant/message') count += 1
      }
      return count
    }

    /**
     * Plan the fork that carries an edited message.
     *
     * `sessions.fork` takes an inclusive cut, and session seqs are contiguous
     * from 0, so the event immediately before the target is always a real seq —
     * which makes the plan independent of how much of the log the client has
     * loaded. A cut landing inside the target's own turn is what the Host
     * balances with its synthetic turn and tool closers.
     *
     * @param {object[]} events - the window's session events.
     * @param {string} messageId - the durable message identity of the edited row.
     * @returns {{ ok: true, atSeq: number, targetSeq: number, removed: number } | { ok: false, reason: string }} the plan, or a refusal.
     */
    function planForkEdit(events, messageId) {
      const found = events.find((event) => event.type === 'user/message' && String(event.data?.id) === messageId)
      if (found === undefined) return { ok: false, reason: '这条输入不在当前加载的对话里，先往下滚动再试' }
      if (found.surfaceOp !== 'append') return { ok: false, reason: '这条输入已经被更早的一次修改取代' }
      if (found.data?.source?.kind !== 'user') return { ok: false, reason: '只能修改你自己发送的输入' }
      if (!Number.isSafeInteger(found.seq) || found.seq < 1) return { ok: false, reason: '这是会话的第一条消息，前面没有可保留的历史' }
      return {
        ok: true,
        atSeq: found.seq - 1,
        targetSeq: found.seq,
        removed: countRemovedMessages(events, found.seq),
      }
    }

    /** One readable reason out of anything thrown by the remote calls. */
    function reasonOf(error) {
      if (error === null || error === undefined) return ''
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message !== '') return error.message
      if (typeof error.error?.message === 'string') return error.error.message
      return String(error)
    }

    /**
     * Wait until one session has no running turn.
     * @param {object} session - a bound `ISession`.
     * @param {number} timeoutMs - give up after this long.
     * @returns {Promise<boolean>} whether it went idle.
     */
    function waitForIdle(session, timeoutMs = EDIT_IDLE_TIMEOUT_MS) {
      if (session?.getSnapshot?.()?.running !== true) return Promise.resolve(true)
      return new Promise((resolve) => {
        let dispose = null
        const finish = (ok) => {
          clearTimeout(timer)
          if (typeof dispose === 'function') dispose()
          resolve(ok)
        }
        const timer = setTimeout(() => finish(false), timeoutMs)
        dispose = session.subscribe(() => {
          if (session.getSnapshot?.()?.running !== true) finish(true)
        })
      })
    }

    /**
     * Replace one user message and everything after it, in place from the user's side.
     *
     * Forks a new conversation from the event right before the target, sends the
     * rewritten text into it, switches to it, and archives the original so the
     * sidebar shows one conversation in the original's place. The original is
     * archived rather than deleted because the Session persistence contract is
     * append-only and the Host exposes no way to remove a session.
     *
     * @param {{ sessions: object, uiWorkspace: object }} deps - the two client services.
     * @param {{ sessionId: string, messageId: string, text: string, onStage?: (stage: string) => void }} request - the edit.
     * @returns {Promise<{ ok: true, childId: string, removed: number, warning?: string } | { ok: false, reason: string }>} the outcome.
     */
    async function editViaFork(deps, request) {
      const { sessions, uiWorkspace } = deps
      const { sessionId, messageId, text, onStage } = request
      const body = typeof text === 'string' ? text.trim() : ''
      if (body === '') return { ok: false, reason: '改写后的内容不能为空' }
      const binding = sessions.binding(sessionId)
      if (binding === undefined) return { ok: false, reason: '这个会话没有可用的通道' }

      const plan = planForkEdit(windowEvents(binding.eventSource?.getSnapshot?.()), messageId)
      if (!plan.ok) return plan

      if (binding.session?.getSnapshot?.()?.running === true) {
        onStage?.('stopping')
        await Promise.resolve(binding.session.cancel()).catch(() => {})
        if (!await waitForIdle(binding.session)) return { ok: false, reason: '当前回复没有停下来，请稍后重试' }
      }

      onStage?.('forking')
      let childId
      try {
        // `increaseTitle` would append a suffix to the inherited title; the original
        // is archived a moment later, so the fork simply keeps the same name.
        childId = await sessions.fork({ sessionId, atSeq: plan.atSeq, increaseTitle: false })
      } catch (error) {
        return { ok: false, reason: `分岔失败：${reasonOf(error)}` }
      }

      onStage?.('prompting')
      let sent
      try {
        sent = await sessions.using(childId, { source: 'controllerOperation' }, async (reference) => {
          const session = reference?.session ?? sessions.binding(childId)?.session
          if (session === undefined || typeof session.prompt !== 'function') throw new Error('the forked conversation has no prompt channel')
          return session.prompt([{ type: 'text', text: body }], 'queue')
        })
      } catch (error) {
        sent = { ok: false, error: { message: reasonOf(error) } }
      }
      if (sent?.ok !== true) {
        await Promise.resolve(uiWorkspace.archiveSession(childId)).catch(() => {})
        return { ok: false, reason: `把修改后的输入送进新会话失败：${sent?.error?.message ?? '未知原因'}` }
      }

      onStage?.('opening')
      uiWorkspace.openSession(childId)
      onStage?.('archiving')
      try {
        await uiWorkspace.archiveSession(sessionId, { stopActivity: true })
      } catch (error) {
        return { ok: true, childId, removed: plan.removed, warning: `新会话已就绪，但原会话归档失败：${reasonOf(error)}` }
      }
      return { ok: true, childId, removed: plan.removed }
    }

    /** Styles owned by the edit half; every rule is a host theme token. */
    // The row button borrows the host's own action-button class at injection time,
    // so its geometry, colour and hover belong to the host's stylesheet and nothing
    // is declared for them here. The only thing left is the one property the host's
    // reset cannot reach on a node this half injects: macOS paints a bare <button>
    // with `buttonface`, which `-webkit-appearance: none` turns off. The dialog is
    // built outside React and styles itself inline instead.
    const FILL_OFF = '-webkit-appearance:none !important;appearance:none !important'
    const EDIT_CSS = [
      `button[${ICON_BUTTON_ATTR}]{box-sizing:border-box !important;${FILL_OFF}}`,
      `button[${ICON_BUTTON_ATTR}] svg{pointer-events:none}`,
    ].join('')
    //#endregion

    //#region browser half: conversation-history edit
    /**
     * Build the edit button's icon.
     *
     * The Harness Client package that owns this artwork cannot be required from
     * a plugin half, so the shipped `IconEditOutlineRegular` paths are inlined
     * verbatim — same 16px viewBox, same one-pixel stroke, so the button reads
     * as one of the host's own icon buttons.
     *
     * @returns {SVGElement} the icon, sized by the stylesheet.
     */
    function iconSvg(paths, size = 16) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('width', String(size))
      svg.setAttribute('height', String(size))
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('stroke-width', '1')
      for (const [d, mode] of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', d)
        if (mode === 'fill') path.setAttribute('fill', 'currentColor')
        else path.setAttribute('stroke', 'currentColor')
        svg.appendChild(path)
      }
      return svg
    }

    /**
     * Build one icon-only, fill-free control.
     *
     * The Harness Client package that owns this artwork cannot be required from a
     * plugin half, so the shipped `IconEditOutlineRegular`, `IconSendOutlineRegular`
     * and `IconCloseOutlineRegular` paths are inlined verbatim — same 16px viewBox,
     * same one-pixel stroke — so these read as the host's own icon buttons. Each
     * control carries its accessible name and hover hint instead of visible text.
     *
     * @param {string} icon - `edit`, `send` or `close`.
     * @param {string} label - the accessible name and hover hint.
     * @param {number} size - the icon's own square size.
     * @returns {HTMLButtonElement} the button.
     */
    function iconButton(icon, label, size = 16) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute(ICON_BUTTON_ATTR, icon)
      button.title = label
      button.setAttribute('aria-label', label)
      button.style.setProperty('-webkit-appearance', 'none')
      button.style.setProperty('appearance', 'none')
      if (icon === 'edit') {
        button.appendChild(iconSvg([
          ['M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z', 'fill'],
          ['M7.7849 8.23878L13.888 2.13574', 'stroke'],
        ], size))
      } else if (icon === 'send') {
        button.setAttribute('data-ws-edit-primary', '')
        button.appendChild(iconSvg([
          ['M6.97211 1.94476C7.55785 1.35914 8.50767 1.35919 9.09343 1.94476L13.921 6.77228L13.2138 7.47939L8.38632 2.65187C8.19108 2.45682 7.87443 2.45677 7.67922 2.65187L2.74397 7.58711L2.03687 6.88L6.97211 1.94476Z', 'fill'],
          ['M7.97571 14.5732L8.02421 2.34139', 'stroke'],
        ], size))
      } else {
        button.appendChild(iconSvg([
          ['M2.5 2.5L13.5 13.5', 'stroke'],
          ['M13.5 2.5L2.5 13.5', 'stroke'],
        ], size))
      }
      return button
    }

    /** Insert the edit half's stylesheet once and return its remover. */
    function installEditStyles() {
      if (typeof document === 'undefined') return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspace-sort'
      tag.dataset.pluginCss = `${EDIT_NS}.css`
      tag.textContent = EDIT_CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    /**
     * Mount the edit button and the inline editor.
     * @param {object} ctx - Client root context.
     * @param {object} uiWorkspace - the deferred Workspace service the edit writes through.
     */
    function mountConversationEdit(ctx, uiWorkspace) {
      const sessions = ctx.sessions
      const t = ctx.locale.bind(EDIT_NS)

      const removeStyles = installEditStyles()
      ctx.effect(() => removeStyles(), 'workspace-sort: edit styles')
      ctx.effect(() => ctx.locale.register(EDIT_NS, { zh: editZh, en: editEn }), 'workspace-sort: edit dictionaries')

      /**
       * Open the inline Markdown editor above one user message.
       * @param {{ row: Element, sessionId: string, messageId: string }} target - the edited row.
       */
      const openDialog = ({ sessionId, messageId }) => {
        if (document.querySelector(`[${EDIT_DIALOG_ATTR}]`) !== null) return
        const events = windowEvents(sessions.binding(sessionId)?.eventSource?.getSnapshot?.())
        const original = events.find((event) => event.type === 'user/message' && String(event.data?.id) === messageId)
        if (original === undefined) return
        const plan = planForkEdit(events, messageId)
        if (!plan.ok) {
          console.warn(`[dsh-workspace-sort] the edit dialog did not open: ${plan.reason}`)
          return
        }

        // Every visual property is written inline. The injected stylesheet proved
        // unreliable for a subtree this half creates outside React, and inline
        // declarations cannot lose a cascade, an injection order or a reset.
        const el = (tag, style, text) => {
          const node = document.createElement(tag)
          node.setAttribute('style', style)
          if (text !== undefined) node.textContent = text
          return node
        }
        const CLEAR = 'background:transparent;border:0;box-shadow:none;-webkit-appearance:none;appearance:none'
        const scrim = el('div', [
          'position:fixed', 'inset:0', 'z-index:2147483000', 'display:flex',
          'align-items:center', 'justify-content:center', 'padding:24px',
          'background:color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent)',
        ].join(';'))
        scrim.setAttribute(EDIT_DIALOG_ATTR, sessionId)

        const card = el('div', [
          'box-sizing:border-box', 'width:100%', 'max-width:640px',
          'max-height:min(70vh,560px)', 'display:flex', 'flex-direction:column', 'gap:12px',
          'padding:16px', 'border-radius:var(--dsw-radius-panel)',
          'background:var(--dsw-alias-bg-overlay)', 'color:var(--dsw-alias-label-primary)',
          'box-shadow:var(--dsw-elevation-panel)', 'overflow:hidden',
        ].join(';'))

        const head = el('div', 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;color:var(--dsw-alias-label-secondary)')
        head.appendChild(el('strong', 'color:var(--dsw-alias-label-primary);font-weight:600', t('dialog.title')))
        head.appendChild(el('span', '', t('dialog.count', { count: plan.removed })))

        const area = el('textarea', [
          'flex:1 1 auto', 'min-height:140px', 'resize:none', 'padding:0',
          'outline:none', CLEAR, 'color:var(--dsw-alias-label-primary)',
          'font:inherit', 'font-family:var(--dsw-font-family)', 'line-height:1.6',
        ].join(';'))
        area.value = messageTextOf(original.data?.content)
        area.spellcheck = false

        const foot = el('div', 'display:flex;align-items:center;gap:10px')
        const note = el('div', 'flex:1 1 auto;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;color:var(--dsw-alias-label-secondary)')
        const actions = el('div', 'display:flex;gap:2px;flex:none')
        const submit = iconButton('send', t('panel.submit'), 14)
        const cancel = iconButton('close', t('panel.cancel'), 14)
        for (const button of [cancel, submit]) {
          button.setAttribute('style', `box-sizing:border-box;padding:6px;border-radius:var(--dsw-radius-sm);cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);${CLEAR}`)
        }
        actions.append(cancel, submit)
        foot.append(note, actions)
        card.append(head, area, foot)
        scrim.appendChild(card)
        document.body.appendChild(scrim)

        let settled = false
        const close = () => {
          if (settled) return
          settled = true
          scrim.remove()
          document.removeEventListener('keydown', onKey, true)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }
        document.addEventListener('keydown', onKey, true)
        scrim.addEventListener('mousedown', (event) => {
          if (event.target === scrim) close()
        })
        cancel.addEventListener('click', close)

        const busy = (working) => {
          submit.disabled = working
          cancel.disabled = working
          note.removeAttribute('data-ws-edit-error')
        }
        const fail = (message) => {
          busy(false)
          note.textContent = message
          note.setAttribute('style', 'flex:1 1 auto;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;color:var(--dsw-alias-state-error-primary)')
        }
        const run = async () => {
          const body = area.value.trim()
          if (body === '') {
            fail(t('panel.empty'))
            return
          }
          busy(true)
          note.textContent = ''
          const result = await editViaFork(
            { sessions, uiWorkspace },
            { sessionId, messageId, text: body, onStage: (stage) => { note.textContent = t(`stage.${stage}`) } },
          )
          if (result.ok !== true) {
            fail(result.reason)
            return
          }
          settled = true
          scrim.remove()
          document.removeEventListener('keydown', onKey, true)
          if (result.warning !== undefined) console.warn(`[dsh-workspace-sort] ${result.warning}`)
        }
        submit.addEventListener('click', () => { void run() })
        // Enter submits; Shift+Enter keeps the browser's own newline; Esc is handled
        // by the document listener above. `isComposing` keeps an IME candidate window
        // from submitting mid-composition.
        area.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return
          if (event.shiftKey) return
          if (event.isComposing === true) return
          event.preventDefault()
          void run()
        })
        area.focus()
        area.setSelectionRange(area.value.length, area.value.length)
      }

      /**
       * Give every rendered user bubble an edit button, if it has none yet.
       * @param {Element} occurrence - one `[data-conversation-session]` root.
       */
      const decorate = (occurrence) => {
        const sessionId = occurrence.getAttribute('data-conversation-session')
        if (sessionId === null || sessionId === '') return
        for (const row of occurrence.querySelectorAll(USER_ROW_SELECTOR)) {
          if (row.querySelector(`[${EDIT_BUTTON_ATTR}]`) !== null) continue
          const actions = row.querySelector(ACTION_ROW_SELECTOR)
          if (actions === null) continue
          const messageId = parseChatNodeKey(row.getAttribute('data-chat-node-key'))
          if (messageId === undefined) continue
          const button = iconButton('edit', t('action.edit'))
          button.setAttribute(EDIT_BUTTON_ATTR, messageId)
          // Borrow the host button's own class so its size, colour and hover come
          // from the host's stylesheet instead of being re-declared here.
          const reference = actions.querySelector(`button:not([${ICON_BUTTON_ATTR}])`)
          if (reference !== null && typeof reference.className === 'string' && reference.className !== '') {
            button.className = reference.className
          }
          button.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            openDialog({ sessionId, messageId })
          })
          const first = actions.querySelector('button')
          if (first === null) actions.appendChild(button)
          else first.before(button)
        }
      }

      ctx.effect(() => {
        const scan = () => {
          if (typeof document === 'undefined') return
          for (const occurrence of document.querySelectorAll(OCCURRENCE_SELECTOR)) decorate(occurrence)
        }
        const schedule = () => {
          if (schedule.timer !== null) clearTimeout(schedule.timer)
          schedule.timer = setTimeout(() => {
            schedule.timer = null
            scan()
          }, EDIT_SCAN_DELAY_MS)
        }
        schedule.timer = null
        scan()
        const observer = typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(schedule)
        if (observer !== null && typeof document !== 'undefined') observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer?.disconnect()
          if (schedule.timer !== null) clearTimeout(schedule.timer)
        }
      }, 'workspace-sort: conversation edit observer')
    }
    //#endregion

    //#region browser half: LLM proxy routing settings page
    /** Locale namespace owned by the proxy-routing page. */
    const PROXY_NS = 'workspaceSortProxy'
    /** Host HTTP API base path (routes owned by the host half). */
    const PROXY_API_BASE = '/api/dsh-workspace-sort/proxy'
    /** Nav identity of the page inside the Settings shell. */
    const PROXY_SECTION_ID = 'llm-proxy'
    /** First-level nav position: directly below the usage section (order 151). */
    const PROXY_SECTION_ORDER = 152
    /** Ceiling for one host API call; a stalled host must not pile up requests. */
    const PROXY_REQUEST_TIMEOUT_MS = 30000
    /** The probe dials a real proxy, so it gets a wider ceiling. */
    const PROXY_TEST_TIMEOUT_MS = 25000
    /** Style tag identity, so a hot reload cannot stack duplicate sheets. */
    const PROXY_STYLE_ID = 'dsh-workspace-sort/proxy-section.css'
    /** Class prefix of every element this page owns. */
    const PROXY_CLASS_PREFIX = 'dwsp-'

    /** Chinese copy (the user's UI language). */
    const proxyZh = {
      title: '代理路由',
      intro: '选择哪些 Provider 经代理访问，其余直连；保存后立即生效，无需重启。',
      'status.title': '当前状态',
      'status.disabled': '代理路由已关闭，全部直连',
      'status.routed': '当前经代理：{providers}',
      'status.routedPending': '保存后经代理：{providers}',
      'status.disabledPending': '保存后将全部直连，规则保留',
      'status.routedNone': '代理路由已启用，但还没有 Provider 走代理',
      'status.hosts': '{n} 条主机规则',
      'status.proxy': '生效代理：{url}',
      'status.proxyPending': '保存后代理：{url}',
      'status.proxyNone': '未配置代理地址',
      'status.dirty': '有未保存的修改',
      'status.separator': '、',
      'load.loading': '正在读取配置…',
      'load.failed': '读取配置失败：{error}',
      'load.retry': '重试',
      'general.title': '基本设置',
      'enabled.label': '启用代理路由',
      'enabled.desc': '关闭后所有请求直连；已保存的规则会保留。',
      'proxy.label': '代理地址',
      'proxy.placeholder': 'http://127.0.0.1:7890',
      'proxy.desc': '支持 http:// 与 https://，可带凭据：http://user:pass@host:port',
      'proxy.test': '测试代理',
      'proxy.testing': '测试中…',
      'proxy.ok': '连接成功（{ms} ms）',
      'proxy.fail': '连接失败：{error}',
      'proxy.invalid': '代理地址无效，需形如 http://host:port',
      'proxy.required': '启用代理路由前需填写代理地址',
      'providers.title': 'Provider 规则',
      'providers.desc': '打开开关的 Provider 经代理访问，关闭的直连。',
      'providers.empty': '宿主未上报任何 Provider。',
      'providers.hosts': '命中主机',
      'providers.noHosts': '暂无命中主机',
      'providers.addPlaceholder': '添加主机规则，如 api.example.com',
      'providers.add': '添加',
      'providers.addLabel': '为 {name} 添加主机规则',
      'providers.removeHost': '从 {name} 的额外规则中移除 {host}',
      'providers.switchLabel': '{name} 走代理',
      'providers.source.default': '内置',
      'providers.source.configured': '已配置',
      'providers.source.registered': '运行中',
      'providers.invalidHost': '主机规则无效：不能包含空格、斜杠或冒号',
      'providers.invalidHostWith': '{name} 的主机规则无效：{host}',
      'providers.duplicateHost': '该主机规则已存在',
      'hosts.title': '额外主机规则',
      'hosts.desc': '这些主机无论归属哪个 Provider 都经代理访问。',
      'hosts.empty': '暂无额外主机规则',
      'hosts.add': '添加主机规则',
      'hosts.placeholder': 'generativelanguage.googleapis.com',
      'hosts.pattern': '主机规则',
      'hosts.remove': '删除此规则',
      'hosts.enabled': '规则生效',
      'hosts.invalid': '主机规则无效：不能包含空格、斜杠或冒号',
      'save.save': '保存',
      'save.saving': '保存中…',
      'save.saved': '已保存',
      'save.failed': '保存失败：{error}',
      'save.reset': '恢复默认',
      'save.resetConfirm': '恢复默认会覆盖当前配置，确认继续？',
      'save.confirm': '确认恢复',
      'save.cancel': '取消',
      'save.resetting': '恢复中…',
      'runtime.title': '运行时',
      'runtime.patched': '宿主已接管 fetch',
      'runtime.notPatched': '宿主未接管 fetch',
      'runtime.undici': 'undici {version}',
      'runtime.lastError': '最近一次错误（{at}）：{error}',
      'runtime.noError': '运行正常，无错误',
      'error.timeout': '请求超时',
      'error.network': '无法连接宿主接口：{error}',
      'error.http': '宿主返回 HTTP {status}',
    }

    /** English mirror; every proxyZh key is present. */
    const proxyEn = {
      title: 'Proxy routing',
      intro:
        'Choose which providers reach the network through the proxy; the rest connect directly. Saving applies immediately, with no restart.',
      'status.title': 'Current state',
      'status.disabled': 'Proxy routing is off; every request connects directly',
      'status.routed': 'Currently through the proxy: {providers}',
      'status.routedPending': 'After saving, through the proxy: {providers}',
      'status.disabledPending': 'After saving, everything connects directly; rules are kept',
      'status.routedNone': 'Proxy routing is on, but no provider uses the proxy yet',
      'status.hosts': '{n} host rules',
      'status.proxy': 'Effective proxy: {url}',
      'status.proxyPending': 'After saving: {url}',
      'status.proxyNone': 'No proxy URL configured',
      'status.dirty': 'Unsaved changes',
      'status.separator': ', ',
      'load.loading': 'Loading configuration…',
      'load.failed': 'Failed to load the configuration: {error}',
      'load.retry': 'Retry',
      'general.title': 'General',
      'enabled.label': 'Enable proxy routing',
      'enabled.desc': 'When off, every request connects directly; saved rules are kept.',
      'proxy.label': 'Proxy URL',
      'proxy.placeholder': 'http://127.0.0.1:7890',
      'proxy.desc': 'Accepts http:// and https://, with optional credentials: http://user:pass@host:port',
      'proxy.test': 'Test proxy',
      'proxy.testing': 'Testing…',
      'proxy.ok': 'Connected ({ms} ms)',
      'proxy.fail': 'Connection failed: {error}',
      'proxy.invalid': 'Invalid proxy URL; expected a form like http://host:port',
      'proxy.required': 'A proxy URL is required while proxy routing is on',
      'providers.title': 'Provider rules',
      'providers.desc': 'Providers with the switch on use the proxy; the others connect directly.',
      'providers.empty': 'The host reported no providers.',
      'providers.hosts': 'Matching hosts',
      'providers.noHosts': 'No matching hosts',
      'providers.addPlaceholder': 'Add a host pattern, such as api.example.com',
      'providers.add': 'Add',
      'providers.addLabel': 'Add a host pattern for {name}',
      'providers.removeHost': "Remove {host} from {name}'s extra rules",
      'providers.switchLabel': 'Route {name} through the proxy',
      'providers.source.default': 'Built-in',
      'providers.source.configured': 'Configured',
      'providers.source.registered': 'Registered',
      'providers.invalidHost': 'Invalid host pattern: no spaces, slashes, or colons',
      'providers.invalidHostWith': 'Invalid host pattern for {name}: {host}',
      'providers.duplicateHost': 'That host pattern is already there',
      'hosts.title': 'Extra host rules',
      'hosts.desc': 'These hosts always use the proxy, whichever provider calls them.',
      'hosts.empty': 'No extra host rules',
      'hosts.add': 'Add host rule',
      'hosts.placeholder': 'generativelanguage.googleapis.com',
      'hosts.pattern': 'Host pattern',
      'hosts.remove': 'Remove this rule',
      'hosts.enabled': 'Rule enabled',
      'hosts.invalid': 'Invalid host pattern: no spaces, slashes, or colons',
      'save.save': 'Save',
      'save.saving': 'Saving…',
      'save.saved': 'Saved',
      'save.failed': 'Save failed: {error}',
      'save.reset': 'Restore defaults',
      'save.resetConfirm': 'Restoring defaults overwrites the current configuration. Continue?',
      'save.confirm': 'Restore',
      'save.cancel': 'Cancel',
      'save.resetting': 'Restoring…',
      'runtime.title': 'Runtime',
      'runtime.patched': 'The host patched fetch',
      'runtime.notPatched': 'The host has not patched fetch',
      'runtime.undici': 'undici {version}',
      'runtime.lastError': 'Last error ({at}): {error}',
      'runtime.noError': 'No errors',
      'error.timeout': 'Request timed out',
      'error.network': 'Cannot reach the host API: {error}',
      'error.http': 'The host answered HTTP {status}',
    }

    /**
     * Section stylesheet. Tokens only (`--dsw-alias-*` and friends) plus layout
     * numbers; every class name carries this page's own prefix so nothing
     * collides with a host rule. Rendered as a React element, so unmounting
     * removes it.
     */
    const PROXY_CSS = `
.dwsp-page{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}
.dwsp-title{margin:0;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}
.dwsp-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
.dwsp-card{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}
.dwsp-cardHead{display:flex;flex-direction:column;gap:2px}
.dwsp-cardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}
.dwsp-cardDesc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dwsp-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 0}
.dwsp-row+.dwsp-row{border-top:.5px solid var(--dsw-alias-border-l2)}
.dwsp-rowText{flex:1;min-width:0}
.dwsp-rowTitle{font-size:14px;line-height:20px}
.dwsp-rowDesc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dwsp-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dwsp-fieldLabel{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dwsp-fieldRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dwsp-fieldRow .dwsp-input{flex:1;min-width:220px}
.dwsp-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dwsp-provider{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform)}
.dwsp-providerHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dwsp-providerName{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;font-size:14px;font-weight:500;line-height:22px}
.dwsp-tag{flex:none;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-weight:400}
.dwsp-id{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:400}
.dwsp-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dwsp-chipsLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dwsp-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dwsp-chipExtra{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dwsp-chipText{overflow-wrap:anywhere}
.dwsp-chipRemove{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;padding:0;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.dwsp-chipRemove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dwsp-chipRemove:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dwsp-hostRow{display:flex;align-items:center;gap:8px}
.dwsp-hostRow .dwsp-input{flex:1;min-width:0}
.dwsp-hostList{display:flex;flex-direction:column;gap:8px}
.dwsp-status{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform)}
.dwsp-statusLine{display:flex;align-items:baseline;gap:8px;font-size:14px;line-height:22px}
.dwsp-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed);align-self:center}
.dwsp-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary)}
.dwsp-statusMeta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dwsp-warn{color:var(--dsw-alias-state-warn-label)}
.dwsp-errorText{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dwsp-break{overflow-wrap:anywhere}
.dwsp-footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:2px}
.dwsp-feedback{margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dwsp-feedback[data-kind="saved"]{color:var(--dsw-alias-state-success-primary)}
.dwsp-feedback[data-kind="failed"]{color:var(--dsw-alias-state-error-primary)}
.dwsp-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dwsp-failure{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary)}
.dwsp-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}
.dwsp-input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}
.dwsp-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dwsp-input:disabled{opacity:.6;cursor:default}
.dwsp-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dwsp-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dwsp-button:disabled{opacity:.4;cursor:default}
.dwsp-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dwsp-buttonPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dwsp-buttonPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dwsp-buttonGhost{border:.5px solid var(--dsw-alias-border-l3)}
.dwsp-buttonGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dwsp-buttonDanger{color:var(--dsw-alias-state-error-primary)}
.dwsp-buttonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dwsp-buttonSm{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}
.dwsp-iconButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:1;cursor:pointer}
.dwsp-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.dwsp-iconButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dwsp-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
.dwsp-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dwsp-switch:disabled{cursor:default;opacity:.5}
.dwsp-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dwsp-switchThumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}
.dwsp-switch[aria-checked="false"] .dwsp-switchThumb{background:var(--dsw-alias-switch-thumb)}
.dwsp-switch[aria-checked="true"] .dwsp-switchThumb{transform:translateX(16px)}
@media (prefers-reduced-motion: reduce){.dwsp-switchThumb{transition:none}}
`

    /** Message text of an unknown thrown value. */
    function proxyMessageOf(error) {
      if (error === null || error === undefined) return ''
      if (typeof error === 'string') return error
      if (error instanceof Error) return error.message || error.name
      try {
        return JSON.stringify(error)
      } catch {
        return String(error)
      }
    }

    /** Localized, user-facing description of a transport failure. */
    function proxyErrorText(error, t) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return t('error.timeout')
      if (error && error.name === 'HttpStatusError') return t('error.http', { status: error.status })
      if (error instanceof TypeError) return t('error.network', { error: proxyMessageOf(error) })
      return proxyMessageOf(error)
    }

    /** Abort signal that also honors an outer signal; `release()` clears both. */
    function withProxyTimeout(signal, timeoutMs) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
      const forward = () => controller.abort(signal && signal.reason)
      if (signal) {
        if (signal.aborted) forward()
        else signal.addEventListener('abort', forward, { once: true })
      }
      return {
        signal: controller.signal,
        release() {
          clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', forward)
        },
      }
    }

    /** Parse a JSON body, or null when the response is not JSON. */
    async function readProxyJson(response) {
      try {
        return await response.json()
      } catch {
        return null
      }
    }

    /**
     * One host API call. Resolves to the parsed payload; rejects with the host's
     * own `error` text (or an HTTP status) when the call did not succeed.
     */
    async function proxyRequest(path, options) {
      const opts = options || {}
      const guard = withProxyTimeout(opts.signal, opts.timeoutMs || PROXY_REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(PROXY_API_BASE + path, {
          method: opts.method || 'GET',
          headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          cache: 'no-store',
          signal: guard.signal,
        })
        const payload = await readProxyJson(response)
        if (payload && payload.ok === false) throw new Error(proxyMessageOf(payload.error) || 'request refused')
        if (!response.ok) {
          const failure = new Error(proxyMessageOf(payload && payload.error) || `HTTP ${response.status}`)
          failure.name = 'HttpStatusError'
          failure.status = response.status
          throw failure
        }
        if (payload === null) {
          const failure = new Error(`HTTP ${response.status}`)
          failure.name = 'HttpStatusError'
          failure.status = response.status
          throw failure
        }
        return payload
      } finally {
        guard.release()
      }
    }

    /** Host API surface the proxy-routing page uses. */
    const proxyApi = {
      state: (signal) => proxyRequest('/state', { signal, timeoutMs: PROXY_REQUEST_TIMEOUT_MS }),
      save: (config) => proxyRequest('/config', { method: 'POST', body: { config }, timeoutMs: PROXY_REQUEST_TIMEOUT_MS }),
      test: (proxyUrl) => proxyRequest('/test', { method: 'POST', body: { proxyUrl }, timeoutMs: PROXY_TEST_TIMEOUT_MS }),
      reset: () => proxyRequest('/reset', { method: 'POST', timeoutMs: PROXY_REQUEST_TIMEOUT_MS }),
    }

    /** Monotonic key source for host-rule rows; never sent to the host. */
    let proxyHostRuleUid = 0
    function nextProxyHostRuleUid() {
      proxyHostRuleUid += 1
      return 'proxy-host-' + proxyHostRuleUid
    }

    /** Validate one proxy URL; "required" | "invalid" | null. */
    function proxyUrlProblem(value) {
      const text = String(value === undefined || value === null ? '' : value).trim()
      if (text === '') return 'required'
      let parsed
      try {
        parsed = new URL(text)
      } catch {
        return 'invalid'
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'invalid'
      if (!parsed.hostname) return 'invalid'
      return null
    }

    /** Validate one host pattern; "empty" | "chars" | null. */
    function hostPatternProblem(pattern) {
      const text = String(pattern === undefined || pattern === null ? '' : pattern).trim()
      if (text === '') return 'empty'
      if (!/^[A-Za-z0-9*._-]+$/.test(text)) return 'chars'
      return null
    }

    /** Trimmed, wire-shaped copy of one draft. */
    function toProxyPayload(draft) {
      const providers = {}
      const source = draft && draft.providers ? draft.providers : {}
      for (const id of Object.keys(source).sort()) {
        const entry = source[id] || {}
        providers[id] = {
          enabled: entry.enabled === true,
          extraHosts: Array.isArray(entry.extraHosts)
            ? entry.extraHosts.map((host) => String(host).trim()).filter((host) => host !== '')
            : [],
          displayName: typeof entry.displayName === 'string' && entry.displayName !== '' ? entry.displayName : id,
        }
      }
      return {
        enabled: draft ? draft.enabled === true : false,
        proxyUrl: draft ? String(draft.proxyUrl || '').trim() : '',
        providers,
        hosts: (draft && Array.isArray(draft.hosts) ? draft.hosts : []).map((rule) => ({
          pattern: String(rule.pattern || '').trim(),
          enabled: rule.enabled !== false,
          note: typeof rule.note === 'string' ? rule.note : '',
        })),
      }
    }

    /** First validation failure of a draft as localized text, or null. */
    function validateProxyDraft(draft, t) {
      if (!draft) return null
      const required = draft.enabled === true
      const problem = proxyUrlProblem(draft.proxyUrl)
      if (problem === 'required' && required) return t('proxy.required')
      if (problem === 'invalid') return t('proxy.invalid')
      for (const rule of draft.hosts || []) {
        const hostProblem = hostPatternProblem(rule.pattern)
        if (hostProblem === 'empty') return t('hosts.invalid')
        if (hostProblem === 'chars') return t('hosts.invalid')
      }
      for (const id of Object.keys(draft.providers || {})) {
        const entry = draft.providers[id] || {}
        for (const host of entry.extraHosts || []) {
          const hostProblem = hostPatternProblem(host)
          if (hostProblem !== null) {
            return t('providers.invalidHostWith', {
              name: entry.displayName || id,
              host: String(host).trim() === '' ? '—' : String(host),
            })
          }
        }
      }
      return null
    }

    /**
     * Merge a host config with the host's live provider catalog: every catalog
     * provider gets a row, provider entries the catalog does not report survive,
     * and unknown fields are dropped.
     */
    function normalizeProxyDraft(raw, catalog) {
      const config = raw !== null && typeof raw === 'object' ? raw : {}
      const reported = config.providers !== null && typeof config.providers === 'object' ? config.providers : {}
      const providers = {}
      const ids = []
      for (const entry of Array.isArray(catalog) ? catalog : []) {
        const id = entry && typeof entry.id === 'string' ? entry.id : null
        if (id === null || ids.indexOf(id) !== -1) continue
        ids.push(id)
      }
      for (const id of Object.keys(reported)) if (ids.indexOf(id) === -1) ids.push(id)
      for (const id of ids) {
        const saved = reported[id] !== null && typeof reported[id] === 'object' ? reported[id] : {}
        const listed = (Array.isArray(catalog) ? catalog : []).find((entry) => entry && entry.id === id) || {}
        providers[id] = {
          // The saved override wins; a provider the config never mentions starts
          // from the host's effective value for it (default or registered).
          enabled: typeof saved.enabled === 'boolean' ? saved.enabled : listed.enabled === true,
          extraHosts: Array.isArray(saved.extraHosts)
            ? saved.extraHosts.map((host) => String(host)).filter((host) => host.trim() !== '')
            : [],
          displayName:
            typeof saved.displayName === 'string' && saved.displayName !== ''
              ? saved.displayName
              : typeof listed.displayName === 'string' && listed.displayName !== ''
                ? listed.displayName
                : id,
        }
      }
      const hosts = (Array.isArray(config.hosts) ? config.hosts : [])
        .filter((rule) => rule !== null && typeof rule === 'object')
        .map((rule) => ({
          uid: nextProxyHostRuleUid(),
          pattern: String(rule.pattern === undefined || rule.pattern === null ? '' : rule.pattern),
          enabled: rule.enabled !== false,
          note: typeof rule.note === 'string' ? rule.note : '',
        }))
      return {
        enabled: config.enabled === true,
        proxyUrl: typeof config.proxyUrl === 'string' ? config.proxyUrl : '',
        providers,
        hosts,
      }
    }

    /** Provider catalog of a state snapshot, always an array. */
    function proxyCatalogOf(snapshot) {
      return snapshot && Array.isArray(snapshot.providers) ? snapshot.providers : []
    }

    /** Catalog hosts already known for one provider id. */
    function proxyKnownHosts(catalog, id) {
      const entry = catalog.find((row) => row && row.id === id)
      return entry && Array.isArray(entry.hosts) ? entry.hosts.map((host) => String(host)) : []
    }

    /** Localized label of a provider source. */
    function proxySourceLabel(source, t) {
      if (source === 'configured') return t('providers.source.configured')
      if (source === 'registered') return t('providers.source.registered')
      return t('providers.source.default')
    }

    /** Host-styled toggle switch (`role="switch"`, state keyed off aria-checked). */
    function ProxySwitch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked === true,
          'aria-label': props.label,
          title: props.title,
          disabled: props.disabled === true,
          className: 'dwsp-switch',
          onClick: () => props.onChange(props.checked !== true),
        },
        h('span', { className: 'dwsp-switchThumb' }),
      )
    }

    /** Host-styled button: primary, ghost, or danger, at md or sm size. */
    function ProxyButton(props) {
      const className = [
        'dwsp-button',
        props.variant === 'primary'
          ? 'dwsp-buttonPrimary'
          : props.variant === 'danger'
            ? 'dwsp-buttonDanger'
            : 'dwsp-buttonGhost',
        props.size === 'sm' ? 'dwsp-buttonSm' : '',
        props.className || '',
      ]
        .filter((part) => part !== '')
        .join(' ')
      return h(
        'button',
        {
          type: 'button',
          className,
          disabled: props.disabled === true,
          title: props.title,
          onClick: props.onClick,
        },
        props.children,
      )
    }

    /** Small square icon button used by removable rows. */
    function ProxyIconButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dwsp-iconButton',
          disabled: props.disabled === true,
          title: props.title,
          'aria-label': props.label || props.title,
          onClick: props.onClick,
        },
        props.children,
      )
    }

    /** Card with an optional title and description above its children. */
    function ProxyCard(props) {
      const head =
        props.title === undefined
          ? null
          : h(
              'div',
              { className: 'dwsp-cardHead' },
              h('h3', { className: 'dwsp-cardTitle' }, props.title),
              props.description === undefined ? null : h('p', { className: 'dwsp-cardDesc' }, props.description),
            )
      return h('div', { className: 'dwsp-card' }, head, props.children)
    }

    /**
     * The proxy-routing settings page: the master switch, the proxy URL with its
     * probe, one rule row per provider, extra host rules, the live status line,
     * and the save/restore footer.
     */
    function ProxyRoutingSection(props) {
      const t = props.t
      const [reloadToken, setReloadToken] = React.useState(0)
      const [load, setLoad] = React.useState({ status: 'loading', error: null })
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [save, setSave] = React.useState({ status: 'idle', error: null })
      const [probe, setProbe] = React.useState({ status: 'idle', error: null, latencyMs: null })
      const [confirmReset, setConfirmReset] = React.useState(false)
      const [pendingHost, setPendingHost] = React.useState({})
      const [rowError, setRowError] = React.useState({})
      const [newHost, setNewHost] = React.useState('')
      const translate = React.useRef(t)
      translate.current = t
      const catalog = proxyCatalogOf(snapshot)

      React.useEffect(() => {
        let alive = true
        const controller = new AbortController()
        setLoad({ status: 'loading', error: null })
        proxyApi.state(controller.signal).then(
          (next) => {
            if (!alive) return
            setSnapshot(next)
            setDraft(normalizeProxyDraft(next.config, next.providers))
            setLoad({ status: 'ready', error: null })
          },
          (error) => {
            if (!alive || controller.signal.aborted) return
            setLoad({ status: 'error', error: proxyErrorText(error, translate.current) })
          },
        )
        return () => {
          alive = false
          controller.abort()
        }
      }, [reloadToken])

      /** Immutable draft update. */
      const edit = (updater) => setDraft((current) => (current ? updater(current) : current))
      const providerEntry = (current, id) =>
        current.providers[id] || { enabled: false, extraHosts: [], displayName: id }

      const setProxyUrl = (value) => {
        edit((current) => ({ ...current, proxyUrl: value }))
        // A probe verdict describes the URL it was run against, so drop it here.
        setProbe((current) => (current.status === 'idle' ? current : { status: 'idle', error: null, latencyMs: null }))
        if (save.status === 'failed') setSave({ status: 'idle', error: null })
      }

      const setProviderEnabled = (id, next) =>
        edit((current) => ({
          ...current,
          providers: {
            ...current.providers,
            [id]: { ...providerEntry(current, id), enabled: next },
          },
        }))

      const addProviderHost = (id) => {
        const raw = String(pendingHost[id] || '').trim()
        const entry = draft ? providerEntry(draft, id) : { extraHosts: [], displayName: id }
        const problem = hostPatternProblem(raw)
        if (problem !== null) {
          setRowError((current) => ({ ...current, [id]: 'providers.invalidHost' }))
          return
        }
        const known = proxyKnownHosts(catalog, id).map((host) => host.toLowerCase())
        const extras = entry.extraHosts.map((host) => host.toLowerCase())
        if (known.indexOf(raw.toLowerCase()) !== -1 || extras.indexOf(raw.toLowerCase()) !== -1) {
          setRowError((current) => ({ ...current, [id]: 'providers.duplicateHost' }))
          return
        }
        setRowError((current) => ({ ...current, [id]: null }))
        setPendingHost((current) => ({ ...current, [id]: '' }))
        edit((current) => ({
          ...current,
          providers: {
            ...current.providers,
            [id]: { ...providerEntry(current, id), extraHosts: [...providerEntry(current, id).extraHosts, raw] },
          },
        }))
      }

      const removeProviderHost = (id, host) =>
        edit((current) => {
          const entry = providerEntry(current, id)
          return {
            ...current,
            providers: {
              ...current.providers,
              [id]: { ...entry, extraHosts: entry.extraHosts.filter((item) => item !== host) },
            },
          }
        })

      const addHostRule = () => {
        const raw = newHost.trim()
        const problem = hostPatternProblem(raw)
        if (problem !== null) {
          setRowError((current) => ({ ...current, __newHost: 'hosts.invalid' }))
          return
        }
        setRowError((current) => ({ ...current, __newHost: null }))
        setNewHost('')
        edit((current) => ({
          ...current,
          hosts: [...current.hosts, { uid: nextProxyHostRuleUid(), pattern: raw, enabled: true, note: '' }],
        }))
      }

      const updateHostRule = (index, patch) =>
        edit((current) => ({
          ...current,
          hosts: current.hosts.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)),
        }))

      const removeHostRule = (index) =>
        edit((current) => ({ ...current, hosts: current.hosts.filter((rule, at) => at !== index) }))

      const onTest = () => {
        if (!draft) return
        const problem = proxyUrlProblem(draft.proxyUrl)
        if (problem !== null) {
          setProbe({
            status: 'failed',
            error: t(problem === 'required' ? 'proxy.required' : 'proxy.invalid'),
            latencyMs: null,
          })
          return
        }
        setProbe({ status: 'testing', error: null, latencyMs: null })
        proxyApi.test(draft.proxyUrl.trim()).then(
          (result) =>
            setProbe({
              status: 'ok',
              error: null,
              latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
            }),
          (error) => setProbe({ status: 'failed', error: proxyErrorText(error, t), latencyMs: null }),
        )
      }

      const onSave = () => {
        if (!draft) return
        const problem = validateProxyDraft(draft, t)
        if (problem !== null) {
          setSave({ status: 'failed', error: problem })
          return
        }
        const payload = toProxyPayload(draft)
        const signature = JSON.stringify(payload)
        setSave({ status: 'saving', error: null })
        proxyApi.save(payload).then(
          () => {
            setSave({ status: 'saved', error: null })
            return proxyApi.state().then(
              (next) => {
                setSnapshot(next)
                setDraft((current) =>
                  current && JSON.stringify(toProxyPayload(current)) === signature
                    ? normalizeProxyDraft(next.config, next.providers)
                    : current,
                )
              },
              () =>
                setDraft((current) =>
                  current && JSON.stringify(toProxyPayload(current)) === signature
                    ? normalizeProxyDraft(payload, catalog)
                    : current,
                ),
            )
          },
          (error) => setSave({ status: 'failed', error: proxyErrorText(error, t) }),
        )
      }

      const onReset = () => {
        setConfirmReset(false)
        setSave({ status: 'resetting', error: null })
        proxyApi.reset().then(
          (result) => {
            const fallback = result && result.config !== undefined ? result.config : null
            return proxyApi.state().then(
              (next) => {
                setSnapshot(next)
                setDraft(normalizeProxyDraft(next.config, next.providers))
                setSave({ status: 'saved', error: null })
              },
              () => {
                if (fallback !== null) {
                  setSnapshot((current) => (current ? { ...current, config: fallback } : current))
                  setDraft(normalizeProxyDraft(fallback, catalog))
                }
                setSave({ status: 'saved', error: null })
              },
            )
          },
          (error) => setSave({ status: 'failed', error: proxyErrorText(error, t) }),
        )
      }

      const styleTag = h('style', {
        'data-plugin-css': PROXY_STYLE_ID,
        dangerouslySetInnerHTML: { __html: PROXY_CSS },
      })

      const head = [
        h('h2', { className: 'dwsp-title', key: 'title' }, t('title')),
        h('p', { className: 'dwsp-intro', key: 'intro' }, t('intro')),
      ]

      if (load.status === 'loading' && !draft) {
        return h(
          'div',
          { className: 'dwsp-page', 'data-slot-section': PROXY_SECTION_ID },
          styleTag,
          head,
          h('p', { className: 'dwsp-hint' }, t('load.loading')),
        )
      }

      if (!draft) {
        return h(
          'div',
          { className: 'dwsp-page', 'data-slot-section': PROXY_SECTION_ID },
          styleTag,
          head,
          h(
            'div',
            { className: 'dwsp-failure', role: 'alert' },
            h('span', null, t('load.failed', { error: load.error || '' })),
            h('button', { type: 'button', className: 'dwsp-button dwsp-buttonGhost dwsp-buttonSm', onClick: () => setReloadToken((value) => value + 1) }, t('load.retry')),
          ),
        )
      }

      const enabled = draft.enabled === true
      const runtime = snapshot && snapshot.runtime ? snapshot.runtime : {}
      const appliedConfig = snapshot && snapshot.config !== null && typeof snapshot.config === 'object' ? snapshot.config : {}
      const appliedUrl = typeof appliedConfig.proxyUrl === 'string' ? appliedConfig.proxyUrl : ''
      const dirty = snapshot
        ? JSON.stringify(toProxyPayload(draft)) !== JSON.stringify(toProxyPayload(normalizeProxyDraft(snapshot.config, snapshot.providers)))
        : false
      const hostCount = snapshot && Array.isArray(snapshot.effectiveHosts) ? snapshot.effectiveHosts.length : toProxyPayload(draft).hosts.length
      const appliedRouted = catalog
        .filter((entry) => entry && entry.enabled === true)
        .map((entry) => entry.displayName || entry.id)
      const draftRouted = draft.enabled === true
        ? Object.keys(draft.providers)
            .filter((id) => draft.providers[id] && draft.providers[id].enabled === true)
            .map((id) => draft.providers[id].displayName || id)
        : []
      const routed = dirty ? draftRouted : appliedRouted
      const routingOn = dirty ? enabled : !!(snapshot && snapshot.proxyConfigured === true && appliedRouted.length > 0)
      const statusText = dirty
        ? enabled
          ? routed.length > 0
            ? t('status.routedPending', { providers: routed.join(t('status.separator')) })
            : t('status.routedNone')
          : t('status.disabledPending')
        : !enabled
          ? t('status.disabled')
          : routed.length > 0
            ? t('status.routed', { providers: routed.join(t('status.separator')) })
            : t('status.routedNone')

      const statusCard = h(
        'div',
        { className: 'dwsp-status' },
        h(
          'div',
          { className: 'dwsp-statusLine' },
          h('span', { className: 'dwsp-dot', 'data-on': routingOn && routed.length > 0 ? 'true' : 'false', 'aria-hidden': 'true' }),
          h('span', null, statusText),
        ),
        h(
          'div',
          { className: 'dwsp-statusMeta' },
          h('span', null, t('status.hosts', { n: hostCount })),
          h(
            'span',
            { className: 'dwsp-break' },
            appliedUrl !== '' ? t('status.proxy', { url: appliedUrl }) : t('status.proxyNone'),
          ),
          dirty && draft.proxyUrl.trim() !== '' && draft.proxyUrl.trim() !== appliedUrl
            ? h('span', { className: 'dwsp-break dwsp-warn' }, t('status.proxyPending', { url: draft.proxyUrl.trim() }))
            : null,
          dirty ? h('span', { className: 'dwsp-warn' }, t('status.dirty')) : null,
        ),
        h(
          'div',
          { className: 'dwsp-statusMeta' },
          h('span', { className: 'dwsp-chipsLabel' }, t('runtime.title')),
          h('span', null, runtime.patched === true ? t('runtime.patched') : t('runtime.notPatched')),
          typeof runtime.undici === 'string' && runtime.undici !== '' ? h('span', null, t('runtime.undici', { version: runtime.undici })) : null,
          typeof runtime.lastError === 'string' && runtime.lastError !== ''
            ? h(
                'span',
                { className: 'dwsp-errorText' },
                t('runtime.lastError', {
                  at: typeof runtime.lastErrorAt === 'string' && runtime.lastErrorAt !== ''
                    ? new Date(runtime.lastErrorAt).toLocaleTimeString()
                    : '—',
                  error: runtime.lastError,
                }),
              )
            : runtime.patched === true
              ? h('span', null, t('runtime.noError'))
              : null,
        ),
      )

      const proxyRow = h(
        'div',
        { className: 'dwsp-field' },
        h('label', { className: 'dwsp-fieldLabel', htmlFor: 'dwsp-proxy-url' }, t('proxy.label')),
        h(
          'div',
          { className: 'dwsp-fieldRow' },
          h('input', {
            id: 'dwsp-proxy-url',
            className: 'dwsp-input',
            type: 'text',
            inputMode: 'url',
            spellCheck: false,
            autoComplete: 'off',
            value: draft.proxyUrl,
            placeholder: t('proxy.placeholder'),
            disabled: load.status !== 'ready',
            'aria-invalid': probe.status === 'failed' ? 'true' : 'false',
            onChange: (event) => setProxyUrl(event.target.value),
          }),
          h(
            ProxyButton,
            { variant: 'ghost', size: 'sm', disabled: probe.status === 'testing', onClick: onTest },
            probe.status === 'testing' ? t('proxy.testing') : t('proxy.test'),
          ),
        ),
        h('p', { className: 'dwsp-hint' }, t('proxy.desc')),
        probe.status === 'ok'
          ? h(
              'p',
              { className: 'dwsp-hint', role: 'status' },
              probe.latencyMs === null ? t('proxy.ok', { ms: '—' }) : t('proxy.ok', { ms: probe.latencyMs }),
            )
          : null,
        probe.status === 'failed' ? h('p', { className: 'dwsp-error', role: 'alert' }, t('proxy.fail', { error: probe.error || '' })) : null,
      )

      const generalCard = h(
        ProxyCard,
        { title: t('general.title') },
        h(
          'div',
          { className: 'dwsp-row' },
          h(
            'div',
            { className: 'dwsp-rowText' },
            h('div', { className: 'dwsp-rowTitle' }, t('enabled.label')),
            h('div', { className: 'dwsp-rowDesc' }, t('enabled.desc')),
          ),
          h(ProxySwitch, {
            checked: enabled,
            label: t('enabled.label'),
            disabled: load.status !== 'ready',
            onChange: (next) => edit((current) => ({ ...current, enabled: next })),
          }),
        ),
        proxyRow,
      )

      const providerRows = catalog
        .map((entry) => (entry && typeof entry.id === 'string' ? entry : null))
        .filter((entry) => entry !== null)
        .concat(
          Object.keys(draft.providers)
            .filter((id) => !catalog.some((entry) => entry && entry.id === id))
            .sort()
            .map((id) => ({
              id,
              displayName: providerEntry(draft, id).displayName,
              enabled: providerEntry(draft, id).enabled,
              hosts: [],
              source: 'configured',
            })),
        )

      const providerCards =
        providerRows.length === 0
          ? [h('p', { className: 'dwsp-hint', key: 'empty' }, t('providers.empty'))]
          : providerRows.map((entry) => {
              const id = entry.id
              const current = providerEntry(draft, id)
              const name = current.displayName || entry.displayName || id
              const defaults = proxyKnownHosts(catalog, id)
              const extras = current.extraHosts
              const chips = []
              for (const host of defaults) {
                chips.push(h('span', { className: 'dwsp-chip', key: 'd:' + host }, h('span', { className: 'dwsp-chipText' }, host)))
              }
              for (const host of extras) {
                chips.push(
                  h(
                    'span',
                    { className: 'dwsp-chip dwsp-chipExtra', key: 'e:' + host },
                    h('span', { className: 'dwsp-chipText' }, host),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dwsp-chipRemove',
                        title: t('providers.removeHost', { name, host }),
                        'aria-label': t('providers.removeHost', { name, host }),
                        onClick: () => removeProviderHost(id, host),
                      },
                      '×',
                    ),
                  ),
                )
              }
              if (chips.length === 0) chips.push(h('span', { className: 'dwsp-chipsLabel', key: 'none' }, t('providers.noHosts')))
              return h(
                'div',
                { className: 'dwsp-provider', key: id },
                h(
                  'div',
                  { className: 'dwsp-providerHead' },
                  h(
                    'div',
                    { className: 'dwsp-providerName' },
                    h('span', null, name),
                    h('span', { className: 'dwsp-id' }, id),
                    h('span', { className: 'dwsp-tag' }, proxySourceLabel(entry.source, t)),
                  ),
                  h(ProxySwitch, {
                    checked: current.enabled === true,
                    label: t('providers.switchLabel', { name }),
                    disabled: load.status !== 'ready',
                    onChange: (next) => setProviderEnabled(id, next),
                  }),
                ),
                h(
                  'div',
                  { className: 'dwsp-chips' },
                  h('span', { className: 'dwsp-chipsLabel' }, t('providers.hosts')),
                  chips,
                ),
                h(
                  'div',
                  { className: 'dwsp-fieldRow' },
                  h('input', {
                    className: 'dwsp-input',
                    type: 'text',
                    spellCheck: false,
                    autoComplete: 'off',
                    value: pendingHost[id] || '',
                    placeholder: t('providers.addPlaceholder'),
                    'aria-label': t('providers.addLabel', { name }),
                    'aria-invalid': rowError[id] ? 'true' : 'false',
                    disabled: load.status !== 'ready',
                    onChange: (event) => setPendingHost((state) => ({ ...state, [id]: event.target.value })),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addProviderHost(id)
                      }
                    },
                  }),
                  h(
                    ProxyButton,
                    { variant: 'ghost', size: 'sm', disabled: load.status !== 'ready', onClick: () => addProviderHost(id) },
                    t('providers.add'),
                  ),
                ),
                rowError[id] ? h('p', { className: 'dwsp-error', role: 'alert' }, t(rowError[id])) : null,
              )
            })

      const providersCard = h(
        ProxyCard,
        { title: t('providers.title'), description: t('providers.desc') },
        h('div', { className: 'dwsp-hostList' }, providerCards),
      )

      const hostRows = draft.hosts.map((rule, index) =>
        h(
          'div',
          { className: 'dwsp-hostRow', key: rule.uid || 'proxy-host-' + index },
          h(ProxySwitch, {
            checked: rule.enabled !== false,
            label: t('hosts.enabled'),
            disabled: load.status !== 'ready',
            onChange: (next) => updateHostRule(index, { enabled: next }),
          }),
          h('input', {
            className: 'dwsp-input',
            type: 'text',
            spellCheck: false,
            autoComplete: 'off',
            value: rule.pattern,
            placeholder: t('hosts.placeholder'),
            'aria-label': t('hosts.pattern'),
            disabled: load.status !== 'ready',
            onChange: (event) => updateHostRule(index, { pattern: event.target.value }),
          }),
          h(ProxyIconButton, { title: t('hosts.remove'), onClick: () => removeHostRule(index) }, '×'),
        ),
      )

      const hostsCard = h(
        ProxyCard,
        { title: t('hosts.title'), description: t('hosts.desc') },
        hostRows.length === 0 ? h('p', { className: 'dwsp-hint' }, t('hosts.empty')) : h('div', { className: 'dwsp-hostList' }, hostRows),
        h(
          'div',
          { className: 'dwsp-fieldRow' },
          h('input', {
            className: 'dwsp-input',
            type: 'text',
            spellCheck: false,
            autoComplete: 'off',
            value: newHost,
            placeholder: t('hosts.placeholder'),
            'aria-label': t('hosts.add'),
            'aria-invalid': rowError.__newHost ? 'true' : 'false',
            disabled: load.status !== 'ready',
            onChange: (event) => setNewHost(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addHostRule()
              }
            },
          }),
          h(ProxyButton, { variant: 'ghost', size: 'sm', disabled: load.status !== 'ready', onClick: addHostRule }, t('hosts.add')),
        ),
        rowError.__newHost ? h('p', { className: 'dwsp-error', role: 'alert' }, t(rowError.__newHost)) : null,
      )

      const busy = save.status === 'saving' || save.status === 'resetting'
      const feedback =
        save.status === 'saving'
          ? { kind: 'idle', text: t('save.saving') }
          : save.status === 'resetting'
            ? { kind: 'idle', text: t('save.resetting') }
            : save.status === 'saved'
              ? { kind: 'saved', text: t('save.saved') }
              : save.status === 'failed'
                ? { kind: 'failed', text: t('save.failed', { error: save.error || '' }) }
                : null

      const footer = h(
        'div',
        { className: 'dwsp-footer' },
        h(ProxyButton, { variant: 'primary', disabled: busy || load.status !== 'ready', onClick: onSave }, t('save.save')),
        confirmReset
          ? [
              h('span', { className: 'dwsp-hint', key: 'ask' }, t('save.resetConfirm')),
              h(ProxyButton, { key: 'yes', variant: 'danger', size: 'sm', disabled: busy, onClick: onReset }, t('save.confirm')),
              h(ProxyButton, { key: 'no', variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setConfirmReset(false) }, t('save.cancel')),
            ]
          : h(ProxyButton, { variant: 'ghost', disabled: busy || load.status !== 'ready', onClick: () => setConfirmReset(true) }, t('save.reset')),
        feedback === null
          ? null
          : h(
              'span',
              {
                className: 'dwsp-feedback',
                'data-kind': feedback.kind,
                role: feedback.kind === 'failed' ? 'alert' : 'status',
                'aria-live': 'polite',
              },
              feedback.text,
            ),
      )

      return h(
        'div',
        { className: 'dwsp-page', 'data-slot-section': PROXY_SECTION_ID },
        styleTag,
        head,
        load.status === 'error'
          ? h(
              'div',
              { className: 'dwsp-failure', role: 'alert' },
              h('span', null, t('load.failed', { error: load.error || '' })),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dwsp-button dwsp-buttonGhost dwsp-buttonSm',
                  onClick: () => setReloadToken((value) => value + 1),
                },
                t('load.retry'),
              ),
            )
          : null,
        statusCard,
        generalCard,
        providersCard,
        hostsCard,
        footer,
      )
    }
    //#endregion

    //#region browser half: engine
    /** Required Client services. */
    const inject = ['slots', 'locale', 'workspaces', 'sessions', 'uiSession']

    /**
     * Mount the order reconciler, the sidebar fold pass, the settings row and
     * the proxy-routing page.
     * @param ctx - Client root Context.
     */
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-sort: dictionaries')
      ctx.effect(() => ctx.locale.register(PROXY_NS, { zh: proxyZh, en: proxyEn }), 'workspace-sort: proxy dictionaries')
      let proxyBound = (key) => key
      ctx.effect(() => {
        try {
          proxyBound = ctx.locale.bind(PROXY_NS)
        } catch {
          proxyBound = (key) => key
        }
      })
      const proxyTranslate = (key, params) => {
        let text = null
        try {
          text = proxyBound(key)
        } catch {
          text = null
        }
        let out = text === null || text === undefined ? String(key) : String(text)
        if (params) {
          for (const name of Object.keys(params)) out = out.split('{' + name + '}').join(String(params[name]))
        }
        return out
      }

      const storage = (() => {
        try {
          return globalThis.localStorage ?? null
        } catch (_blockedStorage) {
          return null
        }
      })()

      const settingsStore = createValueStore(loadSettings(storage))
      const workspacesService = ctx.get('workspaces')
      const sessionsService = ctx.get('sessions')
      const uiSession = ctx.get('uiSession')

      if (typeof workspacesService?.list?.getSnapshot !== 'function' || typeof workspacesService?.insertBefore !== 'function') {
        console.warn('[dsh-workspace-sort] the Client Workspace service is unavailable: Workspace ordering is off')
      }
      if (typeof sessionsService?.list?.getSnapshot !== 'function') {
        console.warn('[dsh-workspace-sort] the Session list is unavailable: Workspace ordering falls back to Workspace creation time')
      }
      console.info(
        `[dsh-workspace-sort] mounted: ${String(settingsStore.getSnapshot().visiblePerWorkspace)} conversations per Workspace,`
        + ` Workspace ordering ${settingsStore.getSnapshot().sortWorkspaces ? 'on' : 'off'}`,
      )

      /** Read the current session-summary snapshot, when the service is mounted. */
      const sessionSnapshot = () => {
        try {
          return sessionsService?.list?.getSnapshot?.() ?? null
        } catch (_unreadableSessions) {
          return null
        }
      }

      /** Read the current session-status map (running / pending / unread). */
      const sessionStatus = () => {
        try {
          return uiSession?.sessionStatus?.getSnapshot?.() ?? null
        } catch (_unreadableStatus) {
          return null
        }
      }

      /** Mirror the shipped rule: blank, running or interaction-pending rows never fold. */
      const isIdleRow = (sessionId) => {
        const sessions = sessionSnapshot()
        const summary = sessions?.byId?.[sessionId]
        if (summary?.blank === true) return false
        const status = sessionStatus()?.get?.(sessionId)
        if (status?.running === true) return false
        if (status?.pendingInteraction !== undefined && status?.pendingInteraction !== null) return false
        if (summary?.running === true) return false
        const catalog = sessions?.projectionsBySession?.[sessionId]?.values?.subagentCatalog
        if (Array.isArray(catalog) && catalog.some((child) => (sessionStatus()?.get?.(child.id)?.running ?? sessions.byId?.[child.id]?.running) === true)) return false
        return true
      }

      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

      let disposed = false
      let applyingOrder = false
      let orderTimer = null
      let foldTimer = null
      let modeTimer = null
      let lastGroupBy = readGroupBy(storage)
      /** Sections the reader expanded by hand, keyed by Workspace id ('' is Ungrouped). Default is collapsed. */
      const expandedGroups = new Set()

      /** Push the recency order to the Host, one `insertBefore` per out-of-place Workspace. */
      const applyWorkspaceOrder = async () => {
        try {
          const snapshot = workspacesService?.list?.getSnapshot?.()
          if (snapshot === undefined || snapshot === null) return
          if (snapshot.phase !== 'ready' || snapshot.items.length < 2) return
          const sessions = sessionSnapshot()
          const archived = new Set(snapshot.archivedSessionIds ?? [])
          const desired = sortWorkspacesByRecency(snapshot.items, sessions?.byId ?? {}, archived)
          const current = snapshot.items.map((workspace) => workspace.workspaceId)
          const moves = planWorkspaceMoves(current, desired)
          if (moves.length === 0) return
          for (const move of moves) {
            if (disposed) return
            await workspacesService.insertBefore(move.workspaceId, move.beforeWorkspaceId)
          }
        } catch (error) {
          console.warn('[dsh-workspace-sort] workspace reorder failed', error)
        }
      }

      /** Debounced order pass; the flat single-list mode is deliberately left alone. */
      const scheduleOrder = () => {
        if (orderTimer !== null) return
        orderTimer = setTimeout(() => {
          orderTimer = null
          if (disposed) return
          if (!settingsStore.getSnapshot().sortWorkspaces) return
          if (readGroupBy(storage) === FLAT_MODE) return
          if (applyingOrder) return
          applyingOrder = true
          applyWorkspaceOrder().finally(() => {
            applyingOrder = false
          })
        }, 400)
      }

      /** The sidebar region the shipped browser renders into (the whole document is the boot-time fallback). */
      const findRegion = () => document.querySelector('[data-slot="sidebar.workspaces"]') ?? document

      /** The Workspace id one rendered section stands for; '' is the Ungrouped bucket. */
      const groupWorkspaceId = (group) => {
        const key = group.querySelector('[data-row-key^="workspace:"]')?.getAttribute('data-row-key')
        return typeof key === 'string' ? key.slice('workspace:'.length) : ''
      }

      /** Sessions no Workspace accounts for: the browser's Ungrouped bucket. */
      const straySessionIds = () => {
        const byId = sessionSnapshot()?.byId ?? {}
        const accounted = new Set()
        for (const workspace of workspacesService?.list?.getSnapshot?.()?.items ?? []) {
          for (const id of workspace.sessionIds ?? []) accounted.add(id)
        }
        return Object.keys(byId).filter((id) => !accounted.has(id))
      }

      /** The conversations one section lists, in the shipped browser's own terms. */
      const sectionConversations = (workspaceId) => {
        const workspaces = workspacesService?.list?.getSnapshot?.()
        const sessions = sessionSnapshot()
        const byId = sessions?.byId ?? {}
        const memberIds = workspaceId === ''
          ? straySessionIds()
          : ((workspaces?.items ?? []).find((candidate) => candidate.workspaceId === workspaceId)?.sessionIds ?? [])
        return visibleConversationIds({
          sessionIds: memberIds,
          sessionsById: byId,
          archivedIds: new Set(workspaces?.archivedSessionIds ?? []),
          archivedFilter: readArchivedFilter(storage),
          currentId: Object.values(byId).find((session) => (session.retainedBy?.mainView ?? 0) > 0)?.id,
        })
      }

      /** Conversations of one section the collapsed count keeps out of sight. */
      const remainingConversations = (workspaceId, limit) =>
        hiddenConversationCount(sectionConversations(workspaceId), limit, isIdleRow)

      /**
       * Create, label and place one section's fold control directly below the
       * conversations it still shows. Collapsed it reports the conversations left
       * out of sight; expanded the same control collapses the section again.
       * A section that shows no conversation at all — its own header collapsed,
       * or an empty Workspace — carries no fold control.
       * @param group - the rendered section.
       * @param anchor - the last shown conversation's node.
       * @param expandAll - whether the reader expanded this section.
       * @param remaining - conversations hidden below the fold.
       * @param showsConversations - whether the section renders any conversation row.
       */
      const placeFoldControl = (group, anchor, expandAll, remaining, showsConversations) => {
        const workspaceId = groupWorkspaceId(group)
        let control = group.querySelector('[data-dws-fold]')
        if (remaining <= 0 || !showsConversations) {
          if (control !== null) control.remove()
          return
        }
        if (control === null) {
          control = document.createElement('button')
          control.type = 'button'
          control.dataset.dwsFold = workspaceId
          control.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const id = control.dataset.dwsFold ?? ''
            if (expandedGroups.has(id)) expandedGroups.delete(id)
            else expandedGroups.add(id)
            scheduleFold()
          })
        }
        const t = ctx.locale.bind(NS)
        control.className = 'dws-fold'
        control.textContent = expandAll ? t('fold.collapse') : t('fold.remaining', { n: remaining })
        control.setAttribute('aria-expanded', expandAll ? 'true' : 'false')
        const target = anchor?.parentNode ?? group
        if (anchor !== null && anchor !== undefined && target !== null) {
          if (anchor.nextSibling !== control) target.insertBefore(control, anchor.nextSibling)
        } else if (control.parentNode !== group) {
          group.appendChild(control)
        }
      }

      /**
       * Fold every workspace section to the configured conversation count and
       * keep its own collapse control in place.
       * Conversations the shipped five-row cap left unrendered are revealed
       * through that cap's own control, then the surplus is hidden locally.
       */
      const foldPass = async () => {
        if (disposed || typeof document === 'undefined') return
        const limit = settingsStore.getSnapshot().visiblePerWorkspace
        const region = findRegion()
        // Before the sidebar mounts, the fallback region is the whole document;
        // skip it unless it actually holds a section, so chat mutations stay cheap.
        if (region === document && document.querySelector(`[class*="${GROUP_CLASS_SUFFIX}"]`) === null) return
        for (const group of groupSectionsOf(region)) {
          const workspaceId = groupWorkspaceId(group)
          const remaining = remainingConversations(workspaceId, limit)
          const expandAll = remaining > 0 && expandedGroups.has(workspaceId)
          if (remaining <= 0) expandedGroups.delete(workspaceId)

          const idleEntriesOf = (entries) => entries.filter((entry) => isIdleRow(entry.sessionId))
          let { rows, overflow } = directGroupRows(group)
          let idleCount = idleEntriesOf(rows).length
          let guard = 0
          const canReveal = () => overflow !== null && overflow.row.getAttribute('aria-expanded') !== 'true'
          const limitReached = expandAll ? 240 : 24
          while (guard < limitReached && canReveal() && (expandAll || idleCount < limit)) {
            overflow.row.click()
            await delay(expandAll ? 12 : 24)
            if (disposed) return
            const rescanned = directGroupRows(group)
            rows = rescanned.rows
            overflow = rescanned.overflow
            idleCount = idleEntriesOf(rows).length
            guard += 1
          }

          const plan = expandAll
            ? rows.map((entry) => ({ entry, hidden: false }))
            : planVisibleRows(rows, limit, isIdleRow)
          for (const item of plan) {
            const entry = item.entry
            setHidden(entry.row, item.hidden)
            if (entry.wrapper !== undefined && entry.wrapper !== group && entry.wrapper.tagName === 'SPAN') setHidden(entry.wrapper, item.hidden)
          }
          if (overflow !== null) {
            setHidden(overflow.row, true)
            if (overflow.wrapper !== undefined && overflow.wrapper !== group && overflow.wrapper.tagName === 'SPAN') setHidden(overflow.wrapper, true)
          }
          const anchorEntry = idleEntriesOf(rows)[limit - 1]
          placeFoldControl(group, anchorEntry === undefined ? null : (anchorEntry.wrapper ?? anchorEntry.row), expandAll, remaining, rows.length > 0)
        }
      }

      /** Debounced fold pass. */
      const scheduleFold = () => {
        if (foldTimer !== null) return
        foldTimer = setTimeout(() => {
          foldTimer = null
          foldPass().catch((error) => console.warn('[dsh-workspace-sort] fold pass failed', error))
        }, 80)
      }

      /** Re-open the recency order after the viewing mode changes back from single list. */
      const scheduleModeWatch = () => {
        if (modeTimer !== null) return
        modeTimer = setInterval(() => {
          if (disposed) return
          const mode = readGroupBy(storage)
          if (mode === lastGroupBy) return
          lastGroupBy = mode
          scheduleOrder()
        }, 1500)
      }

      const updateSettings = (patch) => {
        const next = normalizeSettings({ ...settingsStore.getSnapshot(), ...patch })
        settingsStore.set(next)
        saveSettings(storage, next)
        scheduleOrder()
        scheduleFold()
      }

      //#region workspace model memory
      /**
       * Remember one model and thinking depth per Workspace, and replay that
       * Workspace's own choice on the session its new-session button creates.
       *
       * `remote.session` is a namespaced Client service, so it is read through
       * `ctx.get`: reading an undeclared service off the context proxy throws
       * `cannot get property "…" without inject`, and optional chaining does not
       * catch a throwing getter. The whole region is optional — a deployment
       * without those two services loses only the model memory, never Workspace
       * ordering, the fold pass or the settings row.
       * @returns the teardown that puts both intercepted methods back.
       */
      const installWorkspaceModelMemory = () => {
        const remoteSession = unwrapService(ctx.get('remote.session'))
        const uiWorkspace = unwrapService(ctx.get('uiWorkspace'))
        if (typeof remoteSession?.selectModel !== 'function' || typeof uiWorkspace?.connectWorkspace !== 'function') {
          console.warn('[dsh-workspace-sort] remote.session or uiWorkspace is unavailable: the per-Workspace model memory is off')
          return () => {}
        }

        /** Non-zero while the plugin replays a stored choice, which is no user selection. */
        let replaying = 0

        /** Record one accepted selection against the Workspace owning its session. */
        const rememberSelection = (request) => {
          try {
            if (settingsStore.getSnapshot().rememberWorkspaceModel !== true) return
            if (typeof request?.sessionId !== 'string' || request.sessionId === '') return
            if (typeof request?.provider !== 'string' || typeof request?.model !== 'string') return
            const workspaceId = resolveSessionWorkspaceId(
              request.sessionId,
              workspacesService?.list?.getSnapshot?.()?.items,
              sessionSnapshot()?.byId,
            )
            if (workspaceId === null) return
            setWorkspaceModel(storage, workspaceId, {
              provider: request.provider,
              model: request.model,
              reasoningEffort: request.reasoningEffort,
            })
          } catch (error) {
            console.warn('[dsh-workspace-sort] the selected model was not recorded', error)
          }
        }

        /**
         * Replay one Workspace's stored choice on the session its new-session
         * button just produced. A session that already holds a message keeps its
         * own model, and a Workspace that never recorded one keeps the Host's
         * default selection.
         * @param workspaceId - the Workspace whose button was used.
         * @param sessionId - the session that button created or reused.
         */
        const replayWorkspaceModel = async (workspaceId, sessionId) => {
          try {
            if (settingsStore.getSnapshot().rememberWorkspaceModel !== true) return
            if (typeof workspaceId !== 'string' || workspaceId === '') return
            if (typeof sessionId !== 'string' || sessionId === '') return
            const summary = sessionSnapshot()?.byId?.[sessionId]
            if (summary !== undefined && summary.blank !== true) return
            const preference = getWorkspaceModel(storage, workspaceId)
            if (preference === null) return
            replaying += 1
            try {
              const result = await remoteSession.selectModel({
                sessionId,
                provider: preference.provider,
                model: preference.model,
                ...(preference.reasoningEffort === undefined ? {} : { reasoningEffort: preference.reasoningEffort }),
              })
              if (result?.ok === false) {
                console.warn('[dsh-workspace-sort] the Workspace model was refused for the new session', result.error)
              }
            } finally {
              replaying -= 1
            }
          } catch (error) {
            console.warn('[dsh-workspace-sort] the Workspace model was not applied to the new session', error)
          }
        }

        /**
         * Intercept the one funnel every model and thinking-depth change goes
         * through, so a choice made anywhere in a Workspace is remembered for it.
         */
        const restoreSelectModel = interceptMethod(remoteSession, 'selectModel', (original) => async function (...args) {
          const result = await original.apply(this, args)
          if (replaying === 0 && result?.ok !== false) rememberSelection(args[0])
          return result
        })

        /**
         * Every new-session button reaches the Host through `connectWorkspace`
         * (`startSession` → `openWorkspace` → `connectWorkspace`), which already
         * receives the resolved Workspace id and settles with the session id.
         */
        const restoreConnectWorkspace = interceptMethod(uiWorkspace, 'connectWorkspace', (original) => async function (...args) {
          const sessionId = await original.apply(this, args)
          await replayWorkspaceModel(args[0], sessionId)
          return sessionId
        })

        return () => {
          restoreSelectModel()
          restoreConnectWorkspace()
        }
      }

      /**
       * Mount the model memory once both services are live. They are declared
       * here rather than in the plugin's own `inject` list so that Workspace
       * ordering and the fold pass never wait on the model layer.
       */
      ctx.inject(['uiWorkspace', 'remote.session'], (scope) => {
        scope.effect(() => {
          try {
            return installWorkspaceModelMemory()
          } catch (error) {
            console.warn('[dsh-workspace-sort] the per-Workspace model memory failed to install', error)
            return () => {}
          }
        })
      })
      //#endregion

      ctx.on?.('dispose', () => {
        disposed = true
      })

      ctx.effect(() => {
        const disposers = []
        const workspacesModel = workspacesService?.list
        const sessionsModel = sessionsService?.list
        if (typeof workspacesModel?.subscribe === 'function') disposers.push(workspacesModel.subscribe(scheduleOrder))
        if (typeof sessionsModel?.subscribe === 'function') disposers.push(sessionsModel.subscribe(scheduleOrder))
        const observer = typeof MutationObserver !== 'undefined'
          ? new MutationObserver((mutations) => {
              const region = findRegion()
              if (mutations.some((mutation) => region === document || region.contains(mutation.target))) scheduleFold()
            })
          : null
        if (observer !== null && typeof document !== 'undefined') observer.observe(document.body, { childList: true, subtree: true })
        scheduleModeWatch()
        scheduleOrder()
        scheduleFold()
        return () => {
          for (const dispose of disposers) dispose()
          observer?.disconnect()
          if (orderTimer !== null) clearTimeout(orderTimer)
          if (foldTimer !== null) clearTimeout(foldTimer)
          if (modeTimer !== null) clearInterval(modeTimer)
          disposed = true
          if (typeof document !== 'undefined') {
            for (const control of document.querySelectorAll('[data-dws-fold]')) control.remove()
          }
        }
      }, 'workspace-sort: reconcilers')

      ctx.inject(['uiWorkspace'], (scope) => {
        mountConversationEdit(ctx, unwrapService(scope.get('uiWorkspace')))
      })

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'workspace-sort',
        order: 25,
        locale: NS,
        inject: () => ({ settings: settingsStore, update: updateSettings }),
      }, WorkspaceSortSettingsRow))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PROXY_SECTION_ID,
        order: PROXY_SECTION_ORDER,
        locale: PROXY_NS,
        label: () => proxyTranslate('title'),
      }, (slotProps) => h(ProxyRoutingSection, {
        t: (key, params) => {
          // Prefer the framework `t` seat the settings shell passes down; the
          // bound dictionary is the fallback so the page still renders without it.
          const seat = slotProps && typeof slotProps.t === 'function' ? slotProps.t : null
          if (seat !== null) {
            try {
              const value = seat(key)
              if (value !== undefined && value !== null && value !== key) {
                let out = String(value)
                if (params) {
                  for (const name of Object.keys(params)) out = out.split('{' + name + '}').join(String(params[name]))
                }
                return out
              }
            } catch {
              /* fall through to the bound translator */
            }
          }
          return proxyTranslate(key, params)
        },
      })))
    }
    //#endregion

    exports.apply = apply
    exports.inject = inject
    exports.__internals = {
      DEFAULT_SETTINGS,
      MAX_VISIBLE,
      SETTINGS_KEY,
      STYLE_ID,
      SETTINGS_CSS: css,
      VIEW_STORE_KEY,
      WORKSPACE_MODELS_KEY,
      normalizeLimit,
      normalizeSettings,
      normalizeModelPreference,
      loadWorkspaceModels,
      saveWorkspaceModels,
      getWorkspaceModel,
      setWorkspaceModel,
      resolveSessionWorkspaceId,
      workspaceRecency,
      sortWorkspacesByRecency,
      insertIdBefore,
      planWorkspaceMoves,
      planVisibleRows,
      readGroupBy,
      readArchivedFilter,
      visibleConversationIds,
      hiddenConversationCount,
      directGroupRows,
      hasClassSuffix,
      unwrapService,
      interceptMethod,
      WorkspaceSortSettingsRow,
      EDIT_DIALOG_ATTR,
      EDIT_BUTTON_ATTR,
      parseChatNodeKey,
      messageTextOf,
      windowEvents,
      countRemovedMessages,
      planForkEdit,
      reasonOf,
      waitForIdle,
      editViaFork,
      // LLM proxy routing page.
      PROXY_NS,
      PROXY_API_BASE,
      PROXY_SECTION_ID,
      PROXY_SECTION_ORDER,
      PROXY_STYLE_ID,
      PROXY_CLASS_PREFIX,
      PROXY_CSS,
      proxyZh,
      proxyEn,
      proxyUrlProblem,
      hostPatternProblem,
      toProxyPayload,
      validateProxyDraft,
      normalizeProxyDraft,
      proxyCatalogOf,
      proxyKnownHosts,
      proxySourceLabel,
      ProxyRoutingSection,
    }
    return module.exports
  },
})
