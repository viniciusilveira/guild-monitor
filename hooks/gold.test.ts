import { expect, test } from 'claude-code/testing'

import type { TaskClass } from './classify'
import type { Gold } from './gold'
import { goldLines, goldMeasured, goldOperation, goldTexts, goldTotal, MAX_USD, microsOf, moneyText, NO_GOLD, percentsOf } from './gold'
import { CLASSES } from './xp'

const micros = (usd: number) => Math.round(usd * 1e6)
const sum = (gold: Gold) => CLASSES.reduce((total, cls) => total + gold.spent[cls], 0)

// Operations of the interval, then the measurement, with the class that is active at that moment.
const step = (gold: Gold, usd: unknown, ops: readonly TaskClass[] = [], active: TaskClass = 'explorador'): Gold =>
  goldMeasured(ops.reduce(goldOperation, gold), usd, active)

const spentOf = (gold: Gold) => [gold.spent.mago, gold.spent.guerreiro, gold.spent.explorador]

test('gold C1: a change is split by the number of operations of each class', async () => {
  const base = step(NO_GOLD, 1)
  const gold = step(base, 5, ['mago', 'guerreiro', 'guerreiro', 'guerreiro'])

  expect(spentOf(gold)).toEqual([micros(1), micros(3), 0])
  // Another proportion, so the rule cannot be "everything to the class with most operations".
  expect(spentOf(step(base, 5, ['mago', 'mago', 'guerreiro', 'explorador']))).toEqual([micros(2), micros(1), micros(1)])
})

test('gold C2: a single class with operations gets everything even when another is active', async () => {
  const base = step(NO_GOLD, 1)

  for (const cls of CLASSES) {
    const active = CLASSES.find(other => other !== cls) ?? 'mago'
    const gold = step(base, 3, [cls, cls], active)

    expect(gold.spent[cls]).toBe(micros(2))
    expect(sum(gold)).toBe(micros(2))
  }
})

test('gold C3: with no operation the change goes to the active class, measurement after measurement', async () => {
  let gold = step(NO_GOLD, 1)
  gold = step(gold, 3, [], 'mago')
  gold = step(gold, 4, [], 'guerreiro')
  gold = step(gold, 4.5, [], 'explorador')
  gold = step(gold, 5.5, [], 'mago')

  expect(spentOf(gold)).toEqual([micros(3), micros(1), micros(0.5)])
})

test('gold C4: tied classes share a change and the residue goes to the first in order', async () => {
  const base = step(NO_GOLD, 1)
  const gold = step(base, 1.000003, ['guerreiro', 'explorador'])

  expect(sum(gold)).toBe(3)
  expect(spentOf(gold)).toEqual([0, 2, 1])
  // A tie of three: 1 micro-dollar goes to the first in order, the Mage.
  expect(spentOf(step(base, 1.000001, ['explorador', 'mago', 'guerreiro']))).toEqual([1, 0, 0])
  // A residue goes to the class with more operations, not to the first in order.
  expect(spentOf(step(base, 1.000001, ['explorador', 'guerreiro', 'guerreiro']))).toEqual([0, 1, 0])
})

// A small generator with a seed, so a failure repeats.
const lcg = (seed: number) => {
  let state = seed
  return (n: number) => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296

    return Math.floor((state / 4_294_967_296) * n)
  }
}

test('gold C5: the sum per class is always the last cost minus the base, over many sequences', async () => {
  const INVALID = [null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY, '3', MAX_USD + 1]

  let wrong = 0

  for (let seed = 1; seed <= 300; seed += 1) {
    const next = lcg(seed)
    let gold = NO_GOLD
    let cost = next(5000) / 1000
    let ref: { base: number; last: number } | null = null

    for (let i = 0; i < 40; i += 1) {
      const ops: TaskClass[] = Array.from({ length: next(4) }, () => CLASSES[next(3)] ?? 'mago')
      const move = next(10)
      let reading: unknown = cost

      if (move < 5) reading = cost += next(3000) / 1000 + (next(2) === 0 ? 0 : 0.1 + 0.2 - 0.3)
      else if (move === 5) reading = cost = Math.max(0, cost - next(4000) / 1000)
      else if (move === 6) reading = INVALID[next(INVALID.length)]

      gold = step(gold, reading, ops, CLASSES[next(3)] ?? 'mago')

      const m = typeof reading === 'number' && Number.isFinite(reading) && reading >= 0 && reading <= MAX_USD ? Math.round(reading * 1e6) : null
      if (m !== null) {
        ref = ref === null || m < ref.last ? { base: m, last: m } : { base: ref.base, last: m }
      }

      const whole = CLASSES.every(cls => Number.isInteger(gold.spent[cls]) && gold.spent[cls] >= 0)
      const marks = ref === null ? gold.last === null : gold.last === ref.last && gold.base === ref.base
      if (sum(gold) !== (ref === null ? 0 : ref.last - ref.base) || goldTotal(gold) !== sum(gold) || !whole || !marks) wrong += 1
    }
  }

  expect(wrong).toBe(0)
})

test('gold C6: floating point costs add up exactly in micro-dollars', async () => {
  let gold = step(NO_GOLD, 0.1)
  gold = step(gold, 0.3, ['mago', 'guerreiro', 'explorador'])
  gold = step(gold, 0.30000000000000004, ['mago'])
  gold = step(gold, 0.30000000000000004 + 0.01, ['mago', 'guerreiro', 'explorador'])

  expect(sum(gold)).toBe(micros(0.31) - micros(0.1))
  expect(spentOf(gold)).toEqual([70_002, 69_999, 69_999])
})

test('gold C7: an unchanged cost attributes nothing and drops the interval operations', async () => {
  const base = step(NO_GOLD, 2)
  const same = step(base, 2, ['guerreiro', 'guerreiro'])

  expect(spentOf(same)).toEqual([0, 0, 0])
  // The operations of the unchanged interval do not count in the next one: no operation, so the active class.
  expect(spentOf(step(same, 3, [], 'mago'))).toEqual([micros(1), 0, 0])
  // The same sequence in one go ends up with the warrior, which tells the two apart.
  expect(spentOf(step(step(base, 2.5, ['guerreiro'], 'mago'), 2.5, [], 'mago'))).toEqual([0, micros(0.5), 0])
})

test('gold C8: operations with no later measurement attribute nothing yet', async () => {
  const gold = step(step(NO_GOLD, 2), undefined, ['mago', 'guerreiro', 'explorador'])

  expect(spentOf(gold)).toEqual([0, 0, 0])
  expect(goldLines(gold)).toBe(null)
  // They stay counted for the next valid measurement.
  expect(spentOf(step(gold, 3, [], 'mago'))).toEqual([333_334, 333_333, 333_333])
})

test('gold C9: the first measurement is only the base', async () => {
  const first = step(NO_GOLD, 5, ['mago', 'guerreiro'], 'mago')

  expect(spentOf(first)).toEqual([0, 0, 0])
  expect(first.last).toBe(micros(5))
  expect(first.base).toBe(micros(5))
  expect(goldLines(first)).toBe(null)
  expect(spentOf(step(first, 5.5, [], 'guerreiro'))).toEqual([0, micros(0.5), 0])
})

test('gold C10: a lower cost zeroes the split and rebases', async () => {
  const split = step(step(NO_GOLD, 1), 5, ['mago'])
  expect(sum(split)).toBe(micros(4))

  const cleared = step(split, 0.4, ['guerreiro'])
  expect(spentOf(cleared)).toEqual([0, 0, 0])
  expect(cleared.base).toBe(micros(0.4))
  expect(cleared.last).toBe(micros(0.4))
  expect(goldLines(cleared)).toBe(null)

  // From the new base: only what comes after counts.
  expect(spentOf(step(cleared, 1.4, ['explorador']))).toEqual([0, 0, micros(1)])
})

test('gold C11: an invalid measurement is ignored whole', async () => {
  const gold = step(step(NO_GOLD, 1), 2, ['mago'])
  const invalid = [undefined, null, Number.NaN, -0.01, Number.POSITIVE_INFINITY, '3', MAX_USD + 1]
  expect(invalid.length).toBe(7)

  for (const value of invalid) {
    // The same state comes back: the base, the split and the operations waiting for the next valid measurement.
    expect(goldMeasured(gold, value, 'explorador')).toBe(gold)
    expect(microsOf(value)).toBe(null)
  }

  const pending = goldOperation(gold, 'guerreiro')
  expect(goldMeasured(pending, Number.NaN, 'mago')).toBe(pending)
  // The Mage's $1.00 from before is still there; the new $1.00 goes to the warrior, whose operation waited.
  expect(spentOf(step(pending, 3, [], 'mago'))).toEqual([micros(1), micros(1), 0])
})

test('gold C12: a huge cost splits exactly', async () => {
  const base = step(NO_GOLD, 0)
  const gold = step(base, MAX_USD, ['mago', 'guerreiro', 'guerreiro', 'explorador', 'explorador', 'explorador', 'explorador'])

  expect(sum(gold)).toBe(micros(MAX_USD))
  expect(gold.spent.explorador).toBeGreaterThan(gold.spent.guerreiro)
  expect(gold.spent.guerreiro).toBeGreaterThan(gold.spent.mago)
  expect(microsOf(MAX_USD)).toBe(1e15)
  expect(microsOf(MAX_USD + 1)).toBe(null)
  expect(goldMeasured(gold, MAX_USD + 1, 'mago')).toBe(gold)
  // Back to a small cost: nothing stays from the huge one.
  expect(sum(step(gold, 1, ['mago']))).toBe(0)
})

test('gold C15: percentages add up to 100, a single class has 100% and a zero total has 0%', async () => {
  const of = (mago: number, guerreiro: number, explorador: number) => percentsOf({ mago, guerreiro, explorador })
  const totalOf = (p: Record<TaskClass, number>) => p.mago + p.guerreiro + p.explorador

  expect(of(1, 1, 1)).toEqual({ mago: 34, guerreiro: 33, explorador: 33 })
  expect(of(1_200_000, 1_710_000, 510_000)).toEqual({ mago: 35, guerreiro: 50, explorador: 15 })
  expect(of(0, 7, 0)).toEqual({ mago: 0, guerreiro: 100, explorador: 0 })
  expect(of(0, 0, 0)).toEqual({ mago: 0, guerreiro: 0, explorador: 0 })
  // 12.5 / 12.5 / 75: the two halves tie on the rest, the first in order wins.
  expect(of(1, 1, 6)).toEqual({ mago: 13, guerreiro: 12, explorador: 75 })
  expect(of(333_333_333_333_333, 333_333_333_333_333, 333_333_333_333_334)).toEqual({ mago: 33, guerreiro: 33, explorador: 34 })

  const next = lcg(7)
  for (let i = 0; i < 500; i += 1) {
    const p = of(next(1_000_000) + 1, next(1_000_000), next(1_000_000))

    expect(totalOf(p)).toBe(100)
  }
})

test('gold C16: lines are written in the longest form that fits every class', async () => {
  const gold = step(step(NO_GOLD, 0), 3.42, [])
  const lines = [
    { cls: 'mago' as const, micros: 1_200_000, percent: 35 },
    { cls: 'guerreiro' as const, micros: 1_710_000, percent: 50 },
    { cls: 'explorador' as const, micros: 510_000, percent: 15 },
  ]
  expect(goldLines(gold)).not.toBe(null)

  expect(goldTexts(lines, 60)).toEqual(['Mago ~$1,20 (35%)', 'Guerreiro ~$1,71 (50%)', 'Explorador ~$0,51 (15%)'])
  expect(goldTexts(lines, 22)).toEqual(['Mago ~$1,20 35%', 'Guerreiro ~$1,71 50%', 'Explorador ~$0,51 15%'])
  expect(goldTexts(lines, 20)).toEqual(['Mag ~$1,20 35%', 'Gue ~$1,71 50%', 'Exp ~$0,51 15%'])
  expect(goldTexts(lines, 10)).toEqual(['~$1,20 35%', '~$1,71 50%', '~$0,51 15%'])
  expect(goldTexts(lines, 9)).toBe(null)

  // A figure too big for the width takes the lines away whole, never a part of them.
  const big = lines.map(line => ({ ...line, micros: 123_456_789_000_000 }))
  expect(goldTexts(big, 17)).toBe(null)
  expect(goldTexts(big, 20)).toEqual(['~$123456789,00 35%', '~$123456789,00 50%', '~$123456789,00 15%'])
  expect(goldTexts(big, 60)?.[0]).toBe('Mago ~$123456789,00 (35%)')
  for (const width of [10, 14, 16, 18, 20, 24, 40, 60]) {
    for (const text of goldTexts(big, width) ?? []) expect(text.length).toBeLessThanOrEqual(width)
  }

  expect(moneyText(1_200_000)).toBe('1,20')
  expect(moneyText(5_000)).toBe('0,01')
  expect(moneyText(4_999)).toBe('0,00')
  expect(moneyText(999_999)).toBe('1,00')
  expect(moneyText(0)).toBe('0,00')
})
