import { expect, test } from 'claude-code/testing'

import { counterSegments } from './counters'
import { fileKey, MAX_FILES } from './damage'
import { createTracker, startTurn, toolFinished } from './tracker'
import type { Tracker } from './tracker'
import { buildView } from './view'
import { emptyGuild, operationXp } from './xp'

type Use = { tool: string; command?: string; file?: string; lines?: number }
type Result = { isError?: boolean; rejected?: boolean }

const session = (): Tracker => startTurn(createTracker(emptyGuild(), 0), { id: 't1', prompt: 'oi', now: 0 })

const run = (steps: ReadonlyArray<[Use, Result?]>, from: Tracker = session()): Tracker =>
  steps.reduce(
    (tracker, [use, result], i) =>
      toolFinished(tracker, { use, isError: result?.isError === true, rejected: result?.rejected, now: 10 + i, durationMs: 0 }).tracker,
    from,
  )

const damage = (tracker: Tracker) => ({ files: tracker.damage.files.length, lines: tracker.damage.lines, commands: tracker.damage.commands })

test('damage C2: an edit that failed, one that was refused and one outside a turn leave the damage at zero', async () => {
  const failed = run([[{ tool: 'Edit', file: 'k1', lines: 4 }, { isError: true }]])
  const refused = run([[{ tool: 'Edit', file: 'k1', lines: 4 }, { isError: true, rejected: true }]])
  const outside = run([[{ tool: 'Edit', file: 'k1', lines: 4 }], [{ tool: 'Bash', command: 'npm test' }]], createTracker(emptyGuild(), 0))
  const refusedOk = run([[{ tool: 'Edit', file: 'k1', lines: 4 }, { rejected: true }]])

  for (const tracker of [failed, refused, outside, refusedOk]) expect(damage(tracker)).toEqual({ files: 0, lines: 0, commands: 0 })
})

test('damage C3: an edit of 3 lines and a write of 5 make 8 lines, the same value that pays the XP', async () => {
  const tracker = run([[{ tool: 'Edit', file: 'k1', lines: 3 }], [{ tool: 'Write', file: 'k2', lines: 5 }]])
  expect(tracker.damage.lines).toBe(8)

  // 40 lines pay 2 of size bonus (base 2, no time) and count 40: the counter takes the value the XP took.
  const big = toolFinished(session(), { use: { tool: 'Write', file: 'k1', lines: 40 }, isError: false, now: 1, durationMs: 0 })
  expect(big.gain?.xp).toBe(operationXp({ durationMs: 0, lines: 40 }))
  expect(big.gain?.xp).toBe(4)
  expect(big.tracker.damage.lines).toBe(40)
})

test('damage C4: two Bash that worked, one that failed and a Read that worked make 2 commands', async () => {
  const tracker = run([
    [{ tool: 'Bash', command: 'npm test' }],
    [{ tool: 'Bash', command: 'ls' }],
    [{ tool: 'Bash', command: 'npm test' }, { isError: true }],
    [{ tool: 'Read' }],
  ])

  expect(damage(tracker)).toEqual({ files: 0, lines: 0, commands: 2 })
})

test('damage C5: 1005 different files keep the last 1000, and editing the latest again still makes 1000', async () => {
  const many = run(Array.from({ length: 1005 }, (_, i): [Use] => [{ tool: 'Edit', file: `f${i}`, lines: 1 }]))

  expect(many.damage.files.length).toBe(MAX_FILES)
  expect(MAX_FILES).toBe(1000)
  expect(many.damage.files).not.toContain('f0')
  expect(many.damage.files).toContain('f1004')
  expect(many.damage.lines).toBe(1005)

  expect(run([[{ tool: 'Edit', file: 'f1004', lines: 1 }]], many).damage.files.length).toBe(1000)
})

test('damage C8 key: the file key is a short fingerprint with nothing of the path in it', async () => {
  const path = '/Users/me/src/hooks/register.tsx'
  const key = fileKey(path)

  expect(key).not.toMatch(/Users|register|hooks|tsx|\//)
  expect(key.length).toBeLessThanOrEqual(16)
  expect(fileKey(path)).toBe(key)
  expect(fileKey('/Users/me/src/hooks/render.tsx')).not.toBe(key)
})

test('damage C9: counterSegments takes the whole view and gives combo, best, bugs and damage', async () => {
  const ticks: Array<[Use, Result?]> = [
    ...Array.from({ length: 3 }, (_, i): [Use] => [{ tool: 'Edit', file: `f${i}`, lines: 47 }]),
    ...Array.from({ length: 8 }, (): [Use] => [{ tool: 'Bash', command: 'ls' }]),
  ]
  const view = buildView(run(ticks), { rateLimits: [] }, 0)

  expect(counterSegments(view)).toEqual(['combo x11', 'melhor x11', 'bugs 0', '3 arquivos', '141 linhas', '8 comandos'])
})

test('damage C10: the tracker keeps the damage apart and the counters keep their three fields', async () => {
  const tracker = run([[{ tool: 'Edit', file: 'k1', lines: 2 }], [{ tool: 'Bash', command: 'ls' }]])

  expect(tracker.damage).toEqual({ files: ['k1'], lines: 2, commands: 1 })
  expect(tracker.counters).toEqual({ combo: 2, best: 2, bugs: 0 })
  expect(createTracker(emptyGuild(), 0).damage).toEqual({ files: [], lines: 0, commands: 0 })
})
