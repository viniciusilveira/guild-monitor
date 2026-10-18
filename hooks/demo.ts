import type { Settings } from './guild'
import { DEFAULTS } from './guild'
import type { Counters } from './counters'
import type { Tracker } from './tracker'
import { callStarted, createTracker, startTurn, toolFinished, toolStarted } from './tracker'
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
// The demo's clocks: a session open for 1h05, a turn running for 32 s, and a last turn that took 4 min.
const DEMO_SESSION_MS = 65 * MINUTE_MS
const DEMO_TURN_MS = 32_000
const DEMO_LAST_TURN_MS = 4 * MINUTE_MS

const DEMO_COUNTERS: Counters = { combo: 7, best: 9, bugs: 3 }

const demoGuild = () => {
  const levels = [
    ['mago', 130],
    ['guerreiro', 420],
    ['explorador', 55],
  ] as const

  return levels.reduce((guild, [cls, xp]) => addXp(guild, cls, xp).guild, emptyGuild())
}

// A call in progress, so the line at the top of the panel has something to say.
const working = (tracker: Tracker, now: number, tool: string, target?: string): Tracker =>
  callStarted(toolStarted(startTurn(tracker, { id: 'demo', prompt: '', now: now - DEMO_TURN_MS }), { tool }, now), { id: 1, tool, target })

const sceneState = (scene: Scene, now: number, settings: Settings): { tracker: Tracker; usage: Usage } => {
  const base = createTracker(demoGuild(), now)
  const usage: Usage = {
    contextPercent: scene === 'cansado' ? 88 : 36,
    rateLimits: [
      { kind: 'seven_day', percentUsed: 28 },
      { kind: 'five_hour', percentUsed: 55, resetsAt: new Date(now + 133 * MINUTE_MS).toISOString() },
    ],
    costUsd: 3.42,
    startedAt: now - DEMO_SESSION_MS,
  }

  if (scene === 'explorador') return { tracker: working(base, now, 'WebSearch'), usage }
  if (scene === 'mago') return { tracker: working(base, now, 'TodoWrite'), usage }
  if (scene === 'guerreiro') return { tracker: working(base, now, 'Edit', 'register.tsx'), usage }

  if (scene === 'bug') {
    const edit = working(base, now, 'Edit', 'register.tsx')
    const failed = toolFinished(edit, { use: { tool: 'Bash', command: 'npm test' }, isError: true, now, durationMs: 0 })

    return { tracker: failed.tracker, usage }
  }

  const resting: Tracker = { ...base, active: 'guerreiro', lastTurnMs: DEMO_LAST_TURN_MS }

  if (scene === 'cansado') return { tracker: resting, usage }

  return { tracker: { ...resting, lastActivityAt: now - settings.sleepAfterMs - 1_000 }, usage }
}

// The latest payments of XP the demo shows, the newest a moment ago.
const demoHistory = (now: number): Tracker['recent'] => [
  { cls: 'explorador', xp: 4, at: now - 9 * MINUTE_MS, tool: 'WebSearch' },
  { cls: 'explorador', xp: 2, at: now - 7 * MINUTE_MS, tool: 'Read' },
  { cls: 'mago', xp: 2, at: now - 5 * MINUTE_MS, tool: 'TodoWrite' },
  { cls: 'guerreiro', xp: 6, at: now - 3 * MINUTE_MS, tool: 'Edit' },
  { cls: 'guerreiro', xp: 3, at: now - 1 * MINUTE_MS, tool: 'resposta' },
]

export const demoState = (scene: Scene, now: number, settings: Settings = DEFAULTS): { tracker: Tracker; usage: Usage } => {
  const state = sceneState(scene, now, settings)

  // Made-up scores; the bug scene has just lost its combo to the failing call.
  const counters: Counters = scene === 'bug' ? { ...DEMO_COUNTERS, combo: 0 } : DEMO_COUNTERS

  return { tracker: { ...state.tracker, counters, recent: demoHistory(now) }, usage: state.usage }
}
