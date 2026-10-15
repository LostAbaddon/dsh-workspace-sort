/**
 * Durable configuration for the proxy-routing half.
 *
 * The document lives in its own JSON file under `$DSH_HOME`, written
 * atomically, so a Settings-page save applies immediately and survives
 * upgrades without editing the profile's patch layer. It is read through
 * `current()`, which re-stats the file and reloads after an external edit.
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { defaultConfig, normalizeConfig } from './proxy-core.js'

export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export function defaultConfigPath() {
  return join(dshHome(), 'workspace-sort', 'proxy-config.json')
}

export class ConfigStore {
  /**
   * @param options.path - absolute configuration file path.
   * @param options.logger - optional Host logger for non-fatal failures.
   * @param options.seed - document used before the file has ever been written.
   */
  constructor({ path = defaultConfigPath(), logger, seed } = {}) {
    this.path = path
    this.logger = logger
    this.seed = normalizeConfig(seed ?? defaultConfig())
    this.value = null
    this.stamp = null
  }

  /** The effective document, reloaded when the file changed underneath us. */
  current() {
    if (this.value) {
      void this.#refreshInBackground()
      return this.value
    }
    return this.seed
  }

  /** Force a synchronous-from-cache reload attempt; used by the read routes. */
  async load() {
    const info = await stat(this.path).catch(() => undefined)
    if (!info) {
      if (!this.value) this.value = this.seed
      return this.value
    }
    if (this.value && this.stamp === info.mtimeMs) return this.value
    try {
      const text = await readFile(this.path, 'utf8')
      this.value = normalizeConfig(JSON.parse(text), this.seed)
      this.stamp = info.mtimeMs
    } catch (error) {
      this.logger?.warn?.('could not read %s: %s', this.path, error?.message ?? error)
      if (!this.value) this.value = this.seed
    }
    return this.value
  }

  #refreshInBackground() {
    const pending = this.pending ?? (this.pending = this.load().finally(() => {
      this.pending = undefined
    }))
    void pending.catch(() => {})
  }

  /** Persist a document atomically and make it effective at once. */
  async save(next) {
    const normalized = normalizeConfig(next, this.current())
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
    this.value = normalized
    const info = await stat(this.path).catch(() => undefined)
    this.stamp = info?.mtimeMs ?? null
    return normalized
  }

  /** Restore the shipped defaults, keeping the file itself as the record. */
  async reset() {
    return this.save(this.seed)
  }

  async dispose() {
    // A half-written temporary file is the only residue a crash can leave.
    await unlink(`${this.path}.${process.pid}.tmp`).catch(() => {})
  }
}
