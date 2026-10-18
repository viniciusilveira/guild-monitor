import { expect, test } from 'claude-code/testing'

import { counterLine, counterSegments } from './counters'
import { createTracker, startTurn, toolFinished } from './tracker'
import type { Tracker } from './tracker'
import { emptyGuild } from './xp'

const edit = { tool: 'Edit' }
const npmTest = { tool: 'Bash', command: 'npm test' }
const gitPush = { tool: 'Bash', command: 'git push' }

type Result = { isError?: boolean; rejected?: boolean }

const session = (): Tracker => startTurn(createTracker(emptyGuild(), 0), { id: 't1', prompt: 'oi', now: 0 })

// Runs a sequence of finished calls through the tracker, one after the other.
const run = (steps: ReadonlyArray<[{ tool: string; command?: string }, Result?]>, from: Tracker = session()): Tracker =>
  steps.reduce(
    (tracker, [use, result], i) =>
      toolFinished(tracker, { use, isError: result?.isError === true, rejected: result?.rejected, now: 10 + i, durationMs: 0 }).tracker,
    from,
  )

const ok = (n: number): ReadonlyArray<[{ tool: string }]> => Array.from({ length: n }, () => [edit])

test('counters C1: seven successes, a failure and two successes give combo 2, best 7 and the failure raises the bug', async () => {
  const tracker = run([...ok(7), [npmTest, { isError: true }], ...ok(2)])

  expect(tracker.counters).toEqual({ combo: 2, best: 7, bugs: 0 })
  expect(tracker.bug.phase).toBe('alive')
  expect(tracker.bug.category).toBe('Bash:npm test')
})

test('counters C2: a rejected call between successes neither raises nor resets the counters', async () => {
  const before = run(ok(4))
  const rejected = run([[edit, { isError: true, rejected: true }]], before)

  expect(rejected.counters).toEqual({ combo: 4, best: 4, bugs: 0 })

  // A rejection of the very kind of a live bug neither defeats it nor counts a defeat.
  const bugged = run([[npmTest, { isError: true }], ...ok(3)])
  const turnedDown = run([[npmTest, { isError: true, rejected: true }]], bugged)
  expect(turnedDown.counters).toEqual({ combo: 3, best: 3, bugs: 0 })
  expect(turnedDown.bug.phase).toBe('alive')

  expect(run([[edit]], rejected).counters).toEqual({ combo: 5, best: 5, bugs: 0 })
})

test('counters C3: two successes in a row of the live bug category count one defeat, not two', async () => {
  const tracker = run([[npmTest, { isError: true }], [npmTest], [npmTest]])

  expect(tracker.bug.phase).toBe('defeated')
  expect(tracker.counters).toEqual({ combo: 2, best: 2, bugs: 1 })
})

test('counters C4: defeat, a new error of the category and a new defeat count two defeats', async () => {
  const tracker = run([[npmTest, { isError: true }], [npmTest], [npmTest, { isError: true }], [npmTest]])

  expect(tracker.counters).toEqual({ combo: 1, best: 1, bugs: 2 })
})

test('counters C5: a bug replaced by an error of another category is not defeated by the old category', async () => {
  const replaced = run([[npmTest, { isError: true }], [gitPush, { isError: true }], [npmTest]])

  expect(replaced.bug.category).toBe('Bash:git push')
  expect(replaced.counters).toEqual({ combo: 1, best: 1, bugs: 0 })
  expect(run([[gitPush]], replaced).counters).toEqual({ combo: 2, best: 2, bugs: 1 })
})

test('counters C6: the best combo of 5 does not drop after a failure and two successes', async () => {
  const tracker = run([...ok(5), [npmTest, { isError: true }], ...ok(2)])

  expect(tracker.counters).toEqual({ combo: 2, best: 5, bugs: 0 })
})

test('counters C8: the line leaves the combo out at 0, 1 and 2', async () => {
  for (const combo of [0, 1, 2]) {
    expect(counterLine(counterSegments({ combo, best: 2, bugs: 1 }))).toBe('bugs 1')
  }
})

test('counters C9: the line shows the combo at exactly 3', async () => {
  expect(counterLine(counterSegments({ combo: 3, best: 3, bugs: 0 }))).toBe('combo x3 · melhor x3 · bugs 0')
  expect(counterLine(counterSegments({ combo: 7, best: 9, bugs: 3 }))).toBe('combo x7 · melhor x9 · bugs 3')
})

test('counters C15: a segment added to the list shows after the existing ones, joined by a dot', async () => {
  const segments = [...counterSegments({ combo: 7, best: 9, bugs: 3 }), 'dano 12']

  expect(counterLine(segments)).toBe('combo x7 · melhor x9 · bugs 3 · dano 12')
  expect(counterLine(['x'])).toBe('x')
})
