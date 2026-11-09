/**
 * DOM-level tests for the sidebar panel engine.
 *
 * A tiny in-memory DOM stands in for the browser: enough structure and the
 * handful of element methods the engine touches, so folding, the active-panel
 * escape hatch, the fallback trigger and a full long-press drag are exercised
 * against the real bundle rather than against reimplemented helpers.
 *
 * Run with: node --test test/panels-dom.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------- tiny DOM

class FakeStyle {
  constructor() {
    this.order = ''
    this.left = ''
    this.top = ''
  }

  removeProperty(name) {
    if (name === 'order') this.order = ''
    if (name === 'left') this.left = ''
    if (name === 'top') this.top = ''
  }
}

/** Parse the simple selector subset the engine uses: tag, class, and attributes. */
function matchCompound(element, selector) {
  let rest = selector.trim()
  if (rest === '') return false
  const tag = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/)
  if (tag !== null) {
    if (element.tagName !== tag[0].toUpperCase()) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest.length > 0) {
    const attr = rest.match(/^\[([^\]=]+)(?:="([^"]*)")?\]/)
    if (attr !== null) {
      const name = attr[1]
      const value = attr[2]
      if (!element.hasAttribute(name)) return false
      if (value !== undefined && element.getAttribute(name) !== value) return false
      rest = rest.slice(attr[0].length)
      continue
    }
    const cls = rest.match(/^\.([\w-]+)/)
    if (cls !== null) {
      if (!(element.className ?? '').split(/\s+/).includes(cls[1])) return false
      rest = rest.slice(cls[0].length)
      continue
    }
    const descendant = rest.match(/^\s+([\s\S]+)$/)
    if (descendant !== null) {
      // Ancestor combinators are only used as "some ancestor matches"; the
      // engine's selectors nest at most one level.
      return true
    }
    return false
  }
  return true
}

function matches(element, selector) {
  const value = selector.trim()
  if (value === 'nav > *') return element.parentElement !== null && element.parentElement.tagName === 'NAV'
  if (/\s/.test(value)) {
    const parts = value.split(/\s+/)
    return matchCompound(element, parts[parts.length - 1])
  }
  return matchCompound(element, value)
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.children = []
    this.parentElement = null
    this.attributes = new Map()
    this.className = ''
    this.style = new FakeStyle()
    this.textContent = ''
    this.innerHTML = ''
    this.isConnected = true
    this.offsetWidth = 280
    this.offsetHeight = 160
    this.rect = null
    this.listeners = new Map()
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  appendChild(child) {
    if (child.parentElement !== null) child.parentElement.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }

  append(...children) {
    for (const child of children) {
      if (typeof child === 'string') {
        const text = new FakeElement('span')
        text.textContent = child
        this.appendChild(text)
      } else {
        this.appendChild(child)
      }
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentElement = null
  }

  remove() {
    if (this.parentElement !== null) this.parentElement.removeChild(this)
    this.isConnected = false
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  matches(selector) {
    return matches(this, selector)
  }

  closest(selector) {
    let node = this
    while (node !== null) {
      if (node.matches !== undefined && node.matches(selector)) return node
      node = node.parentElement
    }
    return null
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  contains(node) {
    if (node === this) return true
    for (const child of this.children) {
      if (child.contains(node)) return true
    }
    return false
  }

  getBoundingClientRect() {
    return this.rect ?? { top: 0, left: 0, width: 200, height: 36, bottom: 36, right: 200 }
  }

  setPointerCapture() {}

  releasePointerCapture() {}

  click() {
    this.dispatch('click', { target: this, preventDefault() {}, stopPropagation() {} })
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement('head')
    this.body = new FakeElement('body')
    this.listeners = new Map()
  }

  createElement(tag) {
    return new FakeElement(tag)
  }

  querySelectorAll(selector) {
    const out = []
    for (const root of [this.head, this.body]) {
      if (root.matches(selector)) out.push(root)
      out.push(...root.querySelectorAll(selector))
    }
    return out
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

class FakeObserver {
  observe() {}
  disconnect() {}
}

const doc = new FakeDocument()
const win = {
  __ModuleLoader__: { load(loaded) { spec = loaded } },
  MutationObserver: FakeObserver,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1200,
  innerHeight: 800,
}
let spec
globalThis.window = win
globalThis.document = doc

await import('../lib/client.js')

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
  createPanelEngine,
  PANEL_ROW_ATTR,
  PANEL_SHOWN_ATTR,
  PANEL_TRIGGER_ATTR,
  PANEL_DRAGGED_ATTR,
  PANEL_REORDER_ATTR,
  PANEL_DONE_ATTR,
  PANEL_NAV_ATTR,
} = mod.__internals

const LABELS = [
  ['plugins', '插件'],
  ['task-board', '任务看板'],
  ['agents', '智能体'],
  ['memory', '记忆系统'],
  ['context', '上下文洞察'],
]

function storeOf(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function fixture(options = {}) {
  const document = new FakeDocument()
  const nav = document.createElement('nav')
  nav.rect = { top: 0, left: 0, width: 240, height: 200, bottom: 200, right: 240 }
  const rows = LABELS.map(([id, label], index) => {
    const row = document.createElement('button')
    row.setAttribute('aria-label', label)
    row.rect = { top: index * 40, left: 0, width: 220, height: 36, bottom: index * 40 + 36, right: 220 }
    nav.appendChild(row)
    return row
  })
  let moreWrap = null
  if (options.hostMore !== false) {
    moreWrap = document.createElement('span')
    const more = document.createElement('button')
    more.setAttribute('aria-haspopup', 'menu')
    more.setAttribute('aria-label', '更多')
    moreWrap.appendChild(more)
    nav.appendChild(moreWrap)
  }
  document.body.appendChild(nav)

  const settings = options.settings ?? { enabled: true, limit: 2, mode: 'auto', order: [], shown: [] }
  const store = storeOf(settings)
  const catalog = storeOf(LABELS.map(([id, label]) => ({ id, label })))
  const updates = []
  const update = (patch) => {
    const next = { ...store.getSnapshot(), ...patch }
    store.set(next)
    updates.push(next)
  }
  const engine = createPanelEngine({ get: () => null }, {
    doc: document,
    win,
    store,
    catalog,
    update,
    translate: (key) => key,
    actionsSeat: () => options.actionsSeat === true,
  })
  return { document, nav, rows, moreWrap, store, catalog, updates, engine }
}

/** The pointer event shape the engine reads. */
function pointer(overrides = {}) {
  return {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 100,
    clientY: 0,
    cancelable: true,
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  }
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- folding

test('the engine folds rows past the ceiling and keeps the host More launcher last', async () => {
  const f = fixture()
  f.engine.start()
  f.engine.applyNow()
  assert.equal(f.nav.getAttribute(PANEL_NAV_ATTR), '1')
  assert.equal(f.rows[0].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[1].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[2].getAttribute(PANEL_SHOWN_ATTR), '0')
  assert.equal(f.rows[4].getAttribute(PANEL_SHOWN_ATTR), '0')
  assert.equal(f.rows[0].style.order, '0')
  assert.equal(f.rows[4].style.order, '4')
  assert.equal(f.moreWrap.style.order, '15')
  assert.equal(f.nav.querySelector('button[' + PANEL_TRIGGER_ATTR + ']'), null)
  f.engine.stop()
  assert.equal(f.rows[0].getAttribute(PANEL_ROW_ATTR), null)
  assert.equal(f.rows[0].style.order, '')
  assert.equal(f.moreWrap.style.order, '')
})

test('the open panel stays visible even beyond the ceiling', () => {
  const f = fixture()
  f.rows[3].setAttribute('aria-current', 'page')
  f.engine.applyNow()
  assert.equal(f.rows[3].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[2].getAttribute(PANEL_SHOWN_ATTR), '0')
  f.engine.stop()
})

test('the saved order decides which rows stay above the fold', () => {
  const f = fixture({ settings: { enabled: true, limit: 2, mode: 'auto', order: ['memory', 'context'], shown: [] } })
  f.engine.applyNow()
  assert.equal(f.rows[3].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[4].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[0].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[1].getAttribute(PANEL_SHOWN_ATTR), '0')
  assert.equal(f.rows[3].style.order, '0')
  assert.equal(f.rows[0].style.order, '2')
  f.engine.stop()
})

test('manual mode follows the checked ids and ignores the ceiling', () => {
  const f = fixture({ settings: { enabled: true, limit: 1, mode: 'manual', order: [], shown: ['agents', 'context'] } })
  f.engine.applyNow()
  assert.equal(f.rows[0].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[2].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[4].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[1].getAttribute(PANEL_SHOWN_ATTR), '0')
  assert.equal(f.rows[3].getAttribute(PANEL_SHOWN_ATTR), '0')
  f.engine.stop()
})

test('turning folding off puts every marked row back', () => {
  const f = fixture()
  f.engine.applyNow()
  f.store.set({ ...f.store.getSnapshot(), enabled: false })
  f.engine.applyNow()
  assert.equal(f.rows[2].getAttribute(PANEL_ROW_ATTR), null)
  assert.equal(f.rows[2].getAttribute(PANEL_SHOWN_ATTR), null)
  assert.equal(f.rows[2].style.order, '')
  assert.equal(f.moreWrap.style.order, '')
  f.engine.stop()
})

// ---------------------------------------------------------------- fallback trigger

test('a host without the actions slot gets a fallback trigger instead of a More row', () => {
  const f = fixture({ hostMore: false })
  f.engine.applyNow()
  const trigger = f.nav.querySelector('button[' + PANEL_TRIGGER_ATTR + ']')
  assert.notEqual(trigger, null)
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(trigger.style.order, '15')
  f.engine.stop()
  assert.equal(f.nav.querySelector('button[' + PANEL_TRIGGER_ATTR + ']'), null)
})

// ---------------------------------------------------------------- drag

test('holding a row and dragging past the first row reorders and persists', async () => {
  const f = fixture({ settings: { enabled: true, limit: 5, mode: 'auto', order: [], shown: [] } })
  f.engine.start()
  f.engine.applyNow()
  f.document.dispatch('pointerdown', pointer({ target: f.rows[3], clientY: 140 }))
  await settle(430)
  assert.equal(f.rows[3].getAttribute(PANEL_DRAGGED_ATTR), '1')
  f.document.dispatch('pointermove', pointer({ clientY: 2 }))
  f.document.dispatch('pointerup', pointer({ clientY: 2 }))
  assert.deepEqual(f.store.getSnapshot().order, ['memory', 'plugins', 'task-board', 'agents', 'context'])
  assert.equal(f.updates.length, 1)
  assert.equal(f.rows[3].getAttribute(PANEL_DRAGGED_ATTR), null)
  assert.equal(f.rows[3].style.order, '0')
  f.engine.stop()
})

test('a long press without movement opens arrange mode without changing the order', async () => {
  const f = fixture()
  f.engine.start()
  f.engine.applyNow()
  f.document.dispatch('pointerdown', pointer({ target: f.rows[1], clientY: 60 }))
  await settle(430)
  f.document.dispatch('pointerup', pointer({ clientY: 60 }))
  assert.deepEqual(f.store.getSnapshot().order, [])
  assert.equal(f.updates.length, 0)
  assert.equal(f.nav.getAttribute(PANEL_REORDER_ATTR), '1')
  const done = f.nav.querySelector('button[' + PANEL_DONE_ATTR + ']')
  assert.notEqual(done, null)
  assert.equal(done.getAttribute(PANEL_ROW_ATTR), null, 'the arrange control is not a panel row')
  f.engine.applyNow()
  assert.equal(f.nav.getAttribute(PANEL_REORDER_ATTR), '1', 'a reconcile keeps arrange mode open')
  done.click()
  assert.equal(f.nav.getAttribute(PANEL_REORDER_ATTR), null)
  assert.equal(f.nav.querySelector('button[' + PANEL_DONE_ATTR + ']'), null)
  f.engine.stop()
})

test('a folded row can be dragged into the visible head from arrange mode', async () => {
  const f = fixture()
  f.engine.start()
  f.engine.applyNow()
  // A plain hold opens arrange mode and reveals every row.
  f.document.dispatch('pointerdown', pointer({ target: f.rows[0], clientY: 20 }))
  await settle(430)
  f.document.dispatch('pointerup', pointer({ clientY: 20 }))
  assert.equal(f.nav.getAttribute(PANEL_REORDER_ATTR), '1')
  // The previously hidden row is now reachable and can be moved to the top.
  f.document.dispatch('pointerdown', pointer({ target: f.rows[3], clientY: 140 }))
  await settle(430)
  assert.equal(f.rows[3].getAttribute(PANEL_DRAGGED_ATTR), '1')
  f.document.dispatch('pointermove', pointer({ clientY: 2 }))
  f.document.dispatch('pointerup', pointer({ clientY: 2 }))
  assert.deepEqual(f.store.getSnapshot().order, ['memory', 'plugins', 'task-board', 'agents', 'context'])
  assert.equal(f.nav.getAttribute(PANEL_REORDER_ATTR), null)
  assert.equal(f.nav.querySelector('button[' + PANEL_DONE_ATTR + ']'), null)
  assert.equal(f.rows[3].getAttribute(PANEL_SHOWN_ATTR), '1')
  assert.equal(f.rows[3].style.order, '0')
  f.engine.stop()
})

test('moving before the delay is treated as a click/scroll, not a drag', async () => {
  const f = fixture({ settings: { enabled: true, limit: 5, mode: 'auto', order: [], shown: [] } })
  f.engine.start()
  f.engine.applyNow()
  f.document.dispatch('pointerdown', pointer({ target: f.rows[0], clientY: 20 }))
  f.document.dispatch('pointermove', pointer({ clientY: 90 }))
  await settle(430)
  f.document.dispatch('pointerup', pointer({ clientY: 90 }))
  assert.equal(f.updates.length, 0)
  f.engine.stop()
})
