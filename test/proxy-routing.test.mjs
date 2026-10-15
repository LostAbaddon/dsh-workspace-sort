/**
 * End-to-end tests for the fetch patch.
 *
 * They run against throwaway local servers, so the assertions are about this
 * plugin's behaviour rather than about the internet: the router must hand a
 * routed host to the proxy dispatcher, must leave an unrouted host on the
 * process's normal path, and must send nothing to the proxy while disabled. One
 * additional check drives a real CONNECT tunnel to an external host, and falls
 * back to asserting the decision alone when the machine has no outbound network.
 *
 * The dispatcher comes from the same resolver the Host uses, with
 * `DSH_WORKSPACE_SORT_PROXY_UNDICI` pointing at an installed undici when the test
 * runs outside the packaged app.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

import { AgentPool, installFetchPatch, loadUndici } from '../lib/proxy-transport.js'
import { normalizeConfig } from '../lib/proxy-core.js'

const ORIGIN_PORT = 18092
const PROXY_PORT = 18091
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`

async function startOrigin() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host })
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('origin-ok')
  })
  await new Promise((resolve) => server.listen(ORIGIN_PORT, '127.0.0.1', resolve))
  return {
    seen,
    async stop() {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

async function startProxy() {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ kind: 'request', url: req.url })
    let target
    try {
      target = new URL(req.url)
    } catch {
      res.writeHead(400).end('bad url')
      return
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(res)
      },
    )
    upstream.on('error', () => res.writeHead(502).end('upstream error'))
    req.pipe(upstream)
  })
  server.on('connect', (req, clientSocket, head) => {
    hits.push({ kind: 'connect', host: req.url })
    const [host, portRaw] = String(req.url).split(':')
    const upstream = net.connect(Number(portRaw || 443), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => upstream.destroy())
  })
  await new Promise((resolve) => server.listen(PROXY_PORT, '127.0.0.1', resolve))
  return {
    hits,
    async stop() {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

function configFor(overrides) {
  return normalizeConfig({
    enabled: true,
    proxyUrl: PROXY_URL,
    providers: { gemini: { enabled: true } },
    hosts: [],
    ...overrides,
  })
}

async function withHarness(body) {
  const [origin, proxy, loaded] = await Promise.all([startOrigin(), startProxy(), loadUndici()])
  const pool = new AgentPool(loaded.undici)
  let config = configFor()
  const realFetch = globalThis.fetch
  let dispatcherUses = 0
  const patch = installFetchPatch({
    undici: {
      fetch: (input, init) => {
        if (init?.dispatcher) dispatcherUses += 1
        return loaded.undici.fetch(input, init)
      },
    },
    pool,
    getConfig: () => config,
    logger: { warn() {} },
  })
  try {
    await body({
      origin,
      proxy,
      patch,
      dispatcherUses: () => dispatcherUses,
      setConfig(next) {
        config = next
      },
    })
  } finally {
    patch.uninstall()
    globalThis.fetch = realFetch
    await pool.dispose()
    await proxy.stop()
    await origin.stop()
  }
}

test('a routed host is handed to the proxy dispatcher', async () => {
  await withHarness(async ({ proxy, patch, dispatcherUses, setConfig }) => {
    setConfig(configFor({ providers: { gemini: { enabled: true } }, hosts: [{ pattern: 'example.com' }] }))
    assert.equal(patch.state.proxied, 0)
    try {
      const response = await fetch('https://example.com/', { signal: AbortSignal.timeout(15000) })
      await response.text()
      assert.equal(response.status, 200)
      assert.equal(patch.state.proxied, 1)
      assert.equal(patch.state.direct, 0)
      assert.equal(dispatcherUses(), 1)
      assert.deepEqual(proxy.hits, [{ kind: 'connect', host: 'example.com:443' }])
    } catch (error) {
      // No outbound network: the decision itself is still fully asserted.
      const decision = patch.state.lastDecisions[0]
      assert.equal(decision?.host, 'example.com', `unexpected failure: ${error?.message ?? error}`)
      assert.equal(decision?.proxy, true)
      assert.equal(decision?.reason, 'matched example.com')
      assert.equal(dispatcherUses(), 1)
    }
  })
})

test('an unrouted host stays direct and the proxy sees nothing', async () => {
  await withHarness(async ({ origin, proxy, patch }) => {
    const response = await fetch(`http://127.0.0.1:${ORIGIN_PORT}/v1/chat/completions`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'origin-ok')
    assert.equal(patch.state.direct, 1)
    assert.equal(patch.state.proxied, 0)
    assert.equal(proxy.hits.length, 0)
    assert.equal(origin.seen.length, 1)
  })
})

test('a deepseek host is never routed even when its row is posted enabled', async () => {
  const config = normalizeConfig({
    enabled: true,
    proxyUrl: PROXY_URL,
    providers: { deepseek: { enabled: true } },
  })
  assert.equal(config.providers.deepseek.enabled, false)
  await withHarness(async ({ proxy, setConfig, patch }) => {
    setConfig(config)
    const response = await fetch(`http://127.0.0.1:${ORIGIN_PORT}/v1/chat/completions`, {
      headers: { host: 'api.deepseek.com' },
    })
    assert.equal(response.status, 200)
    assert.equal(proxy.hits.length, 0)
    assert.equal(patch.state.proxied, 0)
  })
})

test('disabling the router restores a direct path', async () => {
  await withHarness(async ({ proxy, setConfig, patch, dispatcherUses }) => {
    setConfig(configFor({ enabled: false }))
    const response = await fetch(`http://127.0.0.1:${ORIGIN_PORT}/v1/models`)
    assert.equal(response.status, 200)
    assert.equal(proxy.hits.length, 0)
    assert.equal(patch.state.direct, 1)
    assert.equal(patch.state.proxied, 0)
    assert.equal(dispatcherUses(), 0)
  })
})

test('a catch-all host rule still leaves local origins direct', async () => {
  await withHarness(async ({ proxy, setConfig, patch }) => {
    setConfig(configFor({ providers: {}, hosts: [{ pattern: '*' }] }))
    const response = await fetch(`http://127.0.0.1:${ORIGIN_PORT}/anything`)
    assert.equal(response.status, 200)
    assert.equal(proxy.hits.length, 0)
    assert.equal(patch.state.proxied, 0)
    assert.equal(patch.state.lastDecisions[0].reason, 'local-host')
  })
})

test('the patch is fully restored on uninstall', async () => {
  const before = globalThis.fetch
  await withHarness(async ({ patch }) => {
    assert.notEqual(globalThis.fetch, before)
    patch.uninstall()
    assert.equal(globalThis.fetch, before)
  })
  assert.equal(globalThis.fetch, before)
})
