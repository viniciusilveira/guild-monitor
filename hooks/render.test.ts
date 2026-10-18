import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const START = 1_000_000
const MINUTE = 60_000

type Fail = (tool: string) => boolean

// The world beneath the guild plugin: a clock the test moves, a store holding a guild whose warrior is at level 3,
// the session's figures and a tool runner that fails the calls the test says.
const setup = async ($: Engine, on: On, fails: Fail = () => false) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, { 'guild.v1': { guerreiro: { xp: 200 } } })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { percent: 30 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  on('command.register', async () => ({ value: { command: 'guild' } }) as never)
  on('session.start', async () => ({ cwd: '/tmp' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('tool.call', async (_$, e) => ({ result: 'ok', isError: fails(e.tool) }) as never)
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
