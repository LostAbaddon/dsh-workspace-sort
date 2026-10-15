/**
 * Node tests for the fork-based conversation-history edit.
 *
 * The browser half is loaded through the same `window.__ModuleLoader__` shim
 * the DSH client uses, so the file under test is byte-for-byte the one the
 * client serves.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

let spec
globalThis.window = { __ModuleLoader__: { load(next) { spec = next } } }
await import('../lib/client.js')
assert.equal(spec.id, 'dsh-workspace-sort', 'bundle registers the package id')

const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1] ?? {}, children: args.slice(2) }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
}
const browser = spec.factory((id) => {
  if (id === 'react') return fakeReact
  throw new Error(`unexpected require(${id})`)
}).__internals

const { parseChatNodeKey, messageTextOf, windowEvents, countRemovedMessages, planForkEdit, editViaFork } = browser

/** One user message event on the surface. */
const user = (seq, id, text) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } })
/** One assistant message event on the surface. */
const assistant = (seq) => ({ seq, type: 'assistant/message', surfaceOp: 'append', data: { message: { content: [] } } })
/** One command lifecycle event, which carries no surface marker. */
const turnEnd = (seq) => ({ seq, type: 'turn/end', data: { reason: { kind: 'completed' } } })

test('a rendered row key carries the durable message id back out', () => {
  assert.equal(parseChatNodeKey('13:input-message4f2c-9'), '4f2c-9')
  assert.equal(parseChatNodeKey('9:turn-tail7'), undefined)
  assert.equal(parseChatNodeKey('no-separator'), undefined)
  assert.equal(parseChatNodeKey(':input-messagex'), undefined)
  assert.equal(parseChatNodeKey(undefined), undefined)
})

test('text blocks concatenate back into Markdown', () => {
  assert.equal(messageTextOf([{ type: 'text', text: '# 标题\n' }, { type: 'image' }, { type: 'text', text: '正文' }]), '# 标题\n正文')
  assert.equal(messageTextOf([]), '')
  assert.equal(messageTextOf(undefined), '')
})

test('the event window yields session events and drops stream transients', () => {
  const window = {
    entries: [
      { type: 'event', event: user(1, 'm1', 'a') },
      { type: 'transient', event: { seq: 2, type: 'assistant/live-chunk' } },
      { type: 'event', event: assistant(2) },
    ],
  }
  assert.deepEqual(windowEvents(window).map((event) => event.seq), [1, 2])
  assert.deepEqual(windowEvents(undefined), [])
  assert.deepEqual(windowEvents({ entries: 'nope' }), [])
})

test('the removed count covers user and assistant messages at or after the cut', () => {
  const events = [user(1, 'm1', 'a'), assistant(2), user(3, 'm2', 'b'), turnEnd(4), assistant(5)]
  assert.equal(countRemovedMessages(events, 3), 2)
  assert.equal(countRemovedMessages(events, 1), 4)
  assert.equal(countRemovedMessages(events, 99), 0)
})

test('the fork cut is the event right before the target, so it never needs the rest of the log', () => {
  const events = [user(1, 'm1', 'a'), assistant(2), user(3, 'm2', 'b'), assistant(4)]
  const plan = planForkEdit(events, 'm2')
  assert.equal(plan.ok, true)
  assert.equal(plan.atSeq, 2, 'the cut lands immediately before the edited message')
  assert.equal(plan.targetSeq, 3)
  assert.equal(plan.removed, 2)

  // The window is paginated: the target can be its first entry and the plan still holds,
  // because seqs are contiguous from 0 and the cut is derived from the target alone.
  const windowed = planForkEdit(events.slice(2), 'm2')
  assert.equal(windowed.ok, true)
  assert.equal(windowed.atSeq, 2)
})

test('an uneditable target is refused with a reason', () => {
  const superseded = { ...user(2, 'm2', 'b'), surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }
  assert.match(planForkEdit([user(1, 'm1', 'a'), superseded], 'm2').reason, /更早的一次修改/)
  assert.match(planForkEdit([user(1, 'm1', 'a')], 'missing').reason, /不在当前加载的对话/)
  const injected = { seq: 2, type: 'user/message', surfaceOp: 'append', data: { id: 'm2', source: { kind: 'injected' }, content: [] } }
  assert.match(planForkEdit([user(1, 'm1', 'a'), injected], 'm2').reason, /你自己发送的输入/)
  assert.match(planForkEdit([user(0, 'm1', 'a')], 'm1').reason, /第一条消息/)
})

/** Build session, workspace and agent doubles for the orchestration tests. */
function doubles({ running = false, forkFails = false, promptFails = false, archiveFails = false, bound = true } = {}) {
  const calls = []
  let snapshot = { running }
  const binding = bound
    ? {
        session: {
          getSnapshot: () => snapshot,
          subscribe: (listener) => {
            listeners.push(listener)
            return () => listeners.splice(listeners.indexOf(listener), 1)
          },
          cancel: async () => { calls.push(['cancel']); snapshot = { running: false }; for (const listener of listeners) listener() },
          prompt: async (parts, mode) => {
            calls.push(['prompt', parts, mode])
            return promptFails ? { ok: false, error: { message: 'prompt refused' } } : { ok: true, value: { accepted: true } }
          },
        },
        eventSource: { getSnapshot: () => ({ entries: events.map((event) => ({ type: 'event', event })) }) },
      }
    : undefined
  const listeners = []
  const events = [user(1, 'm1', '旧的第一问'), assistant(2), user(3, 'm2', '旧的第二问'), assistant(4)]
  const sessions = {
    binding: (id) => (id === 's1' ? binding : undefined),
    fork: async ({ atSeq, increaseTitle }) => {
      calls.push(['fork', atSeq, increaseTitle])
      if (forkFails) throw new Error('fork refused')
      return 's2'
    },
    using: async (id, options, operation) => {
      calls.push(['using', id, options.source])
      return operation({ session: binding.session })
    },
  }
  const uiWorkspace = {
    openSession: (id) => calls.push(['open', id]),
    archiveSession: async (id, options) => {
      calls.push(['archive', id, options])
      if (archiveFails && id === 's1') throw new Error('archive refused')
    },
  }
  return { sessions, uiWorkspace, calls }
}

test('one edit forks, sends the rewritten input, switches over and archives the original', async () => {
  const { sessions, uiWorkspace, calls } = doubles()
  const stages = []
  const result = await editViaFork({ sessions, uiWorkspace }, {
    sessionId: 's1', messageId: 'm1', text: '新的第一问', onStage: (stage) => stages.push(stage),
  })

  assert.equal(result.ok, true)
  assert.equal(result.childId, 's2')
  assert.equal(result.removed, 4)
  assert.deepEqual(calls, [
    ['fork', 0, false],
    ['using', 's2', 'controllerOperation'],
    ['prompt', [{ type: 'text', text: '新的第一问' }], 'queue'],
    ['open', 's2'],
    ['archive', 's1', { stopActivity: true }],
  ])
  assert.deepEqual(stages, ['forking', 'prompting', 'opening', 'archiving'])
})

test('a running turn is cancelled and waited out before the fork', async () => {
  const { sessions, uiWorkspace, calls } = doubles({ running: true })
  const stages = []
  const result = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'm1', text: '新的第一问', onStage: (stage) => stages.push(stage) })

  assert.equal(result.ok, true)
  assert.equal(calls[0][0], 'cancel')
  assert.equal(stages[0], 'stopping')
  assert.deepEqual(calls[1], ['fork', 0, false], 'the fork keeps the original title instead of adding a suffix')
})

test('an empty rewrite and an uneditable target never reach the fork', async () => {
  const { sessions, uiWorkspace, calls } = doubles()
  const empty = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'm1', text: '   ' })
  assert.equal(empty.ok, false)
  assert.match(empty.reason, /不能为空/)

  const unknown = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'nope', text: 'x' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.reason, /不在当前加载的对话/)

  assert.deepEqual(calls, [], 'nothing was forked, opened or archived')
})

test('a failed fork leaves both conversations alone', async () => {
  const { sessions, uiWorkspace, calls } = doubles({ forkFails: true })
  const result = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'm1', text: '新的第一问' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /分岔失败：fork refused/)
  assert.deepEqual(calls, [['fork', 0, false]])
})

test('a refused prompt archives the orphaned fork instead of leaving it behind', async () => {
  const { sessions, uiWorkspace, calls } = doubles({ promptFails: true })
  const result = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'm1', text: '新的第一问' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /prompt refused/)
  assert.deepEqual(calls, [['fork', 0, false], ['using', 's2', 'controllerOperation'], ['prompt', [{ type: 'text', text: '新的第一问' }], 'queue'], ['archive', 's2', undefined]])
})

test('a failed archive still lands the user in the new conversation, with a warning', async () => {
  const { sessions, uiWorkspace, calls } = doubles({ archiveFails: true })
  const result = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'm1', text: '新的第一问' })
  assert.equal(result.ok, true)
  assert.match(result.warning, /归档失败：archive refused/)
  assert.deepEqual(calls.at(-2), ['open', 's2'], 'the switch happened before the archive that failed')
})

test('a conversation with no live binding is refused before anything is written', async () => {
  const { sessions, uiWorkspace, calls } = doubles({ bound: false })
  const result = await editViaFork({ sessions, uiWorkspace }, { sessionId: 's1', messageId: 'm1', text: '新的第一问' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /没有可用的通道/)
  assert.deepEqual(calls, [])
})
