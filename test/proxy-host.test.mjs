/**
 * Tests for the Host entry: route registration, the configuration store, and
 * the degradation paths.
 *
 * The entry runs against a Context double rather than a real Cordis, because
 * what needs pinning here is the route table and the failure handling, not the
 * DI graph — `test/cordis/run.mjs` already covers the real thing for the
 * browser half.
 *
 * The configuration file it writes lands in the OS temp directory under a fixed
 * name, so a run leaves one small file there and overwrites it next time.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { inject, apply } = await import('../lib/index.js')
const { defaultConfigPath } = await import('../lib/proxy-config.js')

const CONFIG_PATH = join(tmpdir(), 'dsh-workspace-sort-proxy-host-test', 'config.json')
const PREFIX = '/api/dsh-workspace-sort/proxy'

/** A response recorder shaped like the one the Host's webServer hands a route. */
function recorder() {
  const state = { status: 0, headers: null, body: '' }
  return {
    state,
    res: {
      writeHead(status, headers) {
        state.status = status
        state.headers = headers
      },
      end(body) {
        state.body = body
      },
    },
  }
}

/** A GET request: the read routes never read a body. */
const get = () => ({ method: 'GET' })

/** A POST request carrying `value` as its JSON body. */
function post(value) {
  const chunks = value === undefined ? [] : [Buffer.from(JSON.stringify(value), 'utf8')]
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  }
}

/** A POST request whose body stream fails halfway through. */
function postBroken() {
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      throw new Error('connection reset')
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30))

/**
 * Mount the host half against a double.
 *
 * The `fetch` patch it installs is process-wide, so the original is captured and
 * put back by `dispose()` however the body ends.
 */
async function mount(rowConfig = {}) {
  const routes = new Map()
  const effects = []
  const fetchBefore = globalThis.fetch
  const ctx = {
    logger: { info() {}, warn() {} },
    effect(fn) {
      effects.push(fn)
      return fn()
    },
    get: () => undefined,
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
  }
  apply(ctx, { configPath: CONFIG_PATH, ...rowConfig })
  await flush()
  return {
    routes,
    fetchBefore,
    dispose() {
      for (const dispose of effects) dispose()
      globalThis.fetch = fetchBefore
    },
  }
}

// ------------------------------------------------------------------ contract

test('the host half declares only the HTTP carrier it really needs', () => {
  assert.deepEqual(inject, ['webServer'], 'the `llm` service is optional and read through ctx.get')
})

test('the configuration lands beside the workspace-sort preferences by default', () => {
  const path = defaultConfigPath()
  assert.ok(path.endsWith(join('workspace-sort', 'proxy-config.json')), `unexpected default path: ${path}`)
})

test('every route of the proxy surface is registered under the package prefix', async () => {
  const host = await mount()
  try {
    assert.deepEqual(
      [...host.routes.keys()].sort(),
      [`${PREFIX}/config`, `${PREFIX}/diagnostics`, `${PREFIX}/reset`, `${PREFIX}/selftest`, `${PREFIX}/state`, `${PREFIX}/test`],
    )
  } finally {
    host.dispose()
  }
})

test('the router installs its fetch patch and puts the original back on disposal', async () => {
  const host = await mount()
  const patched = globalThis.fetch
  host.dispose()
  assert.equal(globalThis.fetch, host.fetchBefore, 'disposal restores the process fetch exactly')
  if (patched !== host.fetchBefore) {
    assert.equal(typeof patched, 'function', 'a patched fetch is still callable')
  }
})

// --------------------------------------------------------------------- state

test('state reports the configuration, the provider catalog and the runtime', async () => {
  const host = await mount()
  try {
    const out = recorder()
    await host.routes.get(`${PREFIX}/state`)(get(), out.res)

    assert.equal(out.state.status, 200)
    assert.equal(out.state.headers['cache-control'], 'no-store')
    const payload = JSON.parse(out.state.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.configPath, CONFIG_PATH)
    assert.equal(typeof payload.runtime.patched, 'boolean')
    assert.equal(typeof payload.runtime.requests, 'number')
    assert.ok(Array.isArray(payload.effectiveHosts))

    const gemini = payload.providers.find((row) => row.id === 'gemini')
    assert.ok(gemini, 'the built-in catalog reaches the page even with no llm service')
    assert.ok(gemini.hosts.includes('generativelanguage.googleapis.com'))
    assert.equal(payload.providers.find((row) => row.id === 'deepseek').locked, true, 'a never-proxied row is locked')
    assert.equal(
      gemini.enabled,
      true,
      'a never-saved installation pre-selects the cloud providers the master switch governs',
    )
    assert.equal(payload.config.enabled, false, 'routing itself stays off until the switch is saved on')
    assert.ok(
      payload.effectiveHosts.includes('generativelanguage.googleapis.com'),
      'the listed host patterns describe the rules, which survive a switch-off',
    )
    assert.equal(payload.proxyConfigured, false, 'a fresh installation has no proxy URL')
  } finally {
    host.dispose()
  }
})

test('diagnostics names the configuration file and the routing counters', async () => {
  const host = await mount()
  try {
    const out = recorder()
    await host.routes.get(`${PREFIX}/diagnostics`)(get(), out.res)
    const payload = JSON.parse(out.state.body)
    assert.equal(payload.config.path, CONFIG_PATH)
    assert.equal(typeof payload.process.pid, 'number')
    assert.ok('patch' in payload)
  } finally {
    host.dispose()
  }
})

// --------------------------------------------------------------------- saving

test('saving applies the document at once and rejects an unusable proxy URL', async () => {
  const host = await mount()
  try {
    const refused = recorder()
    await host.routes.get(`${PREFIX}/config`)(
      post({ config: { enabled: true, proxyUrl: 'socks5://127.0.0.1:1080', providers: {}, hosts: [] } }),
      refused.res,
    )
    assert.equal(refused.state.status, 400)
    assert.match(JSON.parse(refused.state.body).error, /必须先填写有效的代理地址/)

    const accepted = recorder()
    await host.routes.get(`${PREFIX}/config`)(
      post({
        config: {
          enabled: true,
          proxyUrl: '127.0.0.1:7890',
          providers: { gemini: { enabled: true, extraHosts: [] }, deepseek: { enabled: true, extraHosts: [] } },
          hosts: [{ pattern: '*.openrouter.ai', enabled: true }],
        },
      }),
      accepted.res,
    )
    assert.equal(accepted.state.status, 200)
    const saved = JSON.parse(accepted.state.body)
    assert.equal(saved.applied, true)
    assert.equal(saved.config.proxyUrl, 'http://127.0.0.1:7890', 'a scheme-less address is normalized on save')
    assert.equal(saved.config.providers.deepseek.enabled, false, 'the never-proxied set is refused on the way in')

    // The write reached the store: a fresh read serves it back.
    const reread = recorder()
    await host.routes.get(`${PREFIX}/state`)(get(), reread.res)
    const state = JSON.parse(reread.state.body)
    assert.equal(state.config.enabled, true)
    assert.equal(state.config.proxyUrl, 'http://127.0.0.1:7890')
    assert.ok(state.effectiveHosts.includes('generativelanguage.googleapis.com'))
    assert.ok(state.effectiveHosts.includes('*.openrouter.ai'))
    assert.equal(state.effectiveHosts.includes('api.deepseek.com'), false, 'a locked provider contributes no host')
    assert.equal(state.proxyConfigured, true)
  } finally {
    await (async () => {
      const out = recorder()
      await host.routes.get(`${PREFIX}/reset`)(post(), out.res)
      host.dispose()
    })()
  }
})

// ----------------------------------------------------------------- refusals

test('the write routes refuse a method they do not implement', async () => {
  const host = await mount()
  try {
    for (const path of [`${PREFIX}/config`, `${PREFIX}/test`, `${PREFIX}/reset`, `${PREFIX}/selftest`]) {
      const out = recorder()
      await host.routes.get(path)(get(), out.res)
      assert.equal(out.state.status, 405, `${path} must answer 405`)
    }
  } finally {
    host.dispose()
  }
})

test('an unreadable request body is a 400 with a readable reason', async () => {
  const host = await mount()
  try {
    for (const path of [`${PREFIX}/config`, `${PREFIX}/test`, `${PREFIX}/selftest`]) {
      const out = recorder()
      await host.routes.get(path)(postBroken(), out.res)
      assert.equal(out.state.status, 400, `${path} must answer 400`)
      assert.match(JSON.parse(out.state.body).error, /无法解析请求体/)
    }
  } finally {
    host.dispose()
  }
})

test('the probe refuses an address it cannot dial without touching the network', async () => {
  const host = await mount()
  try {
    const out = recorder()
    await host.routes.get(`${PREFIX}/test`)(post({ proxyUrl: 'ftp://proxy.example:21' }), out.res)
    assert.equal(out.state.status, 400)
    assert.match(JSON.parse(out.state.body).error, /代理地址无效/)
  } finally {
    host.dispose()
  }
})
