import { expect, test } from 'claude-code/testing'

import type { Bug, Snapshot } from './guild'
import { animationFor, bugAt, categoryOf, DEFAULTS, DEFEAT_MS, EXPIRE_MS, isRejection, NO_BUG, onToolResult } from './guild'

const base: Snapshot = { working: false, active: 'guerreiro', idleMs: 0, contextPercent: 10 }
const snap = (patch: Partial<Snapshot>): Snapshot => ({ ...base, ...patch })

test('only the class doing the turn works', async () => {
  const working = snap({ working: true, active: 'mago' })

  expect(animationFor('mago', working)).toBe('trabalho')
  expect(animationFor('guerreiro', working)).toBe('parado')
  expect(animationFor('explorador', working)).toBe('parado')
})

test('working wins over a tired context and over a long idle', async () => {
  const busy = snap({ working: true, active: 'explorador', contextPercent: 95, idleMs: 999_999 })

  expect(animationFor('explorador', busy)).toBe('trabalho')
})

test('characters sleep after the idle limit and not before', async () => {
  expect(animationFor('mago', snap({ idleMs: DEFAULTS.sleepAfterMs - 1 }))).toBe('parado')
  expect(animationFor('mago', snap({ idleMs: DEFAULTS.sleepAfterMs }))).toBe('dormindo')
})

test('a heavy context tires everyone at the limit, a light one does not', async () => {
  expect(animationFor('mago', snap({ contextPercent: DEFAULTS.tiredAtPercent - 1 }))).toBe('parado')
  expect(animationFor('mago', snap({ contextPercent: DEFAULTS.tiredAtPercent }))).toBe('cansado')
  expect(animationFor('guerreiro', snap({ contextPercent: undefined }))).toBe('parado')
})

test('a long idle puts even a tired character to sleep', async () => {
  expect(animationFor('mago', snap({ contextPercent: 90, idleMs: DEFAULTS.sleepAfterMs }))).toBe('dormindo')
})

test('the limits are settings', async () => {
  const settings = { sleepAfterMs: 1_000, tiredAtPercent: 50 }

  expect(animationFor('mago', snap({ idleMs: 1_000 }), settings)).toBe('dormindo')
  expect(animationFor('mago', snap({ contextPercent: 50 }), settings)).toBe('cansado')
})

test('Bash calls are the same kind when program and subcommand match', async () => {
  expect(categoryOf('Edit')).toBe('Edit')
  expect(categoryOf('Bash', 'npm test')).toBe('Bash:npm test')
  expect(categoryOf('Bash', 'npm test -- --watch')).toBe('Bash:npm test')
  expect(categoryOf('Bash', 'git push origin main')).toBe('Bash:git push')
  expect(categoryOf('Bash', 'pytest -x')).toBe('Bash:pytest')
  expect(categoryOf('Bash', 'ls')).toBe('Bash:ls')
  expect(categoryOf('Bash', '')).toBe('Bash:')
})

test('a failure raises the bug and a later success of the same kind defeats it', async () => {
  const test1 = categoryOf('Bash', 'npm test')
  const raised = onToolResult(NO_BUG, { category: test1, isError: true, now: 100 })

  expect(raised).toEqual({ phase: 'alive', category: test1, since: 100 })

  const defeated = onToolResult(raised, { category: test1, isError: false, now: 500 })

  expect(defeated).toEqual({ phase: 'defeated', category: test1, since: 500 })
})

test('a success of another kind leaves the bug alone', async () => {
  const raised: Bug = { phase: 'alive', category: 'Bash:npm test', since: 100 }

  expect(onToolResult(raised, { category: 'Edit', isError: false, now: 200 })).toEqual(raised)
  expect(onToolResult(NO_BUG, { category: 'Edit', isError: false, now: 200 })).toEqual(NO_BUG)
})

test('a new failure replaces the bug, even one being defeated', async () => {
  const defeated: Bug = { phase: 'defeated', category: 'Edit', since: 100 }

  expect(onToolResult(defeated, { category: 'Bash:git push', isError: true, now: 150 })).toEqual({
    phase: 'alive',
    category: 'Bash:git push',
    since: 150,
  })
})

test('a defeated bug is gone once its animation has run', async () => {
  const defeated: Bug = { phase: 'defeated', category: 'Edit', since: 1_000 }

  expect(bugAt(defeated, 1_000 + DEFEAT_MS - 1)).toEqual(defeated)
  expect(bugAt(defeated, 1_000 + DEFEAT_MS)).toEqual(NO_BUG)
  expect(bugAt({ phase: 'alive', category: 'Edit', since: 0 }, EXPIRE_MS - 1).phase).toBe('alive')
})

test('a live bug expires after the quiet period', async () => {
  const alive: Bug = { phase: 'alive', category: 'Edit', since: 0 }

  expect(EXPIRE_MS).toBe(120_000)
  expect(bugAt(alive, EXPIRE_MS - 1)).toEqual(alive)
  expect(bugAt(alive, EXPIRE_MS)).toEqual(NO_BUG)
})

test('an error from a plan or question tool is a rejection', async () => {
  for (const tool of ['ExitPlanMode', 'AskUserQuestion']) {
    expect(isRejection({ tool, isError: true })).toBe(true)
    expect(isRejection({ tool, isError: true, text: 'qualquer coisa' })).toBe(true)
    expect(isRejection({ tool, isError: false })).toBe(false)
  }
})

test('an error whose text begins with an engine refusal is a rejection', async () => {
  const texts = [
    'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).',
    "The user doesn't want to proceed with this tool use. The tool use was rejected.",
    '[Request interrupted by user for tool use]',
  ]

  for (const text of texts) {
    expect(isRejection({ tool: 'Edit', isError: true, text })).toBe(true)
    expect(isRejection({ tool: 'Edit', isError: true, text: `\n  ${text}` })).toBe(true)
    expect(isRejection({ tool: 'Edit', isError: false, text })).toBe(false)
    expect(isRejection({ tool: 'Edit', isError: true, text: `Exit code 1\n${text}` })).toBe(false)
  }
})

test('a failing shell command or edit is not a rejection', async () => {
  expect(isRejection({ tool: 'Bash', isError: true, text: 'Exit code 1\nnpm ERR! test failed' })).toBe(false)
  expect(isRejection({ tool: 'Bash', isError: true, text: 'Exit code 1\n ! [rejected] main -> main (non-fast-forward)' })).toBe(false)
  expect(isRejection({ tool: 'Edit', isError: true, text: 'String to replace not found in file.' })).toBe(false)
  expect(isRejection({ tool: 'Bash', isError: true, text: 'Exit code 126\nPermission denied' })).toBe(false)
  expect(isRejection({ tool: 'Bash', isError: true })).toBe(false)
})
