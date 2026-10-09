/**
 * Run the bundle's Client half against the REAL Cordis and services shaped like
 * the shipped ones.
 *
 * The unit suite models Cordis closely enough to catch the two defects that
 * matter, but it still fakes the registry: `ctx.inject` runs synchronously and
 * `effect` is a plain callback. This harness removes that last fiction — it
 * mounts the real bundle on a real `Context`, with a remote namespace whose
 * methods are own getters (as `RemoteNamespaceService.install` builds them) and
 * a Workspace service whose methods live on the prototype.
 *
 * Usage (from a checkout, with DSH installed):
 *   node test/cordis/run.mjs
 *
 * Environment:
 *   DSH_CORDIS  absolute path to cordis's `lib/index.js`, when auto-discovery
 *               fails. It is discovered from the `dsh` CLI, from an installed
 *               DSH checkout, or from a profile's `node_modules`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

/** Every plausible place a checkout's Cordis may sit, most specific first. */
function cordisCandidates() {
  const candidates = []
  if (process.env.DSH_CORDIS) candidates.push(process.env.DSH_CORDIS)
  const tail = ['node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js']
  try {
    // `which dsh` → …/@deepseek-ai/dsh/lib/bin.js, whose package carries Cordis.
    const cli = realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim())
    candidates.push(join(dirname(cli), '..', ...tail))
  } catch (_noDshOnPath) {
    /* fall through to the installed-location guesses */
  }
  // The profile workspace keeps one shared `node_modules` beside its profiles.
  candidates.push(join(homedir(), '.dsh', 'profiles', ...tail))
  candidates.push(join(homedir(), '.dsh', 'profiles', 'web', ...tail))
  return candidates
}

const cordisPath = cordisCandidates().find((candidate) => existsSync(candidate))
if (cordisPath === undefined) {
  console.error('cordis was not found; set DSH_CORDIS to its lib/index.js')
  process.exit(2)
}
const { Context } = await import(pathToFileURL(cordisPath).href)

let spec
globalThis.window = { __ModuleLoader__: { load: (loaded) => { spec = loaded } } }
await import(pathToFileURL(join(root, 'lib', 'client.js')).href)

const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1] ?? {}, children: args.slice(2) }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
}
const mod = spec.factory((id) => {
  if (id === 'react') return fakeReact
  throw new Error(`unexpected require(${id})`)
})

const store = {}
globalThis.localStorage = {
  getItem: (key) => (key in store ? store[key] : null),
  setItem: (key, value) => {
    store[key] = String(value)
  },
}

/**
 * A remote namespace, built the way `RemoteNamespaceService.install` builds one:
 * each method is an OWN GETTER with no setter, answering a fresh call function.
 */
class RemoteNamespaceService {
  constructor() {
    this.methods = new Map()
  }

  install(method, kind, value) {
    let record = this.methods.get(method)
    const fresh = record === undefined
    record ??= {}
    if (fresh) {
      Object.defineProperty(this, method, {
        configurable: true,
        enumerable: true,
        get: function () {
          const current = this.methods.get(method)
          const direct = current?.direct
          return (...args) => this.invokeRemote(direct, args)
        },
      })
      this.methods.set(method, record)
    }
    if (kind === 'direct') record.direct = value
  }

  invokeRemote(direct, args) {
    return direct(...args)
  }
}

/** The Workspace service: methods on the prototype, like the shipped class. */
class UiWorkspaceService {
  async connectWorkspace() {
    return 'sess-new'
  }

  /** The shipped nested call the new-session button takes. */
  async openWorkspace(workspaceId) {
    return this.connectWorkspace(workspaceId)
  }
}

const calls = []
const namespace = new RemoteNamespaceService()
namespace.install('selectModel', 'direct', async (request) => {
  calls.push(request)
  return { ok: true, value: { selected: { provider: request.provider, model: request.model } } }
})

const workspaces = [
  { workspaceId: 'ws-coder', sessionIds: ['sess-coder'], path: '/ws/coder' },
  { workspaceId: 'ws-writer', sessionIds: ['sess-writer'], path: '/ws/writer' },
]
const byId = {
  'sess-coder': { id: 'sess-coder', cwd: '/ws/coder', blank: false },
  'sess-writer': { id: 'sess-writer', cwd: '/ws/writer', blank: false },
  'sess-new': { id: 'sess-new', cwd: '/ws/coder', blank: true },
}

const registrations = []
const ctx = new Context()
ctx.provide('slots', {
  inject: (_key, callback) => callback(),
  register: (definition) => {
    registrations.push(definition)
    return () => {}
  },
})
ctx.provide('locale', { register: () => () => {}, bind: () => (key) => key })
ctx.provide('workspaces', {
  list: { getSnapshot: () => ({ phase: 'ready', items: workspaces, archivedSessionIds: [] }), subscribe: () => () => {} },
  insertBefore: async () => {},
})
ctx.provide('sessions', { list: { getSnapshot: () => ({ byId, ids: Object.keys(byId) }), subscribe: () => () => {} } })
ctx.provide('uiSession', { sessionStatus: { getSnapshot: () => new Map() } })
ctx.provide('remote.session', namespace)
ctx.provide('uiWorkspace', new UiWorkspaceService())

const warnings = []
const warn = console.warn
const info = console.info
console.warn = (...args) => warnings.push(args.join(' '))
console.info = () => {}
ctx.plugin({ inject: mod.inject, apply: mod.apply })
await new Promise((resolve) => setTimeout(resolve, 250))
console.warn = warn
console.info = info

const checks = []
const check = (label, ok) => checks.push([label, ok === true])

check('the Client half mounts and registers its settings row', registrations.length === 1)
check('the remote method is still an accessor after interception', Object.getOwnPropertyDescriptor(namespace, 'selectModel')?.get !== undefined)

// A model and thinking depth chosen inside one Workspace, through the wire face.
await ctx.get('remote.session').selectModel({
  sessionId: 'sess-coder',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet',
  reasoningEffort: 'high',
})
const recorded = JSON.parse(store['dsh.workspace-models.v1'] ?? '{}')['ws-coder']
check('the choice is recorded for its Workspace, thinking depth included', recorded?.model === 'claude-3-5-sonnet' && recorded?.reasoningEffort === 'high')

// That Workspace's new-session button replays it onto the created session.
calls.length = 0
await ctx.get('uiWorkspace').openWorkspace('ws-coder')
check(
  'the new session replays the Workspace model',
  calls.length === 1
    && calls[0].sessionId === 'sess-new'
    && calls[0].model === 'claude-3-5-sonnet'
    && calls[0].reasoningEffort === 'high',
)

// A Workspace that never recorded a choice keeps the Host default.
calls.length = 0
await ctx.get('uiWorkspace').openWorkspace('ws-writer')
check('a Workspace with no record replays nothing', calls.length === 0)

for (const [label, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
if (warnings.length > 0) console.log(`warnings: ${warnings.join(' | ')}`)
const failed = checks.filter(([, ok]) => !ok).length
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
