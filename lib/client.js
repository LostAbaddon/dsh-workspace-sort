window.__ModuleLoader__.load({
  id: 'dsh-workspace-sort',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

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

    /** Shipped defaults: the built-in hardcodes five idle conversations per Workspace. */
    const DEFAULT_SETTINGS = { visiblePerWorkspace: 5, sortWorkspaces: true }

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
      }
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

    //#region browser half: settings row
    const NS = 'workspaceSort'

    const zh = {
      'settings.title': '工作区对话排序',
      'settings.description': '按每个工作区里最新的对话时间戳，为工作区（含工作区树）降序排列；单列表模式保持默认排序。',
      'settings.countLabel': '每个工作区显示',
      'settings.countSuffix': '条对话',
      'settings.countHint': '系统默认 5 条。超出部分折叠在对话列表下方，收拢时显示还剩多少条，点击展开全部、再点击收拢。',
      'settings.sortLabel': '工作区按最新对话排序',
      'settings.sortHint': '关闭后工作区恢复为系统自身的排列顺序。',
      'fold.remaining': '还有 {n} 条对话',
      'fold.collapse': '收拢',
    }

    const en = {
      'settings.title': 'Workspace conversation order',
      'settings.description': 'Sorts Workspaces (and Workspace Tree sections) newest conversation first; the single-list mode keeps its default order.',
      'settings.countLabel': 'Show',
      'settings.countSuffix': 'conversations per Workspace',
      'settings.countHint': 'The system default is 5. Further conversations stay folded under the list: the collapsed line reports how many remain, and clicking it expands everything and then collapses it again.',
      'settings.sortLabel': 'Sort Workspaces by newest conversation',
      'settings.sortHint': 'Turn this off to restore the system’s own Workspace order.',
      'fold.remaining': '{n} more conversations',
      'fold.collapse': 'Collapse',
    }

    const STYLE_ID = 'dsh-workspace-sort/settings-row.css'
    const css = [
      '.dws-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dws-text{min-width:0}',
      '.dws-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dws-description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dws-controls{display:flex;align-items:center;gap:20px;flex:none}',
      '.dws-field{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dws-input{width:56px;padding:2px 6px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-elevated-fill,#0000);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:right}',
      '.dws-hint{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}',
      '.dws-toggle{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
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
        ]),
      ])
    }
    //#endregion

    //#region browser half: engine
    /** Required Client services. */
    const inject = ['slots', 'locale', 'workspaces', 'sessions', 'uiSession']

    /**
     * Mount the order reconciler, the sidebar fold pass and the settings row.
     * @param ctx - Client root Context.
     */
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-sort: dictionaries')

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

      ctx.on?.('dispose', () => {
        disposed = true
      })

      ctx.effect(() => {
        const disposers = []
        const workspacesModel = workspacesService?.list
        const sessionsModel = sessionsService?.list
        if (typeof workspacesModel?.subscribe === 'function') disposers.push(workspacesModel.subscribe(scheduleOrder))
        if (typeof sessionsModel?.subscribe === 'function') disposers.push(sessionsModel.subscribe(scheduleOrder))
        const observer = new MutationObserver((mutations) => {
          const region = findRegion()
          if (mutations.some((mutation) => region === document || region.contains(mutation.target))) scheduleFold()
        })
        if (typeof document !== 'undefined') observer.observe(document.body, { childList: true, subtree: true })
        scheduleModeWatch()
        scheduleOrder()
        scheduleFold()
        return () => {
          for (const dispose of disposers) dispose()
          observer.disconnect()
          if (orderTimer !== null) clearTimeout(orderTimer)
          if (foldTimer !== null) clearTimeout(foldTimer)
          if (modeTimer !== null) clearInterval(modeTimer)
          disposed = true
          for (const control of document.querySelectorAll('[data-dws-fold]')) control.remove()
        }
      }, 'workspace-sort: reconcilers')

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'workspace-sort',
        order: 25,
        locale: NS,
        inject: () => ({ settings: settingsStore, update: updateSettings }),
      }, WorkspaceSortSettingsRow))
    }
    //#endregion

    exports.apply = apply
    exports.inject = inject
    exports.__internals = {
      DEFAULT_SETTINGS,
      MAX_VISIBLE,
      SETTINGS_KEY,
      VIEW_STORE_KEY,
      normalizeLimit,
      normalizeSettings,
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
      WorkspaceSortSettingsRow,
    }
    return module.exports
  },
})
