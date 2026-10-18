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

// The world beneath the guild plugin: a clock the test moves, a store holding a guild whose warrior is at level 3,
// the session's figures and a tool runner that fails the calls the test says.
const setup = async ($: Engine, on: On, fails: Fail = () => false, says: Says = () => undefined, mountStore: (on: On) => void = on => mock.store(on, { 'guild.v1': { guerreiro: { xp: 200 } } })) => {
  gates.clear()
  refused.clear()
  thrown.clear()
  entered.clear()
  runs = {}
  const clock = mock.clock(on, { now: START })
  mountStore(on)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { percent: 30 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
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
