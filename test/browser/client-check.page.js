/**
 * Page-side checks for dsh-workspace-sort, run inside a live DSH Web client by
 * `run.mjs`.
 *
 *   1. the sidebar — the plugin instance the app itself mounted (its count comes
 *      from the seeded preference): the collapsed line reports the conversations
 *      left out of sight, the control expands to everything and collapses again,
 *      and it sits below the conversations it still shows;
 *   2. the mode gate — with fake Client services, the recency reorder must fire
 *      in the grouped modes, stay out of the single-list mode, and respect the
 *      settings switch. These probes never observe the sidebar, because the
 *      mounted instance owns that DOM.
 *
 * `__ARGS__` is { clientSource, foldLimit }.
 */
(async () => {
  const args = globalThis.__ARGS__
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const report = { foldLimit: args.foldLimit, sidebar: null, modeGate: [] }
  const realLoader = window.__ModuleLoader__

  const sections = () => [...document.querySelectorAll('[class*="_groupSection"]')]
  const readSection = (group) => {
    const rows = [...group.querySelectorAll('[data-row-key^="session:"]')]
    const control = group.querySelector('[data-dws-fold]')
    const overflow = group.querySelector('[data-row-key^="overflow:"]')
    const shown = rows.filter((row) => row.style.display !== 'none')
    const following = control === null || control === undefined
      ? []
      : shown.filter((row) => (control.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
    return {
      rendered: rows.length,
      shown: shown.length,
      hidden: rows.length - shown.length,
      controlText: control?.textContent ?? null,
      controlExpanded: control?.getAttribute('aria-expanded') ?? null,
      controlLabelNumber: control === null || control === undefined ? null : Number.parseInt(control.textContent.replace(/\D+/g, ''), 10) || null,
      /** Collapsed: the line must sit below every conversation it still shows. */
      controlAfterAllShown: control === null || control === undefined ? null : following.length === 0,
      /** Expanded: the collapse line stands before the conversations it revealed. */
      controlBeforeShown: following.length,
      shippedOverflowText: overflow?.innerText ?? null,
      shippedOverflowHidden: overflow === null ? null : overflow.style.display === 'none' || overflow.parentElement?.style.display === 'none',
    }
  }

  // ---- 1. the mounted plugin instance on the real sidebar -------------------
  // Open every Workspace section so the busiest one is rendered, then observe it.
  for (const group of sections()) {
    if (group.querySelectorAll('[data-row-key^="session:"]').length > 0) continue
    group.querySelector('[data-row-key^="workspace:"]')?.click()
    await wait(320)
  }
  await wait(1800)
  let busiest = null
  for (const group of sections()) {
    const count = group.querySelectorAll('[data-row-key^="session:"]').length
    if (busiest === null || count > busiest.count) busiest = { group, count }
  }
  if (busiest !== null) {
    const group = busiest.group
    report.sidebar = {
      group: (group.querySelector('[data-row-key^="workspace:"]')?.innerText ?? '').split('\n')[0],
      renderedBeforeFold: busiest.count,
      collapsed: readSection(group),
    }
    const control = group.querySelector('[data-dws-fold]')
    if (control !== null) {
      control.click()
      await wait(3500)
      report.sidebar.expanded = readSection(group)
      group.querySelector('[data-dws-fold]')?.click()
      await wait(1400)
      report.sidebar.collapsedAgain = readSection(group)
    }
  }

  // ---- 2. mode gate, with fake Client services -----------------------------
  const boot = (services) => {
    let captured = null
    window.__ModuleLoader__ = { load: (spec) => { captured = spec }, mode: 'test', pendingQueue: [] }
    const script = document.createElement('script')
    script.textContent = args.clientSource
    document.body.appendChild(script)
    window.__ModuleLoader__ = realLoader
    const fakeReact = { createElement: () => null, useState: (value) => [value, () => {}], useEffect: () => {} }
    const mod = captured.factory((id) => {
      if (id === 'react') return fakeReact
      throw new Error(`unexpected require(${id})`)
    })
    const cleanups = []
    const ctx = {
      get: (name) => services.named[name],
      effect: (fn) => {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
        return dispose
      },
      on: () => () => {},
      slots: { inject: () => () => {}, register: () => () => {} },
      locale: { register: () => () => {}, bind: () => (key, params) => `${key}${params?.n ?? ''}` },
    }
    mod.apply(ctx)
    return { mod, cleanups }
  }
  const writePreference = (visiblePerWorkspace, sortWorkspaces) => {
    localStorage.setItem('dsh.workspace-sort.v1', JSON.stringify({ visiblePerWorkspace, sortWorkspaces }))
  }
  const writeMode = (groupBy) => {
    localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({
      groupBy,
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      archivedFilter: 'default',
    }))
  }
  const fakeServices = () => {
    const items = [
      { workspaceId: 'old', sessionIds: ['s-old'] },
      { workspaceId: 'newest', sessionIds: ['s-new'] },
      { workspaceId: 'middle', sessionIds: ['s-mid'] },
    ]
    const moves = []
    return {
      moves,
      named: {
        workspaces: {
          list: { getSnapshot: () => ({ phase: 'ready', items: items.map((item) => ({ ...item })), archivedSessionIds: [] }), subscribe: () => () => {} },
          insertBefore: async (workspaceId, beforeWorkspaceId) => {
            moves.push([workspaceId, beforeWorkspaceId])
            const at = items.findIndex((item) => item.workspaceId === workspaceId)
            const anchor = items.findIndex((item) => item.workspaceId === beforeWorkspaceId)
            const [moved] = items.splice(at, 1)
            items.splice(anchor, 0, moved)
          },
        },
        sessions: {
          list: {
            getSnapshot: () => ({
              byId: {
                's-old': { id: 's-old', updatedAt: 1000 },
                's-new': { id: 's-new', updatedAt: 9000 },
                's-mid': { id: 's-mid', updatedAt: 5000 },
              },
              projectionsBySession: {},
            }),
            subscribe: () => () => {},
          },
        },
        uiSession: { sessionStatus: { getSnapshot: () => new Map() } },
      },
    }
  }

  for (const [groupBy, sortWorkspaces] of [['workspace', true], ['workspace-tree', true], ['flat', true], ['workspace', false]]) {
    writePreference(args.foldLimit, sortWorkspaces)
    writeMode(groupBy)
    const services = fakeServices()
    const booted = boot(services)
    await wait(1100)
    report.modeGate.push({
      groupBy,
      sortWorkspaces,
      moves: services.moves,
      order: services.named.workspaces.list.getSnapshot().items.map((item) => item.workspaceId),
    })
    for (const dispose of booted.cleanups) dispose()
  }
  return report
})()
