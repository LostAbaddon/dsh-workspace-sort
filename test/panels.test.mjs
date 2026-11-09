/**
 * Node tests for the sidebar panel-folding decision logic.
 *
 * The real bundle is loaded through the same `window.__ModuleLoader__` shim the
 * other browser-half suites use, so the file under test is byte-for-byte the
 * one the DSH client serves.
 * Run with: node --test test/panels.test.mjs
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
  Fragment: 'fragment',
}

const mod = spec.factory((id) => {
  if (id === 'react') return fakeReact
  throw new Error('unexpected require(' + id + ')')
})

const {
  PANEL_DEFAULT_SETTINGS,
  PANEL_SETTINGS_KEY,
  PANEL_LIMIT_MAX,
  normalizePanelLimit,
  normalizePanelIds,
  normalizePanelSettings,
  loadPanelSettings,
  savePanelSettings,
  panelCatalogOf,
  mergePanelOrder,
  planPanelVisibility,
  movePanelId,
  panelInsertionSlot,
  panelDropIndex,
  panelRowId,
  PANEL_ID_ATTR,
  PANEL_NS,
  panelZh,
  panelEn,
  SidebarPanelsSettings,
  SidebarPanelsMenu,
} = mod.__internals

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

// ---------------------------------------------------------------- preferences

test('the panel ceiling defaults to six and is clamped', () => {
  assert.equal(PANEL_DEFAULT_SETTINGS.limit, 6)
  assert.equal(PANEL_DEFAULT_SETTINGS.enabled, true)
  assert.equal(PANEL_DEFAULT_SETTINGS.mode, 'auto')
  assert.equal(normalizePanelLimit(undefined), 6)
  assert.equal(normalizePanelLimit('nonsense'), 6)
  assert.equal(normalizePanelLimit(null), 6)
  assert.equal(normalizePanelLimit(0), 1)
  assert.equal(normalizePanelLimit(-4), 1)
  assert.equal(normalizePanelLimit(3.7), 3)
  assert.equal(normalizePanelLimit(10_000), PANEL_LIMIT_MAX)
})

test('stored panel preferences fold into a complete document', () => {
  assert.deepEqual(normalizePanelSettings(undefined), {
    enabled: true,
    limit: 6,
    mode: 'auto',
    order: [],
    shown: [],
  })
  assert.deepEqual(
    normalizePanelSettings({ enabled: false, limit: 3, mode: 'manual', order: ['a', 'a', 'b', 7], shown: ['b'] }),
    { enabled: false, limit: 3, mode: 'manual', order: ['a', 'b'], shown: ['b'] },
  )
  assert.equal(normalizePanelSettings({ mode: 'weird' }).mode, 'auto')
  assert.equal(normalizePanelSettings('junk').enabled, true)
  assert.deepEqual(normalizePanelIds(['x', '', 'x', null, 3, 'y']), ['x', 'y'])
})

test('panel preferences survive storage and tolerate a corrupt document', () => {
  const handle = memoryStorage()
  const storage = handle.storage
  const stored = { enabled: false, limit: 2, mode: 'manual', order: ['a'], shown: ['a'] }
  savePanelSettings(storage, stored)
  assert.equal(handle.writes, 1)
  assert.deepEqual(loadPanelSettings(storage), stored)
  handle.map[PANEL_SETTINGS_KEY] = '{oops'
  assert.deepEqual(loadPanelSettings(storage), { ...PANEL_DEFAULT_SETTINGS })
  assert.deepEqual(loadPanelSettings(null), { ...PANEL_DEFAULT_SETTINGS })
  assert.equal(loadPanelSettings(undefined).limit, 6)
})

// ---------------------------------------------------------------- catalog

test('the panel catalog follows the slot order and resolves thunk labels', () => {
  const catalog = panelCatalogOf([
    { options: { id: 'later', order: 20, label: () => '任务看板' } },
    { options: { id: 'first', order: 10, label: '插件' } },
    { options: { id: 'first', order: 99, label: '重复' } },
    { options: { order: 5, label: '无 id' } },
    { options: { id: 'bare', order: 30 } },
  ])
  assert.deepEqual(catalog, [
    { id: 'first', label: '插件' },
    { id: 'later', label: '任务看板' },
    { id: 'bare', label: 'bare' },
  ])
})

test('a throwing label thunk falls back to the id instead of breaking the list', () => {
  const catalog = panelCatalogOf([{ options: { id: 'boom', label: () => { throw new Error('nope') } } }])
  assert.deepEqual(catalog, [{ id: 'boom', label: 'boom' }])
})

// ---------------------------------------------------------------- order

test('the saved order wins for known ids and new ids follow the host order', () => {
  const panels = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual(mergePanelOrder(['c', 'a', 'gone'], panels), ['c', 'a', 'b', 'd'])
  assert.deepEqual(mergePanelOrder([], panels), ['a', 'b', 'c', 'd'])
  assert.deepEqual(mergePanelOrder(['a', 'a', 'b'], panels), ['a', 'b', 'c', 'd'])
  assert.deepEqual(mergePanelOrder(['x'], []), [])
})

// ---------------------------------------------------------------- visibility

const panels = [
  { id: 'plugins', label: '插件' },
  { id: 'task-board', label: '任务看板' },
  { id: 'agents', label: '智能体' },
  { id: 'memory', label: '记忆系统' },
  { id: 'context', label: '上下文洞察' },
]

test('auto mode keeps the first limit rows in the working order', () => {
  const plan = planPanelVisibility(panels, { enabled: true, limit: 2, mode: 'auto', order: [] }, null)
  assert.deepEqual(plan.shown, ['plugins', 'task-board'])
  assert.deepEqual(plan.hidden, ['agents', 'memory', 'context'])
})

test('a saved order decides which rows the ceiling keeps', () => {
  const settings = { enabled: true, limit: 2, mode: 'auto', order: ['memory', 'context', 'plugins'] }
  const plan = planPanelVisibility(panels, settings, null)
  assert.deepEqual(plan.order, ['memory', 'context', 'plugins', 'task-board', 'agents'])
  assert.deepEqual(plan.shown, ['memory', 'context', 'plugins'])
  assert.deepEqual(plan.hidden, ['task-board', 'agents'])
})

test('manual mode keeps exactly the checked rows and ignores the ceiling', () => {
  const settings = { enabled: true, limit: 1, mode: 'manual', order: [], shown: ['memory', 'context', 'gone'] }
  const plan = planPanelVisibility(panels, settings, null)
  assert.deepEqual(plan.shown, ['plugins', 'memory', 'context'])
  assert.deepEqual(plan.hidden, ['task-board', 'agents'])
})

test('the open panel is always shown, even beyond the ceiling', () => {
  const auto = planPanelVisibility(panels, { enabled: true, limit: 1, mode: 'auto' }, 'memory')
  assert.deepEqual(auto.shown, ['plugins', 'memory'])
  assert.deepEqual(auto.hidden, ['task-board', 'agents', 'context'])
  const manual = planPanelVisibility(panels, { enabled: true, limit: 1, mode: 'manual', shown: [] }, 'agents')
  assert.deepEqual(manual.shown, ['plugins', 'agents'])
})

test('turning the switch off shows every row', () => {
  const plan = planPanelVisibility(panels, { enabled: false, limit: 1, mode: 'manual', shown: [] }, null)
  assert.deepEqual(plan.shown, panels.map((panel) => panel.id))
  assert.deepEqual(plan.hidden, [])
})

test('an empty catalog plans nothing rather than inventing rows', () => {
  const plan = planPanelVisibility([], { enabled: true, limit: 4, mode: 'auto' }, 'ghost')
  assert.deepEqual(plan.order, [])
  assert.deepEqual(plan.shown, [])
  assert.deepEqual(plan.hidden, [])
})

// ---------------------------------------------------------------- drag math

test('moving an id clamps into the list and leaves unknown ids alone', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepEqual(movePanelId(order, 'a', 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(movePanelId(order, 'd', 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(movePanelId(order, 'b', 99), ['a', 'c', 'd', 'b'])
  assert.deepEqual(movePanelId(order, 'b', -3), ['b', 'a', 'c', 'd'])
  assert.deepEqual(movePanelId(order, 'ghost', 0), order)
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'the input array is not mutated')
})

test('the pointer Y names an insertion slot by row midpoints', () => {
  const rects = [
    { top: 0, height: 36 },
    { top: 40, height: 36 },
    { top: 80, height: 36 },
  ]
  assert.equal(panelInsertionSlot(rects, 0), 0)
  assert.equal(panelInsertionSlot(rects, 17), 0)
  assert.equal(panelInsertionSlot(rects, 19), 1)
  assert.equal(panelInsertionSlot(rects, 57), 1)
  assert.equal(panelInsertionSlot(rects, 59), 2)
  assert.equal(panelInsertionSlot(rects, 99), 3)
  assert.equal(panelInsertionSlot([], 10), 0)
})

test('an insertion slot becomes a final index after removing the dragged id', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.equal(panelDropIndex(order, 'b', 0), 0)
  assert.equal(panelDropIndex(order, 'b', 2), 1)
  assert.equal(panelDropIndex(order, 'b', 4), 3)
  assert.equal(panelDropIndex(order, 'ghost', 1), -1)
})

// ---------------------------------------------------------------- row identity


// ---------------------------------------------------------------- locale and UI

test('the panel dictionaries carry the same keys in both languages', () => {
  assert.equal(PANEL_NS, 'workspaceSortPanels')
  assert.deepEqual(Object.keys(panelZh).sort(), Object.keys(panelEn).sort())
  for (const value of [...Object.values(panelZh), ...Object.values(panelEn)]) assert.equal(typeof value, 'string')
})

const fakeStore = (snapshot) => {
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

test('the settings page renders the fold controls and the panel list', () => {
  const store = fakeStore({ enabled: true, limit: 2, mode: 'auto', order: [], shown: [] })
  const catalog = fakeStore(panels)
  const tree = SidebarPanelsSettings({
    store,
    catalog,
    update: () => {},
    t: (key) => key,
    translate: (key) => key,
  })
  assert.equal(tree.type, 'div')
  assert.equal(tree.props['data-slot-section'], 'sidebar-panels')
  const text = JSON.stringify(tree)
  assert.match(text, /section\.title/)
  assert.match(text, /general\.title/)
  assert.match(text, /list\.title/)
  assert.match(text, /plugins/)
  assert.match(text, /task-board/)
})

test('the host More menu lists exactly the folded panels', () => {
  const store = fakeStore({ enabled: true, limit: 2, mode: 'auto', order: [], shown: [] })
  const catalog = fakeStore(panels)
  const tree = SidebarPanelsMenu({
    store,
    catalog,
    t: (key) => key,
    translate: (key) => key,
    entries: panels.map((panel) => ({ id: panel.id, label: panel.label })),
    onOpen: () => {},
    onDismiss: () => {},
  })
  assert.notEqual(tree, null)
  const text = JSON.stringify(tree)
  assert.match(text, /智能体/)
  assert.match(text, /记忆系统/)
  assert.match(text, /上下文洞察/)
  assert.doesNotMatch(text, /"插件"/)
  assert.doesNotMatch(text, /"任务看板"/)
})

test('the host More menu renders nothing when the feature is off', () => {
  const store = fakeStore({ enabled: false, limit: 2, mode: 'auto', order: [], shown: [] })
  const catalog = fakeStore(panels)
  assert.equal(SidebarPanelsMenu({
    store,
    catalog,
    t: (key) => key,
    translate: (key) => key,
    entries: panels,
  }), null)
})

test('a row resolves to its stamp, its unique label, or its position', () => {
  const row = (attributes) => ({
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
  })
  assert.equal(panelRowId(row({ [PANEL_ID_ATTR]: 'memory', 'aria-label': '记忆系统' }), panels, 0), 'memory')
  assert.equal(panelRowId(row({ 'aria-label': '智能体' }), panels, 0), 'agents')
  assert.equal(panelRowId(row({ 'aria-label': '记忆系统' }), panels, 3), 'memory')
  assert.equal(panelRowId(row({ 'aria-label': '未知' }), panels, 2), 'pos:2')
})
