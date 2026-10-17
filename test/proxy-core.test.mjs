/**
 * Unit tests for the routing core. These run outside DSH on purpose: the core
 * is pure, so every routing decision the Host will make can be pinned here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ENABLED_PROVIDERS,
  NEVER_PROXY,
  decideRoute,
  defaultConfig,
  effectiveHosts,
  isProviderEnabled,
  matchesHost,
  mergeConfig,
  normalizeConfig,
  normalizeHostPattern,
  normalizeProxyUrl,
  providerHosts,
} from '../lib/proxy-core.js'

const PROXY = 'http://127.0.0.1:7890'

function configWith(overrides = {}) {
  return normalizeConfig({ enabled: true, proxyUrl: PROXY, providers: {}, hosts: [], ...overrides })
}

test('normalizeProxyUrl accepts host:port, adds http, rejects junk', () => {
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), '')
  assert.equal(normalizeProxyUrl('user:pass@proxy.example:8080'), 'http://user:pass@proxy.example:8080')
  assert.equal(normalizeProxyUrl(42), '')
  assert.equal(normalizeProxyUrl(''), '')
  assert.equal(normalizeProxyUrl('   '), '')
})

test('normalizeHostPattern strips scheme, path and port', () => {
  assert.equal(normalizeHostPattern('https://API.OpenAI.com/v1/models'), 'api.openai.com')
  assert.equal(normalizeHostPattern('openrouter.ai:443'), 'openrouter.ai')
  assert.equal(normalizeHostPattern(''), '')
  assert.equal(normalizeHostPattern('not a host'), '')
})

test('matchesHost handles exact, wildcard and bare-suffix patterns', () => {
  assert.equal(matchesHost('openrouter.ai', 'openrouter.ai'), true)
  assert.equal(matchesHost('openrouter.ai', 'api.openrouter.ai'), false)
  assert.equal(matchesHost('*.openrouter.ai', 'api.openrouter.ai'), true)
  assert.equal(matchesHost('*.openrouter.ai', 'openrouter.ai'), false)
  assert.equal(matchesHost('.openrouter.ai', 'openrouter.ai'), true)
  assert.equal(matchesHost('*', 'anything.example'), true)
  assert.equal(matchesHost('api.openai.com', 'API.OPENAI.COM'), true)
})

test('a routed provider host goes through the proxy', () => {
  const config = configWith({ providers: { gemini: { enabled: true } } })
  const decision = decideRoute('https://generativelanguage.googleapis.com/v1beta/models', config)
  assert.equal(decision.proxy, true)
  assert.equal(decision.proxyUrl, PROXY)
  assert.equal(decision.matchedBy, 'generativelanguage.googleapis.com')
})

test('an unrouted provider host stays direct', () => {
  const config = configWith({ providers: { gemini: { enabled: true } } })
  for (const host of [
    'api.deepseek.com',
    'api.moonshot.cn',
    'api.minimax.cn',
    'open.bigmodel.cn',
  ]) {
    const decision = decideRoute(`https://${host}/v1/chat/completions`, config)
    assert.equal(decision.proxy, false, `${host} must stay direct`)
    assert.equal(decision.reason, 'no-rule')
  }
})

test('router disabled and missing proxy both force direct', () => {
  const routed = { providers: { openrouter: { enabled: true } } }
  assert.equal(decideRoute('https://openrouter.ai/api/v1/models', configWith({ ...routed, enabled: false })).reason, 'router-disabled')
  assert.equal(decideRoute('https://openrouter.ai/api/v1/models', configWith({ ...routed, proxyUrl: '' })).reason, 'no-proxy-configured')
})

test('local hosts are never proxied', () => {
  const config = configWith({ hosts: [{ pattern: '*' }] })
  assert.equal(decideRoute('http://127.0.0.1:11434/api/tags', config).reason, 'local-host')
  assert.equal(decideRoute('http://localhost:1234/v1/models', config).reason, 'local-host')
})

test('disabled rows and extra hosts behave', () => {
  const config = configWith({
    providers: { openrouter: { enabled: false, extraHosts: ['proxy-gw.internal'] } },
    hosts: [{ pattern: 'openrouter.ai', enabled: true }],
  })
  assert.equal(decideRoute('https://openrouter.ai/api/v1', config).proxy, true)
  assert.equal(decideRoute('https://proxy-gw.internal/v1', config).reason, 'no-rule')

  const enabledExtra = configWith({ providers: { openrouter: { enabled: true, extraHosts: ['proxy-gw.internal'] } } })
  assert.equal(decideRoute('https://proxy-gw.internal/v1', enabledExtra).proxy, true)
  assert.equal(decideRoute('https://openrouter.ai/api/v1', enabledExtra).proxy, true)
})

test('a disabled host rule does not route', () => {
  const config = configWith({ hosts: [{ pattern: 'openrouter.ai', enabled: false }] })
  assert.equal(decideRoute('https://openrouter.ai/api/v1', config).reason, 'no-rule')
})

test('unparsable urls never throw and never route', () => {
  const config = configWith({ hosts: [{ pattern: '*' }] })
  assert.equal(decideRoute('not a url', config).reason, 'unparsable-url')
})

test('provider rows refuse to route the never-proxy set', () => {
  const config = normalizeConfig({
    enabled: true,
    proxyUrl: PROXY,
    providers: { deepseek: { enabled: true }, 'deepseek-official': { enabled: true }, gemini: { enabled: true } },
  })
  assert.equal(config.providers.deepseek.enabled, false)
  assert.equal(config.providers['deepseek-official'].enabled, false)
  assert.equal(isProviderEnabled('deepseek', config), false)
  assert.equal(isProviderEnabled('gemini', config), true)
  assert.equal(decideRoute('https://api.deepseek.com/v1/chat/completions', config).proxy, false)
})

test('defaultConfig routes the cloud providers and never the domestic ones', () => {
  const config = defaultConfig()
  assert.equal(config.enabled, false)
  for (const id of DEFAULT_ENABLED_PROVIDERS) assert.equal(config.providers[id]?.enabled, true, id)
  for (const id of NEVER_PROXY) assert.equal(config.providers[id], undefined, id)
  assert.equal(config.providers.deepseek, undefined)
})

test('effectiveHosts lists routed patterns once, in decision order', () => {
  const config = configWith({
    providers: {
      gemini: { enabled: true, extraHosts: ['generativelanguage.googleapis.com', 'gemini-gw.internal'] },
      openrouter: { enabled: true },
    },
    hosts: [{ pattern: '*.openrouter.ai' }, { pattern: 'openrouter.ai' }],
  })
  const hosts = effectiveHosts(config)
  assert.deepEqual(hosts.slice(0, 3), ['generativelanguage.googleapis.com', 'aiplatform.googleapis.com', 'gemini-gw.internal'])
  assert.equal(new Set(hosts).size, hosts.length)
  assert.equal(hosts.includes('openrouter.ai'), true)
  assert.equal(hosts.includes('*.openrouter.ai'), true)
})

test('providerHosts merges built-in defaults with per-row extras', () => {
  const config = configWith({ providers: { openrouter: { enabled: true, extraHosts: ['my-gw.example'] } } })
  assert.deepEqual(providerHosts('openrouter', config), ['openrouter.ai', '*.openrouter.ai', 'my-gw.example'])
  assert.deepEqual(providerHosts('unknown-provider', config), [])
})

test('mergeConfig keeps stored rows the client did not post', () => {
  const stored = configWith({ providers: { gemini: { enabled: true }, openrouter: { enabled: false } } })
  const merged = mergeConfig(stored, { enabled: true, proxyUrl: PROXY, providers: { gemini: { enabled: false } }, hosts: [] })
  assert.equal(merged.providers.gemini.enabled, false)
  assert.equal(merged.providers.openrouter.enabled, false)
})

test('normalizeConfig tolerates malformed input', () => {
  const config = normalizeConfig({ enabled: 'yes', proxyUrl: 42, providers: { gemini: 'nope' }, hosts: ['a.example', { pattern: 'b.example', enabled: false }, 5] })
  assert.equal(config.enabled, false)
  assert.equal(config.proxyUrl, '')
  assert.deepEqual(Object.keys(config.providers), [])
  assert.deepEqual(config.hosts, [
    { pattern: 'a.example', enabled: true },
    { pattern: 'b.example', enabled: false },
  ])
  assert.deepEqual(normalizeConfig(null), { enabled: false, proxyUrl: '', providers: {}, hosts: [] })
})

test('agnes is a first-class provider with its own host', () => {
  assert.deepEqual(providerHosts('agnes', configWith({})), ['apihub.agnes-ai.com'])
  assert.equal(DEFAULT_ENABLED_PROVIDERS.includes('agnes'), true, 'a foreign aggregator belongs to the proxied set')
  assert.equal(NEVER_PROXY.has('agnes'), false)
})

test('an agnes endpoint is routed once its row is on', () => {
  const config = configWith({ providers: { agnes: { enabled: true } } })
  const decision = decideRoute('https://apihub.agnes-ai.com/v1/chat/completions', config)
  assert.equal(decision.proxy, true)
  assert.equal(decision.proxyUrl, PROXY)
  assert.equal(decision.matchedBy, 'apihub.agnes-ai.com')
})

test('agnes starts enabled in the configuration a fresh install gets', () => {
  const config = defaultConfig()
  assert.equal(config.providers.agnes?.enabled, true)
})

test('the agnes host is listed for the settings page count', () => {
  const config = configWith({ providers: { agnes: { enabled: true } } })
  assert.deepEqual(effectiveHosts(config), ['apihub.agnes-ai.com'])
})
