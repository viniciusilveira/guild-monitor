import type { Settings } from './guild'
import { DEFAULTS } from './guild'
import type { Tracker } from './tracker'
import { createTracker, startTurn, toolFinished, toolStarted } from './tracker'
import type { Usage } from './view'
import { addXp, emptyGuild } from './xp'

// Scenes for screenshots and a first look: made-up figures, nothing read from
// the session and nothing saved.
export const SCENES = ['explorador', 'mago', 'guerreiro', 'bug', 'cansado', 'dormindo'] as const

export type Scene = (typeof SCENES)[number]

export const sceneOf = (value: unknown): Scene | undefined => SCENES.find(scene => scene === value)

export type SceneChoice = { kind: 'scene'; scene: Scene } | { kind: 'off' } | { kind: 'unknown' }

// What `/guild <word>` asks for: a scene, `off` to go back to the real session, or nothing known.
export const choiceOf = (args: string): SceneChoice => {
  const word = args.trim().toLowerCase()
  const scene = sceneOf(word)

  if (scene !== undefined) return { kind: 'scene', scene }

  return word === 'off' ? { kind: 'off' } : { kind: 'unknown' }
}

const MINUTE_MS = 60_000

const demoGuild = () => {
  const levels = [
    ['mago', 130],
    ['guerreiro', 420],
    ['explorador', 55],
  ] as const

  return levels.reduce((guild, [cls, xp]) => addXp(guild, cls, xp).guild, emptyGuild())
}

const working = (tracker: Tracker, now: number, tool: string): Tracker =>
  toolStarted(startTurn(tracker, { id: 'demo', prompt: '', now }), { tool }, now)

export const demoState = (scene: Scene, now: number, settings: Settings = DEFAULTS): { tracker: Tracker; usage: Usage } => {
  const base = createTracker(demoGuild(), now)
  const usage: Usage = {
    contextPercent: scene === 'cansado' ? 88 : 36,
    rateLimits: [
      { kind: 'seven_day', percentUsed: 28 },
      { kind: 'five_hour', percentUsed: 55, resetsAt: new Date(now + 133 * MINUTE_MS).toISOString() },
    ],
    costUsd: 3.42,
  }

  if (scene === 'explorador') return { tracker: working(base, now, 'WebSearch'), usage }
  if (scene === 'mago') return { tracker: working(base, now, 'TodoWrite'), usage }
  if (scene === 'guerreiro') return { tracker: working(base, now, 'Edit'), usage }

  if (scene === 'bug') {
    const edit = working(base, now, 'Edit')
    const failed = toolFinished(edit, { use: { tool: 'Bash', command: 'npm test' }, isError: true, now, durationMs: 0 })

    return { tracker: failed.tracker, usage }
  }

  const resting: Tracker = { ...base, active: 'guerreiro' }

  if (scene === 'cansado') return { tracker: resting, usage }

  return { tracker: { ...resting, lastActivityAt: now - settings.sleepAfterMs - 1_000 }, usage }
}
