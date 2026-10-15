/**
 * Host half of dsh-workspace-sort.
 *
 * Two features share this half:
 *
 * 1. The sidebar half — Workspace recency ordering, the per-Workspace visible
 *    conversation count, per-Workspace model memory and the Edit button on a
 *    user message — lives entirely in the browser half (`lib/client.js`). This
 *    half only owns the Loader row that makes the browser half get served, so
 *    nothing about the sidebar depends on the code below.
 * 2. Proxy routing: every LLM request DSH makes is routed by hostname.
 *    Hostnames belonging to a provider the user routed through the proxy are
 *    tunnelled through that proxy; everything else keeps the process's normal
 *    network path. The decision is made inside a patch on `globalThis.fetch`,
 *    because that is the single exit every adapter in this profile uses —
 *    pi-ai, the DeepSeek adapter and the provider SDKs all end up there — and
 *    because pi-ai's Google adapter refuses a custom `fetch`, leaving the
 *    global one as the only seam. This half owns that routing patch, the
 *    durable configuration, and the HTTP surface the Settings page talks to.
 *
 * Every step of the router is failure-tolerant: a missing undici, an
 * unwritable configuration file or a refused route registration degrades the
 * Settings page, never the profile.
 */
import { createRequire } from 'node:module'
import { ConfigStore, defaultConfigPath } from './proxy-config.js'
import { AgentPool, describeError, installFetchPatch, loadUndici, probeProxy, undiciCandidates } from './proxy-transport.js'
import {
  DEFAULT_ENABLED_PROVIDERS,
  NEVER_PROXY,
  defaultConfig,
  effectiveHosts,
  isProviderEnabled,
  normalizeConfig,
  normalizeProxyUrl,
  providerHosts,
} from './proxy-core.js'

/** The HTTP carrier this plugin registers its Settings routes on. Every other
  * service it reads — `llm` above all — is optional and resolved with `ctx.get`
  * so the router still mounts in a profile whose LLM composition differs. */
export const inject = ['webServer']

/**
 * The schema library, resolved the same way as the HTTP client is: a plugin
 * installed from a workspace directory resolves from its real path, so neither
 * a bare specifier nor a bare `undici` import can be used at module scope.
 * `createRequire` anchored inside the running application reaches both.
 */
function loadSchemastery() {
  const require = createRequire(import.meta.url)
  const candidates = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(`${process.resourcesPath}/app.asar/dsh/node_modules/`)
  }
  for (const base of candidates) {
    try {
      return createRequire(base)('@deepseek-ai/schemastery')
    } catch {}
  }
  try {
    return require('@deepseek-ai/schemastery')
  } catch {
    return undefined
  }
}

const z = loadSchemastery()

/**
 * Row configuration, for a profile that wants to seed the router from
 * `cordis.patch.yml`. The Settings page owns the state after first save; these
 * values only decide what a fresh, never-saved installation starts from.
 */
export const Config = z === undefined ? undefined : z.object({
  enabled: z.boolean().default(false).description('启用代理路由；设置页保存后以设置页为准'),
  proxyUrl: z.string().default('').description('代理地址，例如 http://127.0.0.1:7890'),
  configPath: z.string().default('').description('配置文件路径，默认 $DSH_HOME/workspace-sort/proxy-config.json'),
  reportPath: z.string().default('').description('激活记录写入路径，留空则不写'),
  defaultEnabledProviders: z.array(String).default([]).description('首次运行时额外走代理的 Provider id'),
})

const ROUTE_PREFIX = '/api/dsh-workspace-sort/proxy'

/** Display names for provider rows the running profile does not declare. */
const BUILTIN_DISPLAY_NAMES = {
  gemini: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  azure: 'Azure OpenAI',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  cerebras: 'Cerebras',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  deepinfra: 'DeepInfra',
  perplexity: 'Perplexity',
  cohere: 'Cohere',
  deepseek: 'DeepSeek',
  kimi: 'Kimi (Moonshot)',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  glm: '智谱 GLM',
  zhipu: '智谱 AI',
  qwen: '通义千问',
  siliconflow: 'SiliconFlow',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function readJsonBody(req, limitBytes = 512 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limitBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Provider rows the UI offers: declared routes first, then known built-ins. */
function enumerateProviders(llm, config) {
  const rows = new Map()
  const add = (id, displayName, source) => {
    const key = String(id ?? '').trim().toLowerCase()
    if (!key) return
    const existing = rows.get(key)
    if (existing && existing.source !== 'builtin') return
    rows.set(key, {
      id: key,
      displayName: displayName || BUILTIN_DISPLAY_NAMES[key] || key,
      source,
      enabled: isProviderEnabled(key, config),
      hosts: providerHosts(key, config),
      locked: NEVER_PROXY.has(key),
    })
  }
  if (llm && typeof llm.listProviders === 'function') {
    try {
      for (const entry of llm.listProviders()) add(entry.id, entry.name, 'registered')
    } catch (error) {
      void error
    }
  }
  for (const [id, name] of Object.entries(BUILTIN_DISPLAY_NAMES)) add(id, name, 'builtin')
  for (const [id, entry] of Object.entries(config.providers ?? {})) {
    add(id, entry.displayName, 'configured')
  }
  for (const id of DEFAULT_ENABLED_PROVIDERS) add(id, undefined, 'builtin')
  return [...rows.values()].sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
    return left.displayName.localeCompare(right.displayName)
  })
}

/**
 * @param ctx - Host root Context.
 * @param config - the Loader row's configuration (see `Config`).
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger
  const seed = defaultConfig(config.defaultEnabledProviders ?? [])
  const seeded = normalizeConfig(
    {
      ...seed,
      ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
      ...(config.enabled === true ? { enabled: true } : {}),
    },
    seed,
  )
  const store = new ConfigStore({
    path: typeof config.configPath === 'string' && config.configPath ? config.configPath : defaultConfigPath(),
    logger,
    seed: seeded,
  })

  const runtime = {
    patched: false,
    strategy: null,
    undici: null,
    undiciSpecifier: null,
    hostFetch: null,
    proxyReachable: null,
    lastError: null,
    lastErrorAt: null,
    loadedAt: null,
  }
  let patch = null
  let pool = null
  const configReportPath = String(config.reportPath ?? '') || process.env.DSH_WORKSPACE_SORT_PROXY_REPORT || ''
  const mounts = { at: new Date().toISOString(), routes: [], configPath: store.path, reportPath: configReportPath }

  const getConfig = () => store.current()

  /**
   * Write the activation record an installer or a maintainer can inspect. The
   * row's `reportPath` (or `DSH_WORKSPACE_SORT_PROXY_REPORT`) enables it; with
   * neither set a normal installation writes nothing.
   */
  const writeReport = async () => {
    const file = configReportPath
    if (!file) return
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const current = store.current()
    const payload = {
      ...mounts,
      activatedAt: new Date().toISOString(),
      process: {
        pid: process.pid,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        execPath: process.execPath,
        resourcesPath: process.resourcesPath ?? null,
        dshHome: process.env.DSH_HOME ?? null,
      },
      resolution: {
        chosen: runtime.undiciSpecifier,
        undiciVersion: runtime.undici,
        candidates: undiciCandidates().map((c) => c.specifier),
      },
      patch: patch
        ? {
            installed: patch.state.installed,
            hostFetch: patch.state.hostFetch,
            realFetch: patch.realFetch?.constructor?.name ?? typeof patch.realFetch,
            proxied: patch.state.proxied,
            direct: patch.state.direct,
            decisions: patch.state.decisions,
            failures: patch.state.failures,
            dispatchersPassed: patch.state.dispatchersPassed,
            dispatcherHonoured: patch.state.dispatcherHonoured,
            lastError: patch.state.lastError,
          }
        : null,
      config: {
        enabled: current.enabled,
        proxyUrl: current.proxyUrl,
        routedProviders: Object.entries(current.providers ?? {})
          .filter(([, entry]) => entry?.enabled === true)
          .map(([id]) => id),
        effectiveHosts: effectiveHosts(current),
      },
      error: runtime.lastError,
    }
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  void (async () => {
    try {
      const loaded = await loadUndici()
      runtime.undici = loaded.version
      runtime.undiciSpecifier = loaded.specifier
      pool = new AgentPool(loaded.undici)
      patch = installFetchPatch({ undici: loaded.undici, pool, getConfig, logger })
      runtime.patched = patch.state.installed
      runtime.hostFetch = patch.state.hostFetch
      runtime.strategy = 'global-fetch+dispatcher'
      runtime.loadedAt = new Date().toISOString()
      runtime.lastError = null
      runtime.lastErrorAt = null
      logger?.info?.('workspace-sort: proxy routing installed (undici %s from %s)', loaded.version, loaded.specifier)
    } catch (error) {
      runtime.lastError = describeError(error)
      runtime.lastErrorAt = new Date().toISOString()
      runtime.strategy = 'unavailable'
      logger?.warn?.('workspace-sort: proxy routing unavailable: %s', runtime.lastError)
    }
    await writeReport().catch(() => {})
  })()

  ctx.effect(() => () => {
    patch?.uninstall()
    return pool?.dispose()
  })

  const routes = [
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: async (req, res) => {
        const current = await store.load()
        json(res, 200, {
          ok: true,
          config: current,
          providers: enumerateProviders(ctx.get('llm'), current),
          effectiveHosts: effectiveHosts(current),
          proxyConfigured: Boolean(normalizeProxyUrl(current.proxyUrl)),
          runtime: {
            patched: runtime.patched,
            strategy: runtime.strategy,
            undici: runtime.undici,
            undiciSpecifier: runtime.undiciSpecifier,
            hostFetch: runtime.hostFetch,
            proxyReachable: runtime.proxyReachable,
            lastError: runtime.lastError,
            lastErrorAt: runtime.lastErrorAt,
            requests: patch?.state.decisions ?? 0,
            proxied: patch?.state.proxied ?? 0,
            direct: patch?.state.direct ?? 0,
            failures: patch?.state.failures ?? 0,
            dispatchersPassed: patch?.state.dispatchersPassed ?? 0,
            dispatcherHonoured: patch?.state.dispatcherHonoured ?? null,
            recent: patch?.state.lastDecisions ?? [],
          },
          configPath: store.path,
        })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/config`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          json(res, 400, { ok: false, error: `无法解析请求体：${describeError(error)}` })
          return
        }
        const posted = body?.config ?? body
        const normalized = normalizeConfig(posted, store.current())
        if (normalized.enabled && !normalizeProxyUrl(normalized.proxyUrl)) {
          json(res, 400, { ok: false, error: '启用代理路由前必须先填写有效的代理地址（http:// 或 https://）' })
          return
        }
        try {
          const saved = await store.save(normalized)
          runtime.lastError = null
          json(res, 200, { ok: true, config: saved, applied: true, patched: runtime.patched })
          await writeReport().catch(() => {})
        } catch (error) {
          json(res, 500, { ok: false, error: `保存失败：${describeError(error)}` })
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/test`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body = {}
        try {
          body = await readJsonBody(req)
        } catch (error) {
          json(res, 400, { ok: false, error: `无法解析请求体：${describeError(error)}` })
          return
        }
        const proxyUrl = normalizeProxyUrl(body?.proxyUrl ?? store.current().proxyUrl)
        if (!proxyUrl) {
          json(res, 400, { ok: false, error: '代理地址无效：需要 http:// 或 https:// 前缀的主机端口' })
          return
        }
        const target = typeof body?.host === 'string' && body.host.trim()
          ? { host: body.host.trim(), port: Number(body.port) > 0 ? Number(body.port) : 443 }
          : undefined
        const result = await probeProxy(proxyUrl, target)
        runtime.proxyReachable = result.ok
        if (!result.ok) runtime.lastError = result.error
        json(res, 200, result)
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/reset`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const saved = await store.reset()
          json(res, 200, { ok: true, config: saved, applied: true })
          await writeReport().catch(() => {})
        } catch (error) {
          json(res, 500, { ok: false, error: `重置失败：${describeError(error)}` })
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/selftest`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body = {}
        try {
          body = await readJsonBody(req)
        } catch (error) {
          json(res, 400, { ok: false, error: `无法解析请求体：${describeError(error)}` })
          return
        }
        const url = typeof body?.url === 'string' && body.url.trim() ? body.url.trim() : 'https://generativelanguage.googleapis.com/'
        const runtimeBefore = {
          proxied: patch?.state.proxied ?? 0,
          direct: patch?.state.direct ?? 0,
          dispatchersPassed: patch?.state.dispatchersPassed ?? 0,
        }
        let outcome
        try {
          const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
          outcome = { reached: true, status: response.status }
        } catch (error) {
          outcome = { reached: false, error: describeError(error) }
        }
        const runtimeAfter = {
          proxied: patch?.state.proxied ?? 0,
          direct: patch?.state.direct ?? 0,
          dispatchersPassed: patch?.state.dispatchersPassed ?? 0,
        }
        json(res, 200, {
          ok: true,
          url,
          outcome,
          routedThroughProxy: runtimeAfter.proxied > runtimeBefore.proxied,
          stayedDirect: runtimeAfter.direct > runtimeBefore.direct,
          dispatcherPassed: runtimeAfter.dispatchersPassed > runtimeBefore.dispatchersPassed,
          decision: patch?.state.lastDecisions?.[0] ?? null,
          patched: runtime.patched,
          error: runtime.lastError,
        })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/diagnostics`,
      handler: async (req, res) => {
        const current = store.current()
        json(res, 200, {
          ok: true,
          process: {
            pid: process.pid,
            node: process.versions.node,
            electron: process.versions.electron ?? null,
            execPath: process.execPath,
            resourcesPath: process.resourcesPath ?? null,
            dshHome: process.env.DSH_HOME ?? null,
          },
          routing: runtime,
          patch: patch
            ? {
                installed: patch.state.installed,
                hostFetch: patch.state.hostFetch,
                originalKind: patch.realFetch?.constructor?.name ?? 'unknown',
                decisions: patch.state.decisions,
                proxied: patch.state.proxied,
                direct: patch.state.direct,
                failures: patch.state.failures,
                dispatchersPassed: patch.state.dispatchersPassed,
                dispatcherHonoured: patch.state.dispatcherHonoured,
                lastError: patch.state.lastError,
                recent: patch.state.lastDecisions,
              }
            : null,
          config: {
            path: store.path,
            enabled: current.enabled,
            proxyUrl: current.proxyUrl,
            routedProviders: Object.entries(current.providers ?? {})
              .filter(([, entry]) => entry?.enabled === true)
              .map(([id]) => id),
            effectiveHosts: effectiveHosts(current),
          },
          loadedAt: runtime.loadedAt,
        })
        await writeReport().catch(() => {})
      },
    },
  ]

  for (const route of routes) {
    mounts.routes.push(route.path)
    ctx.effect(() => ctx.webServer.register(route))
  }
  ctx.effect(() => () => store.dispose())
}
