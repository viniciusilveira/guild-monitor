import type { Settings } from './guild'
import { DEFAULTS } from './guild'
import type { Counters } from './counters'
import type { Tokens } from './tokens'
import { addTurn, NO_TOKENS } from './tokens'
import type { Gold } from './gold'
import { goldMeasured, goldOperation, NO_GOLD } from './gold'
import type { Tracker } from './tracker'
import { callStarted, createTracker, startTurn, toolFinished, toolStarted } from './tracker'
import type { History } from './forecast'
import { addSample, EMPTY_HISTORY } from './forecast'
import type { MeterScheme } from './schemes'
import type { Usage } from './view'
import { addXp, emptyGuild } from './xp'

// Scenes for screenshots and a first look: made-up figures, nothing read from
// the session and nothing saved.
export const SCENES = ['explorador', 'mago', 'guerreiro', 'bug', 'cansado', 'dormindo'] as const

// One scene per color scheme of the meters, for screenshots: the warrior at work, the scheme forced while the scene
// runs, and the HP walking through its three levels (see `HP_STEPS`).
export const SCHEME_SCENES = ['esquema-padrao', 'esquema-contraste', 'esquema-daltonico'] as const

export type Scene = (typeof SCENES)[number] | (typeof SCHEME_SCENES)[number]

const SCHEME_OF: Record<(typeof SCHEME_SCENES)[number], MeterScheme> = { 'esquema-padrao': 'padrao', 'esquema-contraste': 'contraste', 'esquema-daltonico': 'daltonico' }

export const sceneOf = (value: unknown): Scene | undefined => [...SCENES, ...SCHEME_SCENES].find(scene => scene === value)

// The scheme a scene forces on the screen, or nothing for the scenes of the figures.
export const schemeOfScene = (scene: Scene): MeterScheme | undefined => (scene in SCHEME_OF ? SCHEME_OF[scene as keyof typeof SCHEME_OF] : undefined)

// The percent of the week used in each step of a scheme scene, which makes HP 72, 38 and 15: one level of each color.
const HP_STEPS = [28, 62, 85] as const
const HP_STEP_MS = 3_000

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

// The cost every scene shows, and the one the made-up split adds up to.
const DEMO_COST_USD = 3.42

const DEMO_COUNTERS: Counters = { combo: 7, best: 9, bugs: 3 }

// Made-up tokens through the code the real ones go through: an earlier turn, the last one (142k of input, 87% from
// the cache; 1,2M and 91% in all) and a subagent with a low hit rate (38%), so the red shows.
const demoTokens = (): Tokens => {
  const usage = (input: number, read: number, written: number, output: number, model: string) => ({
    input_tokens: input,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: written,
    output_tokens: output,
    model,
  })
  const model = 'claude-sonnet-5-5'
  const earlier = addTurn(NO_TOKENS, usage(42_000, 968_460, 47_540, 78_000, model), false)
  const last = addTurn(earlier, usage(6_000, 123_540, 12_460, 18_000, model), false)

  return addTurn(last, usage(12_000, 11_400, 6_600, 4_100, model), true)
}

// Made-up gold through the code the real one goes through: from $0 to the demo's $3.42, in three readings that
// each belong to one class (Mage $1.20, Warrior $1.71, Explorer $0.51).
const demoGold = (): Gold => {
  const steps = [
    ['mago', 1.2],
    ['guerreiro', 2.91],
    ['explorador', DEMO_COST_USD],
  ] as const

  return steps.reduce((gold, [cls, usd]) => goldMeasured(goldOperation(gold, cls), usd, cls), goldMeasured(NO_GOLD, 0, 'mago'))
}

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

// The made-up readings behind the forecasts, through the same code the real ones go through: the 5-hour window
// climbs 5 points every 10 minutes (90 minutes left, the reset in 133: red) and the week 1 point every 3 hours
// (9 days left, the reset in 2: it lasts).
const demoReadings = (now: number, usage: Usage): History => {
  const five = usage.rateLimits.find(limit => limit.kind === 'five_hour')
  const week = usage.rateLimits.find(limit => limit.kind === 'seven_day')
  const hours = [40, 45, 50, 55].map((used, i) => ({ at: now - (3 - i) * 10 * MINUTE_MS, used, resetsAt: five?.resetsAt }))
  const weeks = [26, 27, 28].map((used, i) => ({ at: now - (2 - i) * 180 * MINUTE_MS, used, resetsAt: week?.resetsAt }))

  return {
    five_hour: hours.reduce((series, sample) => addSample(series, sample, 'five_hour'), EMPTY_HISTORY.five_hour),
    seven_day: weeks.reduce((series, sample) => addSample(series, sample, 'seven_day'), EMPTY_HISTORY.seven_day),
  }
}

const sceneState = (scene: Scene, now: number, settings: Settings): { tracker: Tracker; usage: Usage } => {
  const base = createTracker(demoGuild(), now)
  const isSchemeScene = schemeOfScene(scene) !== undefined
  const weekUsed = isSchemeScene ? (HP_STEPS[Math.floor(now / HP_STEP_MS) % HP_STEPS.length] ?? 28) : 28
  const usage: Usage = {
    contextPercent: scene === 'cansado' ? 88 : 36,
    rateLimits: [
      { kind: 'seven_day', percentUsed: weekUsed, resetsAt: new Date(now + 2 * 24 * 60 * MINUTE_MS).toISOString() },
      { kind: 'five_hour', percentUsed: 55, resetsAt: new Date(now + 133 * MINUTE_MS).toISOString() },
    ],
    costUsd: DEMO_COST_USD,
    startedAt: now - DEMO_SESSION_MS,
  }

  if (scene === 'explorador') return { tracker: working(base, now, 'WebSearch'), usage }
  if (scene === 'mago') return { tracker: working(base, now, 'TodoWrite'), usage }
  if (scene === 'guerreiro' || isSchemeScene) return { tracker: working(base, now, 'Edit', 'register.tsx'), usage }

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

export const demoState = (scene: Scene, now: number, settings: Settings = DEFAULTS): { tracker: Tracker; usage: Usage; history: History } => {
  const state = sceneState(scene, now, settings)

  // Made-up scores; the bug scene has just lost its combo to the failing call.
  const counters: Counters = scene === 'bug' ? { ...DEMO_COUNTERS, combo: 0 } : DEMO_COUNTERS

  return { tracker: { ...state.tracker, counters, recent: demoHistory(now), tokens: demoTokens(), gold: demoGold() }, usage: state.usage, history: demoReadings(now, state.usage) }
}
