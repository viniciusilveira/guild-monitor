import { expect, test } from 'claude-code/testing'

import { DEFEAT_MS, EXPIRE_MS } from './guild'
import {
  callEnded,
  callStarted,
  completeTurn,
  createTracker,
  setPlanMode,
  startTurn,
  tick,
  toolFinished,
  toolStarted,
} from './tracker'
import { emptyGuild } from './xp'

const fresh = () => createTracker(emptyGuild(), 0)
const edit = { tool: 'Edit' }
const read = { tool: 'Read' }
const npmTest = { tool: 'Bash', command: 'npm test' }

test('a new tracker starts as the explorer with an empty guild', async () => {
  const tracker = fresh()

  expect(tracker.active).toBe('explorador')
  expect(tracker.turn).toBe(null)
  expect(tracker.bug.phase).toBe('none')
})

test('the class follows the turn: the prompt first, then the tools', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 10 })
  expect(tracker.active).toBe('explorador')

  tracker = toolStarted(tracker, read, 11)
  expect(tracker.active).toBe('explorador')

  tracker = toolStarted(tracker, edit, 12)
  expect(tracker.active).toBe('guerreiro')
})

test('plan mode makes the turn the mage and leaving it gives the class back', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'corrija o bug', now: 0 })
  expect(tracker.active).toBe('guerreiro')

  tracker = setPlanMode(tracker, true)
  expect(tracker.active).toBe('mago')

  tracker = setPlanMode(tracker, false)
  expect(tracker.active).toBe('guerreiro')
})

const finish = (tracker: ReturnType<typeof fresh>, use: { tool: string; command?: string; lines?: number }, now: number, durationMs = 0, isError = false) => {
  const started = toolStarted(tracker, use, now)

  return toolFinished(started, { use, isError, now, durationMs })
}

test('each operation that worked pays its own class at once, by time and size', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 })

  const searched = finish(tracker, { tool: 'WebSearch' }, 1, 4_000)
  expect(searched.gain).toEqual({ cls: 'explorador', xp: 4, level: 1, leveledUp: false })

  const planned = finish(searched.tracker, { tool: 'TodoWrite' }, 2)
  expect(planned.gain?.cls).toBe('mago')
  expect(planned.gain?.xp).toBe(2)

  const edited = finish(planned.tracker, { tool: 'Edit', lines: 45 }, 3, 0)
  expect(edited.gain).toEqual({ cls: 'guerreiro', xp: 4, level: 1, leveledUp: false })

  tracker = edited.tracker
  expect(tracker.guild.explorador.xp).toBe(4)
  expect(tracker.guild.mago.xp).toBe(2)
  expect(tracker.guild.guerreiro.xp).toBe(4)
  expect(tracker.recent).toEqual([
    { cls: 'explorador', xp: 4, at: 1, tool: 'WebSearch' },
    { cls: 'mago', xp: 2, at: 2, tool: 'TodoWrite' },
    { cls: 'guerreiro', xp: 4, at: 3, tool: 'Edit' },
  ])
})

test('in plan mode every operation belongs to the mage', async () => {
  const tracker = setPlanMode(startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 }), true)

  expect(finish(tracker, { tool: 'Read' }, 1).gain?.cls).toBe('mago')
})

test('a failed operation and one outside a turn pay nothing', async () => {
  const inTurn = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 })

  expect(finish(inTurn, edit, 1, 0, true).gain).toBe(undefined)
  expect(finish(fresh(), edit, 1).gain).toBe(undefined)
  expect(finish(fresh(), edit, 1).tracker.guild).toEqual(emptyGuild())
})

test('an answered turn pays a little for the answer, and the answer is in the history too', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'corrija o bug', now: 0 })
  tracker = finish(tracker, read, 1).tracker
  tracker = finish(tracker, edit, 2).tracker

  const done = completeTurn(tracker, { id: 't1', reason: 'answer', now: 3 })

  expect(done.gain).toEqual({ cls: 'guerreiro', xp: 3, level: 1, leveledUp: false })
  expect(done.tracker.guild.guerreiro.xp).toBe(5)
  expect(done.tracker.guild.explorador.xp).toBe(2)
  expect(done.tracker.guild.mago.xp).toBe(0)
  expect(done.tracker.turn).toBe(null)
  expect(done.tracker.recent.map(entry => [entry.cls, entry.xp, entry.tool])).toEqual([
    ['explorador', 2, 'Read'],
    ['guerreiro', 2, 'Edit'],
    ['guerreiro', 3, 'resposta'],
  ])
})

test('the history keeps the latest twenty payments', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 })

  for (let i = 0; i < 30; i += 1) tracker = finish(tracker, read, i).tracker

  expect(tracker.recent.length).toBe(20)
  expect(tracker.recent[0]?.at).toBe(10)
  expect(tracker.recent[19]?.at).toBe(29)
})

test('a level is reached by operations and the gain says so', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 })
  let leveled = 0

  for (let i = 0; i < 20; i += 1) {
    const step = finish(tracker, { tool: 'Read' }, i, 6_000)
    tracker = step.tracker
    if (step.gain?.leveledUp) leveled += 1
  }

  expect(tracker.guild.explorador.xp).toBe(100)
  expect(leveled).toBe(1)
})

test('an interrupted or failed turn pays nothing but is over', async () => {
  const started = startTurn(fresh(), { id: 't1', prompt: 'corrija', now: 0 })

  for (const reason of ['aborted', 'error', 'refusal']) {
    const done = completeTurn(started, { id: 't1', reason, now: 5 })

    expect(done.gain).toBe(undefined)
    expect(done.tracker.guild).toEqual(emptyGuild())
    expect(done.tracker.turn).toBe(null)
    expect(done.tracker.lastActivityAt).toBe(5)
  }
})

test('the completion of another turn is ignored', async () => {
  const started = startTurn(fresh(), { id: 't1', prompt: 'corrija', now: 0 })

  expect(completeTurn(started, { id: 'other', reason: 'answer', now: 5 }).tracker).toEqual(started)
  expect(completeTurn(fresh(), { id: 't1', reason: 'answer', now: 5 }).gain).toBe(undefined)
})

test('a failing call raises the bug, a passing call of the same kind defeats it and pays a bonus to who did it', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 })

  tracker = finish(tracker, npmTest, 1, 0, true).tracker
  expect(tracker.bug.phase).toBe('alive')
  expect(tracker.guild.guerreiro.xp).toBe(0)

  tracker = finish(tracker, edit, 3).tracker
  expect(tracker.bug.phase).toBe('alive')

  const fixed = finish(tracker, npmTest, 5)
  expect(fixed.tracker.bug.phase).toBe('defeated')
  // 2 for the operation, 10 for the bug
  expect(fixed.gain).toEqual({ cls: 'guerreiro', xp: 12, level: 1, leveledUp: false })
})

test('a bug defeated pays only the call that defeated it', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 })
  tracker = finish(tracker, npmTest, 1, 0, true).tracker
  tracker = finish(tracker, npmTest, 2).tracker

  expect(tracker.guild.guerreiro.xp).toBe(12)
  expect(finish(tracker, npmTest, 3).gain?.xp).toBe(2)
})

test('the defeated bug leaves with the clock', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 })
  tracker = toolFinished(tracker, { use: npmTest, isError: true, now: 1, durationMs: 0 }).tracker
  tracker = toolFinished(tracker, { use: npmTest, isError: false, now: 1000, durationMs: 0 }).tracker

  expect(tick(tracker, 1000 + DEFEAT_MS - 1).bug.phase).toBe('defeated')
  expect(tick(tracker, 1000 + DEFEAT_MS).bug.phase).toBe('none')
})

test('activity outside a turn keeps the guild awake without starting one', async () => {
  const tracker = toolStarted(fresh(), read, 50)

  expect(tracker.turn).toBe(null)
  expect(tracker.lastActivityAt).toBe(50)
})

const failedAt = (now: number, tool = npmTest) => {
  const started = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 })

  return toolFinished(started, { use: tool, isError: true, now, durationMs: 0 }).tracker
}

test('the clock expires a quiet live bug', async () => {
  const tracker = failedAt(1_000)

  expect(tick(tracker, 1_000 + EXPIRE_MS - 1).bug.phase).toBe('alive')
  expect(tick(tracker, 1_000 + EXPIRE_MS).bug.phase).toBe('none')
})

test('a new failure restarts the quiet period', async () => {
  let tracker = failedAt(1_000)
  tracker = toolFinished(tracker, { use: edit, isError: true, now: 100_000, durationMs: 0 }).tracker

  expect(tick(tracker, 1_000 + EXPIRE_MS).bug.phase).toBe('alive')
  expect(tick(tracker, 100_000 + EXPIRE_MS - 1).bug.phase).toBe('alive')
  expect(tick(tracker, 100_000 + EXPIRE_MS).bug.phase).toBe('none')
})

test('a success before the quiet period ends still defeats the bug', async () => {
  let tracker = failedAt(1_000)
  const fixed = toolFinished(tracker, { use: npmTest, isError: false, now: 1_000 + EXPIRE_MS - 1, durationMs: 0 })
  tracker = fixed.tracker

  expect(tracker.bug.phase).toBe('defeated')
  expect(fixed.gain?.xp).toBe(12)
  expect(tick(tracker, 1_000 + EXPIRE_MS - 1 + DEFEAT_MS - 1).bug.phase).toBe('defeated')
  expect(tick(tracker, 1_000 + EXPIRE_MS - 1 + DEFEAT_MS).bug.phase).toBe('none')
})

test('an expired bug cannot be defeated or paid', async () => {
  const expired = tick(failedAt(1_000), 1_000 + EXPIRE_MS)
  const later = toolFinished(expired, { use: npmTest, isError: false, now: 1_000 + EXPIRE_MS + 1, durationMs: 0 })

  expect(later.tracker.bug.phase).toBe('none')
  expect(later.gain?.xp).toBe(2)
})

test('a rejected call raises no bug, defeats none and pays no XP', async () => {
  const started = startTurn(fresh(), { id: 't1', prompt: 'planeje', now: 0 })
  const plan = { tool: 'ExitPlanMode' }

  const refused = toolFinished(toolStarted(started, plan, 1), { use: plan, isError: true, rejected: true, now: 2, durationMs: 0 })
  expect(refused.tracker.bug.phase).toBe('none')
  expect(refused.gain).toBeUndefined()
  expect(refused.tracker.guild).toEqual(started.guild)
  expect(refused.tracker.recent).toEqual([])
  expect(refused.tracker.lastActivityAt).toBe(2)

  // The same error that is not a rejection does raise the bug.
  expect(toolFinished(toolStarted(started, plan, 1), { use: plan, isError: true, now: 2, durationMs: 0 }).tracker.bug.phase).toBe('alive')

  // A live bug stays alive: a rejection of the same kind is not the fix.
  const live = failedAt(1_000)
  const after = toolFinished(live, { use: npmTest, isError: false, rejected: true, now: 2_000, durationMs: 0 })
  expect(after.tracker.bug).toEqual(live.bug)
  expect(after.gain).toBeUndefined()
  expect(after.tracker.guild).toEqual(live.guild)
})

const call = (id: number, tool: string, target?: string) => ({ id, tool, target })

test('running calls: the latest call not finished is the one that counts', async () => {
  let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 })
  tracker = callStarted(tracker, call(1, 'Read', 'a.ts'))
  tracker = callStarted(tracker, call(2, 'Edit', 'b.ts'))
  expect(tracker.running.at(-1)).toEqual(call(2, 'Edit', 'b.ts'))

  tracker = callEnded(tracker, 2)
  expect(tracker.running.at(-1)).toEqual(call(1, 'Read', 'a.ts'))

  tracker = callEnded(tracker, 1)
  expect(tracker.running).toEqual([])
})

test('running calls: a finished, failed or refused call leaves the list', async () => {
  const base = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 })
  const running = callStarted(callStarted(base, call(1, 'Bash', 'npm test')), call(2, 'Edit', 'a.ts'))

  const failed = toolFinished(running, { use: { tool: 'Bash', command: 'npm test' }, isError: true, now: 5, durationMs: 1 })
  expect(callEnded(failed.tracker, 1).running).toEqual([call(2, 'Edit', 'a.ts')])

  const refused = toolFinished(running, { use: { tool: 'Edit' }, isError: true, rejected: true, now: 5, durationMs: 1 })
  expect(callEnded(refused.tracker, 2).running).toEqual([call(1, 'Bash', 'npm test')])

  expect(callEnded(running, 99).running).toEqual(running.running)
})

test('running calls: the end of the turn clears them', async () => {
  const running = callStarted(startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 }), call(1, 'Edit', 'a.ts'))
  const done = completeTurn(running, { id: 't1', reason: 'answer', now: 9 })
  expect(done.tracker.running).toEqual([])

  const interrupted = completeTurn(running, { id: 't1', reason: 'interrupted', now: 9 })
  expect(interrupted.tracker.running).toEqual([])
})
