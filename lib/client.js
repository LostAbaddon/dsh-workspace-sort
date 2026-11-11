window.__ModuleLoader__.load({
  id: 'dsh-workspace-sort',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    /** Short alias used by the proxy-routing page; the sidebar half spells `React.createElement`. */
    const h = React.createElement
    /**
     * The host's menu-row primitive, when this build exposes it. The host More
     * menu expects `MenuItemButton` children; the fallback is a plain button so
     * an older host still gets a usable menu.
     */
    let MenuItemButton = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (primitives !== null && primitives !== undefined && typeof primitives.MenuItemButton === 'function') {
        MenuItemButton = primitives.MenuItemButton
      }
    } catch (_noPrimitives) {
      MenuItemButton = null
    }

    //#region core: pure decision helpers
    /** Browser-local preference key, a sibling of the built-in `dsh.workspace.view.v5`. */
    const SETTINGS_KEY = 'dsh.workspace-sort.v1'
    /** Persisted key of the shipped sidebar browser's viewing store. */
    const VIEW_STORE_KEY = 'dsh.workspace.view.v5'
    /** The shipped browser's three viewing modes. */
    const FLAT_MODE = 'flat'
    /** The shipped browser's three viewing modes, in the order the shortcut cycles them. */
    const VIEW_MODES = ['workspace', 'workspace-tree', FLAT_MODE]
    /** Default binding of the view-mode cycle shortcut. */
    const DEFAULT_SHORTCUT = 'ctrl+shift+tab'
    /** Canonical modifier order inside a stored binding. */
    const SHORTCUT_MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta']
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
    const DEFAULT_SETTINGS = {
      visiblePerWorkspace: 5,
      sortWorkspaces: true,
      rememberWorkspaceModel: true,
      shortcutEnabled: true,
      shortcutBinding: DEFAULT_SHORTCUT,
    }

    /** Clamp one user-supplied count into the accepted range. */
    function normalizeLimit(value) {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
      if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.visiblePerWorkspace
      const whole = Math.trunc(parsed)
      if (whole < 1) return 1
      return whole > MAX_VISIBLE ? MAX_VISIBLE : whole
    }

    /** Spellings accepted for a shortcut modifier, folded to the canonical name. */
    const SHORTCUT_MODIFIER_ALIASES = {
      ctrl: 'ctrl',
      control: 'ctrl',
      '⌃': 'ctrl',
      shift: 'shift',
      '⇧': 'shift',
      alt: 'alt',
      option: 'alt',
      opt: 'alt',
      '⌥': 'alt',
      meta: 'meta',
      cmd: 'meta',
      command: 'meta',
      '⌘': 'meta',
    }

    /** Named keys the recorder and a stored binding may use. */
    const SHORTCUT_KEY_ALIASES = {
      tab: 'tab',
      iso_left_tab: 'tab',
      space: 'space',
      esc: 'escape',
      escape: 'escape',
      enter: 'enter',
      return: 'enter',
      backspace: 'backspace',
      delete: 'delete',
      del: 'delete',
      up: 'up',
      arrowup: 'up',
      down: 'down',
      arrowdown: 'down',
      left: 'left',
      arrowleft: 'left',
      right: 'right',
      arrowright: 'right',
      home: 'home',
      end: 'end',
      pageup: 'pageup',
      pagedown: 'pagedown',
      insert: 'insert',
    }

    /** Fold one keyboard key ("Tab", "ArrowUp", "a") to its stored spelling. */
    function normalizeShortcutKey(value) {
      if (typeof value !== 'string') return null
      if (value === ' ') return 'space'
      const key = value.trim().toLowerCase()
      if (key === '' || key === '+') return null
      const named = SHORTCUT_KEY_ALIASES[key]
      if (named !== undefined) return named
      if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
      if (key.length === 1) return key
      return null
    }

    /**
     * Parse one binding ("ctrl+shift+tab", "Ctrl + Shift + Tab") into its key
     * and modifier set; null when it carries no modifier, no key or an unknown token.
     * @param value - stored or user-written binding.
     * @returns the parsed binding, or null.
     */
    function parseShortcut(value) {
      if (typeof value !== 'string') return null
      const parts = value.trim().toLowerCase().split(/[+\s]+/).filter((part) => part !== '')
      if (parts.length < 2) return null
      const modifiers = new Set()
      let key = null
      for (const part of parts) {
        const modifier = SHORTCUT_MODIFIER_ALIASES[part]
        if (modifier !== undefined) {
          modifiers.add(modifier)
          continue
        }
        const normalized = normalizeShortcutKey(part)
        if (normalized === null || key !== null) return null
        key = normalized
      }
      if (key === null || modifiers.size === 0) return null
      return { key, modifiers }
    }

    /** Normalize a stored binding to the canonical spelling, falling back to the default. */
    function normalizeShortcut(value) {
      const parsed = parseShortcut(value)
      if (parsed === null) return DEFAULT_SHORTCUT
      return [...SHORTCUT_MODIFIER_ORDER.filter((name) => parsed.modifiers.has(name)), parsed.key].join('+')
    }

    /** The binding a keydown would produce, or null for a modifier-only press. */
    function shortcutFromEvent(event) {
      if (event === null || typeof event !== 'object') return null
      if (event.repeat === true || event.isComposing === true) return null
      const key = normalizeShortcutKey(event.key)
      if (key === null) return null
      const modifiers = []
      if (event.ctrlKey === true) modifiers.push('ctrl')
      if (event.altKey === true) modifiers.push('alt')
      if (event.shiftKey === true) modifiers.push('shift')
      if (event.metaKey === true) modifiers.push('meta')
      if (modifiers.length === 0) return null
      return [...modifiers, key].join('+')
    }

    /** True when one keydown carries exactly the stored binding's chord. */
    function shortcutMatches(binding, event) {
      if (event === null || typeof event !== 'object') return false
      if (event.repeat === true || event.isComposing === true) return false
      const parsed = parseShortcut(binding)
      if (parsed === null) return false
      const key = normalizeShortcutKey(event.key)
      if (key === null || key !== parsed.key) return false
      return (event.ctrlKey === true) === parsed.modifiers.has('ctrl')
        && (event.altKey === true) === parsed.modifiers.has('alt')
        && (event.shiftKey === true) === parsed.modifiers.has('shift')
        && (event.metaKey === true) === parsed.modifiers.has('meta')
    }

    /** True on a macOS-like visiting device; the shortcut label follows the keyboard. */
    function isMacPlatform() {
      try {
        const platform = typeof navigator === 'undefined' ? '' : String(navigator.platform ?? '')
        return /mac|iphone|ipad/i.test(platform)
      } catch (_noNavigator) {
        return false
      }
    }

    /** Render one stored binding for the settings row. */
    function shortcutLabel(binding, mac = isMacPlatform()) {
      const parsed = parseShortcut(binding) ?? parseShortcut(DEFAULT_SHORTCUT)
      const modifierLabels = {
        ctrl: 'Ctrl',
        alt: mac ? 'Option' : 'Alt',
        shift: 'Shift',
        meta: mac ? 'Cmd' : 'Meta',
      }
      const keyLabels = {
        tab: 'Tab',
        space: 'Space',
        escape: 'Esc',
        enter: 'Enter',
        backspace: 'Backspace',
        delete: 'Delete',
        up: '↑',
        down: '↓',
        left: '←',
        right: '→',
        home: 'Home',
        end: 'End',
        pageup: 'Page Up',
        pagedown: 'Page Down',
        insert: 'Insert',
      }
      const modifiers = SHORTCUT_MODIFIER_ORDER
        .filter((name) => parsed.modifiers.has(name))
        .map((name) => modifierLabels[name])
      return [...modifiers, keyLabels[parsed.key] ?? parsed.key.toUpperCase()].join(' + ')
    }

    /** Render one stored binding in the ARIA keystroke syntax. */
    function shortcutAria(binding) {
      const parsed = parseShortcut(binding) ?? parseShortcut(DEFAULT_SHORTCUT)
      const modifierLabels = { ctrl: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta' }
      const keyLabels = {
        tab: 'Tab',
        space: 'Space',
        escape: 'Escape',
        enter: 'Enter',
        backspace: 'Backspace',
        delete: 'Delete',
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        home: 'Home',
        end: 'End',
        pageup: 'PageUp',
        pagedown: 'PageDown',
        insert: 'Insert',
      }
      const modifiers = SHORTCUT_MODIFIER_ORDER
        .filter((name) => parsed.modifiers.has(name))
        .map((name) => modifierLabels[name])
      return [...modifiers, keyLabels[parsed.key] ?? parsed.key.toUpperCase()].join('+')
    }

    /** The mode one press moves to, in the order the sidebar ships its three views. */
    function nextViewMode(current) {
      const index = VIEW_MODES.indexOf(current)
      return index === -1 ? VIEW_MODES[0] : VIEW_MODES[(index + 1) % VIEW_MODES.length]
    }

    /**
     * Apply one cycle to the shipped viewing store.
     * @param view - the setGroupBy action set the host's own View options menu calls.
     * @param storage - localStorage holding the shipped view store.
     * @param fallback - the last mode this session applied, for a browser that refuses storage.
     * @returns the mode that was applied, or null when the bridge is absent.
     */
    function cycleViewMode(view, storage, fallback = null) {
      if (view === null || view === undefined || typeof view.setGroupBy !== 'function') return null
      const readable = storage !== null && storage !== undefined && typeof storage.getItem === 'function'
      const next = nextViewMode(readable ? readGroupBy(storage) : fallback)
      view.setGroupBy(next)
      return next
    }

    /** Fold a stored/partial preference document into a complete settings object. */
    function normalizeSettings(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        visiblePerWorkspace: normalizeLimit(source.visiblePerWorkspace),
        sortWorkspaces: source.sortWorkspaces !== false,
        rememberWorkspaceModel: source.rememberWorkspaceModel !== false,
        shortcutEnabled: source.shortcutEnabled !== false,
        shortcutBinding: normalizeShortcut(source.shortcutBinding),
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

    /**
     * Every Workspace that can claim a Session, membership first.
     *
     * `resolveSessionWorkspaceId` answers with the FIRST match, which is right
     * when a Session is already a member of one Workspace. A Session that has
     * only just been created may not be listed as a member yet, and several
     * Workspaces can share one directory — so a caller that must not guess needs
     * the whole candidate list to tell whether its answer is unique.
     * @param sessionId - Session identity.
     * @param workspaces - the Workspace list snapshot.
     * @param sessionsById - the Session list snapshot's rows.
     * @returns the claiming Workspaces, empty when none can be named.
     */
    function workspacesClaiming(sessionId, workspaces, sessionsById) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      const list = Array.isArray(workspaces) ? workspaces : []
      const members = list.filter((workspace) => Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId))
      if (members.length > 0) return members
      const cwd = sessionsById?.[sessionId]?.cwd
      if (typeof cwd !== 'string' || cwd === '') return []
      return list.filter((workspace) => typeof workspace?.path === 'string' && workspace.path === cwd)
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
      'settings.shortcutTitle': '视图模式循环快捷键',
      'settings.shortcutDescription': '按下组合键，在「按工作区」「按工作区树」「单列表」三种视图之间循环切换。',
      'settings.shortcutEnable': '启用快捷键',
      'settings.shortcutHint': '默认 Ctrl + Shift + Tab；点击按键显示区后可重新录制，Esc 取消，组合键至少包含一个修饰键。',
      'settings.shortcutRecording': '请按下组合键…（Esc 取消）',
      'settings.shortcutRecord': '录制新的组合键',
      'settings.shortcutReset': '恢复默认',
      'settings.shortcutCycle': '循环顺序：按工作区 → 按工作区树 → 单列表。',
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
      'settings.shortcutTitle': 'Cycle the view mode',
      'settings.shortcutDescription': 'Press the chord to cycle the sidebar between WorkSpace, Workspace Tree, and the single list.',
      'settings.shortcutEnable': 'Enable shortcut',
      'settings.shortcutHint': 'Default Ctrl + Shift + Tab. Click the key display to record another chord; Esc cancels. A chord needs at least one modifier.',
      'settings.shortcutRecording': 'Press a chord… (Esc cancels)',
      'settings.shortcutRecord': 'Record a new shortcut',
      'settings.shortcutReset': 'Restore default',
      'settings.shortcutCycle': 'Cycle order: WorkSpace → Workspace Tree → Single list.',
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
      '.dws-shortcut{display:inline-flex;align-items:center;justify-content:center;min-width:96px;padding:3px 10px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-elevated-fill,#0000);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dws-shortcut:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}',
      '.dws-shortcut[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dws-shortcut:disabled{opacity:.5;cursor:default}',
      '.dws-shortcut-reset{padding:0;border:none;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}',
      '.dws-shortcut-reset:hover{color:var(--dsw-alias-label-secondary)}',
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

    /**
     * One General-settings row for the configurable view-mode cycle.
     *
     * Clicking the key display arms an inline recorder: the next chord with at
     * least one modifier becomes the binding, Escape cancels. The recorder
     * publishes its armed state through the shared store so the global listener
     * never runs while a new chord is being captured.
     * @param props - the shared settings store, the updater, the recorder flag store and the locale seat.
     * @returns the settings row element tree.
     */
    function WorkspaceShortcutSettingsRow(props) {
      const t = props.t
      const store = props.settings
      const update = props.update
      const recorder = props.recorder
      const setRecorder = (value) => {
        if (recorder !== null && recorder !== undefined && typeof recorder.set === 'function') recorder.set(value)
      }
      const [snapshot, setSnapshot] = React.useState(store.getSnapshot())
      const [recording, setRecording] = React.useState(false)

      React.useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store])

      React.useEffect(() => {
        setRecorder(recording)
        if (recording !== true) return () => {}
        const win = typeof window === 'undefined' ? null : window
        if (win === null || typeof win.addEventListener !== 'function') return () => {}
        /** A click anywhere outside the key display abandons the recording. */
        const onPointerDown = (event) => {
          const target = event === null || event === undefined ? null : event.target
          if (target !== null && target !== undefined && typeof target.closest === 'function'
            && target.closest('[data-dws-shortcut-recorder]') !== null) return
          setRecording(false)
        }
        const onKeyDown = (event) => {
          if (event === null || event === undefined) return
          event.preventDefault()
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
          else if (typeof event.stopPropagation === 'function') event.stopPropagation()
          if (event.key === 'Escape') {
            setRecording(false)
            return
          }
          const binding = shortcutFromEvent(event)
          if (binding === null) return
          update({ shortcutBinding: binding, shortcutEnabled: true })
          setRecording(false)
        }
        win.addEventListener('pointerdown', onPointerDown, true)
        win.addEventListener('keydown', onKeyDown, true)
        return () => {
          win.removeEventListener('keydown', onKeyDown, true)
          win.removeEventListener('pointerdown', onPointerDown, true)
          setRecorder(false)
        }
      }, [recording, recorder, update])

      const enabled = snapshot.shortcutEnabled === true
      const keys = shortcutLabel(snapshot.shortcutBinding)
      return React.createElement('div', { className: 'dws-row' }, [
        React.createElement('div', { className: 'dws-text', key: 'text' }, [
          React.createElement('div', { className: 'dws-title', key: 'title' }, t('settings.shortcutTitle')),
          React.createElement('div', { className: 'dws-description', key: 'description' }, t('settings.shortcutDescription')),
          React.createElement('div', { className: 'dws-hint', key: 'hint' }, t('settings.shortcutHint')),
          React.createElement('div', { className: 'dws-hint', key: 'cycle' }, t('settings.shortcutCycle')),
        ]),
        React.createElement('div', { className: 'dws-controls', key: 'controls' }, [
          React.createElement('label', { className: 'dws-toggle', key: 'toggle' }, [
            React.createElement('input', {
              key: 'box',
              type: 'checkbox',
              checked: enabled,
              'aria-label': t('settings.shortcutEnable'),
              onChange: (event) => update({ shortcutEnabled: event.target.checked }),
            }),
            React.createElement('span', { key: 'text' }, t('settings.shortcutEnable')),
          ]),
          React.createElement('button', {
            key: 'keys',
            type: 'button',
            className: 'dws-shortcut',
            'data-dws-shortcut-recorder': 'true',
            'aria-label': recording ? t('settings.shortcutRecording') : t('settings.shortcutRecord') + ': ' + keys,
            'aria-pressed': recording,
            'aria-keyshortcuts': enabled ? shortcutAria(snapshot.shortcutBinding) : undefined,
            disabled: !enabled,
            onClick: () => setRecording((value) => !value),
            onBlur: () => setRecording(false),
          }, recording ? t('settings.shortcutRecording') : keys),
          React.createElement('button', {
            key: 'reset',
            type: 'button',
            className: 'dws-shortcut-reset',
            onClick: () => update({ shortcutBinding: DEFAULT_SHORTCUT }),
          }, t('settings.shortcutReset')),
        ]),
      ])
    }
    //#endregion

    //#region core: sidebar panel folding
    /** Browser-local preference document for the sidebar's global panel rows. */
    const PANEL_SETTINGS_KEY = 'dsh.workspace-sort.panels.v1'
    /** Fold once the sidebar holds more than six panel rows. */
    const PANEL_DEFAULT_SETTINGS = { enabled: true, limit: 6, mode: 'auto', order: [], shown: [] }
    /** Accepted range of the visible-row ceiling. */
    const PANEL_LIMIT_MIN = 1
    const PANEL_LIMIT_MAX = 32
    /**
     * Marker attributes. Every DOM write of this feature is addressed by one of
     * them, never by a CSS-module hash: the hashed class names are build output
     * and are the first thing a host rebuild changes.
     */
    const PANEL_NAV_ATTR = 'data-dwsn-nav'
    const PANEL_ROW_ATTR = 'data-dwsn-row'
    const PANEL_ID_ATTR = 'data-dwsn-id'
    const PANEL_SHOWN_ATTR = 'data-dwsn-shown'
    const PANEL_DRAGGING_ATTR = 'data-dwsn-dragging'
    const PANEL_DRAGGED_ATTR = 'data-dwsn-dragged'
    const PANEL_REORDER_ATTR = 'data-dwsn-reorder'
    const PANEL_DONE_ATTR = 'data-dwsn-done'
    const PANEL_TRIGGER_ATTR = 'data-dwsn-trigger'
    const PANEL_POP_ATTR = 'data-dwsn-pop'
    /** Style tag identity for the folded list's own controls. */
    const PANEL_STYLE_ID = 'dsh-workspace-sort/panels.css'
    /** Settings section identity and its place among the first-level sections. */
    const PANEL_SECTION_ID = 'sidebar-panels'
    const PANEL_SECTION_ORDER = 153
    /** Long-press delay, and the pointer travel that still counts as a click. */
    const PANEL_PRESS_MS = 380
    const PANEL_PRESS_TOLERANCE_PX = 6

    /** Clamp one user-supplied panel ceiling into the accepted range. */
    function normalizePanelLimit(value) {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
      if (!Number.isFinite(parsed)) return PANEL_DEFAULT_SETTINGS.limit
      const whole = Math.trunc(parsed)
      if (whole < PANEL_LIMIT_MIN) return PANEL_LIMIT_MIN
      return whole > PANEL_LIMIT_MAX ? PANEL_LIMIT_MAX : whole
    }

    /** Keep the meaningful ids of a stored list, in order and without duplicates. */
    function normalizePanelIds(raw) {
      if (!Array.isArray(raw)) return []
      const seen = new Set()
      const ids = []
      for (const value of raw) {
        if (typeof value !== 'string' || value === '' || seen.has(value)) continue
        seen.add(value)
        ids.push(value)
      }
      return ids
    }

    /** Fold a stored/partial panel preference document into a complete one. */
    function normalizePanelSettings(raw) {
      const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      return {
        enabled: source.enabled !== false,
        limit: normalizePanelLimit(source.limit),
        mode: source.mode === 'manual' ? 'manual' : 'auto',
        order: normalizePanelIds(source.order),
        shown: normalizePanelIds(source.shown),
      }
    }

    /** Read the panel preferences, tolerating an absent or refusing storage. */
    function loadPanelSettings(storage) {
      try {
        const raw = storage?.getItem(PANEL_SETTINGS_KEY)
        if (raw === null || raw === undefined) return { ...PANEL_DEFAULT_SETTINGS }
        return normalizePanelSettings(JSON.parse(raw))
      } catch (_unreadablePanels) {
        return { ...PANEL_DEFAULT_SETTINGS }
      }
    }

    /** Persist the panel preferences; a refusing storage costs durability, never the session. */
    function savePanelSettings(storage, settings) {
      try {
        storage?.setItem(PANEL_SETTINGS_KEY, JSON.stringify(settings))
      } catch (_unwritablePanels) {
        /* keep the in-memory value */
      }
    }

    /** Resolve one slot label, which may be a locale-aware thunk. */
    function resolvePanelLabel(label) {
      let value = label
      if (typeof value === 'function') {
        try {
          value = value()
        } catch (_labelThrew) {
          value = null
        }
      }
      return typeof value === 'string' && value !== '' ? value : null
    }

    /**
     * The authoritative panel list, in the sidebar's own order: each
     * registration's id, resolved label, and order key. Duplicate ids collapse
     * to the first registration, exactly like the host's keyed rows.
     * @param entries - slot entries from the sidebar.panellist list.
     * @returns [{ id, label }] sorted by the host order key.
     */
    function panelCatalogOf(entries) {
      const rows = []
      const seen = new Set()
      for (const entry of Array.isArray(entries) ? entries : []) {
        const options = entry?.options ?? entry ?? {}
        const id = typeof options.id === 'string' && options.id !== '' ? options.id : null
        if (id === null || seen.has(id)) continue
        seen.add(id)
        const label = resolvePanelLabel(options.label) ?? id
        const order = typeof options.order === 'number' && Number.isFinite(options.order) ? options.order : 0
        rows.push({ id, label, order })
      }
      rows.sort((left, right) => left.order - right.order)
      return rows.map((row) => ({ id: row.id, label: row.label }))
    }

    /** Read the panel catalog from the live slot registry, or an empty list. */
    function readPanelCatalog(slots) {
      try {
        if (typeof slots?.entriesOfSlot !== 'function') return []
        return panelCatalogOf(slots.entriesOfSlot('sidebar.panellist'))
      } catch (_unreadablePanels) {
        return []
      }
    }

    /** True when both catalogs describe the same panel list in the same order. */
    function samePanelCatalog(left, right) {
      if (left.length !== right.length) return false
      return left.every((panel, index) => panel.id === right[index].id && panel.label === right[index].label)
    }

    /**
     * Merge the user's saved order with the live panel list: known ids keep
     * their saved position, ids the user has never seen follow in host order,
     * and ids that left the registry are dropped from the working order.
     * @param order - the persisted id order.
     * @param panels - the live catalog.
     * @returns the complete working order.
     */
    function mergePanelOrder(order, panels) {
      const available = panels.map((panel) => panel.id)
      const known = new Set(available)
      const merged = []
      for (const id of normalizePanelIds(order)) {
        if (known.has(id) && !merged.includes(id)) merged.push(id)
      }
      for (const id of available) {
        if (!merged.includes(id)) merged.push(id)
      }
      return merged
    }

    /**
     * Decide which panel rows this snapshot shows.
     *
     * auto keeps the first limit rows of the working order; manual keeps
     * exactly the checked ids and ignores the ceiling, because an explicit
     * selection is the user's answer. The panel currently open is always kept:
     * hiding the row of the page the user is reading would strand it.
     * @param panels - the live catalog.
     * @param settings - the panel preferences.
     * @param activeId - the selected panel id, when known.
     * @returns the working order plus the shown and hidden ids in that order.
     */
    function planPanelVisibility(panels, settings, activeId) {
      const catalog = Array.isArray(panels) ? panels : []
      const normalized = normalizePanelSettings(settings)
      const order = mergePanelOrder(normalized.order, catalog)
      const known = new Set(order)
      const show = new Set()
      if (normalized.enabled) {
        if (normalized.mode === 'manual') {
          for (const id of normalized.shown) {
            if (known.has(id)) show.add(id)
          }
        } else {
          for (let index = 0; index < order.length && index < normalized.limit; index += 1) {
            show.add(order[index])
          }
        }
      } else {
        for (const id of order) show.add(id)
      }
      if (typeof activeId === 'string' && known.has(activeId)) show.add(activeId)
      // The host keeps its plugin manager entry reachable in every state; the
      // More menu excludes it, so folding it would strand the panel.
      if (known.has('plugins')) show.add('plugins')
      return {
        enabled: normalized.enabled,
        mode: normalized.mode,
        limit: normalized.limit,
        order,
        shown: order.filter((id) => show.has(id)),
        hidden: order.filter((id) => !show.has(id)),
      }
    }

    /**
     * Move one id to a final index. The index is read after removal, which is
     * what the settings page up/down controls and the drag preview both use.
     * @param order - the working order.
     * @param id - the id to move.
     * @param targetIndex - its final position, clamped into the list.
     * @returns a new order; an unknown id leaves a copy of the input.
     */
    function movePanelId(order, id, targetIndex) {
      const list = Array.isArray(order) ? order.slice() : []
      const from = list.indexOf(id)
      if (from < 0) return list
      list.splice(from, 1)
      const to = Math.max(0, Math.min(Math.trunc(targetIndex), list.length))
      list.splice(to, 0, id)
      return list
    }

    /**
     * The insertion slot a pointer Y names among the rendered rows. Rects are
     * supplied in visual order; the slot is 0 before the first row and
     * rects.length after the last.
     * @param rects - each rendered row's client rect, in visual order.
     * @param pointerY - the pointer's client Y.
     * @returns the insertion slot.
     */
    function panelInsertionSlot(rects, pointerY) {
      let slot = 0
      for (const rect of rects) {
        if (rect === null || rect === undefined) continue
        if (pointerY >= rect.top + rect.height / 2) slot += 1
      }
      return slot
    }

    /** Translate an insertion slot among all rows into a final index after removal. */
    function panelDropIndex(order, id, slot) {
      const from = order.indexOf(id)
      if (from < 0) return -1
      const target = slot > from ? slot - 1 : slot
      return Math.max(0, Math.min(target, order.length - 1))
    }

    /** The panel id a rendered row stands for, from its stamp, label, or position. */
    function panelRowId(row, panels, index) {
      const stamped = row?.getAttribute?.(PANEL_ID_ATTR)
      if (typeof stamped === 'string' && stamped !== '' && panels.some((panel) => panel.id === stamped)) return stamped
      const label = row?.getAttribute?.('aria-label') ?? ''
      const matches = panels.filter((panel) => panel.label === label)
      if (matches.length === 1) return matches[0].id
      const byIndex = panels[index]
      if (byIndex !== undefined && byIndex.label === label) return byIndex.id
      return 'pos:' + index
    }

    /** True when the node is the host's own More launcher rather than a panel row. */
    function panelMoreButton(node) {
      if (node === null || node === undefined || typeof node.getAttribute !== 'function') return false
      if (node.hasAttribute(PANEL_TRIGGER_ATTR) === true) return false
      return node.getAttribute('aria-haspopup') === 'menu'
    }

    /**
     * The rendered panel rows of one sidebar nav, in DOM order. The host's More
     * launcher is a panel-shaped button too, so it is filtered out by its menu
     * affordance and by this plugin's own trigger marker.
     * @param nav - the rendered panel list.
     * @returns the panel row buttons.
     */
    function panelRowsOf(nav) {
      if (nav === null || nav === undefined || typeof nav.querySelectorAll !== 'function') return []
      const rows = []
      for (const button of nav.querySelectorAll('button')) {
        if (button.closest?.('button') !== button) continue
        if (panelMoreButton(button)) continue
        if (button.hasAttribute(PANEL_TRIGGER_ATTR) === true) continue
        if (button.hasAttribute(PANEL_DONE_ATTR) === true) continue
        if (button.getAttribute('aria-label') === null) continue
        rows.push(button)
      }
      return rows
    }

    /** The host's More launcher inside the nav, when this build renders one. */
    function hostPanelMore(nav) {
      if (nav === null || nav === undefined || typeof nav.querySelector !== 'function') return null
      const button = nav.querySelector('button[aria-haspopup="menu"]')
      if (button === null || button === undefined) return null
      if (button.hasAttribute(PANEL_TRIGGER_ATTR) === true) return null
      return button
    }

    /**
     * Find the sidebar's global panel list. Label matching against the live
     * slot catalog is preferred because it follows the locale; a structural
     * fallback covers the first frames before any label is known.
     * @param doc - the document to search.
     * @param panels - the live panel catalog.
     * @returns the nav element, or null.
     */
    function findPanelNav(doc, panels) {
      if (doc === null || doc === undefined || typeof doc.querySelectorAll !== 'function') return null
      const marked = doc.querySelector('nav[' + PANEL_NAV_ATTR + ']')
      if (marked !== null && marked !== undefined) return marked
      const known = new Set(panels.map((panel) => panel.label))
      let best = null
      let bestScore = 0
      const structural = []
      for (const candidate of doc.querySelectorAll('nav')) {
        const rows = panelRowsOf(candidate)
        let score = 0
        for (const row of rows) {
          if (known.has(row.getAttribute('aria-label') ?? '')) score += 1
        }
        if (score > bestScore) {
          best = candidate
          bestScore = score
        }
        const direct = Array.from(candidate.children ?? []).filter((child) => child.tagName === 'BUTTON')
        if (direct.length >= 2) {
          const parent = candidate.parentElement
          if (parent !== null && parent !== undefined && typeof getComputedStyle === 'function') {
            try {
              const style = getComputedStyle(parent)
              if (style.display.includes('flex') && style.flexDirection === 'column') structural.push(candidate)
            } catch (_styleUnreadable) {}
          }
        }
      }
      if (best !== null && bestScore > 0) {
        best.setAttribute(PANEL_NAV_ATTR, '1')
        return best
      }
      if (structural.length === 1) {
        structural[0].setAttribute(PANEL_NAV_ATTR, '1')
        return structural[0]
      }
      return null
    }

    /** Stamp each rendered row with the panel id it stands for. */
    function stampPanelRows(rows, panels) {
      return rows.map((row, index) => {
        const id = panelRowId(row, panels, index)
        if (row.getAttribute(PANEL_ID_ATTR) !== id) row.setAttribute(PANEL_ID_ATTR, id)
        if (row.getAttribute(PANEL_ROW_ATTR) !== '1') row.setAttribute(PANEL_ROW_ATTR, '1')
        return { row, id }
      })
    }
    //#endregion

    //#region browser half: sidebar panel folding
    /** Locale namespace of the panel-folding page and the host More menu rows. */
    const PANEL_NS = 'workspaceSortPanels'

    /** Chinese copy of the panel-folding UI. */
    const panelZh = {
      'section.title': '侧边栏面板',
      'section.intro': '面板图标超过设定数量时，靠后的收进侧边栏的「更多」；长按面板图标约 0.4 秒后拖动即可调整顺序，长按后松手会展开全部面板，方便把折叠项移到前面。',
      'general.title': '折叠设置',
      'general.desc': '自动模式下按顺序保留前 N 个，其余收进「更多」；手动模式以勾选为准。',
      'enabled.label': '启用面板折叠',
      'enabled.desc': '关闭后侧栏恢复显示全部面板，已保存的顺序与勾选会保留。',
      'limit.label': '最多显示',
      'limit.suffix': '个面板',
      'limit.desc': '自动模式下，超出这个数量的面板会收进「更多」；当前打开的面板始终显示。',
      'mode.label': '折叠方式',
      'mode.auto': '按顺序保留前 N 个',
      'mode.autoHint': '按当前顺序保留前 N 个，其余收进「更多」。',
      'mode.manual': '只显示勾选的面板',
      'mode.manualHint': '手动模式不受数量上限约束；当前打开的面板无论是否勾选都会显示。',
      'list.title': '顺序与显示',
      'list.desc': '这里的顺序决定自动模式保留哪几个；也可以在侧栏长按图标拖动来调整。',
      'list.empty': '当前没有注册任何全局面板。',
      'list.moveUp': '上移 {name}',
      'list.moveDown': '下移 {name}',
      'list.show': '显示 {name}',
      'list.hide': '收起 {name}',
      'list.auto': '自动',
      'list.manual': '手动',
      'list.checkLabel': '显示',
      'list.summary': '显示 {shown} 个 · 折叠 {hidden} 个',
      'list.reset': '恢复默认',
      'trigger.more': '更多面板',
      'trigger.moreCount': '更多面板（{n}）',
      'pop.title': '已折叠的面板',
      'pop.hint': '点一个面板打开它；显示与顺序在「设置 → 侧边栏面板」里调整。',
      'pop.empty': '没有折叠的面板。',
      'pop.close': '关闭',
      'reorder.done': '完成排序',
    }

    /** English mirror; every panelZh key is present. */
    const panelEn = {
      'section.title': 'Sidebar panels',
      'section.intro': 'Once the panel icons exceed the configured count, the trailing ones move into the sidebar More menu; press and hold a panel icon for about 0.4 s, then drag to reorder. Releasing the hold without moving expands every panel so a folded one can be dragged forward.',
      'general.title': 'Folding',
      'general.desc': 'Auto keeps the first N in order and folds the rest into More; manual follows the checkboxes exactly.',
      'enabled.label': 'Enable panel folding',
      'enabled.desc': 'When off, the sidebar shows every panel again; the saved order and checks are kept.',
      'limit.label': 'Show at most',
      'limit.suffix': 'panels',
      'limit.desc': 'In auto mode, panels beyond this count move into More; the open panel is always shown.',
      'mode.label': 'Folding mode',
      'mode.auto': 'Keep the first N in order',
      'mode.autoHint': 'Keep the first N in the current order and fold the rest into More.',
      'mode.manual': 'Show only checked panels',
      'mode.manualHint': 'Manual mode ignores the count ceiling; the open panel is always shown whether checked or not.',
      'list.title': 'Order and visibility',
      'list.desc': 'This order decides which rows auto mode keeps; you can also reorder by holding and dragging icons in the sidebar.',
      'list.empty': 'No global panels are registered right now.',
      'list.moveUp': 'Move {name} up',
      'list.moveDown': 'Move {name} down',
      'list.show': 'Show {name}',
      'list.hide': 'Fold {name}',
      'list.auto': 'Auto',
      'list.manual': 'Manual',
      'list.checkLabel': 'Show',
      'list.summary': '{shown} shown · {hidden} folded',
      'list.reset': 'Reset to default',
      'trigger.more': 'More panels',
      'trigger.moreCount': 'More panels ({n})',
      'pop.title': 'Folded panels',
      'pop.hint': 'Pick a panel to open it; visibility and order live in Settings → Sidebar panels.',
      'pop.empty': 'No folded panels.',
      'pop.close': 'Close',
      'reorder.done': 'Done',
    }

    /** Substitute the small {name} placeholders the dictionaries use. */
    function panelText(t, key, params) {
      let out
      try {
        out = t(key)
      } catch (_translateFailed) {
        out = key
      }
      if (out === undefined || out === null) out = key
      let text = String(out)
      if (params) {
        for (const name of Object.keys(params)) text = text.split('{' + name + '}').join(String(params[name]))
      }
      return text
    }

    /** Panel-folding stylesheet: layout numbers and theme tokens only. */
    const PANEL_CSS = [
      '.dwsn-page{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}',
      '.dwsn-title{margin:0;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}',
      '.dwsn-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}',
      '.dwsn-card{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}',
      '.dwsn-cardHead{display:flex;flex-direction:column;gap:2px}',
      '.dwsn-cardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.dwsn-cardDesc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dwsn-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:10px 0}',
      '.dwsn-row+.dwsn-row{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.dwsn-rowText{flex:1;min-width:0}',
      '.dwsn-rowTitle{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dwsn-rowDesc{margin-top:3px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.dwsn-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;justify-content:flex-end;min-width:0}',
      '.dwsn-toggle{display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dwsn-field{display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dwsn-input{width:64px;padding:2px 6px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:right}',
      '.dwsn-modes{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0}',
      '.dwsn-mode{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dwsn-mode input{margin-top:3px}',
      '.dwsn-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.dwsn-list{display:flex;flex-direction:column}',
      '.dwsn-item{display:flex;align-items:center;gap:8px;min-height:38px;padding:6px 0;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.dwsn-item:first-child{border-top:none}',
      '.dwsn-itemIndex{flex:none;width:20px;text-align:right;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.dwsn-itemText{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.dwsn-itemName{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dwsn-itemId{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dwsn-tag{flex:none;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);padding:0 5px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '.dwsn-check{flex:none;display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dwsn-iconButton{flex:none;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer}',
      '.dwsn-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dwsn-iconButton:disabled{opacity:.35;cursor:default}',
      '.dwsn-iconButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.dwsn-footer{display:flex;flex-wrap:wrap;align-items:center;gap:10px}',
      '.dwsn-summary{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dwsn-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dwsn-button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dwsn-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.dwsn-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '[data-dwsn-row][data-dwsn-shown="0"]{display:none!important}',
      '[data-dwsn-dragging] [data-dwsn-row]{user-select:none;-webkit-user-select:none;cursor:grabbing}',
      '[data-dwsn-dragging] [data-dwsn-row][data-dwsn-shown="0"]{display:flex!important}',
      '[data-dwsn-reorder] [data-dwsn-row][data-dwsn-shown="0"]{display:flex!important}',
      '[data-dwsn-dragged="1"]{opacity:.55}',
      'button[data-dwsn-done]{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:calc(100% - 4px);min-height:32px;margin:4px 2px 0;padding:4px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      'button[data-dwsn-done]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      'button[data-dwsn-done]:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      'button[data-dwsn-done][data-rail="1"]{width:36px;height:36px;min-height:36px;margin:0;padding:0;font-size:0}',
      'button[data-dwsn-done][data-rail="1"]::after{content:"✓";font-size:16px;line-height:1}',
      'button[data-dwsn-trigger]{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% - 4px);min-height:36px;margin:0 2px;padding:7px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}',
      'button[data-dwsn-trigger]:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      'button[data-dwsn-trigger]:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      'button[data-dwsn-trigger][data-rail="1"]{width:36px;height:36px;min-height:36px;margin:0;padding:0;justify-content:center}',
      'button[data-dwsn-trigger][data-rail="1"] .dwsn-trigger-label{display:none}',
      'button[data-dwsn-trigger][data-rail="1"] .dwsn-trigger-badge{display:none}',
      'button[data-dwsn-trigger] .dwsn-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      'button[data-dwsn-trigger] .dwsn-trigger-badge{margin-left:auto;flex:none;min-width:18px;height:16px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:16px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '[data-dwsn-pop]{position:fixed;z-index:2147483000;box-sizing:border-box;width:min(280px,calc(100vw - 24px));max-height:min(64vh,460px);overflow:auto;padding:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(0,0,0,.24);font-family:inherit;font-size:13px;line-height:20px;-webkit-overflow-scrolling:touch}',
      '[data-dwsn-pop] .dwsn-pop-head{display:flex;align-items:center;gap:8px;padding:2px 4px 6px;font-weight:500}',
      '[data-dwsn-pop] .dwsn-pop-head button{margin-left:auto;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;line-height:1}',
      '[data-dwsn-pop] .dwsn-pop-head button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '[data-dwsn-pop] .dwsn-pop-item{display:flex;width:100%;align-items:center;gap:8px;min-height:32px;padding:5px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '[data-dwsn-pop] .dwsn-pop-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '[data-dwsn-pop] .dwsn-pop-hint{margin:6px 4px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '[data-dwsn-pop] .dwsn-pop-empty{margin:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '[data-dwsn-pop] .dwsn-pop-itemId{margin-left:auto;flex:none;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.dwsn-menu-row{display:flex;width:100%;align-items:center;gap:8px;min-height:30px;padding:4px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.dwsn-menu-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    ].join('')

    /** Insert the panel-folding stylesheet once per document. */
    function installPanelStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + PANEL_STYLE_ID + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspace-sort'
      tag.dataset.pluginCss = PANEL_STYLE_ID
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }

    /**
     * The first-level settings page: the folding switch and ceiling, the mode,
     * and the per-panel order/visibility list. Every control writes the shared
     * store immediately; the engine and the host More menu read the same store.
     * @param props - injected stores, the updater, and the locale seat.
     * @returns the settings section element tree.
     */
    function SidebarPanelsSettings(props) {
      const store = props.store
      const catalog = props.catalog
      const update = props.update
      const t = typeof props.t === 'function' ? props.t : props.translate
      const [snapshot, setSnapshot] = React.useState(store.getSnapshot())
      const [panels, setPanels] = React.useState(catalog.getSnapshot())
      const [limitDraft, setLimitDraft] = React.useState(String(store.getSnapshot().limit))

      React.useEffect(() => store.subscribe(() => {
        const next = store.getSnapshot()
        setSnapshot(next)
        setLimitDraft(String(next.limit))
      }), [store])

      React.useEffect(() => catalog.subscribe(() => {
        setPanels(catalog.getSnapshot())
      }), [catalog])

      const plan = planPanelVisibility(panels, snapshot, null)
      const byId = new Map(panels.map((panel) => [panel.id, panel]))
      const modeTag = snapshot.mode === 'manual' ? t('list.manual') : t('list.auto')

      const commitLimit = (value) => {
        setLimitDraft(value)
        const parsed = Number.parseInt(value, 10)
        if (!Number.isFinite(parsed)) return
        update({ limit: normalizePanelLimit(parsed) })
      }

      const setMode = (mode) => {
        if (mode === 'manual') update({ mode, shown: plan.shown.slice() })
        else update({ mode })
      }

      const move = (id, delta) => {
        const from = plan.order.indexOf(id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= plan.order.length) return
        update({ order: movePanelId(plan.order, id, to) })
      }

      const toggleShown = (id, checked) => {
        const next = new Set(snapshot.shown)
        if (checked) next.add(id)
        else next.delete(id)
        update({ shown: [...next] })
      }

      const itemRows = plan.order.map((id, index) => {
        const panel = byId.get(id)
        const label = panel !== undefined ? panel.label : id
        const checked = snapshot.mode === 'manual' ? snapshot.shown.includes(id) : plan.shown.includes(id)
        const checkbox = React.createElement('input', {
          key: 'check',
          type: 'checkbox',
          checked,
          disabled: snapshot.mode !== 'manual',
          'aria-label': checked ? panelText(t, 'list.hide', { name: label }) : panelText(t, 'list.show', { name: label }),
          onChange: (event) => {
            if (snapshot.mode === 'manual') toggleShown(id, event.target.checked)
          },
        })
        return React.createElement('div', { className: 'dwsn-item', key: id }, [
          React.createElement('span', { className: 'dwsn-itemIndex', key: 'index' }, String(index + 1)),
          React.createElement('div', { className: 'dwsn-itemText', key: 'text' }, [
            React.createElement('span', { className: 'dwsn-itemName', key: 'name' }, label),
            React.createElement('span', { className: 'dwsn-itemId', key: 'id' }, id),
          ]),
          snapshot.mode === 'manual'
            ? React.createElement('label', { className: 'dwsn-check', key: 'checkLabel' }, [
              checkbox,
              React.createElement('span', { key: 'label' }, t('list.checkLabel')),
            ])
            : React.createElement('span', { className: 'dwsn-tag', key: 'tag', title: panelText(t, 'mode.auto') }, modeTag),
          React.createElement('button', {
            key: 'up',
            type: 'button',
            className: 'dwsn-iconButton',
            disabled: index === 0,
            'aria-label': panelText(t, 'list.moveUp', { name: label }),
            onClick: () => move(id, -1),
          }, '↑'),
          React.createElement('button', {
            key: 'down',
            type: 'button',
            className: 'dwsn-iconButton',
            disabled: index === plan.order.length - 1,
            'aria-label': panelText(t, 'list.moveDown', { name: label }),
            onClick: () => move(id, 1),
          }, '↓'),
        ])
      })

      return React.createElement('div', { className: 'dwsn-page', 'data-slot-section': PANEL_SECTION_ID }, [
        React.createElement('style', {
          key: 'style',
          'data-plugin-css': PANEL_STYLE_ID,
          dangerouslySetInnerHTML: { __html: PANEL_CSS },
        }),
        React.createElement('h2', { className: 'dwsn-title', key: 'title' }, t('section.title')),
        React.createElement('p', { className: 'dwsn-intro', key: 'intro' }, t('section.intro')),

        React.createElement('section', { className: 'dwsn-card', key: 'general' }, [
          React.createElement('div', { className: 'dwsn-cardHead', key: 'head' }, [
            React.createElement('h3', { className: 'dwsn-cardTitle', key: 'title' }, t('general.title')),
            React.createElement('p', { className: 'dwsn-cardDesc', key: 'desc' }, t('general.desc')),
          ]),
          React.createElement('div', { className: 'dwsn-row', key: 'enabled' }, [
            React.createElement('div', { className: 'dwsn-rowText', key: 'text' }, [
              React.createElement('div', { className: 'dwsn-rowTitle', key: 'title' }, t('enabled.label')),
              React.createElement('div', { className: 'dwsn-rowDesc', key: 'desc' }, t('enabled.desc')),
            ]),
            React.createElement('div', { className: 'dwsn-controls', key: 'controls' }, [
              React.createElement('label', { className: 'dwsn-toggle', key: 'toggle' }, [
                React.createElement('input', {
                  key: 'box',
                  type: 'checkbox',
                  checked: snapshot.enabled,
                  'aria-label': t('enabled.label'),
                  onChange: (event) => update({ enabled: event.target.checked }),
                }),
                React.createElement('span', { key: 'text' }, t('enabled.label')),
              ]),
            ]),
          ]),
          React.createElement('div', { className: 'dwsn-row', key: 'limit' }, [
            React.createElement('div', { className: 'dwsn-rowText', key: 'text' }, [
              React.createElement('div', { className: 'dwsn-rowTitle', key: 'title' }, t('limit.label')),
              React.createElement('div', { className: 'dwsn-rowDesc', key: 'desc' }, t('limit.desc')),
            ]),
            React.createElement('div', { className: 'dwsn-controls', key: 'controls' }, [
              React.createElement('label', { className: 'dwsn-field', key: 'field' }, [
                React.createElement('span', { key: 'label' }, t('limit.label')),
                React.createElement('input', {
                  key: 'input',
                  className: 'dwsn-input',
                  type: 'number',
                  min: PANEL_LIMIT_MIN,
                  max: PANEL_LIMIT_MAX,
                  step: 1,
                  value: limitDraft,
                  'aria-label': t('limit.label'),
                  onChange: (event) => commitLimit(event.target.value),
                  onBlur: () => setLimitDraft(String(snapshot.limit)),
                }),
                React.createElement('span', { key: 'suffix' }, t('limit.suffix')),
              ]),
            ]),
          ]),
          React.createElement('div', { className: 'dwsn-row', key: 'mode' }, [
            React.createElement('div', { className: 'dwsn-rowText', key: 'text' }, [
              React.createElement('div', { className: 'dwsn-rowTitle', key: 'title' }, t('mode.label')),
              React.createElement('div', { className: 'dwsn-rowDesc', key: 'desc' },
                snapshot.mode === 'manual' ? t('mode.manualHint') : t('mode.autoHint')),
            ]),
            React.createElement('div', { className: 'dwsn-modes', key: 'modes', role: 'radiogroup', 'aria-label': t('mode.label') }, [
              React.createElement('label', { className: 'dwsn-mode', key: 'auto' }, [
                React.createElement('input', {
                  key: 'radio',
                  type: 'radio',
                  name: 'dwsn-mode',
                  checked: snapshot.mode !== 'manual',
                  onChange: () => setMode('auto'),
                }),
                React.createElement('span', { key: 'text' }, t('mode.auto')),
              ]),
              React.createElement('label', { className: 'dwsn-mode', key: 'manual' }, [
                React.createElement('input', {
                  key: 'radio',
                  type: 'radio',
                  name: 'dwsn-mode',
                  checked: snapshot.mode === 'manual',
                  onChange: () => setMode('manual'),
                }),
                React.createElement('span', { key: 'text' }, t('mode.manual')),
              ]),
            ]),
          ]),
        ]),

        React.createElement('section', { className: 'dwsn-card', key: 'list' }, [
          React.createElement('div', { className: 'dwsn-cardHead', key: 'head' }, [
            React.createElement('h3', { className: 'dwsn-cardTitle', key: 'title' }, t('list.title')),
            React.createElement('p', { className: 'dwsn-cardDesc', key: 'desc' }, t('list.desc')),
          ]),
          itemRows.length > 0
            ? React.createElement('div', { className: 'dwsn-list', key: 'rows' }, itemRows)
            : React.createElement('p', { className: 'dwsn-empty', key: 'empty' }, t('list.empty')),
          React.createElement('div', { className: 'dwsn-footer', key: 'footer' }, [
            React.createElement('button', {
              key: 'reset',
              type: 'button',
              className: 'dwsn-button',
              onClick: () => update({ ...PANEL_DEFAULT_SETTINGS }),
            }, t('list.reset')),
            React.createElement('span', { className: 'dwsn-summary', key: 'summary' },
              panelText(t, 'list.summary', { shown: plan.shown.length, hidden: plan.hidden.length })),
          ]),
        ]),
      ])
    }

    /**
     * The rows this plugin contributes to the host's own More menu: one row per
     * folded panel, in the user's order. Rendered only while that menu is open,
     * which is exactly when the rows are needed.
     * @param props - owner callbacks, the host entries, and the injected stores.
     * @returns menu rows, or null when nothing is folded.
     */
    function SidebarPanelsMenu(props) {
      const store = props.store
      const catalog = props.catalog
      const t = typeof props.t === 'function' ? props.t : props.translate
      const [snapshot, setSnapshot] = React.useState(store.getSnapshot())
      const [panels, setPanels] = React.useState(catalog.getSnapshot())

      React.useEffect(() => store.subscribe(() => {
        setSnapshot(store.getSnapshot())
      }), [store])

      React.useEffect(() => catalog.subscribe(() => {
        setPanels(catalog.getSnapshot())
      }), [catalog])

      const entries = Array.isArray(props.entries) ? props.entries : []
      const labels = new Map(entries.map((entry) => [entry.id, entry.label]))
      const base = panels.length > 0 ? panels : entries.map((entry) => ({ id: entry.id, label: entry.label }))
      const plan = planPanelVisibility(base, snapshot, null)
      if (!snapshot.enabled || plan.hidden.length === 0) return null

      const select = (id) => {
        try {
          if (typeof props.onDismiss === 'function') props.onDismiss()
        } catch (_dismissFailed) {}
        try {
          if (typeof props.onOpen === 'function') props.onOpen(id)
        } catch (_openFailed) {}
      }

      const rows = plan.hidden.map((id, index) => {
        const label = labels.get(id) ?? (base.find((panel) => panel.id === id)?.label ?? id)
        if (typeof MenuItemButton === 'function') {
          return React.createElement(MenuItemButton, {
            key: id,
            separatorBefore: index === 0,
            onSelect: () => select(id),
          }, label)
        }
        return React.createElement('button', {
          key: id,
          type: 'button',
          role: 'menuitem',
          className: 'dwsn-menu-row',
          onClick: () => select(id),
        }, label)
      })
      if (rows.length === 0) return null
      return React.createElement(React.Fragment, null, rows)
    }

    /**
     * Mount the panel fold/reorder presentation.
     *
     * The engine owns only presentation: it stamps the host's rendered rows,
     * folds the overflow with an attribute-selected rule, orders the flex items
     * with CSS order, and runs the long-press drag. It fails open — without a
     * rendered nav nothing is hidden and the host behaves as shipped.
     * @param ctx - Client root Context (for the optional layout service).
     * @param options - stores, updater, translator, and the actions-seat probe.
     * @returns the engine controls.
     */
    function createPanelEngine(ctx, options) {
      const doc = options.doc ?? (typeof document === 'undefined' ? null : document)
      const win = options.win ?? (typeof window === 'undefined' ? null : window)
      const store = options.store
      const catalog = options.catalog
      const update = options.update
      const translate = options.translate
      const actionsSeat = typeof options.actionsSeat === 'function' ? options.actionsSeat : () => false

      let nav = null
      let trigger = null
      let pop = null
      let popCleanup = null
      let observer = null
      let frame = 0
      let disposed = false
      let press = null
      let drag = null
      let suppressRow = null
      let suppressUntil = 0
      let startedAt = 0
      let warned = false
      let retryTimer = null
      let retries = 0
      /** Long-press released without movement: keep every row visible for arranging. */
      let revealAll = false
      let doneButton = null

      /** Schedule one coalesced reconcile. */
      function schedule() {
        if (disposed || frame !== 0 || win === null || doc === null) return
        if (typeof win.requestAnimationFrame === 'function') {
          frame = win.requestAnimationFrame(() => {
            frame = 0
            applyNow()
          })
        } else {
          frame = win.setTimeout(() => {
            frame = 0
            applyNow()
          }, 16)
        }
      }

      /** The panel id of the row the host marks as the open page. */
      function activeIdOfNav() {
        if (nav === null) return null
        const panels = catalog.getSnapshot()
        const rows = panelRowsOf(nav)
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          if (row.getAttribute('aria-current') !== 'page') continue
          const stamped = row.getAttribute(PANEL_ID_ATTR)
          if (typeof stamped === 'string' && stamped !== '') return stamped
          return panelRowId(row, panels, index)
        }
        return null
      }

      /** The plan for the current store and catalog, including the open panel. */
      function currentPlan() {
        return planPanelVisibility(catalog.getSnapshot(), store.getSnapshot(), activeIdOfNav())
      }

      /** Write one plan's visibility and visual order onto the stamped rows. */
      function applyRows(stamped, plan) {
        const positions = new Map(plan.order.map((id, index) => [id, index]))
        for (let index = 0; index < stamped.length; index += 1) {
          const entry = stamped[index]
          const position = positions.get(entry.id)
          const known = position !== undefined
          const shown = known ? plan.shown.includes(entry.id) : true
          const value = shown ? '1' : '0'
          if (entry.row.getAttribute(PANEL_SHOWN_ATTR) !== value) entry.row.setAttribute(PANEL_SHOWN_ATTR, value)
          const order = known ? position : plan.order.length + index
          const text = String(order)
          if (entry.row.style.order !== text) entry.row.style.order = text
        }
      }

      /** Keep the host More launcher (or the fallback trigger) below every row. */
      function applyMoreOrder(length) {
        if (nav === null) return
        const more = hostPanelMore(nav)
        if (more !== null) {
          const anchor = typeof more.closest === 'function' ? (more.closest('nav > *') ?? more) : more
          if (anchor.style !== undefined) {
            const text = String(length + 10)
            if (anchor.style.order !== text) anchor.style.order = text
          }
        }
        if (trigger !== null) trigger.style.order = String(length + 10)
      }

      /** Run the order-only pass used by a drag preview (visibility stays folded). */
      function applyOrderOnly(order) {
        if (nav === null) return
        const rows = panelRowsOf(nav)
        const panels = catalog.getSnapshot()
        const positions = new Map(order.map((id, index) => [id, index]))
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const id = row.getAttribute(PANEL_ID_ATTR) ?? panelRowId(row, panels, index)
          const position = positions.get(id)
          if (position !== undefined) row.style.order = String(position)
        }
        applyMoreOrder(order.length)
      }

      /** Remove every marker and inline order this feature wrote. */
      function clearPanelDom() {
        if (doc === null) return
        for (const row of doc.querySelectorAll('[' + PANEL_ROW_ATTR + ']')) {
          row.removeAttribute(PANEL_ROW_ATTR)
          row.removeAttribute(PANEL_ID_ATTR)
          row.removeAttribute(PANEL_SHOWN_ATTR)
          try {
            row.style.removeProperty('order')
          } catch (_noStyle) {}
        }
        for (const node of doc.querySelectorAll('[' + PANEL_DRAGGING_ATTR + ']')) node.removeAttribute(PANEL_DRAGGING_ATTR)
        for (const node of doc.querySelectorAll('[' + PANEL_DRAGGED_ATTR + ']')) node.removeAttribute(PANEL_DRAGGED_ATTR)
        for (const node of doc.querySelectorAll('[' + PANEL_REORDER_ATTR + ']')) node.removeAttribute(PANEL_REORDER_ATTR)
        removeDoneButton()
        const marked = doc.querySelector('nav[' + PANEL_NAV_ATTR + ']')
        if (marked !== null) marked.removeAttribute(PANEL_NAV_ATTR)
        const more = doc.querySelector('nav button[aria-haspopup="menu"]')
        if (more !== null && typeof more.closest === 'function') {
          const anchor = more.closest('nav > *')
          if (anchor !== null && anchor.style !== undefined) anchor.style.removeProperty('order')
        }
      }

      /**
       * In arrange mode every row stays visible, and one explicit row closes the
       * mode. This is what makes a folded panel reachable by drag: a long press
       * without movement opens the mode, then the reader can grab any row.
       * @param plan - the current visibility plan.
       */
      function ensureDone(plan) {
        if (nav === null) return
        const shouldShow = revealAll === true && plan.hidden.length > 0
        if (!shouldShow) {
          nav.removeAttribute(PANEL_REORDER_ATTR)
          removeDoneButton()
          return
        }
        nav.setAttribute(PANEL_REORDER_ATTR, '1')
        if (doneButton === null || doneButton.isConnected === false) {
          doneButton = doc.createElement('button')
          doneButton.type = 'button'
          doneButton.setAttribute(PANEL_DONE_ATTR, '1')
          doneButton.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            exitReorder()
          })
        }
        if (doneButton.parentElement !== nav) nav.appendChild(doneButton)
        const text = translate('reorder.done')
        if (doneButton.textContent !== text) doneButton.textContent = text
        if (doneButton.getAttribute('aria-label') !== text) doneButton.setAttribute('aria-label', text)
        const width = typeof nav.getBoundingClientRect === 'function' ? nav.getBoundingClientRect().width : 0
        doneButton.setAttribute('data-rail', width > 0 && width <= 72 ? '1' : '0')
        doneButton.style.order = String(plan.order.length + 20)
      }

      /** Remove the arrange-mode footer button. */
      function removeDoneButton() {
        if (doneButton !== null) {
          doneButton.remove()
          doneButton = null
        }
      }

      /** Leave arrange mode and fold the tail again. */
      function exitReorder() {
        if (revealAll !== true) return
        revealAll = false
        if (nav !== null) nav.removeAttribute(PANEL_REORDER_ATTR)
        removeDoneButton()
        applyNow()
      }

      /** Build (once) and place the trigger that stands in for a host without a More menu. */
      function ensureTrigger(plan) {
        if (revealAll === true) {
          removeTrigger()
          return
        }
        if (nav === null) return
        const more = hostPanelMore(nav)
        if (more !== null) {
          removeTrigger()
          return
        }
        if (actionsSeat() && Date.now() - startedAt < 2500) {
          removeTrigger()
          return
        }
        if (plan.hidden.length === 0) {
          removeTrigger()
          return
        }
        if (trigger === null || trigger.isConnected === false) {
          trigger = doc.createElement('button')
          trigger.type = 'button'
          trigger.setAttribute(PANEL_TRIGGER_ATTR, '1')
          trigger.setAttribute('aria-haspopup', 'dialog')
          trigger.setAttribute('aria-expanded', 'false')
          trigger.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
            + '<span class="dwsn-trigger-label"></span><span class="dwsn-trigger-badge"></span>'
          trigger.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            togglePopover()
          })
        }
        if (trigger.parentElement !== nav) nav.appendChild(trigger)
        const width = typeof nav.getBoundingClientRect === 'function' ? nav.getBoundingClientRect().width : 0
        const rail = width > 0 && width <= 72
        trigger.setAttribute('data-rail', rail ? '1' : '0')
        const text = plan.hidden.length > 0
          ? panelText(translate, 'trigger.moreCount', { n: plan.hidden.length })
          : translate('trigger.more')
        const label = trigger.querySelector('.dwsn-trigger-label')
        if (label !== null && label.textContent !== text) label.textContent = text
        const badge = trigger.querySelector('.dwsn-trigger-badge')
        if (badge !== null) {
          const count = plan.hidden.length > 0 ? String(plan.hidden.length) : ''
          if (badge.textContent !== count) badge.textContent = count
        }
        if (trigger.getAttribute('aria-label') !== text) trigger.setAttribute('aria-label', text)
        if (trigger.getAttribute('title') !== text) trigger.setAttribute('title', text)
      }

      /** Remove the fallback trigger and any popover it owns. */
      function removeTrigger() {
        closePopover()
        if (trigger !== null) {
          trigger.remove()
          trigger = null
        }
      }

      /** One reconcile. Idempotent: repeating it writes identical values. */
      function applyNow() {
        if (disposed || drag !== null || doc === null) return
        const settings = store.getSnapshot()
        if (!settings.enabled) {
          revealAll = false
          removeDoneButton()
          removeTrigger()
          clearPanelDom()
          return
        }
        nav = findPanelNav(doc, catalog.getSnapshot())
        if (nav === null) {
          warnMissing()
          return
        }
        const rows = panelRowsOf(nav)
        if (rows.length === 0) return
        warned = false
        retries = 0
        const stamped = stampPanelRows(rows, catalog.getSnapshot())
        const active = activeIdOfNav()
        const plan = planPanelVisibility(catalog.getSnapshot(), settings, active)
        if (revealAll === true && plan.hidden.length === 0) revealAll = false
        applyRows(stamped, plan)
        ensureTrigger(plan)
        applyMoreOrder(plan.order.length)
        ensureDone(plan)
        positionPopover()
      }

      /** Retry quietly for a few seconds, then warn once and keep behaving as shipped. */
      function warnMissing() {
        if (disposed) return
        const waited = Date.now() - startedAt
        if (waited < 4000) {
          if (retries >= 10 || retryTimer !== null) return
          retries += 1
          retryTimer = win.setTimeout(() => {
            retryTimer = null
            schedule()
          }, 300)
          return
        }
        if (warned) return
        warned = true
        console.warn('[dsh-workspace-sort] the sidebar panel list was not found; panel folding stays off while every other feature keeps working')
      }

      /** Toggle the fallback popover (only used where the host has no More menu). */
      function togglePopover() {
        if (pop !== null) closePopover()
        else openPopover()
      }

      /** Select one panel by clicking its host row (which owns the host behavior). */
      function selectPanel(id) {
        closePopover()
        const rows = nav === null ? [] : panelRowsOf(nav)
        for (const row of rows) {
          if (row.getAttribute(PANEL_ID_ATTR) !== id) continue
          row.click()
          return
        }
        try {
          const layout = typeof ctx.get === 'function' ? ctx.get('layout') : null
          if (layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(id)
        } catch (_layoutUnavailable) {}
      }

      /** Build and show the fallback folded-panel popover. */
      function openPopover() {
        closePopover()
        if (trigger === null || doc === null) return
        const plan = currentPlan()
        const panels = catalog.getSnapshot()
        const labels = new Map(panels.map((panel) => [panel.id, panel.label]))
        pop = doc.createElement('div')
        pop.setAttribute(PANEL_POP_ATTR, '1')
        pop.setAttribute('role', 'dialog')
        pop.setAttribute('aria-label', translate('pop.title'))

        const head = doc.createElement('div')
        head.className = 'dwsn-pop-head'
        const title = doc.createElement('span')
        title.textContent = translate('pop.title')
        const close = doc.createElement('button')
        close.type = 'button'
        close.setAttribute('aria-label', translate('pop.close'))
        close.textContent = '×'
        close.addEventListener('click', () => closePopover())
        head.append(title, close)

        const list = doc.createElement('div')
        if (plan.hidden.length === 0) {
          const empty = doc.createElement('p')
          empty.className = 'dwsn-pop-empty'
          empty.textContent = translate('pop.empty')
          list.append(empty)
        } else {
          for (const id of plan.hidden) {
            const item = doc.createElement('button')
            item.type = 'button'
            item.className = 'dwsn-pop-item'
            const name = doc.createElement('span')
            name.textContent = labels.get(id) ?? id
            item.append(name)
            const code = doc.createElement('span')
            code.className = 'dwsn-pop-itemId'
            code.textContent = id
            item.append(code)
            item.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              selectPanel(id)
            })
            list.append(item)
          }
        }

        const hint = doc.createElement('p')
        hint.className = 'dwsn-pop-hint'
        hint.textContent = translate('pop.hint')
        pop.append(head, list, hint)
        doc.body.appendChild(pop)
        trigger.setAttribute('aria-expanded', 'true')
        positionPopover()
        guardPopover()
      }

      /** Close and remove the fallback popover. */
      function closePopover() {
        if (popCleanup !== null) {
          popCleanup()
          popCleanup = null
        }
        if (pop !== null) {
          pop.remove()
          pop = null
        }
        if (trigger !== null) trigger.setAttribute('aria-expanded', 'false')
      }

      /** Keep the fallback popover beside its trigger and inside the viewport. */
      function positionPopover() {
        if (pop === null || trigger === null) return
        const rect = trigger.getBoundingClientRect()
        const margin = 8
        const width = pop.offsetWidth || 280
        const height = pop.offsetHeight || 0
        const left = Math.max(margin, Math.min(rect.left, win.innerWidth - width - margin))
        let top = rect.bottom + 6
        if (top + height > win.innerHeight - margin) top = Math.max(margin, Math.min(rect.top - height - 6, win.innerHeight - height - margin))
        pop.style.left = Math.round(left) + 'px'
        pop.style.top = Math.round(top) + 'px'
      }

      /** Outside-click / Escape / viewport listeners for the fallback popover. */
      function guardPopover() {
        if (popCleanup !== null) popCleanup()
        const onPointerDown = (event) => {
          const target = event.target
          if (target !== null && pop !== null && pop.contains(target)) return
          if (target !== null && trigger !== null && trigger.contains(target)) return
          closePopover()
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          closePopover()
          if (trigger !== null) trigger.focus({ preventScroll: true })
        }
        const onViewport = () => positionPopover()
        doc.addEventListener('pointerdown', onPointerDown, true)
        doc.addEventListener('keydown', onKeyDown, true)
        win.addEventListener('resize', onViewport)
        win.addEventListener('scroll', onViewport, true)
        popCleanup = () => {
          doc.removeEventListener('pointerdown', onPointerDown, true)
          doc.removeEventListener('keydown', onKeyDown, true)
          win.removeEventListener('resize', onViewport)
          win.removeEventListener('scroll', onViewport, true)
        }
      }

      /** A pointer over a panel row may become a long-press drag. */
      function onPointerDown(event) {
        if (disposed || drag !== null || nav === null) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const target = event.target
        if (target === null || typeof target.closest !== 'function') return
        if (revealAll === true && nav.contains(target) !== true) exitReorder()
        const row = target.closest('[' + PANEL_ROW_ATTR + '="1"]')
        if (row === null || row === undefined || !nav.contains(row)) return
        cancelPress()
        press = {
          row,
          id: row.getAttribute(PANEL_ID_ATTR) ?? '',
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          timer: win.setTimeout(beginDrag, PANEL_PRESS_MS),
        }
      }

      /** Move before the delay means the reader is scrolling or clicking. */
      function onPointerMove(event) {
        if (drag !== null) {
          if (event.pointerId !== drag.pointerId) return
          if (event.cancelable) event.preventDefault()
          moveDrag(event.clientY)
          return
        }
        if (press === null || event.pointerId !== press.pointerId) return
        const dx = event.clientX - press.x
        const dy = event.clientY - press.y
        if (dx * dx + dy * dy > PANEL_PRESS_TOLERANCE_PX * PANEL_PRESS_TOLERANCE_PX) cancelPress()
      }

      /** Enter the drag: reveal the folded rows so any of them can be moved. */
      function beginDrag() {
        if (disposed || press === null) return
        const row = press.row
        const id = press.id
        const pointerId = press.pointerId
        press = null
        if (id === '' || nav === null || row.isConnected === false) return
        const plan = currentPlan()
        if (plan.order.length < 2) return
        drag = { row, id, pointerId, order: plan.order.slice(), original: plan.order.slice(), moved: false }
        closePopover()
        nav.setAttribute(PANEL_DRAGGING_ATTR, '1')
        row.setAttribute(PANEL_DRAGGED_ATTR, '1')
        try {
          row.setPointerCapture(pointerId)
        } catch (_noCapture) {}
        applyOrderOnly(drag.order)
        suppressRow = row
        suppressUntil = Number.POSITIVE_INFINITY
      }

      /** Reorder the working list under the pointer; the CSS order follows live. */
      function moveDrag(clientY) {
        if (drag === null || nav === null) return
        const rows = panelRowsOf(nav)
        const byId = new Map()
        for (const row of rows) {
          const id = row.getAttribute(PANEL_ID_ATTR)
          if (id !== null) byId.set(id, row)
        }
        const rects = []
        for (const id of drag.order) {
          const row = byId.get(id)
          if (row === undefined || typeof row.getBoundingClientRect !== 'function') {
            rects.push(null)
            continue
          }
          rects.push(row.getBoundingClientRect())
        }
        const slot = panelInsertionSlot(rects, clientY)
        const target = panelDropIndex(drag.order, drag.id, slot)
        const from = drag.order.indexOf(drag.id)
        if (target < 0 || target === from) return
        drag.order = movePanelId(drag.order, drag.id, target)
        drag.moved = true
        applyOrderOnly(drag.order)
      }

      /** Leave the drag, persisting the order when the pointer actually moved it. */
      function finishDrag(cancelled) {
        if (drag === null) return
        const finished = drag
        drag = null
        if (nav !== null) nav.removeAttribute(PANEL_DRAGGING_ATTR)
        finished.row.removeAttribute(PANEL_DRAGGED_ATTR)
        try {
          finished.row.releasePointerCapture(finished.pointerId)
        } catch (_noCapture) {}
        if (cancelled || !finished.moved) {
          applyOrderOnly(finished.original)
          if (!cancelled && !finished.moved && currentPlan().hidden.length > 0) revealAll = true
        } else {
          revealAll = false
          update({ order: finished.order })
        }
        suppressRow = finished.row
        suppressUntil = Date.now() + 350
        applyNow()
      }

      /** Clear a pending long-press without entering the drag. */
      function cancelPress() {
        if (press === null) return
        win.clearTimeout(press.timer)
        press = null
      }

      function onPointerUp(event) {
        if (press !== null && event.pointerId === press.pointerId) cancelPress()
        if (drag !== null && event.pointerId === drag.pointerId) finishDrag(false)
      }

      function onPointerCancel(event) {
        if (press !== null && event.pointerId === press.pointerId) cancelPress()
        if (drag !== null && event.pointerId === drag.pointerId) finishDrag(true)
      }

      function onClickCapture(event) {
        const target = event.target
        if (suppressRow !== null) {
          if (Date.now() > suppressUntil) {
            suppressRow = null
          } else if (target !== null && typeof suppressRow.contains === 'function' && suppressRow.contains(target)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
        }
        if (revealAll === true && target !== null && typeof target.closest === 'function') {
          const row = target.closest('[' + PANEL_ROW_ATTR + '="1"]')
          if (row !== null) exitReorder()
        }
      }

      function onKeyDown(event) {
        if (event.key !== 'Escape') return
        if (drag !== null) {
          finishDrag(true)
          return
        }
        if (revealAll === true) {
          exitReorder()
          return
        }
        if (pop !== null) closePopover()
      }

      function onContextMenu(event) {
        if (drag === null && press === null) return
        event.preventDefault()
      }

      function onViewportChange() {
        schedule()
        positionPopover()
      }

      /** Begin observing, or return a no-op on a host without a DOM. */
      function start() {
        if (disposed || doc === null || win === null) return () => {}
        const Observer = win.MutationObserver ?? (typeof MutationObserver === 'function' ? MutationObserver : null)
        if (Observer === null) return () => {}
        startedAt = Date.now()
        observer = new Observer((records) => {
          for (const record of records) {
            if (record.type === 'attributes') {
              if (record.attributeName === 'aria-current') {
                schedule()
                return
              }
              continue
            }
            schedule()
            return
          }
        })
        try {
          observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] })
        } catch (_observeFailed) {}
        doc.addEventListener('pointerdown', onPointerDown, true)
        doc.addEventListener('pointermove', onPointerMove, true)
        doc.addEventListener('pointerup', onPointerUp, true)
        doc.addEventListener('pointercancel', onPointerCancel, true)
        doc.addEventListener('click', onClickCapture, true)
        doc.addEventListener('keydown', onKeyDown, true)
        doc.addEventListener('contextmenu', onContextMenu, true)
        win.addEventListener('resize', onViewportChange)
        schedule()
        win.setTimeout(schedule, 120)
        return stop
      }

      /** Stop observing and put every marked host node back. */
      function stop() {
        if (disposed === true) return
        disposed = true
        if (doc === null || win === null) return
        if (frame !== 0) {
          if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame)
          else win.clearTimeout(frame)
          frame = 0
        }
        if (retryTimer !== null) {
          win.clearTimeout(retryTimer)
          retryTimer = null
        }
        cancelPress()
        if (drag !== null) finishDrag(true)
        if (observer !== null) observer.disconnect()
        observer = null
        doc.removeEventListener('pointerdown', onPointerDown, true)
        doc.removeEventListener('pointermove', onPointerMove, true)
        doc.removeEventListener('pointerup', onPointerUp, true)
        doc.removeEventListener('pointercancel', onPointerCancel, true)
        doc.removeEventListener('click', onClickCapture, true)
        doc.removeEventListener('keydown', onKeyDown, true)
        doc.removeEventListener('contextmenu', onContextMenu, true)
        win.removeEventListener('resize', onViewportChange)
        closePopover()
        revealAll = false
        removeDoneButton()
        if (trigger !== null) {
          trigger.remove()
          trigger = null
        }
        clearPanelDom()
        nav = null
        suppressRow = null
        suppressUntil = 0
      }

      /** Read the authoritative catalog again (panel registered/unregistered). */
      function syncPanels() {
        const next = readPanelCatalog(ctx.slots)
        const current = catalog.getSnapshot()
        if (!samePanelCatalog(current, next)) catalog.set(next)
        schedule()
      }

      return { start, stop, syncPanels, schedule, applyNow }
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

    // DIAG-TEMP: a ring buffer in local storage, so the model-memory path can be
    // inspected from outside the renderer while its console is unreachable.
    const DIAG_KEY = 'dsh.workspace-sort.diag.v1'
    function diag(entry) {
      try {
        const store = globalThis.localStorage
        if (!store) return
        const previous = JSON.parse(store.getItem(DIAG_KEY) ?? '[]')
        const list = Array.isArray(previous) ? previous : []
        list.push({ t: new Date().toISOString(), ...entry })
        while (list.length > 40) list.shift()
        store.setItem(DIAG_KEY, JSON.stringify(list))
      } catch (_diagFailed) {
        /* diagnostics never break the feature */
      }
    }

    /**
     * Mount the order reconciler, the sidebar fold pass, the settings row and
     * the proxy-routing page.
     * @param ctx - Client root Context.
     */
    function apply(ctx) {
      diag({ k: 'apply' })
      installStyles()
      installPanelStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-sort: dictionaries')
      ctx.effect(() => ctx.locale.register(PROXY_NS, { zh: proxyZh, en: proxyEn }), 'workspace-sort: proxy dictionaries')
      ctx.effect(() => ctx.locale.register(PANEL_NS, { zh: panelZh, en: panelEn }), 'workspace-sort: panel dictionaries')
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

      let panelBound = (key) => key
      ctx.effect(() => {
        try {
          panelBound = ctx.locale.bind(PANEL_NS)
        } catch {
          panelBound = (key) => key
        }
      })
      const panelTranslate = (key, params) => {
        let text = null
        try {
          text = panelBound(key)
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

      // Sidebar panel folding: one shared preference store and catalog, read by
      // the settings page, the host More menu rows and the DOM engine.
      const panelPrefs = createValueStore(loadPanelSettings(storage))
      const panelCatalog = createValueStore(readPanelCatalog(ctx.slots))
      const updatePanelPrefs = (patch) => {
        const next = normalizePanelSettings({ ...panelPrefs.getSnapshot(), ...patch })
        panelPrefs.set(next)
        savePanelSettings(storage, next)
      }
      let panelActionsSeat = false
      const panelEngine = createPanelEngine(ctx, {
        store: panelPrefs,
        catalog: panelCatalog,
        update: updatePanelPrefs,
        translate: panelTranslate,
        actionsSeat: () => panelActionsSeat,
      })

      // DIAG-TEMP: report every Session id that appears while mounted.
      try {
        const list = ctx.get('sessions')?.list
        if (list && typeof list.subscribe === 'function') {
          let seen = new Set(list.getSnapshot()?.ids ?? [])
          list.subscribe(() => {
            try {
              const snap = list.getSnapshot()
              const ids = snap?.ids ?? []
              const fresh = ids.filter((id) => !seen.has(id))
              seen = new Set(ids)
              for (const id of fresh) {
                const summary = snap.byId?.[id]
                diag({ k: 'new-session', id, blank: summary?.blank, cwd: summary?.cwd })
              }
            } catch (_watchFailed) {}
          })
        } else {
          diag({ k: 'no-session-list' })
        }
      } catch (_watchThrew) {
        diag({ k: 'session-watch-threw' })
      }

      const settingsStore = createValueStore(loadSettings(storage))
      /** True while the settings row is recording a new shortcut; the cycle listener stays out of the way. */
      const shortcutRecorder = createValueStore(false)
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
        + ` Workspace ordering ${settingsStore.getSnapshot().sortWorkspaces ? 'on' : 'off'},`
        + ` view shortcut ${settingsStore.getSnapshot().shortcutEnabled ? settingsStore.getSnapshot().shortcutBinding : 'off'}`,
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

      /**
       * Install the configurable view-mode cycle.
       *
       * The binding lives in the same browser-local settings document as the
       * switches above, so the settings row and this listener always agree. A
       * press is consumed only after the shipped view store accepted the change;
       * that store persists synchronously, so the next press reads the mode it
       * just wrote.
       * @param uiWorkspace - the Client uiWorkspace service.
       * @returns the teardown that removes the keydown listener.
       */
      const installViewModeShortcut = (uiWorkspace) => {
        const win = typeof window === 'undefined' ? null : window
        if (win === null || typeof win.addEventListener !== 'function') return () => {}
        const view = uiWorkspace === null || uiWorkspace === undefined ? null : uiWorkspace.view
        /** The last mode this listener wrote; used only when the browser refuses storage. */
        let lastAppliedMode = VIEW_MODES[0]
        if (view === null || view === undefined || typeof view.setGroupBy !== 'function') {
          console.warn('[dsh-workspace-sort] uiWorkspace.view is unavailable: the view-mode shortcut is off')
          return () => {}
        }
        const onKeyDown = (event) => {
          if (event === null || event === undefined || event.defaultPrevented === true) return
          if (shortcutRecorder.getSnapshot() === true) return
          const snapshot = settingsStore.getSnapshot()
          if (snapshot.shortcutEnabled !== true) return
          if (shortcutMatches(snapshot.shortcutBinding, event) !== true) return
          let next = null
          try {
            next = cycleViewMode(view, storage, lastAppliedMode)
          } catch (error) {
            console.warn('[dsh-workspace-sort] the view-mode cycle was refused', error)
            return
          }
          if (next === null) return
          lastAppliedMode = next
          event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
        }
        win.addEventListener('keydown', onKeyDown, true)
        return () => {
          if (typeof win.removeEventListener === 'function') win.removeEventListener('keydown', onKeyDown, true)
        }
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
          diag({ k: 'unavailable', selectModel: typeof remoteSession?.selectModel, connect: typeof uiWorkspace?.connectWorkspace })
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
            diag({ k: 'replay', ws: workspaceId, sid: sessionId, on: settingsStore.getSnapshot().rememberWorkspaceModel })
            if (settingsStore.getSnapshot().rememberWorkspaceModel !== true) return diag({ k: 'skip', why: 'switch-off' })
            if (typeof workspaceId !== 'string' || workspaceId === '') return diag({ k: 'skip', why: 'no-workspace' })
            if (typeof sessionId !== 'string' || sessionId === '') return diag({ k: 'skip', why: 'no-session' })
            const summary = sessionSnapshot()?.byId?.[sessionId]
            diag({ k: 'summary', found: summary !== undefined, blank: summary?.blank })
            if (summary !== undefined && summary.blank !== true) return diag({ k: 'skip', why: 'not-blank' })
            const preference = getWorkspaceModel(storage, workspaceId)
            diag({ k: 'pref', value: preference })
            if (preference === null) return diag({ k: 'skip', why: 'no-preference' })
            replaying += 1
            try {
              const result = await remoteSession.selectModel({
                sessionId,
                provider: preference.provider,
                model: preference.model,
                ...(preference.reasoningEffort === undefined ? {} : { reasoningEffort: preference.reasoningEffort }),
              })
              diag({ k: 'replay-result', ok: result?.ok, err: result?.error?.code ?? null })
              // DIAG-TEMP: read the Session's own projection shortly after the
              // replay, which is what the composer renders.
              setTimeout(() => {
                try {
                  const row = sessionSnapshot()?.projectionsBySession?.[sessionId]
                  const shown = row?.values?.modelSelection ?? null
                  diag({ k: 'projection', sid: sessionId, rowState: row?.state ?? null, shown })
                } catch (error) {
                  diag({ k: 'projection-threw', msg: String(error && error.message ? error.message : error) })
                }
              }, 1500)
              if (result?.ok === false) {
                console.warn('[dsh-workspace-sort] the Workspace model was refused for the new session', result.error)
              }
            } finally {
              replaying -= 1
            }
          } catch (error) {
            diag({ k: 'replay-threw', msg: String(error && error.message ? error.message : error) })
            console.warn('[dsh-workspace-sort] the Workspace model was not applied to the new session', error)
          }
        }

        /**
         * Apply one Workspace's remembered choice to one Session, at most once.
         *
         * The precise trigger (the new-session call) and the fallback (the
         * Session appearing in the list) describe the same event, so on a Host
         * where both fire they must not apply twice. The Session id is the
         * identity that holds them apart.
         * @param workspaceId - the Workspace whose button or row this was.
         * @param sessionId - the Session that was created or reused.
         * @param source - which trigger fired, for the diagnostic trace.
         */
        const appliedSessions = new Set()
        const applyOnce = async (workspaceId, sessionId, source) => {
          if (typeof sessionId !== 'string' || sessionId === '') return
          if (appliedSessions.has(sessionId)) return diag({ k: 'skip', why: 'already-applied', sid: sessionId })
          if (appliedSessions.size > 500) appliedSessions.clear()
          appliedSessions.add(sessionId)
          diag({ k: 'apply-once', via: source, ws: workspaceId, sid: sessionId })
          await replayWorkspaceModel(workspaceId, sessionId)
        }

        /**
         * Intercept the one funnel every model and thinking-depth change goes
         * through, so a choice made anywhere in a Workspace is remembered for it.
         */
        const restoreSelectModel = interceptMethod(remoteSession, 'selectModel', (original) => async function (...args) {
          diag({ k: 'select', sid: args[0]?.sessionId, p: args[0]?.provider, m: args[0]?.model, replaying })
          const result = await original.apply(this, args)
          if (replaying === 0 && result?.ok !== false) rememberSelection(args[0])
          return result
        })

        /**
         * The new-session button reaches the Host through `connectWorkspace`
         * (`startSession` → `openWorkspace` → `connectWorkspace`), which already
         * receives the resolved Workspace id and settles with the session id.
         * It is the precise trigger, so it is used when it fires.
         */
        const restoreConnectWorkspace = interceptMethod(uiWorkspace, 'connectWorkspace', (original) => async function (...args) {
          diag({ k: 'connect', ws: args[0] })
          const sessionId = await original.apply(this, args)
          await applyOnce(args[0], sessionId, 'connect')
          return sessionId
        })

        /**
         * The fallback trigger: a Session that appears in the list while this
         * half is mounted and has no messages yet is a new conversation, whatever
         * created it. Watching the list rather than one method is what makes the
         * replay survive a Host that routes "new conversation" through a
         * different call than the one intercepted above.
         * @returns the teardown that drops the subscription.
         */
        const watchNewSessions = () => {
          const list = sessionsService?.list
          if (typeof list?.subscribe !== 'function' || typeof list?.getSnapshot !== 'function') return () => {}
          // The baseline is whatever is already there. A list that has not
          // loaded yet seeds on its first snapshot instead, so the initial fill
          // is never mistaken for a burst of new conversations.
          const initial = list.getSnapshot()
          let seen = Array.isArray(initial?.ids) && initial.phase === 'ready' ? new Set(initial.ids) : null
          const stop = list.subscribe(() => {
            try {
              if (settingsStore.getSnapshot().rememberWorkspaceModel !== true) return
              const snapshot = list.getSnapshot()
              const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : []
              if (seen === null) {
                seen = new Set(ids)
                return
              }
              const fresh = ids.filter((id) => !seen.has(id))
              seen = new Set(ids)
              for (const id of fresh) {
                if (snapshot.byId?.[id]?.blank !== true) continue
                adoptWorkspaceModel(id, 0)
              }
            } catch (error) {
              console.warn('[dsh-workspace-sort] the new conversation was not matched to its Workspace', error)
            }
          })
          return () => {
            try {
              stop()
            } catch {
              /* nothing to drop */
            }
          }
        }

        /**
         * Resolve the Workspace that owns a Session that just appeared and apply
         * its remembered choice.
         *
         * A Session is a member of its Workspace only after the Host has attached
         * it, and several Workspaces may share one directory, so this refuses to
         * guess: it retries once for membership, and gives up rather than apply
         * another Workspace's model.
         * @param sessionId - the Session that appeared.
         * @param attempt - 0 on the first try, 1 on the single retry.
         */
        const adoptWorkspaceModel = (sessionId, attempt) => {
          const snapshot = sessionSnapshot()
          const summary = snapshot?.byId?.[sessionId]
          if (summary === undefined) return
          if (summary.blank !== true) return
          const claimants = workspacesClaiming(
            sessionId,
            workspacesService?.list?.getSnapshot?.()?.items,
            snapshot.byId,
          )
          if (claimants.length === 1) {
            void applyOnce(claimants[0].workspaceId, sessionId, 'appeared')
            return
          }
          if (claimants.length > 1) {
            diag({ k: 'ambiguous', sid: sessionId, n: claimants.length })
            return
          }
          if (attempt === 0) setTimeout(() => adoptWorkspaceModel(sessionId, 1), 500)
        }

        const restoreStartSession = interceptMethod(uiWorkspace, 'startSession', (original) => function (...args) {
          diag({ k: 'startSession', ws: args[0] })
          return original.apply(this, args)
        })
        const restoreOpenWorkspace = interceptMethod(uiWorkspace, 'openWorkspace', (original) => async function (...args) {
          diag({ k: 'openWorkspace', ws: args[0] })
          return original.apply(this, args)
        })
        const stopWatching = watchNewSessions()
        diag({ k: 'installed' })
        return () => {
          restoreSelectModel()
          restoreConnectWorkspace()
          restoreStartSession()
          restoreOpenWorkspace()
          stopWatching()
        }
      }

      /**
       * Mount the model memory once both services are live. They are declared
       * here rather than in the plugin's own `inject` list so that Workspace
       * ordering and the fold pass never wait on the model layer.
       */
      ctx.inject(['uiWorkspace', 'remote.session'], (scope) => {
        diag({ k: 'inject', hasUi: typeof scope.get('uiWorkspace'), hasRemote: typeof scope.get('remote.session') })
        scope.effect(() => {
          try {
            return installWorkspaceModelMemory()
          } catch (error) {
            diag({ k: 'install-threw', msg: String(error && error.message ? error.message : error) })
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

      // The view-mode cycle delegates to the same action set the shipped View
      // options menu calls, so the shortcut and the menu always agree. A host
      // without that bridge only turns this one shortcut off.
      ctx.inject(['uiWorkspace'], (scope) => {
        const uiWorkspace = unwrapService(scope.get('uiWorkspace'))
        scope.effect(() => installViewModeShortcut(uiWorkspace), 'workspace-sort: view mode shortcut')
      })

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'workspace-sort',
        order: 25,
        locale: NS,
        inject: () => ({ settings: settingsStore, update: updateSettings }),
      }, WorkspaceSortSettingsRow))

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'workspace-sort-shortcut',
        order: 26,
        locale: NS,
        inject: () => ({ settings: settingsStore, update: updateSettings, recorder: shortcutRecorder }),
      }, WorkspaceShortcutSettingsRow))

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

      // The panel-folding settings page. It reads and writes the same store as
      // the sidebar engine, so every control applies on the spot.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PANEL_SECTION_ID,
        order: PANEL_SECTION_ORDER,
        locale: PANEL_NS,
        label: () => panelTranslate('section.title'),
        inject: () => ({ store: panelPrefs, catalog: panelCatalog, update: updatePanelPrefs, translate: panelTranslate }),
      }, SidebarPanelsSettings))

      // With a registrant in this list the host renders its own More button and
      // renders this component as the menu's rows; older hosts never declare
      // the list, so the engine falls back to its own trigger there.
      try {
        ctx.slots.inject('sidebar.panellist.actions', () => {
          panelActionsSeat = true
          return ctx.slots.register({
            name: 'sidebar.panellist.actions',
            id: 'workspace-sort-panels',
            order: -10,
            locale: PANEL_NS,
            inject: () => ({ store: panelPrefs, catalog: panelCatalog, translate: panelTranslate }),
          }, SidebarPanelsMenu)
        })
      } catch (_noActionsSeat) {
        panelActionsSeat = false
      }

      ctx.effect(() => {
        const unsubPrefs = panelPrefs.subscribe(() => panelEngine.schedule())
        const unsubSlots = typeof ctx.slots.subscribe === 'function'
          ? ctx.slots.subscribe('sidebar.panellist', () => panelEngine.syncPanels())
          : () => {}
        const unsubLocale = typeof ctx.locale.subscribe === 'function'
          ? ctx.locale.subscribe(() => panelEngine.syncPanels())
          : () => {}
        const win = typeof window === 'undefined' ? null : window
        const onStorage = (event) => {
          if (event === null || event === undefined || event.key !== PANEL_SETTINGS_KEY) return
          panelPrefs.set(loadPanelSettings(storage))
          panelEngine.schedule()
        }
        const listenStorage = win !== null && typeof win.addEventListener === 'function'
        if (listenStorage) win.addEventListener('storage', onStorage)
        panelEngine.syncPanels()
        const stop = panelEngine.start()
        return () => {
          stop()
          unsubPrefs()
          unsubSlots()
          unsubLocale()
          if (listenStorage && typeof win.removeEventListener === 'function') win.removeEventListener('storage', onStorage)
        }
      }, 'workspace-sort: sidebar panels')
    }
    //#endregion

    exports.apply = apply
    exports.inject = inject
    exports.__internals = {
      DEFAULT_SETTINGS,
      MAX_VISIBLE,
      SETTINGS_KEY,
      PANEL_SETTINGS_KEY,
      PANEL_DEFAULT_SETTINGS,
      PANEL_LIMIT_MIN,
      PANEL_LIMIT_MAX,
      PANEL_SECTION_ID,
      PANEL_SECTION_ORDER,
      PANEL_NS,
      PANEL_ROW_ATTR,
      PANEL_ID_ATTR,
      PANEL_SHOWN_ATTR,
      PANEL_NAV_ATTR,
      PANEL_DRAGGING_ATTR,
      PANEL_DRAGGED_ATTR,
      PANEL_REORDER_ATTR,
      PANEL_DONE_ATTR,
      PANEL_TRIGGER_ATTR,
      PANEL_POP_ATTR,
      PANEL_STYLE_ID,
      PANEL_PRESS_MS,
      normalizePanelLimit,
      normalizePanelIds,
      normalizePanelSettings,
      loadPanelSettings,
      savePanelSettings,
      resolvePanelLabel,
      panelCatalogOf,
      mergePanelOrder,
      planPanelVisibility,
      movePanelId,
      panelInsertionSlot,
      panelDropIndex,
      panelRowId,
      panelZh,
      panelEn,
      SidebarPanelsSettings,
      SidebarPanelsMenu,
      createPanelEngine,
      STYLE_ID,
      SETTINGS_CSS: css,
      VIEW_STORE_KEY,
      WORKSPACE_MODELS_KEY,
      normalizeLimit,
      VIEW_MODES,
      DEFAULT_SHORTCUT,
      normalizeShortcut,
      shortcutFromEvent,
      shortcutMatches,
      shortcutLabel,
      shortcutAria,
      nextViewMode,
      cycleViewMode,
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
      WorkspaceShortcutSettingsRow,
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
