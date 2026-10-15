/**
 * Self-check for the LLM proxy-routing Settings page inside the shipped browser
 * half.
 *
 * The real bundle is loaded through a `window.__ModuleLoader__` shim, so the page
 * under test is byte-for-byte the one the DSH client serves. It is driven by a
 * minimal React/hook runtime against a mock host API, then asserted on its
 * dictionary parity, its render states and its request shapes.
 *
 * Run with: node --test test/proxy-page.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')
const source = readFileSync(bundlePath, 'utf8')

/** The proxy-routing page's own slice of the bundle, boundaries by its region markers. */
const PROXY_REGION_START = '//#region browser half: LLM proxy routing settings page'
const pageRegion = source.slice(source.indexOf(PROXY_REGION_START), source.indexOf('//#endregion', source.indexOf(PROXY_REGION_START)))
assert.notEqual(pageRegion, source, 'the proxy-routing region markers are present in the bundle')

let spec
globalThis.window = { __ModuleLoader__: { load: (loaded) => { spec = loaded } } }
await import(bundlePath)
assert.equal(spec.id, 'dsh-workspace-sort', 'bundle registers the package id')

/**
 * A hook runtime just large enough for the page: `useState`, `useRef` and
 * `useEffect` with dependency comparison, and a render pass that settles once
 * no state changed.
 */
let current = null
const React = {
  createElement(type, props, ...children) {
    const next = { ...(props || {}) }
    if (children.length === 1) next.children = children[0]
    else if (children.length > 1) next.children = children
    return { type, props: next }
  },
  useState: (...args) => current.useState(...args),
  useRef: (...args) => current.useRef(...args),
  useEffect: (...args) => current.useEffect(...args),
}

function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, at) => Object.is(value, b[at]))
}

function createRuntime() {
  const hooks = []
  let cursor = 0
  let dirty = false
  let effects = []
  return {
    get hooks() {
      return hooks
    },
    get effects() {
      return effects
    },
    get dirty() {
      return dirty
    },
    start() {
      cursor = 0
      dirty = false
      effects = []
    },
    api: {
      useState(init) {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = { value: typeof init === 'function' ? init() : init }
        const slot = hooks[index]
        return [
          slot.value,
          (next) => {
            const value = typeof next === 'function' ? next(slot.value) : next
            if (!Object.is(value, slot.value)) {
              slot.value = value
              dirty = true
            }
          },
        ]
      },
      useRef(init) {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = { value: { current: init } }
        return hooks[index].value
      },
      useEffect(fn, deps) {
        const index = cursor++
        const previous = hooks[index]
        if (!previous || !sameDeps(previous.deps, deps)) {
          hooks[index] = { deps, fn, cleanup: previous ? previous.cleanup : null }
          effects.push(index)
        }
      },
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Resolve function components and host children into a plain element tree. */
function resolve(element) {
  if (element === null || element === undefined || typeof element !== 'object') return element
  if (Array.isArray(element)) return element.map(resolve)
  if (typeof element.type === 'function') return resolve(element.type(element.props))
  const children = element.props.children
  if (children === undefined) return element
  return { ...element, props: { ...element.props, children: resolve(children) } }
}

/** Mount the page and expose `act()` for state-changing interactions. */
async function mount(Component, props) {
  const runtime = createRuntime()
  let tree = null
  async function pass() {
    for (let round = 0; round < 40; round += 1) {
      runtime.start()
      current = runtime.api
      tree = resolve(React.createElement(Component, props))
      for (const index of runtime.effects) {
        const hook = runtime.hooks[index]
        const cleanup = hook.fn()
        if (typeof cleanup === 'function') hook.cleanup = cleanup
      }
      await flush()
      await flush()
      if (!runtime.dirty) return tree
    }
    throw new Error('component did not settle')
  }
  await pass()
  return {
    get tree() {
      return tree
    },
    act: async (fn) => {
      fn()
      await pass()
      return tree
    },
  }
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ text: String(node) })
    return
  }
  visit({ node })
  walk(node.props ? node.props.children : null, visit)
}

const texts = (tree) => {
  const out = []
  walk(tree, (item) => {
    if (item.text !== undefined) out.push(item.text)
  })
  return out
}
const find = (tree, predicate) => {
  const out = []
  walk(tree, (item) => {
    if (item.node && predicate(item.node)) out.push(item.node)
  })
  return out
}
const text = (tree) => texts(tree).join(' | ')
const byRole = (tree, role, label) =>
  find(tree, (node) => node.props && node.props.role === role && (label === undefined || node.props['aria-label'] === label))[0]
const byText = (tree, label) => find(tree, (node) => node.type === 'button' && texts(node).join('') === label)[0]

const mod = spec.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})

const {
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
  proxyKnownHosts,
  proxySourceLabel,
  ProxyRoutingSection,
} = mod.__internals

// ------------------------------------------------------------------ constants

test('the page identifies itself with the package, not a separate plugin', () => {
  assert.equal(PROXY_NS, 'workspaceSortProxy')
  assert.equal(PROXY_API_BASE, '/api/dsh-workspace-sort/proxy')
  assert.equal(PROXY_SECTION_ID, 'llm-proxy')
  assert.equal(PROXY_SECTION_ORDER, 152)
  assert.equal(PROXY_STYLE_ID, 'dsh-workspace-sort/proxy-section.css')
  assert.equal(PROXY_CLASS_PREFIX, 'dwsp-')
})

// ---------------------------------------------------------------- dictionaries

test('zh and en carry exactly the same keys', () => {
  const zh = Object.keys(proxyZh).sort()
  const en = Object.keys(proxyEn).sort()
  assert.equal(zh.length, en.length)
  for (const key of zh) assert.equal(en.includes(key), true, `en is missing ${key}`)
})

test('every t() key the page renders exists in both dictionaries', () => {
  const used = new Set()
  for (const match of pageRegion.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(match[1])
  const missing = [...used].filter((key) => proxyZh[key] === undefined || proxyEn[key] === undefined)
  assert.deepEqual(missing, [])
})

test('no hardcoded CJK lives outside the proxy dictionaries', () => {
  const dictionaries = pageRegion.slice(
    pageRegion.indexOf('const proxyZh = {'),
    pageRegion.indexOf('//#endregion', pageRegion.indexOf('const proxyEn = {')),
  )
  const body = pageRegion.replace(dictionaries, '')
  assert.equal(/[一-鿿]/.test(body), false, 'the page must render every Chinese string through the dictionaries')
})

// ------------------------------------------------------------- pure page logic

test('a proxy URL is validated as required, invalid or acceptable', () => {
  assert.equal(proxyUrlProblem(''), 'required')
  assert.equal(proxyUrlProblem('   '), 'required')
  assert.equal(proxyUrlProblem('socks5://127.0.0.1:1080'), 'invalid')
  assert.equal(proxyUrlProblem('not a url'), 'invalid')
  assert.equal(proxyUrlProblem('http://127.0.0.1:7890'), null)
  assert.equal(proxyUrlProblem('https://user:pass@proxy.example:8080'), null)
})

test('a host pattern rejects whitespace, slashes and colons', () => {
  assert.equal(hostPatternProblem(''), 'empty')
  assert.equal(hostPatternProblem('bad host'), 'chars')
  assert.equal(hostPatternProblem('a/b.example'), 'chars')
  assert.equal(hostPatternProblem('a:b.example'), 'chars')
  assert.equal(hostPatternProblem('*.openrouter.ai'), null)
})

test('the wire payload is trimmed, sorted and free of local-only fields', () => {
  const payload = toProxyPayload({
    enabled: true,
    proxyUrl: '  http://127.0.0.1:7890  ',
    providers: {
      openrouter: { enabled: true, extraHosts: [' gw.example '], displayName: 'OpenRouter' },
      gemini: { enabled: false, extraHosts: [], displayName: 'Gemini' },
    },
    hosts: [{ uid: 'u1', pattern: '  a.example  ', enabled: true, note: '' }],
  })
  assert.equal(payload.proxyUrl, 'http://127.0.0.1:7890')
  assert.deepEqual(Object.keys(payload.providers), ['gemini', 'openrouter'], 'provider keys are sorted')
  assert.deepEqual(payload.providers.openrouter.extraHosts, ['gw.example'])
  assert.deepEqual(payload.hosts, [{ pattern: 'a.example', enabled: true, note: '' }], 'the local uid never reaches the host')
})

test('a draft is refused when the master switch is on without a proxy URL', () => {
  const t = (key) => key
  assert.equal(validateProxyDraft({ enabled: true, proxyUrl: '', providers: {}, hosts: [] }, t), 'proxy.required')
  assert.equal(validateProxyDraft({ enabled: false, proxyUrl: '', providers: {}, hosts: [] }, t), null)
  assert.equal(validateProxyDraft({ enabled: false, proxyUrl: 'socks5://x', providers: {}, hosts: [] }, t), 'proxy.invalid')
})

test('a draft carrying an unusable host rule is refused, naming its provider', () => {
  const t = (key) => key
  const draft = {
    enabled: true,
    proxyUrl: 'http://127.0.0.1:7890',
    providers: { gemini: { enabled: true, extraHosts: ['bad host'], displayName: 'Gemini' } },
    hosts: [],
  }
  assert.equal(validateProxyDraft(draft, t), 'providers.invalidHostWith')
})

test('a draft merges the host catalog with the stored document', () => {
  const catalog = [
    { id: 'gemini', displayName: 'Gemini', enabled: true, hosts: ['generativelanguage.googleapis.com'] },
    { id: 'openrouter', displayName: 'OpenRouter', enabled: false, hosts: ['openrouter.ai'] },
  ]
  const draft = normalizeProxyDraft(
    { enabled: true, proxyUrl: 'http://127.0.0.1:7890', providers: { gemini: { enabled: false, extraHosts: ['x.example'], displayName: 'Gemini' } }, hosts: [] },
    catalog,
  )
  assert.equal(draft.enabled, true)
  assert.equal(draft.providers.gemini.enabled, false, 'a stored override beats the catalog value')
  assert.deepEqual(draft.providers.gemini.extraHosts, ['x.example'])
  assert.equal(draft.providers.openrouter.enabled, false, 'a provider the document never mentions follows the catalog')
  assert.deepEqual(draft.providers.openrouter.extraHosts, [])
})

test('a stored provider the catalog does not report survives the merge', () => {
  const draft = normalizeProxyDraft({ providers: { retired: { enabled: true, extraHosts: [] } } }, [])
  assert.equal(draft.providers.retired.enabled, true)
  assert.equal(draft.providers.retired.displayName, 'retired')
})

test('host rows are keyed uniquely even for identical patterns', () => {
  const first = normalizeProxyDraft({ hosts: [{ pattern: 'a.example' }, { pattern: 'a.example' }] }, [])
  assert.notEqual(first.hosts[0].uid, first.hosts[1].uid)
})

test('catalog helpers read hosts and source labels', () => {
  const catalog = [{ id: 'gemini', hosts: ['a.example', 'b.example'] }, { id: 'x' }]
  assert.deepEqual(proxyKnownHosts(catalog, 'gemini'), ['a.example', 'b.example'])
  assert.deepEqual(proxyKnownHosts(catalog, 'missing'), [])
  const t = (key) => key
  assert.equal(proxySourceLabel('registered', t), 'providers.source.registered')
  assert.equal(proxySourceLabel('configured', t), 'providers.source.configured')
  assert.equal(proxySourceLabel('anything-else', t), 'providers.source.default')
})

// ------------------------------------------------------------------- host API

const calls = []
let routes = {}
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  const request = { url: String(url), method: (options && options.method) || 'GET', body: options && options.body }
  calls.push(request)
  const handler = routes[`${request.url} ${request.method}`]
  if (!handler) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'no route' }) }
  return handler(request)
}
const json = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload })

const state = {
  ok: true,
  config: {
    enabled: true,
    proxyUrl: 'http://127.0.0.1:7890',
    providers: {
      gemini: { enabled: true, extraHosts: [], displayName: 'Gemini' },
      deepseek: { enabled: false, extraHosts: [], displayName: 'DeepSeek' },
    },
    hosts: [{ pattern: '*.openrouter.ai', enabled: true, note: '' }],
  },
  providers: [
    { id: 'gemini', displayName: 'Gemini', enabled: true, hosts: ['generativelanguage.googleapis.com'], source: 'default' },
    { id: 'deepseek', displayName: 'DeepSeek', enabled: false, hosts: ['api.deepseek.com'], source: 'default' },
    { id: 'openrouter', displayName: 'OpenRouter', enabled: true, hosts: ['openrouter.ai'], source: 'configured' },
  ],
  effectiveHosts: ['generativelanguage.googleapis.com', 'openrouter.ai', '*.openrouter.ai'],
  proxyConfigured: true,
  runtime: { patched: true, undici: '8.11.2', proxyReachable: null, lastError: null },
}
routes = {
  [`${PROXY_API_BASE}/state GET`]: () => json(state),
  [`${PROXY_API_BASE}/config POST`]: (request) => json({ ok: true, config: JSON.parse(request.body).config, applied: true }),
  [`${PROXY_API_BASE}/test POST`]: () => json({ ok: true, latencyMs: 123 }),
  [`${PROXY_API_BASE}/reset POST`]: () => json({ ok: true, config: state.config }),
}

/** Translate through the zh dictionary, the way the settings shell's `t` seat does. */
const seat = (key, params) => {
  let value = proxyZh[key] !== undefined ? proxyZh[key] : key
  if (params) for (const name of Object.keys(params)) value = value.split(`{${name}}`).join(String(params[name]))
  return value
}

test('the ready state renders the effective routing and the runtime facts', async () => {
  calls.length = 0
  const page = await mount(ProxyRoutingSection, { t: seat })
  const rendered = text(page.tree)
  assert.match(rendered, /代理路由/)
  assert.match(rendered, /当前经代理：Gemini、OpenRouter/)
  assert.doesNotMatch(rendered, /当前经代理：[^|]*DeepSeek/, 'an unrouted provider is not named on the routed line')
  assert.match(rendered, /生效代理：http:\/\/127\.0\.0\.1:7890/)
  assert.match(rendered, /3 条主机规则/)
  assert.match(rendered, /generativelanguage\.googleapis\.com/)
  assert.match(rendered, /宿主已接管 fetch/)
  assert.match(rendered, /undici 8\.11\.2/)
  assert.equal(
    find(page.tree, (node) => node.type === 'input' && node.props.value === '*.openrouter.ai').length,
    1,
    'the extra host rule is editable',
  )
  assert.equal(find(page.tree, (node) => node.props && node.props.role === 'switch').length, 5)
  assert.ok(calls.some((call) => call.url === `${PROXY_API_BASE}/state` && call.method === 'GET'), 'state is read on mount')
})

test('toggling a provider marks the draft unsaved and previews the pending routing', async () => {
  const page = await mount(ProxyRoutingSection, { t: seat })
  const geminiSwitch = byRole(page.tree, 'switch', 'Gemini 走代理')
  assert.ok(geminiSwitch, 'the provider switch carries its accessible label')
  await page.act(() => geminiSwitch.props.onClick())
  assert.match(text(page.tree), /有未保存的修改/)
  assert.match(text(page.tree), /保存后经代理：OpenRouter/)
})

test('a provider row adds a removable host and refuses an unusable one', async () => {
  const page = await mount(ProxyRoutingSection, { t: seat })
  const input = () => find(page.tree, (node) => node.type === 'input' && node.props['aria-label'] === '为 Gemini 添加主机规则')[0]
  const add = () => find(page.tree, (node) => node.type === 'button' && texts(node).join('') === '添加')[0]

  await page.act(() => input().props.onChange({ target: { value: '  *.example.com  ' } }))
  await page.act(() => add().props.onClick())
  assert.match(text(page.tree), /\*\.example\.com/, 'the added pattern is rendered as a chip')

  await page.act(() => input().props.onChange({ target: { value: 'bad host' } }))
  await page.act(() => add().props.onClick())
  assert.match(text(page.tree), /主机规则无效/)

  await page.act(() => input().props.onChange({ target: { value: 'generativelanguage.googleapis.com' } }))
  await page.act(() => add().props.onClick())
  assert.match(text(page.tree), /该主机规则已存在/, 'a catalog host is not added twice')
})

test('the probe posts the typed URL and reports the measured latency', async () => {
  calls.length = 0
  const page = await mount(ProxyRoutingSection, { t: seat })
  const probeButton = byText(page.tree, '测试代理')
  assert.ok(probeButton, 'the proxy test button is rendered')
  await page.act(() => probeButton.props.onClick())
  assert.match(text(page.tree), /连接成功（123 ms）/)
  const posted = calls.filter((call) => call.url === `${PROXY_API_BASE}/test`).pop()
  assert.equal(posted.body, JSON.stringify({ proxyUrl: 'http://127.0.0.1:7890' }))
})

test('a probe on an unusable URL is refused locally, without a request', async () => {
  calls.length = 0
  const page = await mount(ProxyRoutingSection, { t: seat })
  const input = find(page.tree, (node) => node.type === 'input' && node.props.id === 'dwsp-proxy-url')[0]
  await page.act(() => input.props.onChange({ target: { value: 'socks5://127.0.0.1:1080' } }))
  await page.act(() => byText(page.tree, '测试代理').props.onClick())
  assert.match(text(page.tree), /代理地址无效/)
  assert.equal(calls.filter((call) => call.url === `${PROXY_API_BASE}/test`).length, 0)
})

test('saving posts the whole document, then re-reads the state', async () => {
  calls.length = 0
  const page = await mount(ProxyRoutingSection, { t: seat })
  const input = find(page.tree, (node) => node.type === 'input' && node.props['aria-label'] === '为 Gemini 添加主机规则')[0]
  await page.act(() => input.props.onChange({ target: { value: '*.example.com' } }))
  await page.act(() => find(page.tree, (node) => node.type === 'button' && texts(node).join('') === '添加')[0].props.onClick())
  await page.act(() => byText(page.tree, '保存').props.onClick())

  const saved = calls.filter((call) => call.url === `${PROXY_API_BASE}/config`).pop()
  assert.ok(saved, 'the save reached the host')
  const posted = JSON.parse(saved.body).config
  assert.equal(posted.proxyUrl, 'http://127.0.0.1:7890')
  assert.equal(posted.providers.gemini.extraHosts.includes('*.example.com'), true)
  assert.equal(posted.hosts.length, 1)
  assert.match(text(page.tree), /已保存/)
  assert.doesNotMatch(text(page.tree), /有未保存的修改/, 'a successful save clears the unsaved marker')
})

test('restore asks first, then posts and re-reads', async () => {
  calls.length = 0
  const page = await mount(ProxyRoutingSection, { t: seat })
  await page.act(() => byText(page.tree, '恢复默认').props.onClick())
  assert.match(text(page.tree), /恢复默认会覆盖当前配置/)
  await page.act(() => byText(page.tree, '确认恢复').props.onClick())
  assert.ok(calls.some((call) => call.url === `${PROXY_API_BASE}/reset` && call.method === 'POST'))
  assert.match(text(page.tree), /已保存/)
})

test('an unreachable host API renders an error state instead of throwing', async () => {
  routes = {}
  const page = await mount(ProxyRoutingSection, { t: seat })
  assert.match(text(page.tree), /读取配置失败/)
  assert.ok(byText(page.tree, '重试'), 'the error state offers a retry')
  assert.notEqual(page.tree, null)
  routes = {
    [`${PROXY_API_BASE}/state GET`]: () => json(state),
    [`${PROXY_API_BASE}/config POST`]: () => json({ ok: false, error: '代理地址无法解析' }, 400),
  }
})

test('a refused save keeps the host reason on screen', async () => {
  const page = await mount(ProxyRoutingSection, { t: seat })
  await page.act(() => byText(page.tree, '保存').props.onClick())
  assert.match(text(page.tree), /保存失败：代理地址无法解析/)
})

test('the host API base is restored after the run', () => {
  globalThis.fetch = realFetch
})

// ---------------------------------------------------------------- style audit

test('the stylesheet uses theme tokens only and its own class prefix', () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(PROXY_CSS), false, 'no literal hex colors')
  assert.equal(/\b(rgb|rgba|hsl|hsla)\(/.test(PROXY_CSS), false, 'no rgb()/hsl() colors')
  const variables = [...PROXY_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1])
  assert.equal(variables.every((token) => token.startsWith('--dsw-')), true, 'every var() is a --dsw token')

  const tokenFile = process.env.DSH_THEME_TOKENS
  if (tokenFile && existsSync(tokenFile)) {
    const known = new Set(readFileSync(tokenFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))
    const unknown = [...new Set(variables)].filter((token) => !known.has(token))
    assert.deepEqual(unknown, [], 'every token exists in the live theme token list')
  }

  const classes = [...PROXY_CSS.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((match) => match[1])
  const foreign = classes.filter((name) => !name.startsWith(PROXY_CLASS_PREFIX))
  assert.deepEqual(foreign, [], 'every class name carries the page prefix')
})
