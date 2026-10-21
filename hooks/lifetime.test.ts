import { expect, test } from 'claude-code/testing'

import {
  createKeeper,
  currentStreak,
  dayOf,
  emptyLifetime,
  LIFETIME_KEY,
  parseLifetime,
  resetText,
  statsRequest,
  statsText,
  WRITE_EVERY_MS,
} from './lifetime'
import type { Lifetime } from './lifetime'
import { emptyGuild } from './xp'

const UTC_MINUS_3 = () => 180 // what `getTimezoneOffset` says for UTC-3
const at = (day: number, hour = 12, minute = 0) => Date.UTC(2026, 9, day, hour, minute)

// A store in memory that remembers every write, as JSON, the way the engine's does.
const fakeStore = (initial: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(initial))
  const writes: Array<{ key: string; value: unknown }> = []

  return {
    writes,
    data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: unknown) => {
      const copy = JSON.parse(JSON.stringify(value))
      data.set(key, copy)
      writes.push({ key, value: copy })
    },
  }
}

const keeperOn = async (store: ReturnType<typeof fakeStore>, offset: (ms: number) => number = () => 0) => {
  const keeper = createKeeper(store, { offsetMinutes: offset })
  await keeper.load()

  return keeper
}

const full: Lifetime = {
  version: 1,
  firstDay: '2026-10-01',
  lastDay: '2026-10-20',
  days: 12,
  streak: 3,
  bestStreak: 7,
  tasks: { mago: 10, guerreiro: 25, explorador: 6 },
  bugs: 9,
  bestCombo: 14,
  operations: 812,
  timeMs: (14 * 60 + 5) * 60_000,
  compactions: 3,
}

test('lifetime C1: missing and tampered data start from zero, the valid fields are kept', async () => {
  expect(parseLifetime(undefined)).toEqual(emptyLifetime())
  expect(parseLifetime(null)).toEqual(emptyLifetime())
  expect(parseLifetime('texto')).toEqual(emptyLifetime())
  expect(parseLifetime([1, 2])).toEqual(emptyLifetime())

  const tampered = parseLifetime({
    version: 1,
    firstDay: '2026-10-01',
    lastDay: 'ontem',
    days: -4,
    streak: 'três',
    bestStreak: 7.9,
    tasks: { mago: 10, guerreiro: Number.NaN, explorador: '6' },
    bugs: 9,
    bestCombo: Infinity,
    operations: 812,
    timeMs: null,
    compactions: 3,
  })

  expect(tampered.firstDay).toBe('2026-10-01')
  // An invalid last day falls back to the first, so the next day is not counted twice.
  expect(tampered.lastDay).toBe('2026-10-01')
  expect(tampered.days).toBe(0)
  expect(tampered.streak).toBe(0)
  expect(tampered.bestStreak).toBe(7)
  expect(tampered.tasks).toEqual({ mago: 10, guerreiro: 0, explorador: 0 })
  expect(tampered.bugs).toBe(9)
  expect(tampered.bestCombo).toBe(0)
  expect(tampered.operations).toBe(812)
  expect(tampered.timeMs).toBe(0)
  expect(tampered.compactions).toBe(3)

  expect(parseLifetime({ firstDay: '2026-02-31' }).firstDay).toBe(null)
  expect(parseLifetime(JSON.parse(JSON.stringify(full)))).toEqual(full)
})

test('lifetime C2: totals add up across turns', async () => {
  const keeper = await keeperOn(fakeStore())
  const now = at(20)

  await keeper.record({ kind: 'operation', defeated: false, bestCombo: 1 }, now)
  await keeper.record({ kind: 'operation', defeated: false, bestCombo: 2 }, now)
  await keeper.record({ kind: 'turn', cls: 'guerreiro', durationMs: 4_000 }, now)
  await keeper.record({ kind: 'operation', defeated: true, bestCombo: 3 }, now)
  await keeper.record({ kind: 'turn', cls: 'guerreiro', durationMs: 6_000 }, now)
  await keeper.record({ kind: 'turn', cls: 'mago', durationMs: 1_000 }, now)
  await keeper.record({ kind: 'turn', cls: 'explorador', durationMs: 1_000 }, now)
  // An interrupted turn is no task, but its time was spent.
  await keeper.record({ kind: 'turn', cls: null, durationMs: 500 }, now)
  await keeper.record({ kind: 'compaction' }, now)

  const total = keeper.current()
  expect(total.operations).toBe(3)
  expect(total.bugs).toBe(1)
  expect(total.bestCombo).toBe(3)
  expect(total.compactions).toBe(1)
  expect(total.tasks).toEqual({ mago: 1, guerreiro: 2, explorador: 1 })
  expect(total.timeMs).toBe(12_500)
})

test('lifetime C3: totals keep adding up after a restart', async () => {
  const store = fakeStore()
  const first = await keeperOn(store)
  await first.record({ kind: 'operation', defeated: true, bestCombo: 5 }, at(20))
  await first.record({ kind: 'turn', cls: 'mago', durationMs: 3_000 }, at(20))
  await first.flush(at(20), true)

  const second = await keeperOn(store)
  expect(second.current().tasks.mago).toBe(1)
  await second.record({ kind: 'turn', cls: 'mago', durationMs: 2_000 }, at(20))

  expect(second.current().tasks.mago).toBe(2)
  expect(second.current().timeMs).toBe(5_000)
  expect(second.current().bugs).toBe(1)
  expect(second.current().bestCombo).toBe(5)
})

test('lifetime C4: only counters and dates reach the store', async () => {
  const store = fakeStore()
  const keeper = await keeperOn(store)
  const canary = ['/home/pessoa/segredo/app.ts', 'rm -rf /', 'minha senha é 1234']

  // Hostile values where the keeper takes a class or a number: none may become a key or a text.
  await keeper.record({ kind: 'turn', cls: canary[0] as never, durationMs: canary[1] as never }, at(20))
  await keeper.record({ kind: 'operation', defeated: canary[2] as never, bestCombo: canary[1] as never }, at(20))
  await keeper.record({ kind: 'turn', cls: 'mago', durationMs: 1_000 }, at(21))
  await keeper.record({ kind: 'compaction' }, at(22))
  await keeper.flush(at(22), true)
  await keeper.reset(at(23))
  await keeper.record({ kind: 'turn', cls: 'explorador', durationMs: 1_000 }, at(24))
  await keeper.flush(at(24), true)

  expect(store.writes.length).toBeGreaterThan(2)

  const KEYS = new Set(['version', 'firstDay', 'lastDay', 'days', 'streak', 'bestStreak', 'tasks', 'bugs', 'bestCombo', 'operations', 'timeMs', 'compactions', 'mago', 'guerreiro', 'explorador'])
  const walk = (value: unknown, path: string) => {
    if (value === null) return
    if (typeof value === 'number') return expect(Number.isInteger(value) && value >= 0, `${path} = ${value}`).toBe(true)
    if (typeof value === 'string') return expect(/^\d{4}-\d{2}-\d{2}$/.test(value), `${path} = ${value}`).toBe(true)

    expect(typeof value, path).toBe('object')
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      expect(KEYS.has(key), `${path}.${key}`).toBe(true)
      walk(inner, `${path}.${key}`)
    }
  }

  for (const write of store.writes) {
    expect(write.key).toBe(LIFETIME_KEY)
    walk(write.value, 'registro')
  }
  expect(JSON.stringify(store.writes)).not.toContain('segredo')
  expect(JSON.stringify(store.writes)).not.toContain('rm -rf')
})

test('lifetime C5: the day is the local day', async () => {
  // 01:30 UTC on the 20th is 22:30 on the 19th at UTC-3.
  expect(dayOf(at(20, 1, 30), 180)).toBe('2026-10-19')
  expect(dayOf(at(20, 1, 30), 0)).toBe('2026-10-20')
  expect(dayOf(at(20, 1, 30), -540)).toBe('2026-10-20')

  const keeper = await keeperOn(fakeStore(), UTC_MINUS_3)
  await keeper.record({ kind: 'turn', cls: 'mago', durationMs: 1_000 }, at(20, 1, 30))

  const total = keeper.current()
  expect(total.firstDay).toBe('2026-10-19')
  expect(total.lastDay).toBe('2026-10-19')
  expect(total.days).toBe(1)
  expect(total.streak).toBe(1)
  expect(total.bestStreak).toBe(1)
})

test('lifetime C6: a change of day extends the streak and the same day changes nothing', async () => {
  const store = fakeStore({ [LIFETIME_KEY]: { ...full, firstDay: '2026-10-17', lastDay: '2026-10-19', days: 3, streak: 3, bestStreak: 3 } })
  const keeper = await keeperOn(store, UTC_MINUS_3)

  // 23:59 local on the 19th: still the 19th.
  await keeper.record({ kind: 'compaction' }, at(20, 2, 59))
  expect(keeper.current().days).toBe(3)
  expect(keeper.current().streak).toBe(3)

  // 00:00 local on the 20th.
  await keeper.record({ kind: 'compaction' }, at(20, 3, 0))
  expect(keeper.current().lastDay).toBe('2026-10-20')
  expect(keeper.current().days).toBe(4)
  expect(keeper.current().streak).toBe(4)
  expect(keeper.current().bestStreak).toBe(4)

  await keeper.record({ kind: 'compaction' }, at(20, 20, 0))
  expect(keeper.current().days).toBe(4)
  expect(keeper.current().streak).toBe(4)

  // A clock set back never breaks the streak.
  await keeper.record({ kind: 'compaction' }, at(10))
  expect(keeper.current().days).toBe(4)
  expect(keeper.current().lastDay).toBe('2026-10-20')
})

test('lifetime C7: skipping a day resets the current streak and keeps the best', async () => {
  const keeper = await keeperOn(fakeStore({ [LIFETIME_KEY]: { ...full, lastDay: '2026-10-20', days: 4, streak: 4, bestStreak: 4 } }))

  await keeper.record({ kind: 'compaction' }, at(22))

  expect(keeper.current().streak).toBe(1)
  expect(keeper.current().bestStreak).toBe(4)
  expect(keeper.current().days).toBe(5)
  expect(keeper.current().lastDay).toBe('2026-10-22')
})

test('lifetime C8: a broken streak shows as zero before the next use', async () => {
  const lifetime = { ...full, lastDay: '2026-10-20', streak: 3, bestStreak: 7 }

  expect(currentStreak(lifetime, '2026-10-20')).toBe(3)
  expect(currentStreak(lifetime, '2026-10-21')).toBe(3)
  expect(currentStreak(lifetime, '2026-10-23')).toBe(0)
  expect(statsText(lifetime, '2026-10-23')).toContain('Sequência: 0 dias (melhor: 7)')
})

test('lifetime C9: writes are batched, at most one every 5 seconds', async () => {
  const store = fakeStore()
  const keeper = await keeperOn(store)
  const start = at(20)

  await keeper.record({ kind: 'compaction' }, start)
  expect(store.writes.length).toBe(1)

  for (let second = 0; second < 10; second += 1) await keeper.record({ kind: 'operation', defeated: false, bestCombo: 1 }, start + 100 + second * 390)
  await keeper.flush(start + 3_999)
  expect(store.writes.length).toBe(1)

  await keeper.flush(start + WRITE_EVERY_MS - 1)
  expect(store.writes.length).toBe(1)

  await keeper.flush(start + WRITE_EVERY_MS)
  expect(store.writes.length).toBe(2)
  expect((store.writes[1]?.value as Lifetime).operations).toBe(10)

  // Nothing new: nothing written.
  await keeper.flush(start + 3 * WRITE_EVERY_MS)
  expect(store.writes.length).toBe(2)
})

test('lifetime C10: the end of the session flushes what is pending', async () => {
  const store = fakeStore()
  const keeper = await keeperOn(store)
  const start = at(20)

  await keeper.record({ kind: 'compaction' }, start)
  await keeper.record({ kind: 'turn', cls: 'guerreiro', durationMs: 9_000 }, start + 1_000)
  expect(store.writes.length).toBe(1)

  await keeper.flush(start + 1_500, true)
  expect(store.writes.length).toBe(2)

  const next = await keeperOn(store)
  expect(next.current().tasks.guerreiro).toBe(1)
  expect(next.current().timeMs).toBe(9_000)
})

test('lifetime C11: an unreadable or newer record is never overwritten', async () => {
  const broken = fakeStore()
  broken.get = async () => {
    throw new Error('store is down')
  }
  const unreadable = await keeperOn(broken)
  await unreadable.record({ kind: 'compaction' }, at(20))
  await unreadable.flush(at(20), true)
  await unreadable.reset(at(20))
  expect(broken.writes.length).toBe(0)

  const newer = fakeStore({ [LIFETIME_KEY]: { ...full, version: 2, extra: { tokens: 99 } } })
  const keeper = await keeperOn(newer)
  expect(keeper.current().bugs).toBe(9)
  await keeper.record({ kind: 'compaction' }, at(21))
  await keeper.flush(at(21), true)
  await keeper.reset(at(21))
  expect(newer.writes.length).toBe(0)
  expect((newer.data.get(LIFETIME_KEY) as { extra: unknown }).extra).toEqual({ tokens: 99 })

  // A store that refuses a write loses nothing: the next window tries again.
  const flaky = fakeStore()
  const set = flaky.set
  flaky.set = async () => {
    throw new Error('disk full')
  }
  const retry = await keeperOn(flaky)
  await retry.record({ kind: 'compaction' }, at(20))
  flaky.set = set
  await retry.flush(at(20) + WRITE_EVERY_MS)
  expect(flaky.writes.length).toBe(1)
  expect((flaky.writes[0]?.value as Lifetime).compactions).toBe(1)
})

test('lifetime C12: stats text lists every total within 40 columns', async () => {
  const text = statsText(full, '2026-10-20')

  expect(text).toContain('Primeiro dia: 01/10/2026')
  expect(text).toContain('Último dia: 20/10/2026')
  expect(text).toContain('Dias de uso: 12')
  expect(text).toContain('Sequência: 3 dias (melhor: 7)')
  expect(text).toContain('Tarefas: 41')
  expect(text).toContain('Mago: 10')
  expect(text).toContain('Guerreiro: 25')
  expect(text).toContain('Explorador: 6')
  expect(text).toContain('Bugs derrotados: 9')
  expect(text).toContain('Melhor combo: x14')
  expect(text).toContain('Operações: 812')
  expect(text).toContain('Tempo total: 14h05')
  expect(text).toContain('Compactações: 3')
  for (const line of text.split('\n')) expect(line.length, line).toBeLessThanOrEqual(40)

  expect(statsText({ ...full, streak: 1, bestStreak: 1 }, '2026-10-20')).toContain('Sequência: 1 dia (melhor: 1)')
  for (const line of statsText({ ...full, tasks: { mago: 99999, guerreiro: 99999, explorador: 99999 }, operations: 9999999, timeMs: 9999 * 3_600_000 }, '2026-10-20').split('\n')) {
    expect(line.length, line).toBeLessThanOrEqual(40)
  }
  for (const line of resetText().split('\n')) expect(line.length, line).toBeLessThanOrEqual(40)
})

test('lifetime C13: stats text with no totals says so', async () => {
  expect(statsText(emptyLifetime(), '2026-10-20')).toContain('Ainda sem totais')
})

test('lifetime C14: reset zeroes the totals and leaves the XP alone', async () => {
  const guild = { ...emptyGuild(), mago: { xp: 500 } }
  const store = fakeStore({ 'guild.v1': guild, [LIFETIME_KEY]: full })
  const keeper = await keeperOn(store)
  expect(keeper.current().days).toBe(12)

  await keeper.reset(at(20))

  expect(keeper.current()).toEqual(emptyLifetime())
  expect(store.writes.length).toBe(1)
  expect(store.writes[0]?.key).toBe(LIFETIME_KEY)
  expect(store.writes[0]?.value).toEqual(emptyLifetime())
  expect(store.data.get('guild.v1')).toEqual(guild)

  const text = resetText()
  expect(text).toContain('Totais zerados')
  expect(text).toContain('O XP e os níveis não foram alterados')

  // It starts again from the next use.
  await keeper.record({ kind: 'turn', cls: 'mago', durationMs: 1_000 }, at(21))
  expect(keeper.current().firstDay).toBe('2026-10-21')
  expect(keeper.current().days).toBe(1)
})

test('lifetime C15: an unknown stats argument changes nothing', async () => {
  expect(statsRequest('stats')).toBe('show')
  expect(statsRequest('stats ')).toBe('show')
  expect(statsRequest('stats reset')).toBe('reset')
  expect(statsRequest('stats   reset')).toBe('reset')
  expect(statsRequest('stats zerar')).toBe('invalid')
  expect(statsRequest('stats reset tudo')).toBe('invalid')
  expect(statsRequest('statsx')).toBe(undefined)
  expect(statsRequest('panel')).toBe(undefined)
  expect(statsRequest('')).toBe(undefined)
})
