/**
 * Pure routing core of the proxy-routing half.
 *
 * Nothing here touches I/O, timers, or the Host: it turns a stored
 * configuration plus a request URL into a routing decision, and it produces and
 * validates the configuration document the Settings page edits. Keeping it pure
 * is what lets the routing rules be tested outside DSH.
 */

/** Host patterns DSH's LLM providers are reached through. */
export const PROVIDER_HOSTS = {
  gemini: ['generativelanguage.googleapis.com', 'aiplatform.googleapis.com'],
  'google-vertex': ['aiplatform.googleapis.com'],
  openrouter: ['openrouter.ai', '*.openrouter.ai'],
  anthropic: ['api.anthropic.com'],
  openai: ['api.openai.com'],
  'openai-codex': ['chatgpt.com', '*.openai.com'],
  azure: ['*.openai.azure.com', '*.cognitiveservices.azure.com'],
  groq: ['api.groq.com'],
  mistral: ['api.mistral.ai'],
  xai: ['api.x.ai'],
  cerebras: ['api.cerebras.ai'],
  together: ['api.together.xyz'],
  fireworks: ['api.fireworks.ai'],
  deepinfra: ['api.deepinfra.com'],
  perplexity: ['api.perplexity.ai'],
  cohere: ['api.cohere.ai', 'api.cohere.com'],
  deepseek: ['api.deepseek.com'],
  kimi: ['api.moonshot.cn', 'api.moonshot.ai'],
  moonshot: ['api.moonshot.cn', 'api.moonshot.ai'],
  'kimi-coding': ['api.moonshot.cn', 'api.moonshot.ai'],
  minimax: ['api.minimax.chat', 'api.minimaxi.com', 'api.minimax.cn'],
  'minimax-cn': ['api.minimax.cn'],
  'minimax-mplan': ['api.minimax.cn'],
  glm: ['open.bigmodel.cn', 'api.z.ai'],
  zhipu: ['open.bigmodel.cn', 'api.z.ai'],
  zai: ['api.z.ai'],
  qwen: ['dashscope.aliyuncs.com'],
  dashscope: ['dashscope.aliyuncs.com'],
  siliconflow: ['api.siliconflow.cn', 'api.siliconflow.com'],
  ollama: ['localhost', '127.0.0.1'],
  lmstudio: ['localhost', '127.0.0.1'],
}

/** Providers the router turns on by default: reached only through a proxy. */
export const DEFAULT_ENABLED_PROVIDERS = [
  'gemini',
  'google-vertex',
  'openrouter',
  'anthropic',
  'openai',
  'openai-codex',
  'azure',
  'groq',
  'mistral',
  'xai',
  'cerebras',
  'together',
  'fireworks',
  'deepinfra',
  'perplexity',
  'cohere',
]

/** Provider ids never routed, whatever a stored document says. */
export const NEVER_PROXY = new Set(['deepseek', 'deepseek-official', 'ollama', 'lmstudio'])

/** Accepted shape of a stored configuration document. */
export const EMPTY_CONFIG = Object.freeze({
  enabled: false,
  proxyUrl: '',
  providers: {},
  hosts: [],
})

/** Hosts that must never be routed, because they are not provider traffic. */
export const LOCAL_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1', '[::1]', '*.local']

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalise one host pattern; an unusable pattern normalises to ''. */
export function normalizeHostPattern(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const withoutPath = withoutScheme.split('/')[0]
  const withoutPort = withoutPath.replace(/:\d+$/, '')
  if (!withoutPort || /\s/.test(withoutPort)) return ''
  return withoutPort
}

/** One usable proxy URL with a scheme, or '' when the text cannot be one. */
export function normalizeProxyUrl(value) {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    return ''
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (!parsed.hostname) return ''
  // `URL` appends a bare '/' for an origin-only address; storing the trimmed
  // form keeps the document readable and compares equal to what a user typed.
  return parsed.href.replace(/\/$/, '')
}

/** Whether a host pattern matches a request hostname. */
export function matchesHost(pattern, hostname) {
  const clean = normalizeHostPattern(pattern)
  const host = String(hostname ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!clean || !host) return false
  if (clean === '*') return true
  if (clean.startsWith('*.')) {
    const suffix = clean.slice(2)
    return host !== suffix && host.endsWith(`.${suffix}`)
  }
  if (clean.startsWith('.')) {
    const suffix = clean.slice(1)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === clean
}

/**
 * Normalise a stored or posted configuration document.
 * @param raw - value of unknown provenance.
 * @param fallback - returned when `raw` is not a usable document.
 */
export function normalizeConfig(raw, fallback = EMPTY_CONFIG) {
  if (!isPlainObject(raw)) return { ...fallback }
  const enabled = raw.enabled === undefined ? Boolean(fallback.enabled) : raw.enabled === true
  const proxyCandidate = raw.proxyUrl === undefined ? fallback.proxyUrl : raw.proxyUrl
  const proxyUrl = normalizeProxyUrl(proxyCandidate)
  const providers = {}
  if (isPlainObject(raw.providers)) {
    for (const [id, entry] of Object.entries(raw.providers)) {
      const key = String(id).trim().toLowerCase()
      if (!key || !isPlainObject(entry)) continue
      const extraHosts = Array.isArray(entry.extraHosts)
        ? [...new Set(entry.extraHosts.map(normalizeHostPattern).filter(Boolean))]
        : []
      providers[key] = {
        enabled: entry.enabled === true && !NEVER_PROXY.has(key),
        extraHosts,
        ...(typeof entry.displayName === 'string' && entry.displayName.trim()
          ? { displayName: entry.displayName.trim() }
          : {}),
      }
    }
  }
  const hosts = []
  if (Array.isArray(raw.hosts)) {
    const seen = new Set()
    for (const entry of raw.hosts) {
      const source = typeof entry === 'string' ? { pattern: entry } : entry
      if (!isPlainObject(source)) continue
      const pattern = normalizeHostPattern(source.pattern)
      if (!pattern || seen.has(pattern)) continue
      seen.add(pattern)
      hosts.push({
        pattern,
        enabled: source.enabled !== false,
        ...(typeof source.note === 'string' && source.note.trim() ? { note: source.note.trim() } : {}),
      })
    }
  }
  return { enabled, proxyUrl, providers, hosts }
}

/** The explicit host patterns one provider row contributes. */
export function providerHosts(providerId, config) {
  const id = String(providerId ?? '').trim().toLowerCase()
  const defaults = PROVIDER_HOSTS[id] ?? []
  const extra = config?.providers?.[id]?.extraHosts ?? []
  return [...new Set([...defaults, ...extra])]
}

/** Whether a stored document routes this provider through the proxy. */
export function isProviderEnabled(providerId, config) {
  const id = String(providerId ?? '').trim().toLowerCase()
  if (NEVER_PROXY.has(id)) return false
  return config?.providers?.[id]?.enabled === true
}

/** Every host pattern currently in force, in decision order. */
export function effectiveHosts(config) {
  const patterns = []
  const seen = new Set()
  const push = (pattern) => {
    const clean = normalizeHostPattern(pattern)
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    patterns.push(clean)
  }
  for (const [id, entry] of Object.entries(config?.providers ?? {})) {
    if (entry?.enabled !== true || NEVER_PROXY.has(id)) continue
    for (const pattern of providerHosts(id, config)) push(pattern)
  }
  for (const entry of config?.hosts ?? []) {
    if (entry?.enabled === false) continue
    push(entry?.pattern)
  }
  return patterns
}

/**
 * Decide how one request URL is reached.
 * @returns `{ proxy: false, reason }` for a direct request, or
 *          `{ proxy: true, proxyUrl, matchedBy }` when the proxy must be used.
 */
export function decideRoute(url, config) {
  let parsed
  try {
    parsed = url instanceof URL ? url : new URL(String(url))
  } catch {
    return { proxy: false, reason: 'unparsable-url' }
  }
  if (!config || config.enabled !== true) return { proxy: false, reason: 'router-disabled' }
  const proxyUrl = normalizeProxyUrl(config.proxyUrl)
  if (!proxyUrl) return { proxy: false, reason: 'no-proxy-configured' }
  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return { proxy: false, reason: 'no-host' }
  for (const local of LOCAL_HOST_PATTERNS) {
    if (matchesHost(local, hostname)) return { proxy: false, reason: 'local-host' }
  }
  for (const pattern of effectiveHosts(config)) {
    if (matchesHost(pattern, hostname)) return { proxy: true, proxyUrl, matchedBy: pattern }
  }
  return { proxy: false, reason: 'no-rule' }
}

/** Merge a posted document over the stored one, keeping unknown provider rows. */
export function mergeConfig(current, posted) {
  const normalized = normalizeConfig(posted, current)
  const providers = { ...(current?.providers ?? {}) }
  for (const [id, entry] of Object.entries(normalized.providers)) providers[id] = entry
  return { ...normalized, providers }
}

/** The configuration a fresh install starts from. */
export function defaultConfig(extraDefaults = []) {
  const providers = {}
  for (const id of [...new Set([...DEFAULT_ENABLED_PROVIDERS, ...extraDefaults])]) {
    const key = String(id).trim().toLowerCase()
    if (!key || NEVER_PROXY.has(key)) continue
    providers[key] = { enabled: true, extraHosts: [] }
  }
  return { enabled: false, proxyUrl: '', providers, hosts: [] }
}
