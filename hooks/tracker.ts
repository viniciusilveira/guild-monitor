import type { TaskClass, ToolUse } from './classify'
import { classify, classOf, DEFAULT_CLASS } from './classify'
import type { Bug } from './guild'
import { bugAt, categoryOf, NO_BUG, onToolResult } from './guild'
import type { Guild } from './xp'
import { addXp, ANSWER_XP, BUG_BONUS, CLASSES, operationXp } from './xp'

const MAX_TOOLS = 500
const MAX_RECENT = 20

export type Turn = {
  id: string
  prompt: string
  tools: ToolUse[]
  // XP each class earned in the turn, operation by operation.
  earned: Record<TaskClass, number>
}

const NOTHING_EARNED = (): Record<TaskClass, number> => ({ mago: 0, guerreiro: 0, explorador: 0 })

export type Entry = { cls: TaskClass; xp: number; at: number }

// Everything the guild remembers about the session, as plain data: the events
// of the engine go in one at a time and a new tracker comes out.
export type Tracker = {
  turn: Turn | null
  planMode: boolean
  // The class doing the turn's work, or the last one that did.
  active: TaskClass
  bug: Bug
  guild: Guild
  lastActivityAt: number
  recent: readonly Entry[]
}

export const createTracker = (guild: Guild, now: number): Tracker => ({
  turn: null,
  planMode: false,
  active: DEFAULT_CLASS,
  bug: NO_BUG,
  guild,
  lastActivityAt: now,
  recent: [],
})

// The class follows the turn as it unfolds: first the prompt, then the tools.
const reclassify = (tracker: Tracker): Tracker =>
  tracker.turn === null
    ? tracker
    : {
        ...tracker,
        active: classify({ prompt: tracker.turn.prompt, planMode: tracker.planMode, tools: tracker.turn.tools }),
      }

export const setPlanMode = (tracker: Tracker, planMode: boolean): Tracker =>
  tracker.planMode === planMode ? tracker : reclassify({ ...tracker, planMode })

export const startTurn = (tracker: Tracker, start: { id: string; prompt: string; now: number }): Tracker =>
  reclassify({
    ...tracker,
    turn: { id: start.id, prompt: start.prompt, tools: [], earned: NOTHING_EARNED() },
    lastActivityAt: start.now,
  })

export const toolStarted = (tracker: Tracker, use: ToolUse, now: number): Tracker =>
  tracker.turn === null
    ? { ...tracker, lastActivityAt: now }
    : reclassify({
        ...tracker,
        turn: { ...tracker.turn, tools: [...tracker.turn.tools, use].slice(-MAX_TOOLS) },
        lastActivityAt: now,
      })

export type Gain = { cls: TaskClass; xp: number; level: number; leveledUp: boolean }

// A tool call that worked pays its own class, at once: by what it took and what it wrote, plus
// a bonus for making a failing call pass again. Only calls inside a turn pay.
export const toolFinished = (
  tracker: Tracker,
  done: { use: ToolUse; isError: boolean; now: number; durationMs: number },
): { tracker: Tracker; gain?: Gain } => {
  const bug = onToolResult(tracker.bug, {
    category: categoryOf(done.use.tool, done.use.command),
    isError: done.isError,
    now: done.now,
  })
  const resolved = tracker.bug.phase === 'alive' && bug.phase === 'defeated'
  const turn = tracker.turn
  const moved: Tracker = { ...tracker, bug, lastActivityAt: done.now }
  if (turn === null || done.isError) return { tracker: moved }

  const cls = classOf(done.use, tracker.planMode)
  const xp = operationXp({ durationMs: done.durationMs, lines: done.use.lines ?? 0 }) + (resolved ? BUG_BONUS : 0)
  const added = addXp(tracker.guild, cls, xp)

  return {
    tracker: { ...moved, guild: added.guild, turn: { ...turn, earned: { ...turn.earned, [cls]: turn.earned[cls] + xp } } },
    gain: { cls, xp, level: added.level, leveledUp: added.leveledUp },
  }
}

// A defeated bug leaves once its animation ran.
export const tick = (tracker: Tracker, now: number): Tracker => {
  const bug = bugAt(tracker.bug, now)

  return bug === tracker.bug ? tracker : { ...tracker, bug }
}

// The operations were paid as they finished; a turn the model answered pays a little
// more for the answer, and an interrupted one or one an API error killed only closes.
export const completeTurn = (
  tracker: Tracker,
  end: { id: string; reason: string; now: number },
): { tracker: Tracker; gain?: Gain } => {
  const turn = tracker.turn
  if (turn === null || turn.id !== end.id) return { tracker }

  const answered = end.reason === 'answer'
  const earned = { ...turn.earned }
  if (answered) earned[tracker.active] += ANSWER_XP

  const history = CLASSES.filter(cls => earned[cls] > 0).map(cls => ({ cls, xp: earned[cls], at: end.now }))
  const idle: Tracker = {
    ...tracker,
    turn: null,
    lastActivityAt: end.now,
    recent: [...tracker.recent, ...history].slice(-MAX_RECENT),
  }
  if (!answered) return { tracker: idle }

  const added = addXp(tracker.guild, tracker.active, ANSWER_XP)

  return {
    tracker: { ...idle, guild: added.guild },
    gain: { cls: tracker.active, xp: ANSWER_XP, level: added.level, leveledUp: added.leveledUp },
  }
}
