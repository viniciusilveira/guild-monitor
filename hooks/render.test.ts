import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const START = 1_000_000
const MINUTE = 60_000

type Fail = (tool: string) => boolean
type Says = (tool: string) => string | undefined

// The world beneath the guild plugin: a clock the test moves, a store holding a guild whose warrior is at level 3,
// the session's figures and a tool runner that fails the calls the test says.
const setup = async ($: Engine, on: On, fails: Fail = () => false, says: Says = () => undefined, mountStore: (on: On) => void = on => mock.store(on, { 'guild.v1': { guerreiro: { xp: 200 } } })) => {
  const clock = mock.clock(on, { now: START })
  mountStore(on)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { percent: 30 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  on('command.register', async () => ({ value: { command: 'guild' } }) as never)
  on('session.start', async () => ({ cwd: '/tmp' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('tool.call', async (_$, e) => ({ result: 'ok', isError: fails(e.tool), text: says(e.tool) }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal' } as never)

  return clock
}

const mountBand = ($: Engine) =>
  $.ui.mount({
    plugin: 'guild-monitor',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never,
    viewport: { columns: 120, rows: 40 } as never,
  })

const mountPanel = ($: Engine) =>
  $.ui.mount({
    plugin: 'guild-monitor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'guild',
    props: { title: 'Guilda', isFocused: false, bodyColumns: 60, bodyRows: 40 } as never,
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
