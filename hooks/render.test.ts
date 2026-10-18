import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

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
  on('session.usage', async () => ({ value: { startedAt: sessionStart, context: { percent: 30 }, rateLimits: limits, cost: { usd: 1.5 } } }) as never)
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

const countersLine = async ($: Engine, columns = 60) => (await panelTexts($, columns)).find(text => /(^|\b)bugs \d+$/.test(text))

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
    const at = texts.indexOf('combo x7 · melhor x9 · bugs 3')
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

type Item = { text: string; color: unknown }

const itemsOf = async (mounted: { findAll: Awaited<ReturnType<typeof mountPanel>>['findAll'] }): Promise<Item[]> =>
  (await mounted.findAll({ type: 'Text' })).map(item => ({ text: item.text as string, color: item.props.color }))

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
