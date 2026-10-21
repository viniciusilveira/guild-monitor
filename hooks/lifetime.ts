import type { TaskClass } from './classify'
import { durationText, NAMES } from './view'
import { CLASSES } from './xp'

// The lifetime totals: what the person did with the guild across sessions, kept in a record of its own,
// separate from the XP (`guild.v1`), so a read that fails in one never wipes the other. Counters and dates
// only: nothing here ever holds a prompt, a reply, a command, a path (nor a file fingerprint) or a task's text.
//
// Decisions that cannot be taken back, because they live in the store of every machine:
//  1. The key is `guild.lifetime.v1`. The `v1` in it is the key's generation, which a rewrite that breaks
//     everything would change; the `version` inside the record is what grows with ordinary additions.
//  2. The record is `{ version, firstDay, lastDay, days, streak, bestStreak, tasks, bugs, bestCombo, operations,
//     timeMs, compactions }`, the days as local `YYYY-MM-DD` text (an instant would depend on the zone of whoever
//     reads it). To extend it: add the field to `Lifetime`, to `emptyLifetime`, to `parseLifetime` (it reads field
//     by field, so an old record without the field starts it from zero) and to the event that feeds it. Raise
//     `LIFETIME_VERSION` only when an old reader would misread the new record.
//  3. A record whose `version` is above `LIFETIME_VERSION` was written by a newer plugin: it is read for the
//     fields known here and then never written again, so an older plugin does not erase what it cannot see.
//  4. Writes are batched: at most one every `WRITE_EVERY_MS`, forced only at the end of the session and by reset.
export const LIFETIME_KEY = 'guild.lifetime.v1'
export const LIFETIME_VERSION = 1
export const WRITE_EVERY_MS = 5_000

export type Lifetime = {
  version: number
  // The local days (`YYYY-MM-DD`) of the first and of the last use; null before any.
  firstDay: string | null
  lastDay: string | null
  // How many different days had use, and the run of consecutive days ending at `lastDay` (and the best run).
  days: number
  streak: number
  bestStreak: number
  // Turns the main agent answered, by the class that was on stage.
  tasks: Record<TaskClass, number>
  bugs: number
  bestCombo: number
  operations: number
  // The sum of the main agent's turns, as the engine reported their durations.
  timeMs: number
  compactions: number
}

export const emptyLifetime = (): Lifetime => ({
  version: LIFETIME_VERSION,
  firstDay: null,
  lastDay: null,
  days: 0,
  streak: 0,
  bestStreak: 0,
  tasks: { mago: 0, guerreiro: 0, explorador: 0 },
  bugs: 0,
  bestCombo: 0,
  operations: 0,
  timeMs: 0,
  compactions: 0,
})

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// Days since the epoch of a `YYYY-MM-DD` text, or null when it is not a real calendar day.
const dayNumber = (day: string): number | null => {
  const match = DAY.exec(day)
  if (match === null) return null

  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const ms = Date.UTC(year, month - 1, date)
  const back = new Date(ms)

  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === date ? ms / 86_400_000 : null
}

// The local day of an instant, as `YYYY-MM-DD`. `offsetMinutes` is what `Date#getTimezoneOffset` says for the
// zone (positive west of UTC); by default the machine's own at that very instant.
export const dayOf = (ms: number, offsetMinutes: number = new Date(ms).getTimezoneOffset()): string =>
  new Date(ms - offsetMinutes * 60_000).toISOString().slice(0, 10)

// A counter that is a sane number: a whole, non-negative value that sums without losing digits (anything else, a
// huge figure included, is as tampered as a text and starts from zero).
const count = (value: unknown): number => {
  const whole = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

  return Number.isSafeInteger(whole) ? whole : 0
}

const dayOrNull = (value: unknown): string | null => (typeof value === 'string' && dayNumber(value) !== null ? value : null)

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

// What the store hands back is JSON anyone could have edited: keep each field that is sane and start the rest
// from zero (a day from nothing), the same way `parseGuild` does for the XP.
export const parseLifetime = (stored: unknown): Lifetime => {
  const record = recordOf(stored)
  const lifetime = emptyLifetime()
  if (record === undefined) return lifetime

  const first = dayOrNull(record.firstDay)
  const last = dayOrNull(record.lastDay)
  const tasks = recordOf(record.tasks)
  const streak = count(record.streak)

  return {
    ...lifetime,
    // One day known stands for the other: otherwise the next use would count the same day again.
    firstDay: first ?? last,
    lastDay: last ?? first,
    days: count(record.days),
    streak,
    bestStreak: Math.max(count(record.bestStreak), streak),
    tasks: { mago: count(tasks?.mago), guerreiro: count(tasks?.guerreiro), explorador: count(tasks?.explorador) },
    bugs: count(record.bugs),
    bestCombo: count(record.bestCombo),
    operations: count(record.operations),
    timeMs: count(record.timeMs),
    compactions: count(record.compactions),
  }
}

// The version a stored record claims; a record without a usable one is read as the current.
const versionOf = (stored: unknown): number => {
  const version = recordOf(stored)?.version

  return typeof version === 'number' && Number.isFinite(version) && version >= 1 ? Math.floor(version) : LIFETIME_VERSION
}

// Use on `day`: a new day counts, and extends the run when it follows the last one or starts it over when a day
// was skipped. The same day, or one before the last (a clock set back), changes nothing.
const onDay = (lifetime: Lifetime, day: string): Lifetime => {
  const today = dayNumber(day)
  if (today === null) return lifetime
  if (lifetime.lastDay === null) return { ...lifetime, firstDay: day, lastDay: day, days: 1, streak: 1, bestStreak: Math.max(lifetime.bestStreak, 1) }

  const last = dayNumber(lifetime.lastDay)
  if (last === null || today <= last) return lifetime

  const streak = today - last === 1 ? lifetime.streak + 1 : 1

  return { ...lifetime, lastDay: day, days: lifetime.days + 1, streak, bestStreak: Math.max(lifetime.bestStreak, streak) }
}

// What feeds the totals: numbers and a class, nothing else.
export type LifetimeEvent =
  // An operation of the main agent that finished (not a refused one): `defeated` when it took a bug down, and
  // the best combo of the session so far.
  | { kind: 'operation'; defeated: boolean; bestCombo: number }
  // A turn of the main agent ended: `cls` is the class that answered it, or null when it was interrupted.
  | { kind: 'turn'; cls: TaskClass | null; durationMs: number }
  | { kind: 'compaction' }

const apply = (lifetime: Lifetime, event: LifetimeEvent): Lifetime => {
  if (event.kind === 'compaction') return { ...lifetime, compactions: lifetime.compactions + 1 }

  if (event.kind === 'operation') {
    return {
      ...lifetime,
      operations: lifetime.operations + 1,
      bugs: lifetime.bugs + (event.defeated === true ? 1 : 0),
      bestCombo: Math.max(lifetime.bestCombo, count(event.bestCombo)),
    }
  }

  const known = CLASSES.find(cls => cls === event.cls)

  return {
    ...lifetime,
    tasks: known === undefined ? lifetime.tasks : { ...lifetime.tasks, [known]: lifetime.tasks[known] + 1 },
    timeMs: lifetime.timeMs + count(event.durationMs),
  }
}

// The run of days as it stands on `today`: broken (zero) once a whole day passed without use.
export const currentStreak = (lifetime: Lifetime, today: string): number => {
  const last = lifetime.lastDay === null ? null : dayNumber(lifetime.lastDay)
  const now = dayNumber(today)

  return last === null || now === null || now - last > 1 ? 0 : lifetime.streak
}

const dateText = (day: string | null): string => {
  const match = day === null ? null : DAY.exec(day)

  return match === null ? '--' : `${match[3]}/${match[2]}/${match[1]}`
}

const daysText = (n: number): string => `${n} ${n === 1 ? 'dia' : 'dias'}`

const isEmpty = (lifetime: Lifetime): boolean => JSON.stringify(lifetime) === JSON.stringify(emptyLifetime())

// The text of `/guild stats`, in lines of 40 columns at most (the panel is narrow).
export const statsText = (lifetime: Lifetime, today: string): string => {
  if (isEmpty(lifetime)) return 'Ainda sem totais. Eles aparecem\ndepois do primeiro turno de trabalho.'

  const tasks = CLASSES.reduce((sum, cls) => sum + lifetime.tasks[cls], 0)

  return [
    'Totais da guilda (só nesta máquina)',
    `Primeiro dia: ${dateText(lifetime.firstDay)}`,
    `Último dia: ${dateText(lifetime.lastDay)}`,
    `Dias de uso: ${lifetime.days}`,
    `Sequência: ${daysText(currentStreak(lifetime, today))} (melhor: ${lifetime.bestStreak})`,
    `Tarefas: ${tasks}`,
    ...CLASSES.map(cls => `  ${NAMES[cls]}: ${lifetime.tasks[cls]}`),
    `Bugs derrotados: ${lifetime.bugs}`,
    `Melhor combo: x${lifetime.bestCombo}`,
    `Operações: ${lifetime.operations}`,
    `Tempo total: ${durationText(lifetime.timeMs)}`,
    `Compactações: ${lifetime.compactions}`,
  ].join('\n')
}

export const resetText = (): string =>
  ['Totais zerados: dias, sequências,', 'tarefas, bugs, combo, operações, tempo', 'e compactações.', 'O XP e os níveis não foram alterados.'].join('\n')

export const resetRefusedText = (): string => ['Não zerei os totais: o registro', 'não pôde ser lido ou é de uma versão', 'mais nova. Nada foi alterado.'].join('\n')

export const STATS_USAGE = 'Use /guild stats | stats reset'

export type StatsRequest = 'show' | 'reset' | 'invalid'

// What follows `/guild`: undefined when it is not about the totals, else what was asked.
export const statsRequest = (args: string): StatsRequest | undefined => {
  const words = args.trim().toLowerCase().split(/\s+/)
  if (words[0] !== 'stats') return undefined
  if (words.length === 1) return 'show'

  return words.length === 2 && words[1] === 'reset' ? 'reset' : 'invalid'
}

type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }

export type Keeper = {
  // Reads the record. One that cannot be read, or that is newer than this plugin knows, is never written.
  load: () => Promise<void>
  // Applies an event at `now` (an instant, from the injected clock) and writes if the window allows.
  record: (event: LifetimeEvent, now: number) => Promise<void>
  // Writes what is pending when the window since the last write has passed, or at once with `force`.
  flush: (now: number, force?: boolean) => Promise<void>
  // Zeroes the totals and writes at once; false (nothing changed) when the record is not writable.
  reset: (now: number) => Promise<boolean>
  current: () => Lifetime
  // The local day of an instant.
  dayAt: (now: number) => string
}

export const createKeeper = (store: Store, options: { offsetMinutes?: (ms: number) => number } = {}): Keeper => {
  let lifetime = emptyLifetime()
  let isWritable = true
  let isDirty = false
  let lastWriteAt: number | null = null

  const dayAt = (now: number): string => dayOf(now, options.offsetMinutes?.(now))

  const flush = async (now: number, force = false): Promise<void> => {
    if (!isWritable || !isDirty) return
    if (!force && lastWriteAt !== null && now - lastWriteAt < WRITE_EVERY_MS) return

    lastWriteAt = now
    try {
      await store.set(LIFETIME_KEY, lifetime)
      isDirty = false
    } catch {
      // The totals stay pending: the next window tries again.
      isDirty = true
    }
  }

  return {
    load: async () => {
      try {
        const stored = await store.get(LIFETIME_KEY)
        lifetime = parseLifetime(stored)
        isWritable = versionOf(stored) <= LIFETIME_VERSION
      } catch {
        lifetime = emptyLifetime()
        isWritable = false
      }
      isDirty = false
      lastWriteAt = null
    },
    record: async (event, now) => {
      if (!Number.isFinite(now)) return

      lifetime = apply(onDay(lifetime, dayAt(now)), event)
      isDirty = true
      await flush(now)
    },
    flush,
    reset: async now => {
      if (!isWritable) return false

      lifetime = emptyLifetime()
      isDirty = true
      await flush(now, true)

      return true
    },
    current: () => lifetime,
    dayAt,
  }
}
