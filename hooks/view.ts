import type { ForecastView, ViewModel } from '../types'
import type { TaskClass } from './classify'
import type { Animation, Settings, Snapshot } from './guild'
import { animationFor, bugAt, DEFAULTS } from './guild'
import { doingOf } from './doing'
import type { History } from './forecast'
import { EMPTY_HISTORY, forecastLine } from './forecast'
import { damageView } from './damage'
import { goldLines } from './gold'
import type { MeterColors } from './schemes'
import { SCHEMES } from './schemes'
import type { Tracker } from './tracker'
import { lineOf, modelLabel } from './tokens'
import { CLASSES, progressOf } from './xp'

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

// The session's figures as `session.measure` reports them.
export type Usage = {
  contextPercent?: number
  rateLimits: readonly RateLimit[]
  costUsd?: number
  // When the session began (`$.session.usage()`'s `startedAt`): a resumed one counts from its first launch, `/clear` starts it over.
  startedAt?: number
}

// What `$.session.usage()` and `session.measure` carry, as far as the guild reads it.
export type SessionFigures = {
  context: { percent?: number }
  rateLimits: readonly RateLimit[]
  cost?: { usd: number }
  // `session.measure` does not carry it, only `$.session.usage()` does.
  startedAt?: number
}

export const usageFrom = (figures: SessionFigures): Usage => ({
  contextPercent: figures.context.percent,
  rateLimits: figures.rateLimits,
  costUsd: figures.cost?.usd,
  startedAt: figures.startedAt,
})

// A figure the engine does not have at the moment (a window that has not been
// read yet, a context with no response behind it) leaves the last one known as
// it was: the attributes belong to the session, and a gap in the reports must
// not blank them.
export const mergeUsage = (known: Usage, fresh: Usage): Usage => {
  const kinds = new Set(fresh.rateLimits.map(limit => limit.kind))

  return {
    contextPercent: fresh.contextPercent ?? known.contextPercent,
    rateLimits: [...known.rateLimits.filter(limit => !kinds.has(limit.kind)), ...fresh.rateLimits],
    costUsd: fresh.costUsd ?? known.costUsd,
    // A later start (a `/clear`) replaces the known one; a report that has none leaves it.
    startedAt: fresh.startedAt ?? known.startedAt,
  }
}

const percentLeft = (used: number | undefined): number | null =>
  used === undefined ? null : Math.max(0, Math.min(100, Math.round(100 - used)))

const wholeSeconds = (ms: number): number => Math.max(0, Math.floor(ms / 1000))

// How long the turn has run, or the duration the last one ended with; null before the first.
const turnSecondsOf = (tracker: Tracker, now: number): number | null => {
  if (tracker.turn !== null) return wholeSeconds(now - tracker.turn.startedAt)

  return tracker.lastTurnMs === null || !Number.isFinite(tracker.lastTurnMs) ? null : wholeSeconds(tracker.lastTurnMs)
}

const tokensViewOf = (tracker: Tracker): ViewModel['tokens'] => {
  const { last, session, subagents } = tracker.tokens
  const sub = subagents === null ? null : lineOf(subagents)
  if (last === null && sub === null) return null

  return { turn: last === null ? null : lineOf(last), session: session === null ? null : lineOf(session), subagents: sub }
}

// `history` is the recent readings of the two windows, for their forecasts; empty shows none.
export const buildView = (tracker: Tracker, usage: Usage, now: number, settings: Settings = DEFAULTS, history: History = EMPTY_HISTORY): ViewModel => {
  const snapshot: Snapshot = {
    working: tracker.turn !== null,
    active: tracker.active,
    idleMs: now - tracker.lastActivityAt,
    contextPercent: usage.contextPercent,
  }
  const week = usage.rateLimits.find(limit => limit.kind === 'seven_day')
  const hours = usage.rateLimits.find(limit => limit.kind === 'five_hour')

  return {
    active: tracker.active,
    working: snapshot.working,
    chars: CLASSES.map(cls => {
      const progress = progressOf(tracker.guild[cls].xp)

      return {
        cls,
        anim: animationFor(cls, snapshot, settings),
        level: progress.level,
        xpInLevel: progress.current,
        xpNeeded: progress.needed,
      }
    }),
    bug: bugAt(tracker.bug, now).phase,
    hp: percentLeft(week?.percentUsed),
    mana: percentLeft(hours?.percentUsed),
    stamina: percentLeft(usage.contextPercent),
    manaResetsAt: hours?.resetsAt ?? null,
    costUsd: usage.costUsd ?? null,
    gold: goldLines(tracker.gold),
    goldPartial: tracker.gold.base > 0,
    damage: damageView(tracker.damage),
    counters: { combo: tracker.counters.combo, best: tracker.counters.best, bugs: tracker.counters.bugs },
    recent: [...tracker.recent],
    doing: doingOf(tracker.running),
    forecast: { sevenDay: forecastLine(history.seven_day, now, 'seven_day'), fiveHour: forecastLine(history.five_hour, now, 'five_hour') },
    sessionSeconds: usage.startedAt === undefined ? null : wholeSeconds(now - usage.startedAt),
    turnSeconds: turnSecondsOf(tracker, now),
    tokens: tokensViewOf(tracker),
    model: tracker.tokens.model === null ? null : modelLabel(tracker.tokens.model),
  }
}

// Which frame of an animation shows `elapsed` ms after it began: a loop wraps
// around, a one-shot stays on its last frame.
export const frameAt = (durations: readonly number[], elapsed: number, loop: boolean): number => {
  const total = durations.reduce((sum, ms) => sum + ms, 0)
  if (durations.length === 0 || total <= 0 || elapsed <= 0) return 0
  if (!loop && elapsed >= total) return durations.length - 1

  let rest = elapsed % total

  for (let i = 0; i < durations.length; i += 1) {
    const ms = durations[i] ?? 0
    if (rest < ms) return i
    rest -= ms
  }

  return durations.length - 1
}

export const sheetIdFor = (cls: TaskClass | 'bug', anim: Animation | 'derrotado'): string => `${cls}_${anim}`

export const NAMES: Record<TaskClass, string> = { mago: 'Mago', guerreiro: 'Guerreiro', explorador: 'Explorador' }

export const COLORS: Record<TaskClass, string> = { mago: '#8E6BBF', guerreiro: '#C8423A', explorador: '#4C9A5B' }

// Colors of the meters, after the usual game HUD conventions: health goes green,
// yellow, red as it drops; mana is blue; stamina orange; experience purple; gold gold.
// These are the `padrao` scheme's; the screen takes the colors of the scheme in use (see schemes.ts).
export const METER_COLORS = { mana: SCHEMES.padrao.mana, stamina: SCHEMES.padrao.stamina, xp: SCHEMES.padrao.xp, gold: SCHEMES.padrao.gold, unknown: SCHEMES.padrao.unknown } as const

// "5h esgota em ~40min": the window and its forecast, in the shorter wording when the full one does not fit
// `width` columns and not at all when not even that does (a line never wraps).
export const fitForecast = (label: string, forecast: ForecastView, width: number): string | null => {
  if (`${label} ${forecast.text}`.length <= width) return `${label} ${forecast.text}`

  return `${label} ${forecast.short}`.length <= width ? `${label} ${forecast.short}` : null
}

// The band has room for one line: the window that runs out before its reset, else the 5-hour one, else the week.
export const bandForecast = (forecast: ViewModel['forecast']): { label: '5h' | '7d'; line: ForecastView } | null => {
  const windows = [
    { label: '5h', line: forecast.fiveHour },
    { label: '7d', line: forecast.sevenDay },
  ] as const
  const chosen = windows.find(item => item.line?.urgent === true) ?? windows.find(item => item.line !== null)

  return chosen === undefined || chosen.line === null ? null : { label: chosen.label, line: chosen.line }
}

// The color of the lines of tokens (a low cache hit rate uses `URGENT_COLOR`).
export const TOKENS_COLOR = SCHEMES.padrao.tokens

// The red of a window that runs out before it resets.
export const URGENT_COLOR = SCHEMES.padrao.urgent

export const healthColor = (percent: number | null, colors: MeterColors = SCHEMES.padrao): string => {
  if (percent === null) return colors.unknown
  if (percent > 50) return colors.hpHigh
  if (percent >= 25) return colors.hpMid

  return colors.hpLow
}

const DOING: Record<TaskClass, string> = { mago: 'planejando', guerreiro: 'em combate', explorador: 'explorando' }

export const stateText = (cls: TaskClass, anim: Animation): string => {
  if (anim === 'trabalho') return DOING[cls]
  if (anim === 'cansado') return 'cansado'
  if (anim === 'dormindo') return 'dormindo'

  return 'de prontidão'
}

// What the line says when no call runs: the character rests, is tired or sleeps.
export const restText = (anim: Animation): string => {
  if (anim === 'cansado') return 'cansado'
  if (anim === 'dormindo') return 'dormindo'

  return 'de prontidão'
}

// ▰▰▰▱▱▱: `percent` of `width` cells filled; empty while the figure is unknown.
export const bar = (percent: number | null, width = 8): string => {
  const filled = percent === null ? 0 : Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export const percentText = (percent: number | null): string => (percent === null ? '--' : `${percent}%`)

export const costText = (usd: number | null): string => (usd === null ? '--' : `$${usd.toFixed(2)}`)

// "2h13" or "47min": time left until a window resets, empty when unknown or past.
export const untilReset = (resetsAt: string | null, now: number): string => {
  if (resetsAt === null) return ''

  const at = Date.parse(resetsAt)
  if (Number.isNaN(at) || at <= now) return ''

  const minutes = Math.ceil((at - now) / 60_000)
  if (minutes < 60) return `${minutes}min`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

// "32s", "4min" or "1h05": a length of time, in its short form. Negative counts as zero.
export const durationText = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

// "agora", "3min" or "1h05": how long ago something happened.
export const agoText = (at: number, now: number): string => {
  const elapsed = Math.max(0, now - at)

  return elapsed < 60_000 ? 'agora' : durationText(elapsed)
}
