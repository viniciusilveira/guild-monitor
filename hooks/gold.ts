import type { GoldLine } from '../types'
import type { TaskClass } from './classify'
import { CLASSES } from './xp'

// What each class "spent" of the session's cost: an estimate kept in memory with the tracker, shown on the panel
// and never saved. Everything here is pure, and the money is whole micro-dollars so the parts add up exactly.

export type Gold = {
  // The last valid measurement and the one the split began at (the first measurement, or the last restart), in
  // micro-dollars; null before the first measurement.
  last: number | null
  base: number
  // What each class spent since the base: the three always add up to `last - base`.
  spent: Record<TaskClass, number>
  // The operations that finished since the last valid measurement, by class: the interval's weights.
  ops: Record<TaskClass, number>
}

const NONE = { mago: 0, guerreiro: 0, explorador: 0 } as const

export const NO_GOLD: Gold = { last: null, base: 0, spent: NONE, ops: NONE }

// Beyond this many dollars a reading is not a cost: it is ignored, so no sum leaves the exact integers.
export const MAX_USD = 1e9

// More operations than this in one interval stop counting: the proportions are all the sum needs.
const MAX_OPS = 1e6

// The cost in whole micro-dollars; null for what is not a cost (absent, NaN, negative, infinite, not a number,
// too big).
export const microsOf = (usd: unknown): number | null =>
  typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 && usd <= MAX_USD ? Math.round(usd * 1e6) : null

const restart = (micros: number): Gold => ({ last: micros, base: micros, spent: NONE, ops: NONE })

// An operation of the main agent that finished: it weighs on the class that did it in the next measurement.
export const goldOperation = (gold: Gold, cls: TaskClass): Gold => ({
  ...gold,
  ops: { ...gold.ops, [cls]: Math.min(gold.ops[cls] + 1, MAX_OPS) },
})

// `delta` micro-dollars shared out by the operations of each class, each part exact; what the division leaves
// goes to the class with the most operations, a tie to the first in the order of the classes.
const share = (delta: number, ops: Record<TaskClass, number>): Record<TaskClass, number> => {
  const total = CLASSES.reduce((sum, cls) => sum + ops[cls], 0)
  const whole = Math.floor(delta / total)
  const rest = delta % total
  const parts = Object.fromEntries(CLASSES.map(cls => [cls, whole * ops[cls] + Math.floor((rest * ops[cls]) / total)])) as Record<TaskClass, number>
  const left = delta - CLASSES.reduce((sum, cls) => sum + parts[cls], 0)
  const heaviest = CLASSES.reduce((best, cls) => (ops[cls] > ops[best] ? cls : best))

  return { ...parts, [heaviest]: parts[heaviest] + left }
}

// What an interval looks like at the moment a reading of the cost is asked for: the operations that finished so far
// and the class active then. The reading arrives later, and what happens while it is on its way belongs to the
// interval that follows it.
export type Interval = { ops: Record<TaskClass, number>; active: TaskClass }

export const intervalOf = (gold: Gold, active: TaskClass): Interval => ({ ops: gold.ops, active })

// A measurement of the cost closes the interval since the last one, as `taken` (the operations) and `active` saw it;
// by default the operations are those so far.
// The change goes to the classes of the operations that ran in it, in proportion to their number, or to the active
// class when none did; operations that finished after `taken` stay for the next interval. The first measurement is
// only the base; a cost that did not change attributes nothing; a lower one is a session that began again
// (`/clear`): the split starts over; what is not a cost changes nothing at all.
export const goldMeasured = (gold: Gold, usd: unknown, active: TaskClass, taken: Record<TaskClass, number> = gold.ops): Gold => {
  const micros = microsOf(usd)
  if (micros === null) return gold

  // Only operations still waiting count as the interval's: a measurement in between may have closed some already.
  const weights = Object.fromEntries(CLASSES.map(cls => [cls, Math.min(taken[cls], gold.ops[cls])])) as Record<TaskClass, number>
  const later = Object.fromEntries(CLASSES.map(cls => [cls, gold.ops[cls] - weights[cls]])) as Record<TaskClass, number>

  if (gold.last === null || micros < gold.last) return { ...restart(micros), ops: later }
  if (micros === gold.last) return { ...gold, ops: later }

  const delta = micros - gold.last
  const count = CLASSES.reduce((sum, cls) => sum + weights[cls], 0)
  const parts = count === 0 ? { ...NONE, [active]: delta } : share(delta, weights)

  return {
    last: micros,
    base: gold.base,
    spent: Object.fromEntries(CLASSES.map(cls => [cls, gold.spent[cls] + parts[cls]])) as Record<TaskClass, number>,
    ops: later,
  }
}

export const goldTotal = (gold: Gold): number => CLASSES.reduce((sum, cls) => sum + gold.spent[cls], 0)

// Whole percentages that add up to 100: each part rounded down, the rest handed one by one to the biggest
// fractions, a tie to the first in the order of the classes. A zero total is 0% for all.
export const percentsOf = (micros: Record<TaskClass, number>): Record<TaskClass, number> => {
  const total = CLASSES.reduce((sum, cls) => sum + BigInt(micros[cls]), 0n)
  if (total === 0n) return { mago: 0, guerreiro: 0, explorador: 0 }

  const exact = CLASSES.map(cls => ({ cls, floor: (BigInt(micros[cls]) * 100n) / total, fraction: (BigInt(micros[cls]) * 100n) % total }))
  let left = 100 - exact.reduce((sum, item) => sum + Number(item.floor), 0)
  const result = Object.fromEntries(exact.map(item => [item.cls, Number(item.floor)])) as Record<TaskClass, number>
  const byFraction = [...exact].sort((a, b) => (a.fraction === b.fraction ? 0 : a.fraction > b.fraction ? -1 : 1))

  for (const item of byFraction) {
    if (left <= 0) break
    result[item.cls] += 1
    left -= 1
  }

  return result
}

// The lines the panel shows, in the order of the classes; null while nothing was split yet.
export const goldLines = (gold: Gold): GoldLine[] | null => {
  if (goldTotal(gold) === 0) return null

  const percents = percentsOf(gold.spent)

  return CLASSES.map(cls => ({ cls, micros: gold.spent[cls], percent: percents[cls] }))
}

// "1.20": dollars and cents, written like the `ouro` line's (`costText`), the cents rounded from the micro-dollars.
export const moneyText = (micros: number): string => {
  const cents = Math.round(micros / 10_000)

  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

const NAMES: Record<TaskClass, string> = { mago: 'Mago', guerreiro: 'Guerreiro', explorador: 'Explorador' }

// The three lines in the longest form that fits `width` columns (the same form for all, so they line up), or null
// when not even the shortest does: the lines are then left out whole.
export const goldTexts = (lines: readonly GoldLine[], width: number): string[] | null => {
  const forms: ((line: GoldLine) => string)[] = [
    line => `${NAMES[line.cls]} ~$${moneyText(line.micros)} (${line.percent}%)`,
    line => `${NAMES[line.cls]} ~$${moneyText(line.micros)} ${line.percent}%`,
    line => `${NAMES[line.cls].slice(0, 3)} ~$${moneyText(line.micros)} ${line.percent}%`,
    line => `~$${moneyText(line.micros)} ${line.percent}%`,
  ]

  for (const form of forms) {
    const texts = lines.map(form)
    if (texts.every(text => text.length <= width)) return texts
  }

  return null
}

// The dim caption under the lines when the split began after the session had already cost something.
export const GOLD_PARTIAL_NOTE = 'desde a abertura'
