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
  assert.deepEqual(normalizeSettings(undefined), { visiblePerWorkspace: 5, sortWorkspaces: true })
  assert.deepEqual(normalizeSettings({ visiblePerWorkspace: 8 }), { visiblePerWorkspace: 8, sortWorkspaces: true })
  assert.deepEqual(normalizeSettings({ visiblePerWorkspace: 8, sortWorkspaces: false }), { visiblePerWorkspace: 8, sortWorkspaces: false })
  assert.deepEqual(normalizeSettings('junk'), { visiblePerWorkspace: 5, sortWorkspaces: true })
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
