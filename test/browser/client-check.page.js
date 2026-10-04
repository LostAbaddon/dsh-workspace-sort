/**
 * Page-side checks for dsh-workspace-sort, run inside a live DSH Web client by
 * `run.mjs`. Two halves:
 *
 *   1. mode gate — with fake Client services, the recency reorder must fire in
 *      the grouped modes, stay out of the single-list mode, and respect the
 *      settings switch;
 *   2. sidebar fold — with the real rendered sidebar, the configured count must
 *      decide how many conversations stay visible per Workspace.
 *
 * `__ARGS__` is { clientSource }.
 */
(async () => {
  const args = globalThis.__ARGS__
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const report = { modeGate: [], fold: [] }
  const realLoader = window.__ModuleLoader__

  /** Instantiate the real browser half once, against fake or real services. */
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
      locale: { register: () => () => {} },
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

  // ---- 1. mode gate ---------------------------------------------------------
  for (const [groupBy, sortWorkspaces] of [['workspace', true], ['workspace-tree', true], ['flat', true], ['workspace', false]]) {
    writePreference(5, sortWorkspaces)
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

  // ---- 2. sidebar fold ------------------------------------------------------
  // Expand every collapsed Workspace section, then check the busiest one, so the
  // result does not depend on which sections happened to be open already.
  const sections = () => [...document.querySelectorAll('[class*="_groupSection"]')]
  for (const group of sections()) {
    if (group.querySelectorAll('[data-row-key^="session:"]').length > 0) continue
    const row = group.querySelector('[data-row-key^="workspace:"]')
    if (row === null) continue
    row.click()
    await wait(260)
  }
  await wait(900)
  let busiest = null
  for (const group of sections()) {
    const count = group.querySelectorAll('[data-row-key^="session:"]').length
    if (busiest === null || count > busiest.count) busiest = { group, count }
  }
  report.busiestGroup = busiest === null ? null : (busiest.group.querySelector('[data-row-key^="workspace:"]')?.innerText ?? '').split('\n')[0]
  report.renderedBeforeFold = busiest?.count ?? 0

  for (const limit of [5, 12, 100]) {
    writePreference(limit, false)
    writeMode('workspace')
    const services = fakeServices()
    const booted = boot(services)
    await wait(1300)
    const target = sections().find((group) => (group.querySelector('[data-row-key^="workspace:"]')?.innerText ?? '').includes(report.busiestGroup ?? '\u0000'))
    if (target !== undefined) {
      const rows = [...target.querySelectorAll('[data-row-key^="session:"]')]
      const overflow = target.querySelector('[data-row-key^="overflow:"]')
      report.fold.push({
        limit,
        rendered: rows.length,
        hidden: rows.filter((row) => row.style.display === 'none').length,
        visible: rows.filter((row) => row.style.display !== 'none').length,
        overflowHidden: overflow === null ? null : overflow.style.display === 'none',
      })
    }
    for (const dispose of booted.cleanups) dispose()
  }
  return report
})()
