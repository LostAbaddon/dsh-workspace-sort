/**
 * Node tests for the browser half's decision logic.
 *
 * The real bundle is loaded here through a `window.__ModuleLoader__` shim, so
 * the file under test is byte-for-byte the one the DSH client serves.
 * Run with: node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'

let spec
globalThis.window = {
  __ModuleLoader__: {
    load(next) {
      spec = next
    },
  },
}

await import('../lib/client.js')
assert.equal(spec.id, 'dsh-workspace-sort', 'bundle registers the package id')

const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1] ?? {}, children: args.slice(2) }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
}

const mod = spec.factory((id) => {
  if (id === 'react') return fakeReact
  throw new Error(`unexpected require(${id})`)
})

const {
  DEFAULT_SETTINGS,
  MAX_VISIBLE,
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
  unwrapService,
  interceptMethod,
  WORKSPACE_MODELS_KEY,
  SETTINGS_KEY,
  normalizeModelPreference,
  loadWorkspaceModels,
  saveWorkspaceModels,
  getWorkspaceModel,
  setWorkspaceModel,
  resolveSessionWorkspaceId,
} = mod.__internals

const sessionsOf = (entries) => Object.fromEntries(entries.map(([id, updatedAt, extra = {}]) => [id, { id, updatedAt, ...extra }]))

// ---------------------------------------------------------------- preferences

test('the shipped five-conversation default is the fallback', () => {
  assert.equal(DEFAULT_SETTINGS.visiblePerWorkspace, 5)
  assert.equal(normalizeLimit(undefined), 5)
  assert.equal(normalizeLimit('nonsense'), 5)
  assert.equal(normalizeLimit(null), 5)
})

test('a user-supplied count is clamped into the accepted range', () => {
  assert.equal(normalizeLimit(12), 12)
  assert.equal(normalizeLimit('12'), 12)
  assert.equal(normalizeLimit(0), 1)
  assert.equal(normalizeLimit(-4), 1)
  assert.equal(normalizeLimit(3.7), 3)
  assert.equal(normalizeLimit(10_000), MAX_VISIBLE)
})

test('stored preferences fold into a complete document', () => {
  assert.deepEqual(normalizeSettings(undefined), { visiblePerWorkspace: 5, sortWorkspaces: true, rememberWorkspaceModel: true })
  assert.deepEqual(normalizeSettings({ visiblePerWorkspace: 8 }), { visiblePerWorkspace: 8, sortWorkspaces: true, rememberWorkspaceModel: true })
  assert.deepEqual(normalizeSettings({ visiblePerWorkspace: 8, sortWorkspaces: false }), { visiblePerWorkspace: 8, sortWorkspaces: false, rememberWorkspaceModel: true })
  assert.deepEqual(normalizeSettings({ visiblePerWorkspace: 8, sortWorkspaces: false, rememberWorkspaceModel: false }), { visiblePerWorkspace: 8, sortWorkspaces: false, rememberWorkspaceModel: false })
  assert.deepEqual(normalizeSettings('junk'), { visiblePerWorkspace: 5, sortWorkspaces: true, rememberWorkspaceModel: true })
})

test('the grouping mode is read from the shipped view store', () => {
  const storage = (raw) => ({ getItem: (key) => (key === 'dsh.workspace.view.v5' ? raw : null) })
  assert.equal(readGroupBy(storage('{"groupBy":"flat"}')), 'flat')
  assert.equal(readGroupBy(storage('{"groupBy":"workspace-tree"}')), 'workspace-tree')
  assert.equal(readGroupBy(storage('{"groupBy":"workspace"}')), 'workspace')
  assert.equal(readGroupBy(storage('{oops')), 'workspace')
  assert.equal(readGroupBy(storage(null)), 'workspace')
  assert.equal(readGroupBy(null), 'workspace')
})

test('the archived-row filter is read from the same store', () => {
  const storage = (raw) => ({ getItem: (key) => (key === 'dsh.workspace.view.v5' ? raw : null) })
  assert.equal(readArchivedFilter(storage('{"archivedFilter":"show"}')), 'show')
  assert.equal(readArchivedFilter(storage('{"archivedFilter":"only"}')), 'only')
  assert.equal(readArchivedFilter(storage('{"archivedFilter":"default"}')), 'default')
  assert.equal(readArchivedFilter(storage('{"archivedFilter":"nonsense"}')), 'default')
  assert.equal(readArchivedFilter(storage(null)), 'default')
  assert.equal(readArchivedFilter(null), 'default')
})

// ---------------------------------------------------------------- fold counting

test('a section lists its conversations in the shipped browser’s own terms', () => {
  const sessionsById = {
    live: { id: 'live', updatedAt: 10 },
    archived: { id: 'archived', updatedAt: 9 },
    blank: { id: 'blank', updatedAt: 8, blank: true },
    child: { id: 'child', updatedAt: 7, origin: 'subagent' },
    otherBlank: { id: 'otherBlank', updatedAt: 6, blank: true },
  }
  const sessionIds = ['live', 'archived', 'blank', 'child', 'otherBlank', 'missing']
  const base = { sessionIds, sessionsById, currentId: 'blank' }
  assert.deepEqual(visibleConversationIds({ ...base, archivedFilter: 'default', archivedIds: new Set(['archived']) }), ['live', 'blank'])
  assert.deepEqual(visibleConversationIds({ ...base, archivedFilter: 'show', archivedIds: new Set(['archived']) }), ['live', 'archived', 'blank'])
  assert.deepEqual(visibleConversationIds({ ...base, archivedFilter: 'only', archivedIds: new Set(['archived']) }), ['archived'])
  assert.deepEqual(visibleConversationIds({ ...base, currentId: 'otherBlank', archivedFilter: 'default', archivedIds: new Set(['archived']) }), ['live', 'otherBlank'])
})

test('the collapsed line counts exactly the conversations kept out of sight', () => {
  const idle = (id) => id !== 'running'
  const ids = ['running', 'a', 'b', 'c', 'd']
  assert.equal(hiddenConversationCount(ids, 3, idle), 1)
  assert.equal(hiddenConversationCount(ids, 4, idle), 0)
  assert.equal(hiddenConversationCount(ids, 9, idle), 0)
  assert.equal(hiddenConversationCount([], 5, idle), 0)
  assert.equal(hiddenConversationCount(undefined, 5, idle), 0)
})

// ---------------------------------------------------------------- recency

test('a workspace rank is its newest real conversation', () => {
  const sessions = sessionsOf([
    ['a', 100],
    ['b', 900],
    ['c', 400, { blank: true }],
  ])
  assert.equal(workspaceRecency({ sessionIds: ['a', 'b', 'c'] }, sessions), 900)
})

test('blank conversations do not carry a workspace timestamp', () => {
  const sessions = sessionsOf([
    ['a', 100],
    ['c', 900, { blank: true }],
  ])
  assert.equal(workspaceRecency({ sessionIds: ['a', 'c'] }, sessions), 100)
})

test('archived conversations are excluded when the archive set is known', () => {
  const sessions = sessionsOf([
    ['a', 100],
    ['b', 900],
  ])
  assert.equal(workspaceRecency({ sessionIds: ['a', 'b'] }, sessions, new Set(['b'])), 100)
})

test('a workspace with only blanks falls back to any session, then to its creation time', () => {
  const sessions = sessionsOf([['c', 900, { blank: true }]])
  assert.equal(workspaceRecency({ sessionIds: ['c'] }, sessions), 900)
  const created = Date.parse('2026-01-02T03:04:05.000Z')
  assert.equal(workspaceRecency({ sessionIds: [], createdAt: '2026-01-02T03:04:05.000Z' }, {}), created)
  assert.equal(workspaceRecency({ sessionIds: ['missing'] }, {}), 0)
})

test('workspaces sort newest conversation first and ties keep their order', () => {
  const sessions = sessionsOf([
    ['a1', 500],
    ['b1', 900],
    ['c1', 100],
    ['d1', 700],
  ])
  const workspaces = [
    { workspaceId: 'A', sessionIds: ['a1'] },
    { workspaceId: 'B', sessionIds: ['b1'] },
    { workspaceId: 'C', sessionIds: ['c1'] },
    { workspaceId: 'D', sessionIds: ['d1'] },
  ]
  assert.deepEqual(sortWorkspacesByRecency(workspaces, sessions), ['B', 'D', 'A', 'C'])

  const tied = [
    { workspaceId: 'A', sessionIds: ['a1'] },
    { workspaceId: 'B', sessionIds: ['b1'] },
  ]
  assert.deepEqual(sortWorkspacesByRecency(tied, sessionsOf([['a1', 5], ['b1', 5]])), ['A', 'B'])
})

test('the newest conversation of a workspace decides against another workspace', () => {
  const sessions = sessionsOf([
    ['old', 10],
    ['new', 2000],
  ])
  const workspaces = [
    { workspaceId: 'quiet', sessionIds: ['old'] },
    { workspaceId: 'busy', sessionIds: ['old', 'new'] },
  ]
  assert.deepEqual(sortWorkspacesByRecency(workspaces, sessions), ['busy', 'quiet'])
})

// ---------------------------------------------------------------- move planning

test('insertIdBefore mirrors the Host rule', () => {
  assert.deepEqual(insertIdBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'])
  assert.deepEqual(insertIdBefore(['a', 'b', 'c'], 'a', undefined), ['b', 'c', 'a'])
  assert.deepEqual(insertIdBefore(['a', 'b'], 'z', 'a'), ['a', 'b'])
})

test('already ordered workspaces need no Host write', () => {
  assert.deepEqual(planWorkspaceMoves(['A', 'B', 'C'], ['A', 'B', 'C']), [])
})

test('planned moves transform the current order into the desired order', () => {
  const current = ['A', 'B', 'C', 'D']
  const desired = ['D', 'C', 'B', 'A']
  const moves = planWorkspaceMoves(current, desired)
  let order = [...current]
  for (const move of moves) order = insertIdBefore(order, move.workspaceId, move.beforeWorkspaceId)
  assert.deepEqual(order, desired)
  assert.ok(moves.length <= current.length - 1, 'at most one move per workspace')
})

test('a mismatched membership plans nothing rather than a wrong order', () => {
  assert.deepEqual(planWorkspaceMoves(['A', 'B'], ['A', 'B', 'C']), [])
})

// ---------------------------------------------------------------- fold planning

test('only idle conversations consume the visible quota', () => {
  const rows = [{ sessionId: 'blank', row: 'blank-node' }, { sessionId: 'run', row: 'run-node' }, { sessionId: 'i1', row: 'n1' }, { sessionId: 'i2', row: 'n2' }, { sessionId: 'i3', row: 'n3' }]
  const idle = new Set(['i1', 'i2', 'i3'])
  const plan = planVisibleRows(rows, 2, (id) => idle.has(id))
  assert.deepEqual(plan.map((entry) => entry.hidden), [false, false, false, false, true])
  assert.deepEqual(plan.map((entry) => entry.entry), rows, 'each decision keeps its input entry, DOM node included')
})

test('running and blank rows survive a one-conversation limit', () => {
  const rows = [{ sessionId: 'i1', row: 'n1' }, { sessionId: 'run', row: 'rn' }, { sessionId: 'i2', row: 'n2' }]
  const plan = planVisibleRows(rows, 1, (id) => id !== 'run')
  assert.deepEqual(plan.map((entry) => entry.hidden), [false, false, true])
  assert.equal(plan[2].entry.row, 'n2')
})

// ---------------------------------------------------------------- DOM reading

/** Minimal fake element: only the surface `directGroupRows` touches. */
function element(tagName, attributes = {}, children = []) {
  const node = {
    tagName,
    children,
    className: attributes.class ?? '',
    style: {},
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    hasAttribute: (name) => name in attributes,
  }
  return node
}

test('CSS-module class suffixes match regardless of the build hash', () => {
  assert.equal(hasClassSuffix({ className: '_7514NG_groupSection _7514NG_x' }, '_groupSection'), true)
  assert.equal(hasClassSuffix({ className: 'jJkEga_groupSection' }, '_groupSection'), true)
  assert.equal(hasClassSuffix({ className: 'groupSection' }, '_groupSection'), false)
  assert.equal(hasClassSuffix({ className: 42 }, '_groupSection'), false)
})

test('one workspace section reports its own rows and overflow control only', () => {
  const wrapper = (row) => element('SPAN', {}, [row])
  const project = element('DIV', { 'data-row-key': 'workspace:w1', class: 'jJkEga_projectRow' })
  const first = element('DIV', { 'data-row-key': 'session:s1', class: 'jJkEga_sessionRow' })
  const second = element('DIV', { 'data-row-key': 'session:s2', class: 'jJkEga_sessionRow' })
  const overflow = element('BUTTON', { 'data-row-key': 'overflow:w1' })
  const nestedGroup = element('DIV', { role: 'group' }, [
    element('SPAN', {}, [element('DIV', { 'data-row-key': 'session:nested' })]),
  ])
  const group = element('DIV', { class: '_7514NG_groupSection' }, [
    wrapper(project),
    wrapper(first),
    nestedGroup,
    wrapper(second),
    wrapper(overflow),
  ])

  const { rows, overflow: found } = directGroupRows(group)
  assert.deepEqual(rows.map((entry) => entry.sessionId), ['s1', 's2'])
  assert.equal(found.row, overflow)
  assert.equal(rows[0].wrapper.tagName, 'SPAN')
})

test('a bare row that is not wrapped is still recognised', () => {
  const bare = element('DIV', { 'data-row-key': 'session:bare' })
  const group = element('DIV', { class: '_7514NG_groupSection' }, [bare])
  assert.deepEqual(directGroupRows(group).rows.map((entry) => entry.sessionId), ['bare'])
  assert.equal(directGroupRows(group).rows[0].wrapper, bare)
})

// ---------------------------------------------------------------- workspace model memory

test('normalizeModelPreference requires provider and model strings', () => {
  assert.equal(normalizeModelPreference(null), null)
  assert.equal(normalizeModelPreference(undefined), null)
  assert.equal(normalizeModelPreference({}), null)
  assert.equal(normalizeModelPreference({ provider: '' }), null)
  assert.equal(normalizeModelPreference({ provider: 'deepseek', model: '' }), null)
  assert.deepEqual(normalizeModelPreference({ provider: 'deepseek', model: 'deepseek-chat' }), {
    provider: 'deepseek',
    model: 'deepseek-chat',
  })
  assert.deepEqual(normalizeModelPreference({
    provider: 'openai',
    model: 'gpt-4o',
    reasoningEffort: 'high',
    updatedAt: 12345,
  }), {
    provider: 'openai',
    model: 'gpt-4o',
    reasoningEffort: 'high',
    updatedAt: 12345,
  })
})

test('loadWorkspaceModels tolerates corrupt storage and returns normalized records', () => {
  const fakeStorage = (val) => ({ getItem: () => val, setItem: () => {} })
  assert.deepEqual(loadWorkspaceModels(fakeStorage(null)), {})
  assert.deepEqual(loadWorkspaceModels(fakeStorage('not-json')), {})
  assert.deepEqual(loadWorkspaceModels(fakeStorage('[]')), {})
  const validJson = JSON.stringify({
    ws1: { provider: 'deepseek', model: 'deepseek-chat' },
    invalid: { provider: '' },
  })
  assert.deepEqual(loadWorkspaceModels(fakeStorage(validJson)), {
    ws1: { provider: 'deepseek', model: 'deepseek-chat' },
  })
})

test('setWorkspaceModel and getWorkspaceModel persist per workspace preferences', () => {
  const map = {}
  const storage = {
    getItem: (key) => map[key] ?? null,
    setItem: (key, val) => {
      map[key] = val
    },
  }

  assert.equal(getWorkspaceModel(storage, 'ws-a'), null)
  setWorkspaceModel(storage, 'ws-a', { provider: 'anthropic', model: 'claude-3-5-sonnet', reasoningEffort: 'low' })

  const loaded = getWorkspaceModel(storage, 'ws-a')
  assert.equal(loaded.provider, 'anthropic')
  assert.equal(loaded.model, 'claude-3-5-sonnet')
  assert.equal(loaded.reasoningEffort, 'low')
  assert.ok(Number.isFinite(loaded.updatedAt))

  setWorkspaceModel(storage, 'ws-b', { provider: 'deepseek', model: 'deepseek-reasoner' })
  assert.equal(getWorkspaceModel(storage, 'ws-b').model, 'deepseek-reasoner')
  assert.equal(getWorkspaceModel(storage, 'ws-a').model, 'claude-3-5-sonnet')
})

test('resolveSessionWorkspaceId matches by sessionIds or falls back to cwd', () => {
  const workspaces = [
    { workspaceId: 'ws-1', sessionIds: ['s1', 's2'], path: '/path/to/project1' },
    { workspaceId: 'ws-2', sessionIds: ['s3'], path: '/path/to/project2' },
  ]
  const sessionsById = {
    s1: { id: 's1', cwd: '/path/to/project1' },
    s_new: { id: 's_new', cwd: '/path/to/project2' },
    s_unknown: { id: 's_unknown', cwd: '/path/to/other' },
  }

  assert.equal(resolveSessionWorkspaceId('s1', workspaces, sessionsById), 'ws-1')
  assert.equal(resolveSessionWorkspaceId('s3', workspaces, sessionsById), 'ws-2')
  // New session not in sessionIds yet, resolved via cwd:
  assert.equal(resolveSessionWorkspaceId('s_new', workspaces, sessionsById), 'ws-2')
  // Unknown session:
  assert.equal(resolveSessionWorkspaceId('s_unknown', workspaces, sessionsById), null)
  assert.equal(resolveSessionWorkspaceId('', workspaces, sessionsById), null)
  assert.equal(resolveSessionWorkspaceId(null, workspaces, sessionsById), null)
})

// ---------------------------------------------------------------- mount helpers

/** A localStorage double that reports how many writes it accepted. */
function memoryStorage() {
  const map = {}
  const handle = { map, writes: 0 }
  handle.storage = {
    getItem: (key) => (key in map ? map[key] : null),
    setItem: (key, value) => {
      map[key] = String(value)
      handle.writes += 1
    },
  }
  return handle
}

/**
 * The per-read tracking proxy Cordis puts in front of every service
 * (`getTraceable`), reduced to what this plugin can observe: every method read
 * is re-wrapped, the unwrapped service answers under the global
 * `cordis.original` symbol, and writes land on the service itself.
 * @param service - the service to wrap, or a non-object to pass through.
 * @returns the tracking proxy, or the input.
 */
function traceable(service) {
  if (service === null || typeof service !== 'object') return service
  return new Proxy(service, {
    get(target, prop, receiver) {
      if (prop === Symbol.for('cordis.original')) return target
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(receiver) : value
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value)
    },
  })
}

/**
 * A remote namespace double, shaped like the Client's `RemoteNamespaceService`:
 * every method is an OWN GETTER with no setter that answers with a fresh call
 * function. Assignment over such a property is dropped without a word, so a
 * plugin that patches by assignment silently does nothing here.
 * @param implementations - method name to the function its getter answers with.
 * @returns the namespace service.
 */
function remoteNamespace(implementations) {
  const service = {}
  for (const [method, run] of Object.entries(implementations)) {
    Object.defineProperty(service, method, {
      configurable: true,
      enumerable: true,
      get() {
        return (...args) => run(...args)
      },
    })
  }
  return service
}

/**
 * A Cordis-shaped Client context double.
 *
 * It reproduces the two behaviours this plugin depends on: reading a service
 * name that `inject` does not declare throws on the context proxy — which `?.`
 * cannot swallow — while `ctx.get(name)` answers `undefined` instead. Declared
 * `inject` names and the built-in context members resolve normally, and
 * `ctx.inject(deps, callback)` runs the callback only when every dependency is
 * present, exactly like the real registry.
 */
function createClientContext(services) {
  const provided = new Map(Object.entries(services))
  const cleanups = []
  const unavailable = []
  const remember = (value) => {
    if (typeof value === 'function') cleanups.push(value)
    return value
  }
  /** Cordis answers every `ctx.get` with a fresh tracking proxy over the service. */
  const resolve = (name) => traceable(provided.get(name))
  const scope = {
    get: resolve,
    effect: (fn) => remember(fn()),
    on: () => {},
  }
  const base = {
    get: resolve,
    inject: (deps, callback) => {
      const names = Array.isArray(deps) ? deps : Object.keys(deps ?? {})
      const absent = names.filter((name) => !provided.has(name))
      if (absent.length === 0) callback(scope)
      else unavailable.push(...absent)
      return { dispose() {} }
    },
    effect: (fn) => remember(fn()),
    on: () => {},
  }
  const ctx = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      if (mod.inject.includes(prop)) return resolve(prop)
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
  return {
    ctx,
    unavailable,
    disposeAll: () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

/**
 * The Client services the model memory talks to, shaped like the shipped ones:
 * `selectModel` is a remote-namespace method (own getter, no setter) answering a
 * RemoteResult, and `connectWorkspace` is a prototype method of the Workspace
 * service that settles with the session id.
 */
function modelFixture(options = {}) {
  const registrations = []
  const seen = []
  const outcome = { ok: true }
  const created = { id: 'sess-new' }
  const workspaces = [
    { workspaceId: 'ws-coder', sessionIds: ['sess-coder'], path: '/ws/coder' },
    { workspaceId: 'ws-writer', sessionIds: ['sess-writer'], path: '/ws/writer' },
  ]
  const byId = {
    'sess-coder': { id: 'sess-coder', cwd: '/ws/coder', blank: false },
    'sess-writer': { id: 'sess-writer', cwd: '/ws/writer', blank: false },
  }

  const remoteSession = remoteNamespace({
    selectModel(request) {
      seen.push(request)
      if (outcome.ok === false) return { ok: false, error: { code: 'session/model-unavailable', message: 'unroutable' } }
      return { ok: true, value: { selected: { provider: request.provider, model: request.model } } }
    },
  })
  /** Prototype methods, like the shipped Workspace service class. */
  const workspacePrototype = {
    async connectWorkspace() {
      return created.id
    },
    /** The shipped nested call the new-session button takes. */
    async openWorkspace(workspaceId) {
      return this.connectWorkspace(workspaceId)
    },
  }
  const uiWorkspace = Object.create(workspacePrototype)
  const services = {
    workspaces: {
      list: { getSnapshot: () => ({ phase: 'ready', items: workspaces, archivedSessionIds: [] }), subscribe: () => () => {} },
      insertBefore: async () => {},
    },
    sessions: { list: { getSnapshot: () => ({ byId, ids: Object.keys(byId) }), subscribe: () => () => {} } },
    uiSession: { sessionStatus: { getSnapshot: () => new Map() } },
    slots: {
      inject: (_key, callback) => callback(),
      register: (definition) => {
        registrations.push(definition)
        return () => {}
      },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    'remote.session': remoteSession,
    uiWorkspace,
  }
  return { services, registrations, seen, outcome, created, byId, workspaces, remoteSession, uiWorkspace }
}

/**
 * Mount the bundle's Client half against the double, muting its boot logging.
 * @param fixture - the Client services to mount against.
 * @param seed - optional writer that pre-populates the storage before mounting.
 */
function mount(fixture, seed) {
  const store = memoryStorage()
  if (typeof seed === 'function') seed(store.storage)
  const warnings = []
  const previousStorage = globalThis.localStorage
  const info = console.info
  const warn = console.warn
  globalThis.localStorage = store.storage
  console.info = () => {}
  console.warn = (...args) => warnings.push(args.join(' '))
  const harness = createClientContext(fixture.services)
  try {
    mod.apply(harness.ctx)
  } catch (error) {
    // A half-mounted Client half still owns its timers; release them so a
    // failing run reports and exits instead of hanging on a live interval.
    harness.disposeAll()
    throw error
  } finally {
    console.info = info
    console.warn = warn
    globalThis.localStorage = previousStorage
  }
  return { store, warnings, harness }
}

// ---------------------------------------------------------------- interception

test('a service is unwrapped to the object behind the Context proxy', () => {
  const raw = { connectWorkspace: () => 'raw' }
  assert.equal(unwrapService(null), null)
  assert.equal(unwrapService(undefined), undefined)
  assert.equal(unwrapService(raw), raw, 'a plain object is returned unchanged')

  const proxy = { [Symbol.for('cordis.original')]: raw }
  assert.equal(unwrapService(proxy), raw, 'the tracking proxy unwraps to its service')
})

test('an intercepted method is restored exactly as it was', () => {
  const service = { selectModel: (value) => `original:${value}` }
  const original = service.selectModel
  const seen = []
  const restore = interceptMethod(service, 'selectModel', (inner) => (value) => {
    seen.push(value)
    return inner(value)
  })

  assert.equal(service.selectModel('a'), 'original:a')
  assert.deepEqual(seen, ['a'])
  restore()
  assert.equal(service.selectModel, original, 'an owned method comes back by identity')
  assert.deepEqual(seen, ['a'], 'the interception is gone')
})

test('a getter-only method — the remote namespace shape — is wrapped, not dropped', () => {
  // `RemoteNamespaceService.install` defines every method as an own getter with
  // no setter, and the bundle is a classic sloppy-mode script: `service[m] = fn`
  // is ignored there without throwing. Only wrapping the getter takes effect.
  const service = remoteNamespace({ selectModel: (value) => `original:${value}` })
  const before = Object.getOwnPropertyDescriptor(service, 'selectModel')
  assert.equal(before.set, undefined)

  const seen = []
  const restore = interceptMethod(service, 'selectModel', (inner) => (value) => {
    seen.push(value)
    return inner(value)
  })

  assert.equal(service.selectModel('a'), 'original:a', 'the wrapped accessor still reaches the service')
  assert.deepEqual(seen, ['a'], 'the wrapper actually ran')
  assert.equal(before.set, undefined, 'the original accessor had no setter to assign through')

  restore()
  const after = Object.getOwnPropertyDescriptor(service, 'selectModel')
  assert.equal(after.get, before.get, 'the original getter is back')
  assert.equal(after.set, undefined)
  assert.equal(service.selectModel('b'), 'original:b')
  assert.deepEqual(seen, ['a'], 'the interception is gone')
})

test('an inherited method is un-shadowed instead of being pinned onto the service', () => {
  const prototype = { connectWorkspace: () => 'inherited' }
  const service = Object.create(prototype)
  assert.equal(Object.hasOwn(service, 'connectWorkspace'), false)

  const restore = interceptMethod(service, 'connectWorkspace', () => () => 'intercepted')
  assert.equal(service.connectWorkspace(), 'intercepted')
  assert.equal(Object.hasOwn(service, 'connectWorkspace'), true)

  restore()
  assert.equal(Object.hasOwn(service, 'connectWorkspace'), false, 'no own property is left behind')
  assert.equal(service.connectWorkspace(), 'inherited')
})

test('the context double reproduces Cordis service access', () => {
  const probe = createClientContext({})
  assert.throws(() => probe.ctx.remote, /cannot get property "remote" without inject/)
  assert.equal(probe.ctx.get('remote'), undefined)
  assert.equal(probe.ctx.get('remote.session'), undefined)
})

test('the Client half mounts with the model services absent and still registers its settings row', () => {
  const fixture = modelFixture()
  delete fixture.services['remote.session']
  delete fixture.services.uiWorkspace

  const { harness } = mount(fixture)
  try {
    assert.equal(fixture.registrations.length, 1, 'the settings row is registered even without the model layer')
    assert.equal(fixture.registrations[0].id, 'workspace-sort')
    assert.deepEqual(harness.unavailable, ['uiWorkspace', 'remote.session'], 'the model layer is deferred, never awaited')
  } finally {
    harness.disposeAll()
  }
})

test('a model chosen inside a Workspace is remembered for that Workspace', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    assert.equal(getWorkspaceModel(store.storage, 'ws-coder'), null)
    await harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      reasoningEffort: 'high',
    })

    const saved = getWorkspaceModel(store.storage, 'ws-coder')
    assert.equal(saved.provider, 'anthropic')
    assert.equal(saved.model, 'claude-3-5-sonnet')
    assert.equal(saved.reasoningEffort, 'high')
    assert.equal(getWorkspaceModel(store.storage, 'ws-writer'), null, 'the other Workspace is untouched')
  } finally {
    harness.disposeAll()
  }
})

test('a thinking depth already stored for a Workspace is replaced by the next choice', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    const select = (reasoningEffort) => harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      reasoningEffort,
    })
    await select('low')
    assert.equal(getWorkspaceModel(store.storage, 'ws-coder').reasoningEffort, 'low')
    await select('max')
    assert.equal(getWorkspaceModel(store.storage, 'ws-coder').reasoningEffort, 'max')
  } finally {
    harness.disposeAll()
  }
})

test('the new-session button replays the Workspace choice onto the session it created', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    await harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      reasoningEffort: 'high',
    })
    fixture.seen.length = 0
    fixture.byId['sess-new'] = { id: 'sess-new', cwd: '/ws/coder', blank: true }

    const sessionId = await harness.ctx.get('uiWorkspace').openWorkspace('ws-coder')
    assert.equal(sessionId, 'sess-new')
    assert.deepEqual(fixture.seen, [{
      sessionId: 'sess-new',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      reasoningEffort: 'high',
    }])
  } finally {
    harness.disposeAll()
  }
})

test('a Workspace that never recorded a choice keeps the Host default', async () => {
  const fixture = modelFixture()
  const { harness } = mount(fixture)
  try {
    fixture.byId['sess-new'] = { id: 'sess-new', cwd: '/ws/writer', blank: true }
    await harness.ctx.get('uiWorkspace').openWorkspace('ws-writer')
    assert.deepEqual(fixture.seen, [], 'nothing is replayed without a stored choice')
  } finally {
    harness.disposeAll()
  }
})

test('a session that already holds a message keeps its own model', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    await harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    })
    fixture.seen.length = 0
    fixture.byId['sess-live'] = { id: 'sess-live', cwd: '/ws/coder', blank: false }
    fixture.created.id = 'sess-live'

    await harness.ctx.get('uiWorkspace').openWorkspace('ws-coder')
    assert.deepEqual(fixture.seen, [], 'a started conversation is never re-targeted')
  } finally {
    harness.disposeAll()
  }
})

test('a replayed choice is not written back as a fresh selection', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    await harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-coder',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    })
    fixture.byId['sess-new'] = { id: 'sess-new', cwd: '/ws/coder', blank: true }
    const before = store.writes
    await harness.ctx.get('uiWorkspace').openWorkspace('ws-coder')
    assert.equal(store.writes, before, 'the replay leaves the stored record alone')
  } finally {
    harness.disposeAll()
  }
})

test('a refused selection is not remembered', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    fixture.outcome.ok = false
    await harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-writer',
      provider: 'openai',
      model: 'gpt-4o',
    })
    assert.equal(getWorkspaceModel(store.storage, 'ws-writer'), null)
  } finally {
    harness.disposeAll()
  }
})

test('a transcript-only session never invents a Workspace record', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture)
  try {
    await harness.ctx.get('remote.session').selectModel({
      sessionId: 'sess-ungrouped',
      provider: 'openai',
      model: 'gpt-4o',
    })
    assert.deepEqual(loadWorkspaceModels(store.storage), {}, 'an unknown session records nothing')
  } finally {
    harness.disposeAll()
  }
})

test('turning the switch off stops both recording and replay', async () => {
  const fixture = modelFixture()
  const { store, harness } = mount(fixture, (storage) => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ visiblePerWorkspace: 5, sortWorkspaces: true, rememberWorkspaceModel: false }))
  })
  try {
    await harness.ctx.get('remote.session').selectModel({ sessionId: 'sess-coder', provider: 'anthropic', model: 'claude-3-5-sonnet' })
    assert.deepEqual(loadWorkspaceModels(store.storage), {}, 'recording is off')

    setWorkspaceModel(store.storage, 'ws-coder', { provider: 'anthropic', model: 'claude-3-5-sonnet' })
    fixture.seen.length = 0
    fixture.byId['sess-new'] = { id: 'sess-new', cwd: '/ws/coder', blank: true }
    await harness.ctx.get('uiWorkspace').openWorkspace('ws-coder')
    assert.deepEqual(fixture.seen, [], 'replay is off')
  } finally {
    harness.disposeAll()
  }
})

test('disposing the Client half puts both intercepted methods back', () => {
  const fixture = modelFixture()
  // A remote method answers a FRESH function per read, so identity lives in the
  // accessor descriptor; a prototype method is identified by having no own
  // property at all.
  const selectDescriptor = Object.getOwnPropertyDescriptor(fixture.remoteSession, 'selectModel')
  const connectDescriptor = Object.getOwnPropertyDescriptor(fixture.uiWorkspace, 'connectWorkspace')
  assert.equal(typeof selectDescriptor.get, 'function')
  assert.equal(selectDescriptor.set, undefined, 'a remote namespace method has no setter')
  assert.equal(connectDescriptor, undefined, 'the Workspace method lives on the prototype')

  const { harness } = mount(fixture)
  try {
    assert.notEqual(Object.getOwnPropertyDescriptor(fixture.remoteSession, 'selectModel'), selectDescriptor)
    assert.notEqual(Object.getOwnPropertyDescriptor(fixture.uiWorkspace, 'connectWorkspace'), undefined)
  } finally {
    harness.disposeAll()
  }

  assert.deepEqual(
    Object.getOwnPropertyDescriptor(fixture.remoteSession, 'selectModel'),
    selectDescriptor,
    'the exact accessor is restored',
  )
  assert.equal(
    Object.getOwnPropertyDescriptor(fixture.uiWorkspace, 'connectWorkspace'),
    undefined,
    'the prototype method is un-shadowed again',
  )
})
