// When a subscription window runs out at the current pace. Pure: it gets the readings of a window
// (time, percent used) and answers with the time until 100%, or with nothing when the readings are not
// enough to say. A made-up number is worse than none, so every doubt ends in "nothing".
//
// The series lives in memory only (it is never saved, traced or announced) and starts over with the window.

export type WindowKind = 'five_hour' | 'seven_day'

export type Sample = { at: number; used: number }

// The recent readings of one window and the reset time they belong to (null while unknown).
export type Series = { resetsAt: string | null; samples: Sample[] }

export type History = Record<WindowKind, Series>

export const EMPTY_SERIES: Series = { resetsAt: null, samples: [] }

export const EMPTY_HISTORY: History = { five_hour: EMPTY_SERIES, seven_day: EMPTY_SERIES }

export type Forecast =
  // Nothing can be said: too few readings, too short a span, too little variation, or readings too old.
  | { kind: 'none' }
  // Readings long enough and the percent did not move.
  | { kind: 'idle' }
  | { kind: 'exhausted' }
  // The window outlasts the reset.
  | { kind: 'lasts' }
  // The window runs out in `ms` (rounded up to steps of 5 minutes); `urgent` when that comes before the reset.
  | { kind: 'runs'; ms: number; urgent: boolean }

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const STEP_MS = 5 * MINUTE_MS

// The percent moves in whole points, so a pace needs a long stretch and a few points to mean anything.
export const MIN_SAMPLES = 3
export const MIN_POINTS = 2
// A reset time that moves less than this between readings is the same window.
const SAME_RESET_MS = 5 * MINUTE_MS
// The last sample may be this many reading gaps old before it says nothing about now.
const STALE_GAPS = 3

type Spec = {
  // Only the samples this recent count towards the slope.
  windowMs: number
  // An unchanged percent is sampled at most this often; a changed one is always kept.
  gapMs: number
  // The samples in the window must cover at least this much time.
  minSpanMs: number
  // How long the subscription window itself is: a forecast beyond it, with no reset to compare with, is not shown.
  lengthMs: number
}

const SPECS: Record<WindowKind, Spec> = {
  five_hour: { windowMs: HOUR_MS, gapMs: MINUTE_MS, minSpanMs: 10 * MINUTE_MS, lengthMs: 5 * HOUR_MS },
  seven_day: { windowMs: 2 * DAY_MS, gapMs: 30 * MINUTE_MS, minSpanMs: 2 * HOUR_MS, lengthMs: 7 * DAY_MS },
}

const KINDS: readonly WindowKind[] = ['five_hour', 'seven_day']

// Rounds up to the next multiple of 5 minutes; no number for zero, negative or infinite.
export const roundUp5 = (ms: number): number | null => (Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / STEP_MS) * STEP_MS : null)

const instantOf = (resetsAt: string | null): number | null => {
  if (resetsAt === null) return null

  const at = Date.parse(resetsAt)

  return Number.isNaN(at) ? null : at
}

export const sameWindow = (known: string | null, fresh: string | null): boolean => {
  if (known === null || fresh === null) return known === fresh

  const a = instantOf(known)
  const b = instantOf(fresh)

  return a === null || b === null ? known === fresh : Math.abs(a - b) < SAME_RESET_MS
}

export type NewSample = { at: number; used: number; resetsAt?: string }

// Adds a reading. One out of order, repeated or not a percent is ignored; a new reset time or a percent that
// fell means a new window, so the series starts over from this reading.
export const addSample = (series: Series, sample: NewSample, kind: WindowKind = 'five_hour'): Series => {
  const { at, used } = sample
  if (!Number.isFinite(at) || !Number.isFinite(used) || used < 0 || used > 100) return series

  const resetsAt = sample.resetsAt ?? null
  const last = series.samples[series.samples.length - 1]
  const spec = SPECS[kind]

  if (last === undefined) return { resetsAt, samples: [{ at, used }] }
  if (at <= last.at) return series
  if (used < last.used || !sameWindow(series.resetsAt, resetsAt)) return { resetsAt, samples: [{ at, used }] }
  if (used === last.used && at - last.at < spec.gapMs) return series

  return { resetsAt: series.resetsAt, samples: [...series.samples.filter(known => known.at >= at - spec.windowMs), { at, used }] }
}

// The readings the session just took: a window the reading does not carry is left alone, so a figure the
// engine did not report again is never counted as one more reading of "nothing changed".
export const recordReadings = (
  history: History,
  readings: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>,
  now: number,
): History => {
  const next: History = { ...history }

  for (const kind of KINDS) {
    const reading = readings.find(item => item.kind === kind)
    if (reading !== undefined) next[kind] = addSample(history[kind], { at: now, used: reading.percentUsed, resetsAt: reading.resetsAt }, kind)
  }

  return next
}

const isUsable = (samples: readonly Sample[], now: number): boolean =>
  samples.every(
    (sample, i) =>
      Number.isFinite(sample.at) &&
      Number.isFinite(sample.used) &&
      sample.used >= 0 &&
      sample.used <= 100 &&
      sample.at <= now &&
      (i === 0 || (sample.at > (samples[i - 1]?.at ?? 0) && sample.used >= (samples[i - 1]?.used ?? 0))),
  )

export const forecastOf = (series: Series, now: number, kind: WindowKind): Forecast => {
  const none: Forecast = { kind: 'none' }
  const spec = SPECS[kind]

  if (!Number.isFinite(now) || !isUsable(series.samples, now)) return none

  const recent = series.samples.filter(sample => sample.at >= now - spec.windowMs)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined || now - last.at > spec.gapMs * STALE_GAPS) return none
  if (last.used >= 100) return { kind: 'exhausted' }

  const span = last.at - first.at
  if (recent.length < MIN_SAMPLES || span < spec.minSpanMs) return none

  const points = last.used - first.used
  if (points === 0) return { kind: 'idle' }
  if (points < MIN_POINTS) return none

  // Multiplied before divided, so a pace that lands on a whole number of minutes does so exactly.
  const left = Math.max(0, (((100 - last.used) * span) / points) - (now - last.at))
  const ms = roundUp5(left) ?? STEP_MS
  const reset = instantOf(series.resetsAt)
  // Without a reset to compare with, a forecast longer than the window itself is a pace too slow to mean anything.
  if (reset === null || reset <= now) return ms > spec.lengthMs ? none : { kind: 'runs', ms, urgent: false }

  // The comparison is made with the value the screen shows (rounded up), so the color and the text agree.
  return ms >= reset - now ? { kind: 'lasts' } : { kind: 'runs', ms, urgent: true }
}

const short = (ms: number): string => {
  const minutes = ms / MINUTE_MS
  if (minutes < 60) return `${minutes}min`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

// "esgota em ~40min", "esgota em ~2h05", "esgota em ~3 dias" (only the 7-day window), "dura até o reset",
// "sem consumo" or "esgotado"; null when there is nothing to say. `shorter` drops the "em" of a narrow place.
export const forecastText = (forecast: Forecast, kind: WindowKind, shorter = false): string | null => {
  if (forecast.kind === 'idle') return 'sem consumo'
  if (forecast.kind === 'exhausted') return 'esgotado'
  if (forecast.kind === 'lasts') return 'dura até o reset'
  if (forecast.kind === 'none') return null

  const ms = roundUp5(forecast.ms)
  if (ms === null) return null
  if (kind === 'seven_day' && ms >= DAY_MS) {
    const days = Math.ceil(ms / DAY_MS)

    return `esgota ${shorter ? '' : 'em '}~${days} ${days === 1 ? 'dia' : 'dias'}`
  }

  return `esgota ${shorter ? '' : 'em '}~${short(ms)}`
}

// What the screen shows for a window: the text and whether it is red; null when there is nothing to show.
export type ForecastLine = { text: string; short: string; urgent: boolean }

export const forecastLine = (series: Series, now: number, kind: WindowKind): ForecastLine | null => {
  const forecast = forecastOf(series, now, kind)
  const text = forecastText(forecast, kind)

  return text === null ? null : { text, short: forecastText(forecast, kind, true) ?? text, urgent: forecast.kind === 'runs' && forecast.urgent }
}
