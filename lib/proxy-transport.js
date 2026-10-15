/**
 * Host-side proxy plumbing: resolving an undici generation that the running
 * Host's own `fetch` accepts, agent pooling, reachability probing, and the
 * global fetch patch.
 *
 * Two facts drive this file:
 *
 * 1. `fetch` honours `init.dispatcher` only when the dispatcher comes from the
 *    undici instance that installed the runtime's global dispatcher. A second
 *    copy of undici in the profile is a different instance and its agents are
 *    refused, so resolution prefers the copy shipped inside the running
 *    application.
 * 2. Patching `fetch` is a process-wide side effect, so it is installed once,
 *    guarded against double installation, and fully restored on disposal.
 */
import { createRequire } from 'node:module'
import http from 'node:http'
import https from 'node:https'
import { decideRoute } from './proxy-core.js'

const requireFromHost = createRequire(import.meta.url)

/**
 * Module specifiers tried in order.
 *
 * The application copy comes first and normally wins: a plugin installed from a
 * workspace directory resolves from its *real* path, so it is not inside the
 * profile's `node_modules` ancestry and a bare `undici` specifier would not
 * resolve at all. Taking the copy that ships with the running application also
 * guarantees the dispatchers handed to `fetch` come from the undici generation
 * whose global dispatcher that `fetch` actually consults.
 */
export function undiciCandidates() {
  const candidates = []
  const override = process.env.DSH_WORKSPACE_SORT_PROXY_UNDICI
  if (typeof override === 'string' && override.trim()) candidates.push({ specifier: override.trim(), kind: 'path' })
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push({ specifier: `${process.resourcesPath}/app.asar/dsh/node_modules/undici/`, kind: 'path' })
    candidates.push({ specifier: `${process.resourcesPath}/app.asar.unpacked/dsh/node_modules/undici/`, kind: 'path' })
  }
  // A profile launched outside the packaged application (a CLI boot, a
  // development checkout) has no `resourcesPath`; the dsh installation the
  // launcher named on argv is then the copy to use.
  const launcher = process.argv[1]
  if (typeof launcher === 'string' && launcher.length > 0) {
    const root = launcher.includes('/node_modules/') ? launcher.slice(0, launcher.indexOf('/node_modules/')) : undefined
    if (root !== undefined) {
      candidates.push({ specifier: `${root}/node_modules/undici/`, kind: 'path' })
      candidates.push({ specifier: `${root}/dsh/node_modules/undici/`, kind: 'path' })
    }
  }
  // The profile's own `node_modules` is the last resort. It is reached through
  // `createRequire` rather than a bare `import()`: the plugin is normally a
  // symlink into a workspace, so a bare specifier resolves from the link target
  // and would never see the profile's copy.
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.trim()) {
    candidates.push({ specifier: `${profileDir.trim().replace(/\/+$/, '')}/`, kind: 'base' })
  }
  return candidates
}

export function describeError(error) {
  if (error === undefined || error === null) return 'unknown error'
  if (typeof error === 'string') return error
  const code = error.code ?? error.cause?.code
  const message = error.message ?? String(error)
  return code ? `${code}: ${message}` : message
}

/**
 * Load the first usable undici.
 * @returns `{ undici, specifier, version }`, or throws listing every attempt.
 */
export async function loadUndici() {
  const attempts = []
  for (const candidate of undiciCandidates()) {
    const { specifier, kind } = candidate
    try {
      const require = kind === 'base' ? createRequire(specifier) : requireFromHost
      const loaded = require(kind === 'base' ? 'undici' : specifier)
      const undici = loaded?.ProxyAgent ? loaded : loaded?.default
      if (typeof undici?.ProxyAgent !== 'function') {
        attempts.push(`${specifier}: no ProxyAgent export`)
        continue
      }
      let version = 'unknown'
      try {
        version = require(kind === 'base' ? 'undici/package.json' : `${specifier}package.json`).version
      } catch {}
      return { undici, specifier, version }
    } catch (error) {
      attempts.push(`${specifier}: ${describeError(error)}`)
    }
  }
  throw new Error(`no usable undici (${attempts.join('; ')})`)
}

/**
 * Default `CONNECT` target for the reachability probe. The probe answers "does
 * this proxy tunnel at all", so it must aim at something the machine can reach
 * without the proxy; a provider endpoint that is itself blocked here would
 * report a working proxy as broken.
 */
export const DEFAULT_PROBE_HOST = 'example.com'

/** Per-proxy-url `ProxyAgent` pool. */
export class AgentPool {
  constructor(undici) {
    this.undici = undici
    this.agents = new Map()
  }

  /** The agent for one proxy URL, created on first use. */
  agent(proxyUrl) {
    const existing = this.agents.get(proxyUrl)
    if (existing) return existing
    const agent = new this.undici.ProxyAgent({
      uri: proxyUrl,
      // Provider endpoints reached through a private MITM proxy routinely fail
      // plain TLS verification. The router owns transport, not certificate
      // policy, so the tunnel does not re-verify on the caller's behalf.
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
    })
    this.agents.set(proxyUrl, agent)
    return agent
  }

  async dispose() {
    const agents = [...this.agents.values()]
    this.agents.clear()
    await Promise.all(agents.map(async (agent) => {
      try {
        await agent.close()
      } catch {}
    }))
  }
}

function tunnel({ proxyUrl, targetHost, targetPort, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(proxyUrl)
    const secure = parsed.protocol === 'https:'
    const transport = secure ? https : http
    const request = transport.request({
      host: parsed.hostname,
      port: Number(parsed.port || (secure ? 443 : 80)),
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}` },
      ...(secure ? { servername: parsed.hostname, rejectUnauthorized: false } : {}),
      ...(parsed.username
        ? {
            headers: {
              host: `${targetHost}:${targetPort}`,
              'proxy-authorization': `Basic ${Buffer.from(
                `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
              ).toString('base64')}`,
            },
          }
        : {}),
    })
    request.on('connect', (response, socket) => {
      const status = response.statusCode ?? 0
      if (status !== 200) {
        socket.destroy()
        reject(new Error(`proxy refused CONNECT with HTTP ${status}`))
        return
      }
      resolve({ status, socket })
    })
    request.on('error', (error) => reject(new Error(`cannot reach proxy: ${describeError(error)}`)))
    request.setTimeout(timeoutMs, () => request.destroy(new Error('proxy connection timed out')))
    request.end()
  })
}

/**
 * Prove a proxy accepts a CONNECT tunnel, without involving undici.
 * @returns `{ ok: true, latencyMs, status }` or `{ ok: false, error }`.
 */
export async function probeProxy(
  proxyUrl,
  target = { host: DEFAULT_PROBE_HOST, port: 443 },
  timeoutMs = 8000,
) {
  const startedAt = Date.now()
  try {
    const { socket, status } = await tunnel({ proxyUrl, targetHost: target.host, targetPort: target.port, timeoutMs })
    socket.destroy()
    return { ok: true, status, latencyMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, error: describeError(error), latencyMs: Date.now() - startedAt }
  }
}

/**
 * Install the routing patch on `globalThis.fetch`.
 * @returns a handle with `uninstall()`, the live `state`, and the original fetch.
 */
export function installFetchPatch({ undici, pool, getConfig, logger }) {
  const realFetch = globalThis.fetch
  if (typeof realFetch !== 'function') throw new Error('globalThis.fetch is unavailable')
  const state = {
    installed: true,
    hostFetch: realFetch === undici.fetch ? 'undici' : (realFetch?.constructor?.name ?? 'unknown'),
    decisions: 0,
    proxied: 0,
    direct: 0,
    failures: 0,
    dispatchersPassed: 0,
    dispatcherHonoured: null,
    lastDecisions: [],
    lastError: null,
  }

  // Every proxied call goes through this seam, so the router can prove that the
  // dispatcher it built actually reached the transport layer rather than being
  // silently ignored by a `fetch` from another undici generation.
  const transport = {
    fetch: (input, init) => {
      if (init?.dispatcher) state.dispatchersPassed += 1
      return undici.fetch(input, init)
    },
  }

  const patched = function workspaceSortProxyFetch(input, init) {
    let config
    try {
      config = getConfig()
    } catch (error) {
      state.lastError = describeError(error)
      return realFetch(input, init)
    }
    let url
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
      url = new URL(String(raw))
    } catch {
      return realFetch(input, init)
    }
    const decision = decideRoute(url, config)
    state.decisions += 1
    state.lastDecisions.unshift({
      host: url.hostname,
      path: url.pathname,
      proxy: decision.proxy === true,
      reason: decision.proxy === true ? `matched ${decision.matchedBy}` : decision.reason,
      at: new Date().toISOString(),
    })
    if (state.lastDecisions.length > 25) state.lastDecisions.length = 25
    if (decision.proxy !== true) {
      state.direct += 1
      return realFetch(input, init)
    }
    state.proxied += 1
    const agent = pool.agent(decision.proxyUrl)
    let outcome
    try {
      outcome = transport.fetch(input, { ...(init ?? {}), dispatcher: agent })
    } catch (error) {
      state.failures += 1
      state.dispatcherHonoured = false
      state.lastError = describeError(error)
      throw error
    }
    if (state.dispatcherHonoured === null) state.dispatcherHonoured = state.dispatchersPassed > 0
    return Promise.resolve(outcome).catch((error) => {
      state.failures += 1
      state.lastError = describeError(error)
      logger?.warn?.('proxied request failed for %s: %s', url.hostname, state.lastError)
      throw error
    })
  }
  Object.defineProperties(patched, {
    name: { value: 'workspaceSortProxyFetch', configurable: true },
    length: { value: realFetch.length, configurable: true },
  })

  globalThis.fetch = patched
  return {
    state,
    realFetch,
    /** Test seam: counts how many proxied calls carried a dispatcher. */
    transport,
    uninstall() {
      if (globalThis.fetch === patched) globalThis.fetch = realFetch
      state.installed = false
    },
  }
}
