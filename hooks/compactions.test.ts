import { expect, test } from 'claude-code/testing'

import type { ViewModel } from '../types'
import { compactionSegments, compactionToast, countsAsCompaction, NO_COMPACTIONS } from './compactions'
import { counterLine, fitCounterLine } from './counters'
import { compacted, createTracker, staminaMeasured } from './tracker'
import type { Tracker } from './tracker'
import { emptyGuild } from './xp'

const fresh = (): Tracker => createTracker(emptyGuild(), 0)

const viewOf = (over: Partial<ViewModel>): ViewModel =>
  ({ counters: { combo: 0, best: 0, bugs: 0 }, damage: { files: 0, lines: 0, commands: 0 }, compactions: 0, ...over }) as ViewModel

test('compactions C1: a manual and then an automatic compaction of the main agent make 1 and then 2', async () => {
  const main = { agentId: undefined, skipped: false }

  expect(countsAsCompaction({ ...main, trigger: 'manual' })).toBe(true)
  expect(countsAsCompaction({ ...main, trigger: 'auto' })).toBe(true)

  const once = compacted(fresh(), 50)
  expect(once.compactions.count).toBe(1)
  expect(compacted(once, 50).compactions.count).toBe(2)
  expect(fresh().compactions).toEqual(NO_COMPACTIONS)
})

test('compactions C3: precompute, plugin, a veto and a subagent do not count', async () => {
  expect(countsAsCompaction({ trigger: 'precompute', skipped: false })).toBe(false)
  expect(countsAsCompaction({ trigger: 'plugin', skipped: false })).toBe(false)
  expect(countsAsCompaction({ trigger: 'manual', skipped: true })).toBe(false)
  expect(countsAsCompaction({ trigger: 'auto', skipped: false, agentId: 'sub1' })).toBe(false)
})

test('compactions C5: 12% before and 64% after make the exact message, once', async () => {
  const done = staminaMeasured(compacted(fresh(), 12), 64)

  expect(done.announce).toEqual({ before: 12, after: 64 })
  expect(compactionToast(done.announce as { before: number; after: number })).toBe('A guilda descansou: ST recuperada de 12% para 64%')
  expect(done.tracker.compactions.count).toBe(1)
})

test('compactions C6: a reading with no percentage says nothing and the compaction stays pending', async () => {
  const waiting = staminaMeasured(compacted(fresh(), 12), null)

  expect(waiting.announce).toBeUndefined()
  expect(waiting.tracker.compactions.pending).toEqual({ before: 12 })
  expect(staminaMeasured(waiting.tracker, 64).announce).toEqual({ before: 12, after: 64 })
})

test('compactions C7: a measurement after the message says nothing', async () => {
  const done = staminaMeasured(compacted(fresh(), 12), 64)

  expect(done.tracker.compactions.pending).toBe(null)
  expect(staminaMeasured(done.tracker, 70).announce).toBeUndefined()
})

test('compactions C8: two compactions before a measurement count 2 and make one message from the first before', async () => {
  const twice = compacted(compacted(fresh(), 12), 40)
  const done = staminaMeasured(twice, 64)

  expect(done.tracker.compactions.count).toBe(2)
  expect(done.announce).toEqual({ before: 12, after: 64 })
  expect(staminaMeasured(done.tracker, 80).announce).toBeUndefined()
})

test('compactions C9: no rise, or no stamina known before, counts the compaction and makes no message', async () => {
  const lower = staminaMeasured(compacted(fresh(), 40), 30)
  expect(lower.announce).toBeUndefined()
  expect(lower.tracker.compactions).toEqual({ count: 1, pending: null })

  const unknown = staminaMeasured(compacted(fresh(), null), 64)
  expect(unknown.announce).toBeUndefined()
  expect(unknown.tracker.compactions).toEqual({ count: 1, pending: null })

  // The same figure may be the engine's old reading: it keeps waiting and says nothing.
  const same = staminaMeasured(compacted(fresh(), 40), 40)
  expect(same.announce).toBeUndefined()
  expect(same.tracker.compactions.pending).toEqual({ before: 40 })
})

test('compactions C10: a measurement with no compaction pending says nothing', async () => {
  const done = staminaMeasured(fresh(), 64)

  expect(done.announce).toBeUndefined()
  expect(done.tracker.compactions).toEqual(NO_COMPACTIONS)
})

test('compactions C13: the line keeps the full words, then the short form, then loses the compactions and then the damage', async () => {
  const view = viewOf({ counters: { combo: 7, best: 9, bugs: 3 }, damage: { files: 3, lines: 142, commands: 8 }, compactions: 2 })

  expect(fitCounterLine(view, 100)).toBe('combo x7 · melhor x9 · bugs 3 · 3 arquivos · 142 linhas · 8 comandos · 2 compactações')
  expect(fitCounterLine(view, 70)).toBe('combo x7 · melhor x9 · bugs 3 · 3 arq · 142 lin · 8 cmd · 2 compact.')
  expect(fitCounterLine(view, 66)).toBe('combo x7 · melhor x9 · bugs 3 · 3 arq · 142 lin · 8 cmd')
  expect(fitCounterLine(view, 40)).toBe('combo x7 · melhor x9 · bugs 3 · 3 arq')
  expect(fitCounterLine(view, 30)).toBe('combo x7 · melhor x9 · bugs 3')
  expect(fitCounterLine(view, 10)).toBe('combo x7 · melhor x9 · bugs 3')
  expect(counterLine(compactionSegments(1))).toBe('1 compactação')
  expect(compactionSegments(0)).toEqual([])
})
