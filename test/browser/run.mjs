/**
 * Drive a headless Chrome DevTools endpoint to run the page-side checks against
 * a live DSH Web client.
 *
 * Usage (from a checkout, with Chrome already serving the app):
 *   DSH_COOKIE='dsh-auth-...=v1....' node test/browser/run.mjs
 *
 * Environment:
 *   DSH_COOKIE  required — the `name=value` browser-session cookie of the
 *               authenticated DSH Web client (see the README).
 *   CDP_PORT    Chrome's remote debugging port (default 9333).
 *   GUI_URL     the DSH Web URL (default http://127.0.0.1:19387/).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const port = Number(process.env.CDP_PORT ?? 9333)
const url = process.env.GUI_URL ?? 'http://127.0.0.1:19387/'
const cookie = process.env.DSH_COOKIE ?? ''
if (cookie === '') {
  console.error('DSH_COOKIE is required (the dsh-auth-* browser-session cookie)')
  process.exit(2)
}
const eq = cookie.indexOf('=')
const cookieName = cookie.slice(0, eq)
const cookieValue = cookie.slice(eq + 1)

const clientSource = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const pageScript = readFileSync(join(here, 'client-check.page.js'), 'utf8')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((entry) => entry.type === 'page')
if (target === undefined) throw new Error('no page target on the DevTools endpoint')

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const consoleLines = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((argument) => argument.value ?? argument.description ?? argument.type).join(' ')
    consoleLines.push(`[${message.params.type}] ${text}`)
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

await send('Page.enable')
await send('Runtime.enable')
await send('Network.setCookie', {
  name: cookieName,
  value: cookieValue,
  domain: new URL(url).hostname,
  path: '/',
  httpOnly: true,
})
await send('Page.navigate', { url })
await new Promise((resolve) => setTimeout(resolve, 14000))

const result = await send('Runtime.evaluate', {
  expression: `globalThis.__ARGS__ = ${JSON.stringify({ clientSource })};\n${pageScript}`,
  returnByValue: true,
  awaitPromise: true,
})
if (result.exceptionDetails !== undefined) {
  console.error('page check threw:', result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails))
  process.exitCode = 1
}
const value = result.result.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
if (consoleLines.length > 0) {
  console.log('--- page console ---')
  for (const line of consoleLines) console.log(line)
}

const shot = process.env.SHOT_PATH
if (shot !== undefined && shot !== '') {
  const capture = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shot, Buffer.from(capture.data, 'base64'))
  console.log(`[screenshot] ${shot}`)
}
socket.close()
process.exit(process.exitCode ?? 0)
