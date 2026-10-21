import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { SCENES as DEMO_SCENES } from './demo'
import { METER_SCHEMES, SCHEMES } from './schemes'
import { COLORS, URGENT_COLOR } from './view'

const START = 1_000_000
const MINUTE = 60_000

type Fail = (tool: string) => boolean

// Calls the test keeps in progress (until released) and calls a permission or hook refuses.
const gates = new Map<string, Promise<void>>()
const refused = new Set<string>()
const thrown = new Set<string>()

const hold = (tool: string): (() => void) => {
  let release = () => {}
  gates.set(tool, new Promise<void>(resolve => (release = resolve)))

  return () => {
    gates.delete(tool)
    release()
  }
}

// Lets the plugin's handlers run up to the held call.
const later = globalThis as unknown as { setTimeout: (run: () => void, ms: number) => unknown }
const sleep = (ms: number) => new Promise<void>(resolve => later.setTimeout(resolve, ms))

// The calls that reached the tool beneath the plugin (and, inside a subagent, those with an agentId): the
// plugin's handler has then already put them in its memory. The test waits for them instead of a fixed time.
const entered = new Set<string>()
let runs: Record<string, number> = {}

const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
  for (let waited = 0; waited < 2_000; waited += 5) {
    if (await check()) return
    await sleep(5)
  }

  throw new Error(`timed out waiting for ${what}`)
}

const arrived = (tool: string) => until(() => entered.has(tool), `the ${tool} call`)
type Says = (tool: string) => string | undefined

// When the session began according to `session.usage`: a test sets `nextStart` before `setup`, and `sessionStart`
// moves on its own afterwards, as a /clear does.
let nextStart = 0
let sessionStart = 0
// The rate limits `session.usage` reports: a test sets `nextLimits` before `setup` and `limits` while the clock runs.
let nextLimits: unknown[] = []
let limits: unknown[] = []
// The cost `session.usage` reports: a test sets `nextCost` before `setup` and `cost` while the clock runs.
let nextCost: unknown = 1.5
let cost: unknown = 1.5
// The context percent `session.usage` reports (the stamina): a test sets `nextContext` before `setup`; `undefined` leaves it unknown.
let nextContext: number | undefined = 30
let contextPercent: number | undefined = 30
// A test that holds the answer of `session.usage`: set `usageGate`, wait for `usageHeld`, then release it.
let usageGate: Promise<void> | undefined
let usageHeld = false
// A test that moves the time itself (`jump`) instead of letting a fake clock tick through it: `nextFast` before
// `setup`, then `fakeNow` is what `$.clock.now()` answers. The engine still calls the `clock.every` callback of the
// plugin in a loop, but it reads `limits`, which is empty in these tests: the readings come only from `jump`.
let nextFast = false
let isFast = false
let fakeNow = 0

// The world beneath the guild plugin: a clock the test moves, a store holding a guild whose warrior is at level 3,
// the session's figures and a tool runner that fails the calls the test says.
const setup = async ($: Engine, on: On, fails: Fail = () => false, says: Says = () => undefined, mountStore: (on: On) => void = on => mock.store(on, { 'guild.v1': { guerreiro: { xp: 200 } } })) => {
  gates.clear()
  refused.clear()
  thrown.clear()
  entered.clear()
  runs = {}
  sessionStart = nextStart
  nextStart = 0
  limits = nextLimits
  nextLimits = []
  cost = nextCost
  nextCost = 1.5
  contextPercent = nextContext
  nextContext = 30
  usageGate = undefined
  usageHeld = false
  isFast = nextFast
  nextFast = false
  fakeNow = START
  // A test that moves the time by hand answers the clock itself and runs no tick.
  const clock = isFast ? ({} as ReturnType<typeof mock.clock>) : mock.clock(on, { now: START })
  if (isFast) {
    on('clock.now', async () => ({ value: fakeNow }) as never)
    on('clock.every', async () => ({ value: undefined }) as never)
  }
  mountStore(on)
  on('session.measure', async (_$, e) => ({ changed: (e as { changed: string[] }).changed }) as never)
  on('session.usage', async () => {
    if (usageGate !== undefined) {
      usageHeld = true
      await usageGate
    }

    return { value: { startedAt: sessionStart, context: { percent: contextPercent }, rateLimits: limits, cost: { usd: cost } } } as never
  })
  on('command.register', async () => ({ value: { command: 'guild' } }) as never)
  on('session.start', async () => ({ cwd: '/tmp' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', async () => ({ text: 'feito' }) as never)
  on('tool.call', async (_$, e) => {
    entered.add(e.tool)
    runs[e.tool] = (runs[e.tool] ?? 0) + 1
    await gates.get(e.tool)
    if (thrown.has(e.tool)) throw new Error('boom')
    if (refused.has(e.tool)) return { deny: 'blocked' } as never

    return { result: 'ok', isError: fails(e.tool), text: says(e.tool) } as never
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)

  return clock
}

const mountBand = ($: Engine, bodyColumns = 120, maxRows = 20) =>
  $.ui.mount({
    plugin: 'guild-monitor',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns } as never,
    viewport: { columns: 120, rows: 40 } as never,
  })

const mountPanel = ($: Engine, columns = 60) =>
  $.ui.mount({
    plugin: 'guild-monitor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'guild',
    props: { title: 'Guilda', isFocused: false, bodyColumns: columns, bodyRows: 40 } as never,
    viewport: { columns: 200, rows: 50 } as never,
  })

const call = async ($: Engine, tool: string, input: Record<string, unknown> = {}) => {
  await $.tool.call({ tool, ...input } as never)
}

test('the band and the panel show the active character, the legend and the bug', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on, tool => tool === 'Bash')
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await call($, 'Bash', { command: 'npm test' })

  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: 'Guerreiro Nv.3' })).toBeDefined()
  expect(await band.find({ key: 'bug' })).toBeDefined()
  // The bug takes the place of the legend under the stats.
  expect(await band.find({ type: 'Text', text: 'HP=7d MP=5h ST=ctx' })).toBeUndefined()
  await band.unmount()

  const panel = await mountPanel($)
  expect(await panel.find({ type: 'Text', text: 'Guerreiro Nv.3' })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: 'HP=7d MP=5h ST=ctx' })).toBeDefined()
  expect(await panel.find({ key: 'bug' })).toBeDefined()
  await panel.unmount()
})

test('the panel without a bug has no bug and says there are no operations yet', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  const panel = await mountPanel($)

  expect(await panel.find({ key: 'bug' })).toBeUndefined()
  expect(await panel.find({ type: 'Text', text: 'nenhuma ainda' })).toBeDefined()
  await panel.unmount()
})

test('the panel lists the latest operations newest first', { options: { layout: 'bar' } }, async ($, on) => {
  const clock = await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  for (const tool of ['Edit', 'Write', 'Edit']) {
    await call($, tool, { file_path: 'a.ts', old_string: 'a', new_string: 'b', content: 'c' })
    await clock.advance(MINUTE)
  }

  const panel = await mountPanel($)
  const rows = (await panel.findAll({ type: 'Text', text: /^(agora|\d+min) +Guerreiro \+\d+ / })).map(row => row.text)

  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatch(/^1min +Guerreiro \+\d+ Edit$/)
  expect(rows[1]).toMatch(/^2min +Guerreiro \+\d+ Write$/)
  expect(rows[2]).toMatch(/^3min +Guerreiro \+\d+ Edit$/)
  await panel.unmount()
})

test('a rejected plan spawns no bug in the engine but a failing command does', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on, tool => tool === 'ExitPlanMode' || tool === 'Bash', tool => (tool === 'Bash' ? 'Exit code 1\nnpm ERR!' : undefined))
  await $.turn.start({ text: 'planeje a mudança', turnId: 't1' } as never)
  await call($, 'ExitPlanMode', { plan: 'faça' })

  const before = await mountPanel($)
  expect(await before.find({ key: 'bug' })).toBeUndefined()
  await before.unmount()

  await call($, 'Bash', { command: 'npm test' })

  const after = await mountPanel($)
  expect(await after.find({ key: 'bug' })).toBeDefined()
  await after.unmount()
})

// The mocked store cannot be read back by the test, so this one keeps the guild the same way and records what is written
// under the trace key.
const watchTrace = () => {
  const written: { trace: Array<Record<string, unknown>> } = { trace: [] }
  const held: Record<string, unknown> = { 'guild.v1': { guerreiro: { xp: 200 } } }
  const store = (on: On) => {
    on('store.get', async (_$, e) => ({ value: held[e.key] === undefined ? undefined : structuredClone(held[e.key]) }) as never)
    on('store.set', async (_$, e) => {
      held[e.key] = e.value
      if (e.key === 'guild.trace.v1') written.trace = e.value as Array<Record<string, unknown>>

      return { value: undefined } as never
    })
  }
  const lastTool = (tool: string) => written.trace.filter(entry => entry.what === 'tool' && entry.tool === tool).pop()

  return { store, lastTool }
}

test('the engine trace marks a rejected plan as rejected, unpaid and not an error, and a failing command as an error', { options: { layout: 'bar' } }, async ($, on) => {
  const { store, lastTool } = watchTrace()
  await setup($, on, tool => tool === 'ExitPlanMode' || tool === 'Bash', tool => (tool === 'Bash' ? 'Exit code 1\nnpm ERR!' : undefined), store)
  await $.turn.start({ text: 'planeje a mudança', turnId: 't1' } as never)
  await call($, 'ExitPlanMode', { plan: 'faça' })
  await call($, 'Bash', { command: 'npm test' })

  const refused = lastTool('ExitPlanMode')
  expect(refused?.rejected).toBe(true)
  expect(refused?.isError).toBeUndefined()
  expect(refused?.paid).toBeUndefined()

  const failed = lastTool('Bash')
  expect(failed?.isError).toBe(true)
  expect(failed?.rejected).toBeUndefined()
  expect(failed?.paid).toBeUndefined()

  const { text } = (await $.command.run({ command: 'guild', args: 'trace' } as never)) as { text: string }
  const lines = text.split('\n')
  expect(lines.find(line => line.includes('ExitPlanMode'))).toContain('RECUSADA')
  expect(lines.find(line => line.includes('ExitPlanMode'))).not.toContain('ERRO')
  expect(lines.find(line => line.includes('Bash:npm'))).toContain('ERRO')
  expect(lines.find(line => line.includes('Bash:npm'))).not.toContain('RECUSADA')
})

test('an edit refused with the engine refusal text spawns no bug in the engine', { options: { layout: 'bar' } }, async ($, on) => {
  const { store, lastTool } = watchTrace()
  await setup($, on, tool => tool === 'Edit', () => 'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).', store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' })

  const panel = await mountPanel($)
  expect(await panel.find({ key: 'bug' })).toBeUndefined()
  await panel.unmount()
  expect(lastTool('Edit')?.rejected).toBe(true)
})

test('an edit that failed with string to replace not found spawns a bug in the engine', { options: { layout: 'bar' } }, async ($, on) => {
  const { store, lastTool } = watchTrace()
  await setup($, on, tool => tool === 'Edit', () => 'String to replace not found in file.', store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' })

  const panel = await mountPanel($)
  expect(await panel.find({ key: 'bug' })).toBeDefined()
  await panel.unmount()
  expect(lastTool('Edit')?.isError).toBe(true)
})

const shows = async (mounted: Awaited<ReturnType<typeof mountPanel>>, text: string | RegExp) =>
  (await mounted.find({ type: 'Text', text })) !== undefined

const panelShows = async ($: Engine, text: string | RegExp, columns = 60) => {
  const panel = await mountPanel($, columns)
  const found = await shows(panel, text)
  await panel.unmount()

  return found
}

const EDIT = { file_path: '/Users/me/src/hooks/register.tsx', old_string: 'a', new_string: 'b' }

test('screen doing: the panel shows the call when it starts and the rest when it ends', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  expect(await panelShows($, 'Guerreiro: de prontidão')).toBe(true)

  const release = hold('Edit')
  const running = call($, 'Edit', EDIT)
  await arrived('Edit')
  expect(await panelShows($, 'Guerreiro: editando register.tsx')).toBe(true)
  expect(await panelShows($, 'Guerreiro: de prontidão')).toBe(false)

  release()
  await running
  expect(await panelShows($, 'Guerreiro: editando register.tsx')).toBe(false)
  expect(await panelShows($, 'Guerreiro: de prontidão')).toBe(true)
})

test('screen doing: the end of the turn brings back the rest', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const release = hold('Edit')
  const running = call($, 'Edit', EDIT)
  await arrived('Edit')
  expect(await panelShows($, 'Guerreiro: editando register.tsx')).toBe(true)

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito' } as never)
  expect(await panelShows($, 'Guerreiro: de prontidão')).toBe(true)
  expect(await panelShows($, /editando/)).toBe(false)

  release()
  await running
})

test('screen doing: parallel calls show the latest not finished', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const releaseRead = hold('Read')
  const releaseEdit = hold('Edit')
  const reading = call($, 'Read', { file_path: '/x/a.ts' })
  await arrived('Read')
  const editing = call($, 'Edit', EDIT)
  await arrived('Edit')
  expect(await panelShows($, 'Guerreiro: editando register.tsx')).toBe(true)

  releaseEdit()
  await editing
  expect(await panelShows($, 'Guerreiro: lendo a.ts')).toBe(true)

  releaseRead()
  await reading
  expect(await panelShows($, 'Guerreiro: de prontidão')).toBe(true)
})

test('screen doing: an error and a refusal take the line away', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on, tool => tool === 'Bash')
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const releaseBash = hold('Bash')
  const failing = call($, 'Bash', { command: 'npm test' })
  await arrived('Bash')
  expect(await panelShows($, 'Guerreiro: executando npm test')).toBe(true)
  releaseBash()
  await failing
  expect(await panelShows($, /executando/)).toBe(false)

  refused.add('Edit')
  const releaseEdit = hold('Edit')
  const denied = call($, 'Edit', EDIT)
  await arrived('Edit')
  releaseEdit()
  await denied
  refused.delete('Edit')
  expect(await panelShows($, /editando/)).toBe(false)
})

test('screen doing: a subagent call is calling an ally and its inner calls do not change it', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'pesquise o repo', turnId: 't1' } as never)
  expect(await panelShows($, /: chamando um aliado$/)).toBe(false)

  const releaseAgent = hold('Agent')
  const running = call($, 'Agent', { subagent_type: 'Explore', prompt: 'olhe' })
  await arrived('Agent')
  expect(await panelShows($, /: chamando um aliado$/)).toBe(true)

  // The subagent's own call stays in progress while the screen is looked at: it must not take the line.
  const releaseInner = hold('Read')
  const inner = call($, 'Read', { file_path: '/x/inner.ts', agentId: 'sub1' })
  await arrived('Read')
  expect(await panelShows($, /: chamando um aliado$/)).toBe(true)
  expect(await panelShows($, /inner\.ts|lendo/)).toBe(false)

  releaseInner()
  await inner
  expect(await panelShows($, /: chamando um aliado$/)).toBe(true)

  releaseAgent()
  await running
  expect(await panelShows($, /chamando um aliado/)).toBe(false)
})

test('screen doing: a call that throws does not stay on the line until the turn ends', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  thrown.add('Edit')
  const release = hold('Edit')
  const running = call($, 'Edit', EDIT).catch(() => 'threw')
  await arrived('Edit')
  expect(await panelShows($, 'Guerreiro: editando register.tsx')).toBe(true)

  release()
  await running
  expect(await panelShows($, /editando/)).toBe(false)
  expect(await panelShows($, 'Guerreiro: de prontidão')).toBe(true)
})

test('screen doing: a narrow panel shows only the verb', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const release = hold('Edit')
  const running = call($, 'Edit', EDIT)
  await arrived('Edit')
  expect(await panelShows($, 'editando', 20)).toBe(true)
  expect(await panelShows($, /register\.tsx/, 20)).toBe(false)
  expect(await panelShows($, /Guerreiro: editando/, 20)).toBe(false)

  release()
  await running
})

test('screen doing: the band shows the line when the information fits', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const release = hold('Edit')
  const running = call($, 'Edit', EDIT)
  await arrived('Edit')
  const band = await mountBand($)
  expect(await shows(band as never, 'editando register.tsx')).toBe(true)
  await band.unmount()

  release()
  await running
  const after = await mountBand($)
  expect(await shows(after as never, /editando/)).toBe(false)
  await after.unmount()
})

test('screen doing: no store write ever carries the target', { options: { layout: 'bar' } }, async ($, on) => {
  const writes: string[] = []
  const toasts: string[] = []
  const store = (on: On) => {
    // A guild one point short of level 4 so the first payment raises a toast, which must not carry a target either.
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 159 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push(JSON.stringify([e.key, e.value]))

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  await setup($, on, () => false, () => undefined, store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  // Long and short targets, a notebook path and a shell command, all in progress at the same time.
  const release = ['Edit', 'Write', 'NotebookEdit', 'Bash'].map(hold)
  const running = [
    call($, 'Edit', { file_path: '/home/x/privado/register.tsx', old_string: 'a', new_string: 'b' }),
    call($, 'Write', { file_path: 'a.ts', content: 'c' }),
    call($, 'NotebookEdit', { notebook_path: '/home/x/privado/lab.ipynb' }),
    call($, 'Bash', { command: 'curl -u admin:hunter2 https://segredo.example/token' }),
  ]
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash']) await arrived(tool)
  expect(await panelShows($, /: executando curl…$/)).toBe(true)
  // The screen itself (panel and band) never carries a secret of the command either.
  const secret = /hunter2|admin|segredo|token|https/
  const panel = await mountPanel($)
  expect((await panel.findAll({ type: 'Text' })).map(item => item.text).join('\n')).not.toMatch(secret)
  await panel.unmount()
  const band = await mountBand($)
  expect((await band.findAll({ type: 'Text' })).map(item => item.text).join('\n')).not.toMatch(secret)
  await band.unmount()

  for (const done of release) done()
  await Promise.all(running)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito' } as never)

  const everything = [...writes, ...toasts].join('\n')
  expect(writes.length).toBeGreaterThan(0)
  expect(toasts.length).toBeGreaterThan(0)
  expect(new Set(writes.map(write => (JSON.parse(write) as [string])[0]))).toEqual(new Set(['guild.trace.v1', 'guild.v1']))
  expect(everything).not.toMatch(/register|privado|segredo|token|hunter2|admin|https|lab\.ipynb|a\.ts/)
})

test('screen doing: the line is the first text of the panel and of the band stats', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const release = hold('Edit')
  const running = call($, 'Edit', EDIT)
  await arrived('Edit')

  const panel = await mountPanel($)
  const panelTexts = (await panel.findAll({ type: 'Text' })).map(item => item.text)
  expect(panelTexts[0]).toBe('Guerreiro: editando register.tsx')
  expect(panelTexts[1]).toBe('Guerreiro Nv.3')
  await panel.unmount()

  const band = await mountBand($)
  const bandTexts = (await band.findAll({ type: 'Text' })).map(item => item.text)
  expect(bandTexts[0]).toBe('editando register.tsx')
  expect(bandTexts[1]).toBe('Guerreiro Nv.3')
  await band.unmount()

  release()
  await running
})

test('screen doing: the demo scenes show a call in progress', async ($, on) => {
  await setup($, on)

  const lines: Array<[string, string]> = [
    ['guerreiro', 'Guerreiro: editando register.tsx'],
    ['bug', 'Guerreiro: editando register.tsx'],
    ['explorador', 'Explorador: pesquisando na web'],
    ['mago', 'Mago: planejando'],
    ['cansado', 'Guerreiro: cansado'],
    ['dormindo', 'Guerreiro: dormindo'],
  ]

  for (const [scene, text] of lines) {
    await $.command.run({ command: 'guild', args: scene } as never)
    expect(await panelShows($, text)).toBe(true)
  }
})

test('screen doing: a store that fails after the tool ran never changes the result or runs the tool again', { options: { layout: 'bar' } }, async ($, on) => {
  let isDown = false
  const store = (on: On) => {
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => {
      if (isDown) throw new Error('store is down')

      return { value: undefined } as never
    })
  }
  await setup($, on, tool => tool === 'Bash', () => 'Exit code 1', store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  isDown = true

  const done = (await $.tool.call({ tool: 'Edit', ...EDIT } as never)) as { result?: string }
  expect(done.result).toBe('ok')

  const failed = (await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)) as { isError?: boolean; text?: string }
  expect(failed.isError).toBe(true)
  expect(failed.text).toBe('Exit code 1')

  // Each call reached the tool once: the failure of the record did not make the engine run it again.
  expect(runs).toEqual({ Edit: 1, Bash: 1 })
  expect(await panelShows($, /editando|executando/)).toBe(false)
})

test('screen doing: the info box of a compact band never has more lines than the character is tall', { options: { layout: 'bar', bandSize: 'compact' } }, async ($, on) => {
  await setup($, on, tool => tool === 'Bash')
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  // Room for the stats but not for the other characters or the bug beside them: 8 rows, 60 columns.
  const lines = async () => {
    const band = await mountBand($, 60, 8)
    const texts = (await band.findAll({ type: 'Text' })).map(item => item.text)
    await band.unmount()

    return texts
  }

  const quiet = await lines()
  expect(quiet.length).toBe(8)
  expect(quiet[0]).toBe('Guerreiro: de prontidão')

  await call($, 'Bash', { command: 'npm test' })
  const withBug = await lines()
  expect(withBug).toContain('bug na área!')
  expect(withBug.length).toBeLessThanOrEqual(8)
})

const HOUR_AND_5 = 65 * MINUTE

test('timers C5: the panel shows the session time from the session start', { options: { layout: 'bar' } }, async ($, on) => {
  nextStart = START - HOUR_AND_5
  await setup($, on)

  expect(await panelShows($, 'sessão 1h05')).toBe(true)
})

test('timers C6: a clear starts the session time over', { options: { layout: 'bar' } }, async ($, on) => {
  nextStart = START - HOUR_AND_5
  const clock = await setup($, on)
  await clock.advance(100)
  expect(await panelShows($, 'sessão 1h05')).toBe(true)

  // The session is read again every two seconds: the next reading brings the new start.
  sessionStart = START + 2_050
  await clock.advance(2_000)
  expect(await panelShows($, 'sessão 0s')).toBe(true)
  expect(await panelShows($, /1h05/)).toBe(false)
})

test('timers C7: the turn time runs in the panel and in the band', { options: { layout: 'bar' } }, async ($, on) => {
  nextStart = START - HOUR_AND_5
  const clock = await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await clock.advance(32_000)

  expect(await panelShows($, 'turno 32s')).toBe(true)

  const band = await mountBand($)
  const texts = (await band.findAll({ type: 'Text' })).map(item => item.text)
  await band.unmount()
  expect(texts).toContain('ouro $1.50 · turno 32s')
  // The band carries no session time.
  expect(texts.some(text => /sessão/.test(text))).toBe(false)
})

test('timers C8: the final duration is the event one and stays', { options: { layout: 'bar' } }, async ($, on) => {
  const clock = await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await clock.advance(10_000)
  expect(await panelShows($, 'turno 10s')).toBe(true)

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 7_000 } as never)
  expect(await panelShows($, 'turno 7s')).toBe(true)

  await clock.advance(60_000)
  expect(await panelShows($, 'turno 7s')).toBe(true)

  const band = await mountBand($)
  const texts = (await band.findAll({ type: 'Text' })).map(item => item.text)
  await band.unmount()
  expect(texts).toContain('ouro $1.50')
  expect(texts.some(text => /turno/.test(text))).toBe(false)
})

test('timers C9: a new turn starts the time over', { options: { layout: 'bar' } }, async ($, on) => {
  const clock = await setup($, on)
  await $.turn.start({ text: 'um', turnId: 't1' } as never)
  await clock.advance(10_000)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 7_000 } as never)
  await clock.advance(5_000)

  await $.turn.start({ text: 'dois', turnId: 't2' } as never)
  expect(await panelShows($, 'turno 0s')).toBe(true)
  await clock.advance(3_000)
  expect(await panelShows($, 'turno 3s')).toBe(true)
  expect(await panelShows($, /turno 7s/)).toBe(false)
})

test('timers C10: before any turn the panel shows no duration', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)

  expect(await panelShows($, 'turno --')).toBe(true)
})

test('timers C11: the view is published once a second, not at every frame', { options: { layout: 'bar' } }, async ($, on) => {
  nextStart = START
  let writes = 0
  const store = (on: On) => {
    mock.store(on, { 'guild.v1': { guerreiro: { xp: 200 } } })
    on('state.set', async (_$, e, next) => {
      if ((e as { key?: string }).key === 'view') writes += 1

      return next(e)
    })
  }
  const clock = await setup($, on, () => false, () => undefined, store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await clock.advance(100)
  writes = 0

  // 17 frames of 50 ms, all inside the same second.
  await clock.advance(850)
  expect(writes).toBe(0)

  // The second changes: one publication, not one per frame.
  await clock.advance(100)
  expect(writes).toBe(1)

  await clock.advance(950)
  expect(writes).toBe(2)
})

test('timers C12: the compact band keeps its eight lines with the turn time', { options: { layout: 'bar', bandSize: 'compact' } }, async ($, on) => {
  const clock = await setup($, on, tool => tool === 'Bash')
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Bash', { command: 'npm test' })
  await clock.advance(32_000)

  const band = await mountBand($, 60, 8)
  const texts = (await band.findAll({ type: 'Text' })).map(item => item.text)
  await band.unmount()

  expect(texts).toContain('bug na área!')
  expect(texts).toContain('ouro $1.50 · turno 32s')
  expect(texts.length).toBeLessThanOrEqual(8)
})

test('timers C13: a narrow panel still shows both times', { options: { layout: 'bar' } }, async ($, on) => {
  nextStart = START - HOUR_AND_5
  const clock = await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await clock.advance(32_000)

  expect(await panelShows($, 'sessão 1h05', 20)).toBe(true)
  expect(await panelShows($, 'turno 32s', 20)).toBe(true)
})

test('timers C14: the times sit after the stats and before the operations', { options: { layout: 'bar' } }, async ($, on) => {
  nextStart = START - HOUR_AND_5
  const clock = await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)
  await clock.advance(32_000)

  for (const columns of [20, 60]) {
    const panel = await mountPanel($, columns)
    const texts = (await panel.findAll({ type: 'Text' })).map(item => item.text)
    await panel.unmount()

    const at = (text: string) => texts.indexOf(text)
    expect(at('ouro $1.50')).toBeGreaterThan(-1)
    expect(at('sessão 1h05')).toBeGreaterThan(at('ouro $1.50'))
    expect(at('turno 32s')).toBe(at('sessão 1h05') + 1)
    expect(at('Últimas operações')).toBe(at('turno 32s') + 1)
  }
})

test('timers C15: the times never reach the store, the trace or a toast', { options: { layout: 'bar' } }, async ($, on) => {
  const writes: string[] = []
  const toasts: string[] = []
  const store = (on: On) => {
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 159 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push(JSON.stringify([e.key, e.value]))

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  nextStart = START - 4_242_424
  const clock = await setup($, on, () => false, () => undefined, store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)
  await clock.advance(10_000)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 7_777 } as never)

  expect(toasts.length).toBeGreaterThan(0)
  expect(new Set(writes.map(write => (JSON.parse(write) as [string])[0]))).toEqual(new Set(['guild.trace.v1', 'guild.v1']))
  expect([...writes, ...toasts].join('\n')).not.toMatch(/7777|7_777|3242424|sessão|turno|durationMs|startedAt/)
})

test('timers C16: the working demo scenes show both times', async ($, on) => {
  await setup($, on)

  for (const scene of ['explorador', 'mago', 'guerreiro', 'bug']) {
    await $.command.run({ command: 'guild', args: scene } as never)
    expect(await panelShows($, 'sessão 1h05')).toBe(true)
    expect(await panelShows($, 'turno 32s')).toBe(true)
  }
})

test('timers C17: the resting demo scenes show both times', async ($, on) => {
  await setup($, on)

  for (const scene of ['cansado', 'dormindo']) {
    await $.command.run({ command: 'guild', args: scene } as never)
    expect(await panelShows($, 'sessão 1h05')).toBe(true)
    expect(await panelShows($, 'turno 4min')).toBe(true)
  }
})

// Counters: a sequence of calls the screen can see. `failBash` makes the Bash calls that follow fail.
let failBash = false

const countersSetup = async ($: Engine, on: On, store?: (on: On) => void, says: Says = () => undefined) => {
  failBash = false

  return setup($, on, tool => tool === 'Bash' && failBash, says, store)
}

const panelTexts = async ($: Engine, columns = 60) => {
  const panel = await mountPanel($, columns)
  const texts = (await panel.findAll({ type: 'Text' })).map(item => item.text as string)
  await panel.unmount()

  return texts
}

// The combo, best combo and bugs of the counters line: the damage dealt after them has its own tests (`damage C*`).
const countersLine = async ($: Engine, columns = 60) =>
  (await panelTexts($, columns)).find(text => /(^|\b)bugs \d+( · .*)?$/.test(text))?.replace(/( · \d+ (arquivos?|linhas?|comandos?))+$/, '')

const edits = async ($: Engine, n: number) => {
  for (let i = 0; i < n; i += 1) await call($, 'Edit', EDIT)
}

const bash = async ($: Engine, fails: boolean) => {
  failBash = fails
  await call($, 'Bash', { command: 'npm test' })
  failBash = false
}

const start = async ($: Engine, on: On, store?: (on: On) => void, says?: Says) => {
  await countersSetup($, on, store, says)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
}

// Nine edits, then three fail-then-pass cycles of npm test, then six edits: combo 7, best 9, 3 defeats.
const seven9and3 = async ($: Engine) => {
  await edits($, 9)
  for (let i = 0; i < 3; i += 1) {
    await bash($, true)
    await bash($, false)
  }
  await edits($, 6)
}

test('counters C7: calls from a subagent neither raise nor reset the combo and count no bug', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await edits($, 4)
  expect(await countersLine($)).toBe('combo x4 · melhor x4 · bugs 0')

  failBash = true
  await call($, 'Bash', { command: 'npm test', agentId: 'sub1' })
  failBash = false
  await call($, 'Edit', { ...EDIT, agentId: 'sub1' })
  await call($, 'Bash', { command: 'npm test', agentId: 'sub1' })

  expect(await countersLine($)).toBe('combo x4 · melhor x4 · bugs 0')
})

test('counters C10: the panel shows combo, best combo and defeats between the characters and the timers', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await seven9and3($)

  for (const columns of [40, 60]) {
    const texts = await panelTexts($, columns)
    const at = texts.findIndex(text => text.startsWith('combo x7 · melhor x9 · bugs 3'))
    const session = texts.findIndex(text => text.startsWith('sessão'))

    expect(at).toBeGreaterThan(-1)
    expect(at).toBe(session - 1)
    expect(at).toBeGreaterThan(texts.findLastIndex(text => /Nv\.\d+$/.test(text)))
    expect(at).toBeGreaterThan(texts.indexOf('ouro $1.50'))
  }
})

test('counters C11: the 20 column panel still shows the three counters', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await seven9and3($)

  expect(await countersLine($, 20)).toBe('combo x7 · melhor x9 · bugs 3')
})

test('counters C12: the compact band keeps its eight lines and shows no counters', { options: { layout: 'bar', bandSize: 'compact' } }, async ($, on) => {
  await start($, on)
  await edits($, 7)

  const band = await mountBand($, 60, 8)
  const texts = (await band.findAll({ type: 'Text' })).map(item => item.text as string)
  await band.unmount()

  expect(texts.length).toBeLessThanOrEqual(8)
  expect(texts.join('\n')).not.toMatch(/combo|melhor|bugs \d/)
  expect(await countersLine($)).toBe('combo x7 · melhor x7 · bugs 0')
})

test('counters C13: no store write, trace entry or toast carries the counters', { options: { layout: 'bar' } }, async ($, on) => {
  const writes: Array<[string, unknown]> = []
  const toasts: string[] = []
  const store = (on: On) => {
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 159 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push([e.key, e.value])

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  await start($, on, store)
  await seven9and3($)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 7_000 } as never)

  expect(await countersLine($)).toBe('combo x7 · melhor x9 · bugs 3')
  expect(toasts.length).toBeGreaterThan(0)
  expect(new Set(writes.map(([key]) => key))).toEqual(new Set(['guild.trace.v1', 'guild.v1']))
  const written = [...writes.map(write => JSON.stringify(write)), ...toasts].join('\n')
  expect(written).not.toMatch(/combo|melhor|best|bugs|counters/i)
  const guild = writes.filter(([key]) => key === 'guild.v1').map(([, value]) => Object.keys(value as object))
  for (const keys of guild) expect(keys.every(key => ['mago', 'guerreiro', 'explorador'].includes(key))).toBe(true)
})

test('counters C14: a new session zeroes the combo, the best combo and the defeats', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await edits($, 5)
  await bash($, true)
  await bash($, false)
  await edits($, 3)
  expect(await countersLine($)).toBe('combo x4 · melhor x5 · bugs 1')

  await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)

  expect(await countersLine($)).toBe('bugs 0')
})

test('counters C16: every demo scene shows made-up counters', async ($, on) => {
  await countersSetup($, on)

  for (const scene of ['explorador', 'mago', 'guerreiro', 'cansado', 'dormindo']) {
    await $.command.run({ command: 'guild', args: scene } as never)
    expect(await countersLine($)).toBe('combo x7 · melhor x9 · bugs 3')
  }

  await $.command.run({ command: 'guild', args: 'bug' } as never)
  expect(await countersLine($)).toBe('melhor x9 · bugs 3')
  expect((await panelTexts($)).join('\n')).not.toMatch(/combo/)
})

test('counters C18: a call a hook denied and one the person turned down leave the combo of 4 alone', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on, undefined, tool => (tool === 'Bash' ? 'Permission for this tool use was denied. Try something else.' : undefined))
  await edits($, 4)

  refused.add('Edit')
  await call($, 'Edit', EDIT)
  refused.delete('Edit')
  await bash($, true)

  expect(await countersLine($)).toBe('combo x4 · melhor x4 · bugs 0')
  expect(await panelShows($, 'bug na área!')).toBe(false)

  await edits($, 1)
  expect(await countersLine($)).toBe('combo x5 · melhor x5 · bugs 0')
})

test('counters C19: the combo shows from the third success in a row', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  expect(await countersLine($)).toBe('bugs 0')

  await edits($, 1)
  expect(await countersLine($)).toBe('bugs 0')
  await edits($, 1)
  expect(await countersLine($)).toBe('bugs 0')
  await edits($, 1)
  expect(await countersLine($)).toBe('combo x3 · melhor x3 · bugs 0')
})

// Forecast: readings of the rate limits that move with the clock. The session is read every 2 seconds, so a
// series of minutes is a loop of minutes: the limits of that minute are set, then the clock runs through it.
type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const RED = '#E74C3C'
const resetsIn = (minutes: number) => new Date(START + minutes * MINUTE).toISOString()
const five = (used: number, reset = 300): Limit => ({ kind: 'five_hour', percentUsed: used, resetsAt: resetsIn(reset) })
const seven = (used: number, reset = 6 * 24 * 60): Limit => ({ kind: 'seven_day', percentUsed: used, resetsAt: resetsIn(reset) })

type Clock = Awaited<ReturnType<typeof setup>>

// `at(minute)` gives the limits of each minute from 1 to `minutes`; minute 0 is `nextLimits`, set before `setup`.
const feed = async (clock: Clock, minutes: number, at: (minute: number) => Limit[], step = MINUTE) => {
  for (let minute = 1; minute <= minutes; minute += 1) {
    limits = at(minute)
    await clock.advance(step)
  }
}

// 33% rising a point a minute: about 50 minutes left, well before a reset 5 hours away.
const hurried = (minute: number): Limit[] => [five(33 + minute)]

// The time moves by hand: at `minute` the session measurement brings these limits. The readings are the same as
// the ones the 2-second tick takes, without the thousands of ticks of a fake clock running through the minutes.
const jump = async ($: Engine, minute: number, rateLimits: Limit[]) => {
  fakeNow = START + minute * MINUTE
  await $.session.measure({ context: { percent: 30 }, rateLimits, changed: ['rateLimits'] } as never)
}

const jumps = async ($: Engine, from: number, to: number, at: (minute: number) => Limit[]) => {
  for (let minute = from; minute <= to; minute += 1) await jump($, minute, at(minute))
}

// Readings every minute for 12 minutes: they span the 10 the 5h window asks for.
const start5 = async ($: Engine, on: On, fails: Fail = () => false) => {
  nextFast = true
  await setup($, on, fails)
  await jumps($, 0, 12, hurried)
}

// Both windows for over two hours: 5h a point every 2 minutes (about 50 minutes left, the reset 5 hours away) and
// 7d 3 points in about 2 hours (days left, but its reset in 24 hours comes first).
const both = (minute: number): Limit[] => [five(5 + Math.floor(minute / 2), 300), seven(20 + Math.floor(minute / 50), 24 * 60)]

const startBoth = async ($: Engine, on: On, fails: Fail = () => false) => {
  nextFast = true
  await setup($, on, fails)
  await jumps($, 0, 140, both)
}

type Item = { text: string; color: unknown; dim: unknown }

const itemsOf = async (mounted: { findAll: Awaited<ReturnType<typeof mountPanel>>['findAll'] }): Promise<Item[]> =>
  (await mounted.findAll({ type: 'Text' })).map(item => ({ text: item.text as string, color: item.props.color, dim: item.props.dimColor }))

const panelItems = async ($: Engine, columns = 60): Promise<Item[]> => {
  const panel = await mountPanel($, columns)
  const items = await itemsOf(panel)
  await panel.unmount()

  return items
}

const bandItems = async ($: Engine, columns = 120, rows = 20): Promise<Item[]> => {
  const band = await mountBand($, columns, rows)
  const items = await itemsOf(band)
  await band.unmount()

  return items
}

const FORECAST_LINE = /^(5h|7d) /
const isForecast = (item: Item) => FORECAST_LINE.test(item.text)
const WORDS = /esgota|sem consumo|dura até|esgotado/

// The minutes in "5h esgota em ~50min" or "5h esgota em ~1h05".
const minutesOf = (text: string): number => {
  const hours = /~(\d+)h(\d\d)/.exec(text)
  if (hours !== null) return Number(hours[1]) * 60 + Number(hours[2])

  return Number(/~(\d+)min/.exec(text)?.[1])
}

test('forecast C14: the panel shows a line per window after the legend, red only before the reset', { options: { layout: 'bar' } }, async ($, on) => {
  await startBoth($, on)

  const items = await panelItems($)
  const texts = items.map(item => item.text)
  const hours = items.find(item => item.text.startsWith('5h '))
  const week = items.find(item => item.text.startsWith('7d '))

  expect(hours?.text).toMatch(/^5h esgota em ~/)
  expect(minutesOf(hours?.text ?? '')).toBeGreaterThanOrEqual(40)
  expect(minutesOf(hours?.text ?? '')).toBeLessThanOrEqual(60)
  expect(hours?.color).toBe(RED)
  expect(week?.text).toBe('7d dura até o reset')
  expect(week?.color).not.toBe(RED)

  // After the legend, before the counters and the times.
  const legend = texts.indexOf('HP=7d MP=5h ST=ctx')
  expect(legend).toBeGreaterThanOrEqual(0)
  expect(texts.indexOf(hours?.text ?? '')).toBeGreaterThan(legend)
  expect(texts.indexOf(week?.text ?? '')).toBeGreaterThan(texts.indexOf(hours?.text ?? ''))
  expect(texts.findIndex(text => /^(combo|melhor|bugs) /.test(text))).toBeGreaterThan(texts.indexOf(week?.text ?? ''))
  expect(texts.findIndex(text => /^sessão /.test(text))).toBeGreaterThan(texts.indexOf(week?.text ?? ''))
})

test('forecast C14: a 5h pace that outlasts the reset says so and is not red', { options: { layout: 'bar' } }, async ($, on) => {
  // A point every 6 minutes leaves hours; the reset is 100 minutes away.
  nextFast = true
  await setup($, on)
  await jumps($, 0, 30, minute => [five(10 + Math.floor(minute / 6), 100)])

  const calm = (await panelItems($)).find(isForecast)
  expect(calm?.text).toBe('5h dura até o reset')
  expect(calm?.color).not.toBe(RED)
})

test('forecast C15: the 20 column panel lines are at most 20 characters', { options: { layout: 'bar' } }, async ($, on) => {
  await start5($, on)

  const lines = (await panelItems($, 20)).filter(isForecast)
  expect(lines.map(item => item.text.slice(0, 2))).toEqual(['5h'])
  expect(lines[0]?.text).toMatch(/^5h esgota em ~/)
  expect(lines[0]?.text.length).toBeLessThanOrEqual(20)

  // Narrower than the whole line, the shorter wording; narrower than that, no line instead of a wrapped one.
  expect((await panelItems($, 18)).find(isForecast)?.text).toMatch(/^5h esgota ~\d+min$/)
  expect((await panelItems($, 14)).some(isForecast)).toBe(false)
})

test('forecast C16: the compact band keeps eight lines and yields to the bug', { options: { layout: 'bar', bandSize: 'compact' } }, async ($, on) => {
  nextFast = true
  await setup($, on, tool => tool === 'Bash')
  await jumps($, 0, 12, hurried)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const quiet = (await bandItems($, 60, 8)).map(item => item.text)
  expect(quiet.length).toBe(8)
  expect(quiet.filter(text => FORECAST_LINE.test(text)).length).toBe(1)
  // The forecast takes the legend's line, the last of the box.
  expect(quiet[7]).toMatch(/^5h esgota em ~/)
  expect(quiet[7]?.length).toBeLessThanOrEqual(28)
  expect(quiet).not.toContain('HP=7d MP=5h ST=ctx')

  await call($, 'Bash', { command: 'npm test' })
  const withBug = (await bandItems($, 60, 8)).map(item => item.text)
  expect(withBug.length).toBeLessThanOrEqual(8)
  expect(withBug).toContain('bug na área!')
  expect(withBug.some(text => FORECAST_LINE.test(text))).toBe(false)
})

test('forecast C17: the full band shows one short line within sixteen rows', { options: { layout: 'bar' } }, async ($, on) => {
  await start5($, on, tool => tool === 'Bash')
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)

  const quiet = (await bandItems($)).map(item => item.text)
  const lines = quiet.filter(text => FORECAST_LINE.test(text))
  // One line, right after the gold line and before the legend.
  expect(lines.length).toBe(1)
  expect(lines[0]).toMatch(/^5h esgota em ~/)
  expect(lines[0]?.length).toBeLessThanOrEqual(28)
  expect(quiet.indexOf(lines[0] ?? '')).toBe(quiet.findIndex(text => /^ouro /.test(text)) + 1)
  expect(quiet.indexOf('HP=7d MP=5h ST=ctx')).toBe(quiet.indexOf(lines[0] ?? '') + 1)

  // With the bug under the stats the box is the doing line, six stats and the forecast: 8 lines, and the bug's
  // 8 rows under them are 16.
  await call($, 'Bash', { command: 'npm test' })
  const band = await mountBand($)
  const withBug = (await itemsOf(band)).map(item => item.text)
  expect(await band.find({ key: 'bug' })).toBeDefined()
  await band.unmount()

  const at = withBug.findIndex(text => FORECAST_LINE.test(text))
  expect(at).toBeGreaterThan(0)
  expect(withBug.filter(text => FORECAST_LINE.test(text)).length).toBe(1)
  expect(withBug).not.toContain('HP=7d MP=5h ST=ctx')
  expect(at + 1 + 8).toBeLessThanOrEqual(16)
  expect(withBug[at + 1]).not.toBe('bug na área!')
})

test('forecast C18: without enough readings no forecast line appears', { options: { layout: 'bar' } }, async ($, on) => {
  nextFast = true
  await setup($, on)
  // Three minutes of readings: samples, but not the 10 minutes the 5h window asks for.
  await jumps($, 0, 3, hurried)

  for (const items of [await panelItems($), await bandItems($)]) {
    expect(items.some(isForecast)).toBe(false)
    expect(items.some(item => WORDS.test(item.text))).toBe(false)
  }
})

test('forecast C18: outside a subscription no forecast line appears', { options: { layout: 'bar' } }, async ($, on) => {
  nextFast = true
  await setup($, on)
  await jumps($, 0, 15, () => [])

  expect((await panelItems($)).some(item => isForecast(item) || WORDS.test(item.text))).toBe(false)
  expect((await bandItems($)).some(item => isForecast(item) || WORDS.test(item.text))).toBe(false)
})

test('forecast C19: showForecast off hides every forecast line', { options: { layout: 'bar', showForecast: 'off' } }, async ($, on) => {
  await start5($, on)

  const panel = await panelItems($)
  const band = await bandItems($)
  const compact = await bandItems($, 60, 8)
  for (const items of [panel, band, compact]) expect(items.some(item => isForecast(item) || WORDS.test(item.text))).toBe(false)
  // The rest is where it was: the legend and the meters.
  expect(panel.map(item => item.text)).toContain('HP=7d MP=5h ST=ctx')
  expect(compact.map(item => item.text)).toContain('HP=7d MP=5h ST=ctx')
  expect(panel.some(item => /^MP /.test(item.text))).toBe(true)
})

test('forecast C20: a missing or unknown showForecast keeps the forecast on', { options: { layout: 'bar', showForecast: 'talvez' } }, async ($, on) => {
  await start5($, on)

  expect((await panelItems($)).some(item => /^5h esgota em ~/.test(item.text))).toBe(true)
})

test('forecast C21: no store write, trace entry or toast carries the forecast', { options: { layout: 'bar' } }, async ($, on) => {
  const writes: string[] = []
  const toasts: string[] = []
  const store = (on: On) => {
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 159 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push(JSON.stringify([e.key, e.value]))

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  nextFast = true
  await setup($, on, () => false, () => undefined, store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await jumps($, 0, 12, hurried)
  await call($, 'Edit', EDIT)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 7_777 } as never)

  // The forecast is on screen, so the test would notice if it leaked.
  expect((await panelItems($)).some(item => /^5h esgota em ~/.test(item.text))).toBe(true)
  expect(toasts.length).toBeGreaterThan(0)
  expect(writes.length).toBeGreaterThan(0)
  expect(new Set(writes.map(write => (JSON.parse(write) as [string])[0]))).toEqual(new Set(['guild.trace.v1', 'guild.v1']))
  expect([...writes, ...toasts].join('\n')).not.toMatch(/esgota|sem consumo|dura até|esgotado|five_hour|seven_day|percentUsed|samples|resetsAt|"used"/)
})

test('forecast C22: a window reset takes the line away until new samples are enough', { options: { layout: 'bar' } }, async ($, on) => {
  await start5($, on)
  const line = async () => (await panelItems($)).find(item => item.text.startsWith('5h '))
  expect(await line()).toBeDefined()

  // The percent drops: a new window, whose reset time is new too. A single reading says nothing.
  await jump($, 13, [five(2, 600)])
  expect(await line()).toBeUndefined()
  expect((await bandItems($)).some(isForecast)).toBe(false)

  // It comes back with new readings, 10 minutes of them, at the new pace.
  await jumps($, 14, 25, minute => [five(2 + (minute - 13), 600)])
  expect((await line())?.text).toMatch(/^5h esgota em ~/)

  // Only the reset time changing, with the percent still rising, is a reset too.
  await jump($, 26, [five(40, 900)])
  expect(await line()).toBeUndefined()
})

const SCENES = ['explorador', 'mago', 'guerreiro', 'bug', 'cansado', 'dormindo']

test('forecast C23: every demo scene shows a made-up forecast', { options: { layout: 'bar' } }, async ($, on) => {
  await setup($, on)

  for (const scene of SCENES) {
    await $.command.run({ command: 'guild', args: scene } as never)
    const items = await panelItems($)

    const hours = items.find(item => item.text === '5h esgota em ~1h30')
    const week = items.find(item => item.text === '7d dura até o reset')

    expect(hours?.color).toBe(RED)
    expect(week).toBeDefined()
    expect(week?.color).not.toBe(RED)
  }

  await $.command.run({ command: 'guild', args: 'guerreiro' } as never)
  expect((await bandItems($)).some(item => item.text === '5h esgota em ~1h30')).toBe(true)
})

test('forecast C23: every demo scene shows no forecast when showForecast is off', { options: { layout: 'bar', showForecast: 'off' } }, async ($, on) => {
  await setup($, on)

  for (const scene of SCENES) {
    await $.command.run({ command: 'guild', args: scene } as never)

    expect((await panelItems($)).some(item => isForecast(item) || WORDS.test(item.text))).toBe(false)
    expect((await bandItems($)).some(item => isForecast(item) || WORDS.test(item.text))).toBe(false)
  }
})

test('forecast C13: readings that come with the session measurement count too', { options: { layout: 'bar' } }, async ($, on) => {
  nextFast = true
  await setup($, on)

  // The session itself reports no limits; only the measurements do, a point a minute.
  await jumps($, 0, 12, hurried)

  expect((await panelItems($)).find(isForecast)?.text).toMatch(/^5h esgota em ~/)
})

test('forecast C13: readings the session takes on its own every 2 seconds count too', { options: { layout: 'bar' } }, async ($, on) => {
  nextLimits = hurried(0)
  const clock = await setup($, on)
  // Twelve minutes is the least that spans the 10 the 5h window asks for; a point a minute, read by the tick.
  await feed(clock, 12, hurried)

  expect((await panelItems($)).find(isForecast)?.text).toMatch(/^5h esgota em ~/)
})

test('forecast C13: a window the engine stops reporting is not read again as idle', { options: { layout: 'bar' } }, async ($, on) => {
  await start5($, on)

  // The 5h window is gone from the reports (the session keeps its last figure): ten minutes later nothing is said,
  // not "sem consumo" and not the old pace.
  await jumps($, 13, 23, () => [seven(20)])

  const items = await panelItems($)
  expect(items.some(item => /^MP /.test(item.text))).toBe(true)
  expect(items.some(item => item.text.startsWith('5h '))).toBe(false)
  expect(items.some(item => /sem consumo/.test(item.text))).toBe(false)
})

// Tokens: the time is moved by hand (`nextFast`), so no test runs a tick of a fake clock.
type Spent = { input?: number; read?: number; written?: number; output?: number; model?: string }

const usageOf = (spent: Spent) => ({
  input_tokens: spent.input ?? 0,
  cache_read_input_tokens: spent.read ?? 0,
  cache_creation_input_tokens: spent.written ?? 0,
  output_tokens: spent.output ?? 0,
  model: spent.model ?? 'claude-sonnet-5-5',
})

// 142k of prompt, 87% of it from the cache, and 18k generated.
const BIG: Spent = { input: 6_000, read: 123_540, written: 12_460, output: 18_000 }

const finish = async ($: Engine, turnId: string, spent?: Spent, more: Record<string, unknown> = {}) => {
  await $.turn.complete({ turnId, reason: 'answer', answer: 'feito', durationMs: 1_000, ...(spent === undefined ? {} : { usage: usageOf(spent) }), ...more } as never)
}

const TOKEN_LINE = /^(tokens  |sessão  |subagentes )/
const tokenTexts = async ($: Engine, columns = 60) => (await panelItems($, columns)).filter(item => TOKEN_LINE.test(item.text))
const fast = async ($: Engine, on: On) => {
  nextFast = true
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
}

const OPTIONS = { options: { layout: 'bar' } } as const

test('tokens C5: no line and no model before any turn with usage', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1')

  expect(await tokenTexts($)).toEqual([])
  const items = await panelItems($)
  expect(items.some(item => /sonnet|input|cache/.test(item.text))).toBe(false)
  expect(items.map(item => item.text)).toContain('Guerreiro Nv.3')
})

test('tokens C6: a turn with usage shows the turn and session lines', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', BIG)

  expect((await tokenTexts($)).map(item => item.text)).toEqual([
    'tokens  input 142k · output 18k · cache 87%',
    'sessão  input 142k · output 18k · cache 87%',
  ])
})

test('tokens C7: the session adds the turns and the rate is of the sum', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', { input: 100, output: 10 })
  await $.turn.start({ text: 'outro', turnId: 't2' } as never)
  await finish($, 't2', { read: 900, output: 20 })

  expect((await tokenTexts($)).map(item => item.text)).toEqual([
    'tokens  input 900 · output 20 · cache 100%',
    'sessão  input 1k · output 30 · cache 90%',
  ])
})

test('tokens C8: turns without usage add nothing and keep the lines', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1')
  expect(await tokenTexts($)).toEqual([])

  await $.turn.start({ text: 'um', turnId: 't2' } as never)
  await finish($, 't2', BIG)
  const before = (await tokenTexts($)).map(item => item.text)
  expect(before.length).toBe(2)

  await $.turn.start({ text: 'dois', turnId: 't3' } as never)
  await finish($, 't3')
  await $.turn.start({ text: 'tres', turnId: 't4' } as never)
  await $.turn.complete({ turnId: 't4', reason: 'aborted', isAborted: true, answer: '', durationMs: 10 } as never)
  await $.turn.start({ text: 'quatro', turnId: 't5' } as never)
  await $.turn.complete({ turnId: 't5', reason: 'error', answer: '', durationMs: 10 } as never)
  await $.turn.start({ text: 'cinco', turnId: 't6' } as never)
  await $.turn.complete({ turnId: 't6', reason: 'refusal', refusal: { category: 'x' }, answer: '', durationMs: 10 } as never)
  await $.turn.complete({ turnId: 's1', agentId: 'sub1', reason: 'aborted', isAborted: true, answer: '', durationMs: 10 } as never)

  expect((await tokenTexts($)).map(item => item.text)).toEqual(before)
})

test('tokens C9: a low rate is red and the threshold is 50', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', { input: 51, read: 49, output: 1 })
  expect((await tokenTexts($)).map(item => item.color)).toEqual([URGENT_COLOR, URGENT_COLOR])

  await $.turn.start({ text: 'b', turnId: 't2' } as never)
  await finish($, 't2', { input: 5_000, read: 5_000, output: 1 })
  const [turn, session] = await tokenTexts($)
  expect(turn?.text).toMatch(/cache 50%$/)
  expect(turn?.color).not.toBe(URGENT_COLOR)
  expect(session?.text).toMatch(/cache 50%$/)
  expect(session?.color).not.toBe(URGENT_COLOR)

  await $.turn.start({ text: 'c', turnId: 't3' } as never)
  await finish($, 't3', BIG)
  expect((await tokenTexts($)).some(item => item.color === URGENT_COLOR)).toBe(false)
})

test('tokens C10: subagent turns add to their own line only', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', BIG)
  await finish($, 's1', { input: 12_000, read: 11_400, written: 6_600, output: 4_100 }, { agentId: 'sub1' })

  const lines = await tokenTexts($)
  expect(lines.map(item => item.text)).toEqual([
    'tokens  input 142k · output 18k · cache 87%',
    'sessão  input 142k · output 18k · cache 87%',
    'subagentes input 30k · output 4,1k · cache 38%',
  ])
  expect(lines[2]?.color).toBe(URGENT_COLOR)

  await finish($, 's2', { input: 10_000, read: 0, output: 1_000 }, { agentId: 'sub1' })
  expect((await tokenTexts($)).map(item => item.text)).toEqual([
    'tokens  input 142k · output 18k · cache 87%',
    'sessão  input 142k · output 18k · cache 87%',
    'subagentes input 40k · output 5,1k · cache 29%',
  ])

  // A later main turn leaves the subagents' total alone.
  await $.turn.start({ text: 'b', turnId: 't2' } as never)
  await finish($, 't2', { input: 1_000, output: 1_000 })
  expect((await tokenTexts($)).map(item => item.text)).toEqual([
    'tokens  input 1k · output 1k · cache 0%',
    'sessão  input 143k · output 19k · cache 86%',
    'subagentes input 40k · output 5,1k · cache 29%',
  ])
})

test('tokens C11: a subagent alone shows only its line', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 's1', { input: 30_000, output: 2_000 }, { agentId: 'sub1' })

  expect((await tokenTexts($)).map(item => item.text)).toEqual(['subagentes input 30k · output 2k · cache 0%'])
  expect((await panelItems($)).some(item => /sonnet/.test(item.text))).toBe(false)
})

test('tokens C12: a subagent turn leaves the main turn open and pays nothing', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', { input: 10, output: 1, model: 'claude-opus-4-1-20250805' })
  await $.turn.start({ text: 'b', turnId: 't2' } as never)
  const xp = (await panelItems($)).find(item => item.text.startsWith('XP '))?.text
  fakeNow += 5_000
  expect((await panelItems($)).some(item => item.text === 'turno 5s')).toBe(true)

  // Even with the very id of the main turn, a subagent's end is not the main turn's.
  await finish($, 't2', { input: 5, output: 1, model: 'claude-haiku-9' }, { agentId: 'sub1' })
  fakeNow += 5_000

  const items = await panelItems($)
  expect(items.some(item => item.text === 'turno 10s')).toBe(true)
  expect(items.find(item => item.text.startsWith('XP '))?.text).toBe(xp)
  expect(items.some(item => item.text === 'opus-4-1')).toBe(true)
  expect(items.some(item => item.text === 'haiku-9')).toBe(false)
})

test('tokens C13: the model is dim beside the name', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', BIG)

  // 60 columns put the stats beside the character in 24: only the family fits next to the name.
  const panel = await mountPanel($)
  const name = await panel.find({ key: 'name' })
  const model = await panel.find({ type: 'Text', text: 'sonnet' })
  const texts = (await panel.findAll({ type: 'Text' })).map(item => item.text)
  await panel.unmount()

  expect(name?.props.flexDirection).toBe('row')
  expect(model?.props.dimColor).toBe(true)
  expect(texts.indexOf('sonnet')).toBe(texts.indexOf('Guerreiro Nv.3') + 1)

  // Below the character the whole name fits; with no room beside the name the model is left out, not cut.
  const whole = await mountPanel($, 40)
  expect((await whole.find({ type: 'Text', text: 'sonnet-5-5' }))?.props.dimColor).toBe(true)
  await whole.unmount()
  expect((await panelItems($, 20)).some(item => /^sonnet/.test(item.text))).toBe(false)
})

test('tokens C14: a narrow panel keeps every line inside its width', OPTIONS, async ($, on) => {
  await fast($, on)
  await finish($, 't1', BIG)
  await finish($, 's1', { input: 12_000, read: 11_400, written: 6_600, output: 4_100 }, { agentId: 'sub1' })

  for (const columns of [20, 60]) {
    const lines = await tokenTexts($, columns)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(columns)
  }

  expect((await tokenTexts($, 20)).map(item => item.text)).toEqual(['tokens  142k/18k 87%', 'sessão  142k/18k 87%', 'subagentes 38%'])
  expect((await tokenTexts($, 60))[0]?.text).toBe('tokens  input 142k · output 18k · cache 87%')
})

test('tokens C15: the bands show no token line, only the model', { options: { layout: 'bar', bandSize: 'compact' } }, async ($, on) => {
  await fast($, on)
  await finish($, 't1', BIG)
  await finish($, 's1', { input: 12_000, output: 4_100 }, { agentId: 'sub1' })

  for (const [columns, rows] of [
    [60, 8],
    [120, 20],
  ] as const) {
    const items = await bandItems($, columns, rows)
    const texts = items.map(item => item.text)
    expect(texts.some(text => TOKEN_LINE.test(text) || /input|cache \d/.test(text))).toBe(false)
    expect(texts).toContain('sonnet-5-5')
    // Dim, and right after the name, in a row with it.
    expect(texts.indexOf('sonnet-5-5')).toBe(texts.indexOf('Guerreiro Nv.3') + 1)
    expect(items.find(item => item.text === 'sonnet-5-5')?.dim).toBe(true)
    const band = await mountBand($, columns, rows)
    expect((await band.find({ key: 'name' }))?.props.flexDirection).toBe('row')
    await band.unmount()
    // The model shares the line of the name: it is one Text more but no line more.
    expect(texts.filter(text => text !== 'sonnet-5-5').length).toBeLessThanOrEqual(rows)
  }
})

test('tokens C16: nothing about tokens reaches the store, the trace or a toast', OPTIONS, async ($, on) => {
  const writes: string[] = []
  const toasts: string[] = []
  const store = (on: On) => {
    // 157 XP: the first edit and the answer of turn one take the warrior to level 3, a toast, once the model is known.
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 157 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push(JSON.stringify([e.key, e.value]))

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  nextFast = true
  await setup($, on, () => false, () => undefined, store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)
  expect(toasts.length).toBe(0)
  await finish($, 't1', { input: 7_777, read: 3_242_424, output: 98_765, model: 'claude-segredo-9' })
  // The level-up of the answer came after the model was known.
  expect(toasts.length).toBe(1)
  await finish($, 's1', { input: 4_242, output: 31_337 }, { agentId: 'sub1' })

  // A second main turn, with the model and the totals known: its start, its tool and its end are traced and stored.
  await $.turn.start({ text: 'outro', turnId: 't2' } as never)
  await call($, 'Edit', EDIT)
  await finish($, 't2', { input: 7_777, read: 3_242_424, output: 98_765, model: 'claude-segredo-9' })

  const trace = ((await $.command.run({ command: 'guild', args: 'trace' } as never)) as { text: string }).text
  expect(trace).toContain('início')
  expect(writes.length).toBeGreaterThan(3)
  expect([...writes, ...toasts, trace].join('\n')).not.toMatch(/7777|7_777|3242424|98765|4242|31337|segredo|tokens|usage|cache|input_tokens|sonnet/)
})

test('tokens C19: the rule is the presence of usage, whatever the reason that ended the turn', OPTIONS, async ($, on) => {
  await fast($, on)
  const one = { input: 100, output: 10 }

  // A refusal without usage adds nothing; with usage it adds, like an interrupted turn or one an API error ended.
  await $.turn.complete({ turnId: 't1', reason: 'refusal', refusal: { category: 'x' }, answer: '', durationMs: 10 } as never)
  expect(await tokenTexts($)).toEqual([])

  const reasons = [{ reason: 'refusal', refusal: { category: 'x' } }, { reason: 'aborted', isAborted: true }, { reason: 'error' }]
  for (const [i, more] of reasons.entries()) {
    await $.turn.start({ text: 'x', turnId: `r${i}` } as never)
    await $.turn.complete({ turnId: `r${i}`, answer: '', durationMs: 10, usage: usageOf(one), ...more } as never)
    expect((await tokenTexts($)).map(item => item.text)).toEqual([
      'tokens  input 100 · output 10 · cache 0%',
      `sessão  input ${(i + 1) * 100} · output ${(i + 1) * 10} · cache 0%`,
    ])
  }
})

test('tokens C17: every demo scene shows made-up tokens', async ($, on) => {
  nextFast = true
  await setup($, on)

  const missing: string[] = []

  for (const scene of DEMO_SCENES) {
    await $.command.run({ command: 'guild', args: scene } as never)
    // What the session really spent is ignored while a scene runs.
    await finish($, 'real', { input: 1, output: 2 })
    await finish($, 'real-sub', { input: 3, output: 4 }, { agentId: 'sub1' })

    const lines = await tokenTexts($)
    expect(lines.map(item => item.text)).toEqual([
      'tokens  input 142k · output 18k · cache 87%',
      'sessão  input 1,2M · output 96k · cache 91%',
      'subagentes input 30k · output 4,1k · cache 38%',
    ])
    expect(lines.map(item => item.color === URGENT_COLOR)).toEqual([false, false, true])
    if (!(await panelItems($)).some(item => /^sonnet/.test(item.text))) missing.push(scene)
  }
  expect(missing).toEqual([])

  // Back to the real session: what happened during the scenes was not counted.
  await $.command.run({ command: 'guild', args: 'off' } as never)
  expect(await tokenTexts($)).toEqual([])
})

// The gold by class: the cost moves by hand, one `session.measure` per interval, the operations in between.
const measureCost = async ($: Engine, usd: unknown) => {
  cost = usd
  await $.session.measure({ context: { percent: 30 }, rateLimits: [], cost: { usd }, changed: ['cost'] } as never)
}

const GOLD_LINE = /~\$/
const goldTexts = async ($: Engine, columns = 60) => (await panelTexts($, columns)).filter(text => GOLD_LINE.test(text))

// The Mage spends $1.20 (TodoWrite), the Warrior $1.71 (Edit), the Explorer $0.51 (Read): $3.42 from the base of $1.50.
const split342 = async ($: Engine) => {
  await call($, 'TodoWrite')
  await measureCost($, 2.7)
  await call($, 'Edit', EDIT)
  await measureCost($, 4.41)
  await call($, 'Read', { file_path: '/x/a.ts' })
  await measureCost($, 4.92)
}

const FULL_LINES = ['Mago ~$1.20 (35%)', 'Guerreiro ~$1.71 (50%)', 'Explorador ~$0.51 (15%)']

test('gold C18: the panel shows the split between the counters and the session time', OPTIONS, async ($, on) => {
  await fast($, on)
  await split342($)

  for (const columns of [40, 60]) {
    const texts = await panelTexts($, columns)
    const counters = texts.findIndex(text => /bugs \d+( · .*)?$/.test(text))
    const session = texts.findIndex(text => text.startsWith('sessão'))

    expect(texts.filter(text => GOLD_LINE.test(text))).toEqual(FULL_LINES)
    expect(texts.indexOf(FULL_LINES[0] as string)).toBe(counters + 1)
    // The session cost $1.50 before the split began: the dim caption comes under the three lines.
    expect(texts[counters + 4]).toBe('desde a abertura')
    expect(session).toBe(counters + 5)
  }
})

test('gold C19: the 20 column panel keeps the three lines within its width', OPTIONS, async ($, on) => {
  await fast($, on)
  await split342($)

  expect(await goldTexts($, 20)).toEqual(['Mag ~$1.20 35%', 'Gue ~$1.71 50%', 'Exp ~$0.51 15%'])

  // Four-digit dollars: still the same form for the three lines, none past 20 columns.
  await call($, 'Edit', EDIT)
  await measureCost($, 4.92 + 12_345.67)
  const texts = await goldTexts($, 20)
  expect(texts.every(text => text.length <= 20)).toBe(true)
  expect(texts).toEqual(['Mag ~$1.20 0%', 'Gue ~$12347.38 100%', 'Exp ~$0.51 0%'])
})

test('gold C20: no line before a change and none in the bands, the compact one keeping its eight lines', { options: { layout: 'bar', bandSize: 'compact' } }, async ($, on) => {
  await fast($, on)
  await call($, 'Edit', EDIT)
  // An operation without a later measurement, and a measurement that did not change the cost.
  expect(await goldTexts($)).toEqual([])
  await measureCost($, 1.5)
  expect(await goldTexts($)).toEqual([])

  await split342($)
  expect((await goldTexts($)).length).toBe(3)

  const compact = await mountBand($, 60, 8)
  const lines = (await compact.findAll({ type: 'Text' })).map(item => item.text as string)
  await compact.unmount()
  expect(lines.length).toBeLessThanOrEqual(8)
  expect(lines.some(text => GOLD_LINE.test(text))).toBe(false)
  expect(lines.some(text => /Mago|Guerreiro|Explorador/.test(text) && /%/.test(text))).toBe(false)

  const full = await bandItems($, 120, 20)
  expect(full.some(item => GOLD_LINE.test(item.text))).toBe(false)
})

test('gold C21: a clear or a new session takes the lines away until a new change', OPTIONS, async ($, on) => {
  await fast($, on)
  await split342($)
  expect((await goldTexts($)).length).toBe(3)

  // A /clear: the cost starts again, lower. The lines go; what follows counts from the new base.
  await measureCost($, 0.4)
  expect(await goldTexts($)).toEqual([])
  await call($, 'Edit', EDIT)
  await measureCost($, 0.9)
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$0.50 (100%)', 'Explorador ~$0.00 (0%)'])

  // A new session: a fresh guild reading its own base.
  cost = 9
  await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
  expect(await goldTexts($)).toEqual([])
  await $.turn.start({ text: 'oi', turnId: 't2' } as never)
  await call($, 'Edit', EDIT)
  await measureCost($, 10)
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$1.00 (100%)', 'Explorador ~$0.00 (0%)'])
})

test('gold C22: the 2 second reading and the session measurement both attribute to the operation class', OPTIONS, async ($, on) => {
  const clock = await setup($, on)
  await clock.advance(100)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)
  expect(await goldTexts($)).toEqual([])

  // The clock reads the session again every two seconds and finds the cost higher.
  cost = 2.5
  await clock.advance(2_100)
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$1.00 (100%)', 'Explorador ~$0.00 (0%)'])

  await call($, 'Read', { file_path: '/x/a.ts' })
  await measureCost($, 3.5)
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$1.00 (50%)', 'Explorador ~$1.00 (50%)'])
})

test('gold C14: subagent calls are not operations', OPTIONS, async ($, on) => {
  await fast($, on)
  await call($, 'Edit', EDIT)
  for (const tool of ['Read', 'Grep', 'Read', 'WebSearch']) await call($, tool, { file_path: '/x/a.ts', agentId: 'sub1' })
  await measureCost($, 2.5)
  // Four explorer calls ran inside a subagent: none counts, the whole change is the warrior's.
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$1.00 (100%)', 'Explorador ~$0.00 (0%)'])

  // Only subagent calls in the interval: the change goes to the active class (still the warrior's turn).
  await call($, 'TodoWrite', { agentId: 'sub1' })
  await call($, 'Read', { file_path: '/x/a.ts', agentId: 'sub1' })
  await measureCost($, 4.5)
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$3.00 (100%)', 'Explorador ~$0.00 (0%)'])
})

test('gold C23: nothing about the split reaches the store, the trace or a toast', OPTIONS, async ($, on) => {
  const writes: string[] = []
  const toasts: string[] = []
  const store = (on: On) => {
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 157 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push(JSON.stringify([e.key, e.value]))

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  nextFast = true
  nextCost = 1.11
  await setup($, on, () => false, () => undefined, store)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)
  await measureCost($, 7.77)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 1_000 } as never)
  await call($, 'TodoWrite')
  await measureCost($, 8.88)
  expect((await goldTexts($)).length).toBe(3)

  const trace = ((await $.command.run({ command: 'guild', args: 'trace' } as never)) as { text: string }).text
  expect(toasts.length).toBeGreaterThan(0)
  expect(writes.length).toBeGreaterThan(2)
  expect([...writes, ...toasts, trace].join('\n')).not.toMatch(/~\$|ouro|gold|spent|micros|6[,.]66|1[,.]11|6660000|1110000|8[,.]88|7[,.]77|7770000|8880000/)
})

test('gold C25: every demo scene shows the made-up split in the panel', OPTIONS, async ($, on) => {
  await setup($, on)
  expect(DEMO_SCENES.length).toBe(6)

  for (const scene of DEMO_SCENES) {
    await $.command.run({ command: 'guild', args: scene } as never)

    expect(await goldTexts($, 60)).toEqual(FULL_LINES)
    expect(await noteIn($, 60)).toBe(undefined)
    expect(await goldTexts($, 20)).toEqual(['Mag ~$1.20 35%', 'Gue ~$1.71 50%', 'Exp ~$0.51 15%'])
  }
})

test('gold C13b: a call a hook denied is not an operation of the interval', OPTIONS, async ($, on) => {
  await fast($, on)
  refused.add('Edit')
  await call($, 'Read', { file_path: '/x/a.ts' })
  await call($, 'Edit', EDIT)
  await measureCost($, 2.5)

  // Only the explorer's read ran: the denied edit would have taken half of the $1.00.
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$0.00 (0%)', 'Explorador ~$1.00 (100%)'])
})

const NOTE = 'desde a abertura'
const noteIn = async ($: Engine, columns: number) => (await panelItems($, columns)).find(item => item.text === NOTE)

test('gold C30: a split that began after the session had cost something has a dim caption under the lines', OPTIONS, async ($, on) => {
  await fast($, on)
  await split342($)

  const items = await panelItems($, 60)
  const last = items.findIndex(item => item.text === 'Explorador ~$0.51 (15%)')
  expect(items[last + 1]).toEqual({ text: NOTE, color: undefined, dim: true })

  expect((await noteIn($, 20))?.dim).toBe(true)
  // Too narrow for the caption (16 columns) but not for the lines (14): the caption goes, the lines stay.
  expect(await noteIn($, 15)).toBe(undefined)
  expect((await goldTexts($, 15)).length).toBe(3)

  // The bands do not show the split and so not the caption either.
  expect((await bandItems($, 120, 20)).some(item => item.text === NOTE)).toBe(false)
  const compact = await mountBand($, 60, 8)
  const lines = (await compact.findAll({ type: 'Text' })).map(item => item.text as string)
  await compact.unmount()
  expect(lines.includes(NOTE)).toBe(false)
})

test('gold C31: a split that began at zero has no caption, and a clear that rebases above zero has one', OPTIONS, async ($, on) => {
  nextFast = true
  nextCost = 0
  await setup($, on)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)
  await measureCost($, 1.2)
  expect((await goldTexts($)).length).toBe(3)
  expect(await noteIn($, 60)).toBe(undefined)

  await measureCost($, 0.4)
  await call($, 'Edit', EDIT)
  await measureCost($, 0.9)
  expect((await noteIn($, 60))?.text).toBe(NOTE)

  // A clear down to exactly zero starts a split from nothing again: no caption.
  await measureCost($, 0)
  await call($, 'Edit', EDIT)
  await measureCost($, 0.5)
  expect((await goldTexts($)).length).toBe(3)
  expect(await noteIn($, 60)).toBe(undefined)
})

test('gold C32: an operation that finishes while the cost is being read weighs on the next interval', OPTIONS, async ($, on) => {
  const clock = await setup($, on)
  await clock.advance(100)
  await $.turn.start({ text: 'conserte o teste', turnId: 't1' } as never)
  await call($, 'Edit', EDIT)

  // The 2 second reading asks for the cost; the answer ($1.00 more) is held while a read finishes.
  cost = 2.5
  let release = () => {}
  usageGate = new Promise<void>(resolve => (release = resolve))
  const reading = clock.advance(2_100)
  await until(() => usageHeld, 'the held reading of the session')
  await call($, 'Read', { file_path: '/x/a.ts' })
  usageGate = undefined
  release()
  await reading

  // The interval it closed was the Edit's alone: the read, which ended during the wait, is not in it.
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$1.00 (100%)', 'Explorador ~$0.00 (0%)'])

  // The read weighs on the next interval.
  await measureCost($, 3.5)
  expect(await goldTexts($)).toEqual(['Mago ~$0.00 (0%)', 'Guerreiro ~$1.00 (50%)', 'Explorador ~$1.00 (50%)'])
})

// Color schemes of the meters (issue 12). The preferences live under `guild.ui.v1`; the test keeps what the store holds
// and every write to it, so a second session can start from the same store.
const UI_KEY = 'guild.ui.v1'

const preferences = (initial?: Record<string, unknown>) => {
  const held: Record<string, unknown> = { 'guild.v1': { guerreiro: { xp: 200 } } }
  if (initial !== undefined) held[UI_KEY] = structuredClone(initial)
  const uiWrites: unknown[] = []
  const store = (on: On) => {
    // The panel the person opens and closes with `/guild panel` and `/guild bar`.
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('ui.close', async () => ({ value: undefined }) as never)
    on('store.get', async (_$, e) => ({ value: held[e.key] === undefined ? undefined : structuredClone(held[e.key]) }) as never)
    on('store.set', async (_$, e) => {
      held[e.key] = structuredClone(e.value)
      if (e.key === UI_KEY) uiWrites.push(structuredClone(e.value))

      return { value: undefined } as never
    })
  }

  return { held, uiWrites, store }
}

type Preferences = ReturnType<typeof preferences>

// HP 72% (the week 28% used), MP 45% and ST 70%.
const WITH_FIGURES = () => {
  nextLimits = [five(55, 133), seven(28)]
}

const startWith = async ($: Engine, on: On, prefs: Preferences) => setup($, on, () => false, () => undefined, prefs.store)

const meters = (args: string) => ({ command: 'guild', args: `meters${args}` }) as never

const reply = async ($: Engine, args: string) => ((await $.command.run(meters(args))) as { text: string }).text

const colorOf = (items: Item[], start: string | RegExp) =>
  items.find(item => (typeof start === 'string' ? item.text.startsWith(start) : start.test(item.text)))?.color

const restart = async ($: Engine) => {
  await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)
}

test('meters C2: the default scheme paints the screen with today\'s colors', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  await startWith($, on, preferences())
  await $.command.run({ command: 'guild', args: 'bug' } as never)

  const panel = await panelItems($)
  expect(colorOf(panel, 'HP ')).toBe('#2ECC71')
  expect(colorOf(panel, 'MP ')).toBe('#4A90E2')
  expect(colorOf(panel, 'ST ')).toBe('#F39C12')
  expect(colorOf(panel, 'XP ')).toBe('#9B59B6')
  expect(colorOf(panel, 'ouro ')).toBe('#F1C40F')
  expect(colorOf(panel, /bugs \d+( · .*)?$/)).toBe('#F1C40F')
  expect(colorOf(panel, /^5h esgota/)).toBe('#E74C3C')
  expect(colorOf(panel, /^tokens /)).toBe('#5DADE2')
  expect(colorOf(panel, /^subagentes /)).toBe('#E74C3C')

  // The label beside a reduced band, and the warning under the stats of a narrow one.
  expect(colorOf(await bandItems($, 120, 8), 'Bug')).toBe('red')
  expect(colorOf(await bandItems($, 60, 8), 'bug na área!')).toBe('red')
})

test('meters C6: a meter without a value uses the unknown gray of the scheme', { options: { layout: 'bar' } }, async ($, on) => {
  nextContext = undefined
  nextCost = null
  await startWith($, on, preferences())

  for (const scheme of METER_SCHEMES) {
    await reply($, ` ${scheme}`)
    const panel = await panelItems($)
    const band = await bandItems($)

    for (const items of [panel, band]) {
      for (const start of ['HP ', 'MP ', 'ST ', 'ouro ']) {
        const line = items.find(item => item.text.startsWith(start))

        expect(`${scheme} ${start} ${line?.text.endsWith('--')}`).toBe(`${scheme} ${start} true`)
        expect(`${scheme} ${start} ${line?.color}`).toBe(`${scheme} ${start} ${SCHEMES[scheme].unknown}`)
      }
    }
  }
  expect(SCHEMES.padrao.unknown).toBe('#7F8C8D')
})

test('meters C8: the screen uses only colors of the scheme and of the classes', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  await startWith($, on, preferences())
  const classes = Object.values(COLORS)

  for (const scheme of METER_SCHEMES) {
    await reply($, ` ${scheme}`)
    const allowed = new Set<unknown>([...Object.values(SCHEMES[scheme]), ...classes])

    for (const scene of ['bug', 'explorador']) {
      await $.command.run({ command: 'guild', args: scene } as never)
      const seen = [...(await panelItems($)), ...(await bandItems($, 120, 20)), ...(await bandItems($, 120, 8)), ...(await bandItems($, 60, 8))]
      const colors = new Set(seen.map(item => item.color).filter(color => color !== undefined))

      expect([...colors].filter(color => !allowed.has(color))).toEqual([])
      // Every color of the map is in use somewhere on these screens (the bug scene has the red lines), but the
      // unknown gray, which only shows without a figure (see C6), and the two lower levels of HP (see C22).
      if (scene === 'bug') {
        const { unknown: _unknown, hpMid: _mid, hpLow: _low, ...inUse } = SCHEMES[scheme]
        expect(Object.values(inUse).filter(color => !colors.has(color))).toEqual([])
      }
    }
  }
})

test('meters C10: the command switches the band and the panel at once', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  await startWith($, on, preferences())
  expect(SCHEMES.contraste.hpHigh).not.toBe(SCHEMES.padrao.hpHigh)

  const band = await mountBand($)
  const live = async () => (await itemsOf(band)).find(item => item.text.startsWith('HP '))?.color
  expect(await live()).toBe(SCHEMES.padrao.hpHigh)

  expect(await reply($, ' contraste')).toBe('Esquema dos medidores: contraste (salvo)')

  // The band that was already on screen follows, and so does a panel opened afterwards.
  expect(await live()).toBe(SCHEMES.contraste.hpHigh)
  await band.unmount()
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
  expect(colorOf(await bandItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)

  expect(await reply($, ' daltonico')).toBe('Esquema dos medidores: daltonico (salvo)')
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)
})

test('meters C11: the choice holds in the next session', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences()
  await startWith($, on, prefs)
  await reply($, ' daltonico')
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'daltonico' })

  // A new session reads the store again: nothing else carries the choice over.
  WITH_FIGURES()
  await restart($)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)
  expect(colorOf(await bandItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)
})

test('meters C12: saved beats the option and the option beats the default', { options: { layout: 'bar', meters: 'daltonico' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences({ meters: 'contraste' })
  await startWith($, on, prefs)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)

  // Nothing saved: the option applies.
  delete prefs.held[UI_KEY]
  await restart($)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)

  // The saved choice comes back and wins again.
  prefs.held[UI_KEY] = { panel: true, meters: 'padrao' }
  await restart($)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.padrao.hpHigh)
})

test('meters C12: an option that is not a scheme falls to the default', { options: { layout: 'bar', meters: 'rosa' } }, async ($, on) => {
  WITH_FIGURES()
  await startWith($, on, preferences())

  expect(colorOf(await panelItems($), 'HP ')).toBe('#2ECC71')
})

test('meters C13: without a name the command lists the schemes', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences()
  await startWith($, on, prefs)

  expect(await reply($, '')).toBe('Esquemas dos medidores:\n- padrao (atual)\n- contraste\n- daltonico\nTroque com /guild meters NOME')

  await reply($, ' contraste')
  prefs.uiWrites.length = 0
  expect(await reply($, '')).toBe('Esquemas dos medidores:\n- padrao\n- contraste (atual)\n- daltonico\nTroque com /guild meters NOME')
  expect(await reply($, '   ')).toContain('- contraste (atual)')

  // Listing neither saves nor changes anything.
  expect(prefs.uiWrites).toEqual([])
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
})

test('meters C14: an unknown name changes nothing', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences()
  await startWith($, on, prefs)
  await reply($, ' contraste')
  prefs.uiWrites.length = 0

  expect(await reply($, ' rosa')).toBe('Esquema "rosa" não existe. Use: /guild meters padrao | contraste | daltonico')
  expect(await reply($, ' contraste daltonico')).toBe('Esquema "contraste daltonico" não existe. Use: /guild meters padrao | contraste | daltonico')
  expect(prefs.uiWrites).toEqual([])
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'contraste' })
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
})

test('meters C15: the name ignores case and spaces', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences()
  await startWith($, on, prefs)

  expect(((await $.command.run({ command: 'guild', args: '  meters   DaltoNico ' } as never)) as { text: string }).text).toBe('Esquema dos medidores: daltonico (salvo)')
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'daltonico' })
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)

  // The same choice again is the same state.
  await reply($, ' daltonico')
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'daltonico' })
})

test('meters C16: the saved preferences hold the panel and the scheme and no session data', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences()
  await startWith($, on, prefs)
  await $.turn.start({ text: 'conserte o teste com a senha hunter2', turnId: 't1' } as never)
  await call($, 'Edit', { file_path: '/Users/me/segredo.ts', old_string: 'a', new_string: 'b' })

  await reply($, ' contraste')
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'contraste' })

  // Opening the panel keeps the scheme, and so does closing it.
  await $.command.run({ command: 'guild', args: 'panel' } as never)
  expect(prefs.held[UI_KEY]).toEqual({ panel: true, meters: 'contraste' })
  await $.command.run({ command: 'guild', args: 'bar' } as never)
  expect(prefs.held[UI_KEY]).toEqual({ panel: false, meters: 'contraste' })

  // Changing the scheme keeps the panel's state.
  await reply($, ' daltonico')
  expect(prefs.held[UI_KEY]).toEqual({ panel: false, meters: 'daltonico' })

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 777 } as never)
  const text = JSON.stringify(prefs.uiWrites)
  expect(text).not.toMatch(/hunter2|segredo|conserte|Edit|777|xp|guerreiro|1\.5|cost/)
  for (const written of prefs.uiWrites) {
    expect(Object.keys(written as Record<string, unknown>).filter(key => key !== 'panel' && key !== 'meters')).toEqual([])
  }
})

test('meters C17: a saved value that is not a scheme is ignored', { options: { layout: 'bar', meters: 'contraste' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences({ meters: 'rosa', panel: true })
  await startWith($, on, prefs)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)

  for (const junk of [42, null, ['daltonico'], { meters: 'daltonico' }, 'DALTONICO']) {
    prefs.held[UI_KEY] = { meters: junk }
    await restart($)
    expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
  }

  prefs.held[UI_KEY] = 'daltonico'
  await restart($)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
})

test('meters C20: the command picks each scheme scene', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  await startWith($, on, preferences())

  for (const scheme of METER_SCHEMES) {
    expect(((await $.command.run({ command: 'guild', args: `esquema-${scheme}` } as never)) as { text: string }).text).toBe(`Cena: esquema-${scheme}`)
    expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES[scheme].hpHigh)
  }
})

test('meters C21: a scheme scene forces its scheme and saves nothing', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences({ meters: 'daltonico' })
  await startWith($, on, prefs)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)

  await $.command.run({ command: 'guild', args: 'esquema-contraste' } as never)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
  expect(colorOf(await bandItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)
  // The saved choice is not the scene's, and the list still says so.
  expect(await reply($, '')).toContain('- daltonico (atual)')
  expect(prefs.uiWrites).toEqual([])
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'daltonico' })

  await $.command.run({ command: 'guild', args: 'off' } as never)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)
  expect(colorOf(await bandItems($), 'HP ')).toBe(SCHEMES.daltonico.hpHigh)
})

test('meters C22: a scheme scene walks the three levels of HP', { options: { layout: 'bar' } }, async ($, on) => {
  const clock = await startWith($, on, preferences())
  const hp = async () => {
    const item = (await panelItems($)).find(entry => entry.text.startsWith('HP '))

    return `${/(\d+)%$/.exec(item?.text ?? '')?.[1]} ${String(item?.color)}`
  }

  for (const scheme of METER_SCHEMES) {
    await $.command.run({ command: 'guild', args: `esquema-${scheme}` } as never)
    const colors = SCHEMES[scheme]
    const seen: string[] = []

    for (let step = 0; step < 3; step += 1) {
      seen.push(await hp())
      await clock.advance(3_000)
    }
    // Whatever level the clock starts at, the three come in turn, in a cycle of 9 seconds.
    expect([...seen].sort()).toEqual([`15 ${colors.hpLow}`, `38 ${colors.hpMid}`, `72 ${colors.hpHigh}`].sort())
    expect(await hp()).toBe(seen[0])
  }
})

test('meters C24: during a scheme scene the answer says the saved scheme waits for /guild off', { options: { layout: 'bar' } }, async ($, on) => {
  WITH_FIGURES()
  const prefs = preferences()
  await startWith($, on, prefs)

  // Out of a scene the answer is the plain one.
  expect(await reply($, ' padrao')).toBe('Esquema dos medidores: padrao (salvo)')

  await $.command.run({ command: 'guild', args: 'esquema-contraste' } as never)
  expect(await reply($, ' daltonico')).toBe('Esquema dos medidores: daltonico (salvo), mas a cena esquema-contraste mostra o esquema dela até /guild off')
  expect(prefs.held[UI_KEY]).toEqual({ meters: 'daltonico' })
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.contraste.hpHigh)

  // The scene's own scheme needs no warning, and a scene of the figures never forces one.
  expect(await reply($, ' contraste')).toBe('Esquema dos medidores: contraste (salvo)')
  await $.command.run({ command: 'guild', args: 'bug' } as never)
  expect(await reply($, ' padrao')).toBe('Esquema dos medidores: padrao (salvo)')

  await $.command.run({ command: 'guild', args: 'esquema-contraste' } as never)
  await $.command.run({ command: 'guild', args: 'off' } as never)
  expect(colorOf(await panelItems($), 'HP ')).toBe(SCHEMES.padrao.hpHigh)
})

// Damage dealt: files, lines and commands on the counters line.
const counterText = async ($: Engine, columns = 60) => (await panelTexts($, columns)).find(text => /(^|\b)bugs \d+( · .*)?$/.test(text))

const lines = (n: number) => Array.from({ length: n }, () => 'x').join('\n')

test('damage C1: Edit twice in a.ts and Write in b.ts make 2 files; every file tool counts its file', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await call($, 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
  await call($, 'Edit', { file_path: '/p/a.ts', old_string: 'b', new_string: 'c' })
  await call($, 'Write', { file_path: '/p/b.ts', content: 'x' })
  expect(await counterText($)).toBe('combo x3 · melhor x3 · bugs 0 · 2 arquivos · 3 linhas · 0 comandos')

  await call($, 'MultiEdit', { file_path: '/p/c.ts', edits: [{ old_string: 'a', new_string: 'b' }] })
  await call($, 'NotebookEdit', { notebook_path: '/p/d.ipynb', new_source: 'x' })
  expect(await counterText($)).toContain('4 arquivos')
})

test('damage C2 subagent: calls from a subagent add no file, line or command', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await call($, 'Edit', { ...EDIT, agentId: 'sub1' })
  await call($, 'Bash', { command: 'npm test', agentId: 'sub1' })

  expect(await counterText($)).toBe('bugs 0')
})

test('damage C6: the panel shows 3 files, 142 lines and 8 commands after the bugs', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await call($, 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
  await call($, 'Write', { file_path: '/p/b.ts', content: lines(100) })
  await call($, 'Write', { file_path: '/p/c.ts', content: lines(41) })
  for (let i = 0; i < 8; i += 1) await call($, 'Bash', { command: 'npm test' })

  expect(await counterText($)).toBe('combo x11 · melhor x11 · bugs 0 · 3 arquivos · 142 linhas · 8 comandos')
})

test('damage C6 plural: one file, one line and one command are written in the singular, and nothing shows without damage', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  expect(await counterText($)).toBe('bugs 0')

  await call($, 'Edit', EDIT)
  await call($, 'Bash', { command: 'npm test' })

  expect(await counterText($)).toBe('bugs 0 · 1 arquivo · 1 linha · 1 comando')
})

test('damage C7: a new session zeroes the damage and the panel hides it', { options: { layout: 'bar' } }, async ($, on) => {
  await start($, on)
  await call($, 'Edit', EDIT)
  await call($, 'Bash', { command: 'npm test' })
  expect(await counterText($)).toContain('1 arquivo · 1 linha · 1 comando')

  await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)

  expect(await counterText($)).toBe('bugs 0')
})

test('damage C8: no store write, trace entry or toast carries the path of an edited file', { options: { layout: 'bar' } }, async ($, on) => {
  const writes: Array<[string, unknown]> = []
  const toasts: string[] = []
  const store = (on: On) => {
    on('store.get', async (_$, e) => ({ value: e.key === 'guild.v1' ? { guerreiro: { xp: 159 } } : undefined }) as never)
    on('store.set', async (_$, e) => {
      writes.push([e.key, e.value])

      return { value: undefined } as never
    })
    on('ui.toast', async (_$, e) => {
      toasts.push(JSON.stringify(e))

      return { value: undefined } as never
    })
  }
  await start($, on, store)
  await call($, 'Edit', EDIT)
  await call($, 'Write', { file_path: '/Users/me/src/notes.md', content: 'a\nb' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'feito', durationMs: 7_000 } as never)

  expect(await counterText($)).toContain('2 arquivos · 3 linhas')
  expect(writes.length).toBeGreaterThan(0)
  const written = [...writes.map(write => JSON.stringify(write)), ...toasts].join('\n')
  expect(written).not.toMatch(/register\.tsx|notes\.md|\/Users\/me|arquivo|linhas|comandos/)
  expect((await panelTexts($)).join('\n')).not.toMatch(/register\.tsx|\/Users\/me\/src\/notes/)
})
