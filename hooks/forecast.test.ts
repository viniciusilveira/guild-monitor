import { expect, test } from 'claude-code/testing'

import type { Forecast, Series, WindowKind } from './forecast'
import { addSample, EMPTY_HISTORY, EMPTY_SERIES, forecastOf, forecastText, recordReadings, roundUp5 } from './forecast'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = 1_700_000_000_000
const at = (minutes: number) => T0 + minutes * MIN

// A series built the way the plugin builds it: one reading after the other.
const build = (points: ReadonlyArray<readonly [number, number]>, resetsAt?: string, from: Series = EMPTY_SERIES, kind: WindowKind = 'five_hour'): Series =>
  points.reduce((series, [minutes, used]) => addSample(series, { at: at(minutes), used, resetsAt }, kind), from)

const resetIn = (minutes: number) => new Date(at(minutes)).toISOString()

const text = (forecast: Forecast, kind: 'five_hour' | 'seven_day' = 'five_hour') => forecastText(forecast, kind)

test('forecast C1: constant pace gives 2h05 and is urgent before the reset', () => {
  // 2 points every 5 min, 40% to 50%: 0.4 points a minute, 50 points left are 125 minutes.
  const series = build([[0, 40], [5, 42], [10, 44], [15, 46], [20, 48], [25, 50]], resetIn(180))
  const forecast = forecastOf(series, at(25), 'five_hour')

  expect(forecast).toEqual({ kind: 'runs', ms: 125 * MIN, urgent: true })
  expect(text(forecast)).toBe('esgota em ~2h05')
})

test('forecast C2: an accelerating series forecasts less later, from the average slope', () => {
  // The pace of each 5 minutes goes 1, 2, 4, 8 points.
  const points = [[0, 40], [5, 41], [10, 43], [15, 47], [20, 55]] as const
  const early = forecastOf(build(points.slice(0, 4)), at(15), 'five_hour')
  const late = forecastOf(build(points), at(20), 'five_hour')

  // 7 points in 15 min leave 53 points: 113.6 min up to 115. 15 points in 20 min leave 45: exactly 60.
  expect(early).toEqual({ kind: 'runs', ms: 115 * MIN, urgent: false })
  expect(late).toEqual({ kind: 'runs', ms: 60 * MIN, urgent: false })
  expect(text(late)).toBe('esgota em ~1h00')
})

test('forecast C3: a series at the same percent says no consumption and no number', () => {
  const series = build([[0, 40], [5, 40], [10, 40], [15, 40], [20, 40]], resetIn(200))

  expect(forecastOf(series, at(20), 'five_hour')).toEqual({ kind: 'idle' })
  expect(text({ kind: 'idle' })).toBe('sem consumo')

  // Read every 2 seconds for 20 minutes the series stays small and is just as idle.
  let dense = EMPTY_SERIES
  for (let ms = 0; ms <= 20 * MIN; ms += 2_000) dense = addSample(dense, { at: T0 + ms, used: 40, resetsAt: resetIn(200) })
  expect(dense.samples.length).toBeLessThanOrEqual(21)
  expect(forecastOf(dense, at(20), 'five_hour')).toEqual({ kind: 'idle' })
})

test('forecast C4: without enough samples, span or variation nothing is shown', () => {
  const none = { kind: 'none' }
  const rising = [[0, 40], [5, 42], [10, 44]] as const

  expect(forecastOf(EMPTY_SERIES, at(0), 'five_hour')).toEqual(none)
  expect(forecastOf(build(rising.slice(0, 1)), at(0), 'five_hour')).toEqual(none)
  expect(forecastOf(build(rising.slice(0, 2)), at(5), 'five_hour')).toEqual(none)
  // Two samples at the same percent are no evidence of an idle window either.
  expect(forecastOf(build([[0, 40], [20, 40]]), at(20), 'five_hour')).toEqual(none)
  // Three samples that cover less than 10 minutes.
  expect(forecastOf(build([[0, 40], [4, 42], [8, 44]]), at(8), 'five_hour')).toEqual(none)
  expect(forecastOf(build([[0, 40], [4, 40], [8, 40]]), at(8), 'five_hour')).toEqual(none)
  // A variation of one point in twenty minutes.
  expect(forecastOf(build([[0, 40], [10, 40], [20, 41]]), at(20), 'five_hour')).toEqual(none)
  // The edges that do show: three samples, exactly 10 minutes, exactly 2 points: 58 left at 0.2 a minute.
  expect(forecastOf(build([[0, 40], [5, 41], [10, 42]]), at(10), 'five_hour')).toEqual({ kind: 'runs', ms: 290 * MIN, urgent: false })
  // One millisecond short of 10 minutes.
  const short = addSample(build([[0, 40], [5, 41]]), { at: at(10) - 1, used: 42 })
  expect(forecastOf(short, at(10) - 1, 'five_hour')).toEqual(none)
  // The seven day window needs two hours.
  expect(forecastOf(build([[0, 40], [30, 41], [60, 42]], undefined, EMPTY_SERIES, 'seven_day'), at(60), 'seven_day')).toEqual(none)
  expect(forecastOf(build([[0, 40], [60, 41], [120, 42]], undefined, EMPTY_SERIES, 'seven_day'), at(120), 'seven_day')).toMatchObject({ kind: 'runs' })
})

test('forecast C5: repeated, backwards and invalid samples are ignored and a disordered series forecasts nothing', () => {
  const base = build([[0, 40], [5, 42]])

  for (const bad of [
    { at: at(5), used: 44 },
    { at: at(4), used: 44 },
    { at: Number.NaN, used: 44 },
    { at: Number.POSITIVE_INFINITY, used: 44 },
    { at: at(6), used: Number.NaN },
    { at: at(6), used: -1 },
    { at: at(6), used: 100.5 },
    { at: at(6), used: Number.POSITIVE_INFINITY },
  ]) {
    expect(addSample(base, bad)).toBe(base)
  }

  const sample = (minutes: number, used: number) => ({ at: at(minutes), used })
  const none = { kind: 'none' }
  const disordered: Series = { resetsAt: null, samples: [sample(0, 40), sample(10, 44), sample(5, 44), sample(15, 46)] }
  const repeated: Series = { resetsAt: null, samples: [sample(0, 40), sample(5, 42), sample(5, 43), sample(15, 46)] }
  const falling: Series = { resetsAt: null, samples: [sample(0, 40), sample(10, 46), sample(20, 44)] }
  const outOfRange: Series = { resetsAt: null, samples: [sample(0, 40), sample(10, 44), sample(20, 130)] }
  const notNumbers: Series = { resetsAt: null, samples: [sample(0, 40), sample(10, Number.NaN), sample(20, 44)] }
  const future: Series = { resetsAt: null, samples: [sample(0, 40), sample(10, 42), sample(30, 44)] }

  // Each is asked about at the moment of its last sample, so the age of the readings is not what hides it.
  for (const series of [disordered, repeated, falling, outOfRange, notNumbers]) {
    const lastAt = series.samples[series.samples.length - 1]?.at ?? 0

    expect(forecastOf(series, lastAt, 'five_hour')).toEqual(none)
  }
  // A sample after the moment being asked about is not a reading anyone has made yet.
  expect(forecastOf(future, at(20), 'five_hour')).toEqual(none)
})

test('forecast C6: a new resetsAt or a percent drop empties the series', () => {
  const first = resetIn(180)
  const series = build([[0, 40], [5, 42], [10, 44]], first)
  expect(forecastOf(series, at(10), 'five_hour')).toMatchObject({ kind: 'runs' })

  // The window starts over with a new reset time: only the new sample stays.
  const renewed = addSample(series, { at: at(15), used: 46, resetsAt: resetIn(480) })
  expect(renewed.samples).toEqual([{ at: at(15), used: 46 }])
  expect(forecastOf(renewed, at(15), 'five_hour')).toEqual({ kind: 'none' })

  // The percent drops under the same reset time.
  const dropped = addSample(series, { at: at(15), used: 3, resetsAt: first })
  expect(dropped.samples).toEqual([{ at: at(15), used: 3 }])
  expect(forecastOf(dropped, at(15), 'five_hour')).toEqual({ kind: 'none' })

  // It needs new samples, enough of them, to forecast again.
  const again = build([[20, 3]], first, dropped)
  expect(forecastOf(again, at(20), 'five_hour')).toEqual({ kind: 'none' })
  expect(forecastOf(build([[30, 5]], first, again), at(30), 'five_hour')).toEqual({ kind: 'lasts' })

  // The same instant written another way, or a few seconds of difference, is the same window.
  const same = addSample(series, { at: at(15), used: 46, resetsAt: new Date(Date.parse(first) + 3_000).toISOString() })
  expect(same.samples.length).toBe(4)
  const offset = build([[0, 40], [5, 42]], '2030-01-01T03:00:00-03:00')
  expect(addSample(offset, { at: at(10), used: 44, resetsAt: '2030-01-01T06:00:00Z' }).samples.length).toBe(3)
  // The reset time appearing or disappearing is a different window too.
  expect(addSample(series, { at: at(15), used: 46 }).samples.length).toBe(1)
  expect(addSample(build([[0, 40]]), { at: at(5), used: 42, resetsAt: first }).samples.length).toBe(1)
})

test('forecast C7: a missing, invalid or past resetsAt never lasts and is never urgent', () => {
  const points = [[0, 40], [5, 42], [10, 44]] as const

  for (const resetsAt of [undefined, 'amanhã', '', 'Invalid Date', resetIn(5), resetIn(10)]) {
    const forecast = forecastOf(build(points, resetsAt), at(10), 'five_hour')

    expect(forecast).toEqual({ kind: 'runs', ms: 140 * MIN, urgent: false })
    expect(text(forecast)).toBe('esgota em ~2h20')
  }

  // A very slow pace is not "lasts until the reset" when there is no reset to compare with.
  const slow = forecastOf(build([[0, 40], [30, 41], [60, 42]]), at(60), 'five_hour')
  expect(slow).toEqual({ kind: 'runs', ms: 1740 * MIN, urgent: false })
})

test('forecast C8: rounds up to steps of 5 minutes and gives no number for 0, negative or infinite', () => {
  expect(roundUp5(5 * MIN)).toBe(5 * MIN)
  expect(roundUp5(5 * MIN + 1)).toBe(10 * MIN)
  expect(roundUp5(1)).toBe(5 * MIN)
  expect(roundUp5(10 * MIN - 1)).toBe(10 * MIN)
  expect(roundUp5(10 * MIN)).toBe(10 * MIN)
  expect(roundUp5(0)).toBeNull()
  expect(roundUp5(-1)).toBeNull()
  expect(roundUp5(-5 * MIN)).toBeNull()
  expect(roundUp5(Number.POSITIVE_INFINITY)).toBeNull()
  expect(roundUp5(Number.NEGATIVE_INFINITY)).toBeNull()
  expect(roundUp5(Number.NaN)).toBeNull()

  const runs = (minutes: number): Forecast => ({ kind: 'runs', ms: minutes * MIN, urgent: true })
  expect(text(runs(5))).toBe('esgota em ~5min')
  expect(text(runs(40))).toBe('esgota em ~40min')
  expect(text(runs(55))).toBe('esgota em ~55min')
  expect(text(runs(60))).toBe('esgota em ~1h00')
  expect(text(runs(65))).toBe('esgota em ~1h05')
  expect(text(runs(300))).toBe('esgota em ~5h00')

  // The forecast itself comes rounded: 113.6 minutes of the raw slope are shown as 115.
  expect(forecastOf(build([[0, 40], [5, 41], [10, 43], [15, 47]]), at(15), 'five_hour')).toMatchObject({ ms: 115 * MIN })
  // Nothing to show for a forecast that rounds to nothing.
  expect(text({ kind: 'runs', ms: 0, urgent: true })).toBeNull()
  expect(text({ kind: 'runs', ms: Number.POSITIVE_INFINITY, urgent: true })).toBeNull()
  expect(text({ kind: 'runs', ms: -MIN, urgent: true })).toBeNull()
  expect(text({ kind: 'none' })).toBeNull()
})

test('forecast C9: a forecast at or past the reset lasts and one before it is urgent', () => {
  const points = [[0, 40], [5, 42], [10, 44]] as const
  // 56 points left at 0.4 a minute: 140 minutes, to the millisecond.
  const exactly = forecastOf(build(points, resetIn(150)), at(10), 'five_hour')
  expect(exactly).toEqual({ kind: 'lasts' })
  expect(text(exactly)).toBe('dura até o reset')

  // A reset one millisecond after the forecast still comes after it: the window runs out first.
  const justAfter = build(points, new Date(at(10) + 140 * MIN + 1).toISOString())
  expect(forecastOf(justAfter, at(10), 'five_hour')).toEqual({ kind: 'runs', ms: 140 * MIN, urgent: true })
  const justBefore = build(points, new Date(at(10) + 140 * MIN - 1).toISOString())
  expect(forecastOf(justBefore, at(10), 'five_hour')).toEqual({ kind: 'lasts' })

  // The reading is 3 minutes old: the 140 minutes have 3 gone already, and 137 do not reach a reset 138 away.
  const aged = build(points, new Date(at(13) + 138 * MIN).toISOString())
  expect(forecastOf(aged, at(13), 'five_hour')).toEqual({ kind: 'runs', ms: 140 * MIN, urgent: true })

  const early = build(points, resetIn(100))
  expect(forecastOf(early, at(10), 'five_hour')).toEqual({ kind: 'lasts' })
  const late = build(points, resetIn(200))
  expect(forecastOf(late, at(10), 'five_hour')).toEqual({ kind: 'runs', ms: 140 * MIN, urgent: true })
})

test('forecast C10: the seven day window shows days rounded up', () => {
  const week = (ms: number): Forecast => ({ kind: 'runs', ms, urgent: false })

  expect(text(week(DAY), 'seven_day')).toBe('esgota em ~1 dia')
  expect(text(week(DAY + 5 * MIN), 'seven_day')).toBe('esgota em ~2 dias')
  expect(text(week(3 * DAY), 'seven_day')).toBe('esgota em ~3 dias')
  expect(text(week(3 * DAY - 5 * MIN), 'seven_day')).toBe('esgota em ~3 dias')
  expect(text(week(DAY - 5 * MIN), 'seven_day')).toBe('esgota em ~23h55')
  expect(text(week(5 * HOUR + 30 * MIN), 'seven_day')).toBe('esgota em ~5h30')
  // The five hour window never speaks of days.
  expect(text(week(30 * HOUR), 'five_hour')).toBe('esgota em ~30h00')

  // From readings: 20 points every 12 hours leave 50 points, 30 hours, rounded up to 2 days.
  const series = build([[0, 10], [12 * 60, 30], [24 * 60, 50]], resetIn(6 * 24 * 60), EMPTY_SERIES, 'seven_day')
  const forecast = forecastOf(series, at(24 * 60), 'seven_day')
  expect(forecast).toEqual({ kind: 'runs', ms: 30 * HOUR, urgent: true })
  expect(text(forecast, 'seven_day')).toBe('esgota em ~2 dias')
})

test('forecast C11: stale samples forecast nothing and only the moving window counts', () => {
  const series = build([[0, 40], [5, 42], [10, 44]])
  expect(forecastOf(series, at(10), 'five_hour')).toMatchObject({ kind: 'runs' })
  // Three reading intervals (3 minutes) after the last sample is still fresh; a millisecond more is not.
  expect(forecastOf(series, at(13), 'five_hour')).toMatchObject({ kind: 'runs' })
  expect(forecastOf(series, at(13) + 1, 'five_hour')).toEqual({ kind: 'none' })
  expect(forecastOf(build([[0, 40], [5, 40], [10, 40]]), at(14), 'five_hour')).toEqual({ kind: 'none' })

  // An old stretch at a slow pace does not weigh on the recent one: the last 60 minutes are 3 samples.
  const old: Series = { resetsAt: null, samples: [{ at: at(0), used: 10 }, { at: at(70), used: 50 }, { at: at(75), used: 51 }, { at: at(80), used: 52 }] }
  expect(forecastOf(old, at(80), 'five_hour')).toEqual({ kind: 'runs', ms: 240 * MIN, urgent: false })

  // Samples that left the window are dropped when a new one comes, so memory stays small.
  const added = addSample(build([[0, 10]]), { at: at(70), used: 50 })
  expect(added.samples).toEqual([{ at: at(70), used: 50 }])
  let dense = EMPTY_SERIES
  for (let ms = 0; ms <= 4 * HOUR; ms += 2_000) dense = addSample(dense, { at: T0 + ms, used: 40 })
  expect(dense.samples.length).toBeLessThanOrEqual(62)
})

test('forecast C12: a window at 100 percent says exhausted', () => {
  expect(text({ kind: 'exhausted' })).toBe('esgotado')
  expect(forecastOf(build([[0, 100]]), at(0), 'five_hour')).toEqual({ kind: 'exhausted' })
  expect(forecastOf(build([[0, 98], [5, 99], [10, 100]]), at(10), 'five_hour')).toEqual({ kind: 'exhausted' })
  expect(forecastOf(build([[0, 100], [10, 100], [20, 100]]), at(20), 'five_hour')).toEqual({ kind: 'exhausted' })
  // 99 is not 100.
  expect(forecastOf(build([[0, 99]]), at(0), 'five_hour')).toEqual({ kind: 'none' })
  // A stale reading of 100 says nothing about now.
  expect(forecastOf(build([[0, 100]]), at(10), 'five_hour')).toEqual({ kind: 'none' })
})

test('forecast C13: a reading without the window records nothing for it', () => {
  const reading = { kind: 'five_hour', percentUsed: 42, resetsAt: resetIn(200) }
  const history = recordReadings(EMPTY_HISTORY, [reading], at(0))

  expect(history.five_hour.samples).toEqual([{ at: at(0), used: 42 }])
  expect(history.seven_day).toBe(EMPTY_SERIES)

  // Later readings that lack the five hour window add nothing, however long it has been.
  const later = recordReadings(history, [{ kind: 'seven_day', percentUsed: 10 }], at(30))
  expect(later.five_hour).toBe(history.five_hour)
  expect(later.seven_day.samples).toEqual([{ at: at(30), used: 10 }])
  expect(recordReadings(history, [], at(60)).five_hour).toBe(history.five_hour)

  // Unknown kinds and unusable percents are skipped.
  expect(recordReadings(history, [{ kind: 'one_hour', percentUsed: 5 }], at(40))).toEqual(history)
  expect(recordReadings(history, [{ kind: 'five_hour', percentUsed: Number.NaN }], at(40)).five_hour).toBe(history.five_hour)
  expect(recordReadings(history, [{ kind: 'five_hour', percentUsed: 12 }], at(-5)).five_hour).toBe(history.five_hour)

  // The forecast of a window that was never read is nothing.
  expect(forecastOf(later.five_hour, at(60), 'five_hour')).toEqual({ kind: 'none' })
})
