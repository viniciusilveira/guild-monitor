import type { ViewModel } from '../types'
import type { TaskClass } from './classify'
import type { Animation, Settings, Snapshot } from './guild'
import { animationFor, bugAt, DEFAULTS } from './guild'
import type { Tracker } from './tracker'
import { CLASSES, progressOf } from './xp'

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

// The session's figures as `session.measure` reports them.
export type Usage = {
  contextPercent?: number
  rateLimits: readonly RateLimit[]
  costUsd?: number
}

// What `$.session.usage()` and `session.measure` carry, as far as the guild reads it.
export type SessionFigures = {
  context: { percent?: number }
  rateLimits: readonly RateLimit[]
  cost?: { usd: number }
}

export const usageFrom = (figures: SessionFigures): Usage => ({
  contextPercent: figures.context.percent,
  rateLimits: figures.rateLimits,
  costUsd: figures.cost?.usd,
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
  }
}

const percentLeft = (used: number | undefined): number | null =>
  used === undefined ? null : Math.max(0, Math.min(100, Math.round(100 - used)))

export const buildView = (tracker: Tracker, usage: Usage, now: number, settings: Settings = DEFAULTS): ViewModel => {
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
export const METER_COLORS = { mana: '#4A90E2', stamina: '#F39C12', xp: '#9B59B6', gold: '#F1C40F', unknown: '#7F8C8D' } as const

export const healthColor = (percent: number | null): string => {
  if (percent === null) return METER_COLORS.unknown
  if (percent > 50) return '#2ECC71'
  if (percent >= 25) return '#F1C40F'

  return '#E74C3C'
}

const DOING: Record<TaskClass, string> = { mago: 'planejando', guerreiro: 'em combate', explorador: 'explorando' }

export const stateText = (cls: TaskClass, anim: Animation): string => {
  if (anim === 'trabalho') return DOING[cls]
  if (anim === 'cansado') return 'cansado'
  if (anim === 'dormindo') return 'dormindo'

  return 'de prontidao'
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
