import type { TaskClass, ToolUse } from './classify'
import { classify, classOf, DEFAULT_CLASS } from './classify'
import type { Gold } from './gold'
import { goldMeasured, goldOperation, NO_GOLD } from './gold'
import type { Counters } from './counters'
import { NO_COUNTERS, onOperation } from './counters'
import type { Bug } from './guild'
import { bugAt, categoryOf, NO_BUG, onToolResult } from './guild'
import type { Tokens } from './tokens'
import { addTurn, NO_TOKENS } from './tokens'
import type { Guild } from './xp'
import { addXp, ANSWER_XP, BUG_BONUS, operationXp } from './xp'

const MAX_TOOLS = 500
const MAX_RECENT = 20

// A tool call that has started and not finished. The target (a file name, the first words of a
// command) is for the screen only: nothing here is ever written to the store.
export type Running = { id: number; tool: string; target?: string }

export type Turn = {
  id: string
  prompt: string
  tools: ToolUse[]
  // When the turn began (ms), for the timer on screen; it lives in memory only.
  startedAt: number
}

// One payment of XP: who got it, how much, when, and for what (a tool, or the answer).
export type Entry = { cls: TaskClass; xp: number; at: number; tool: string }

// Everything the guild remembers about the session, as plain data: the events
// of the engine go in one at a time and a new tracker comes out.
export type Tracker = {
  turn: Turn | null
  planMode: boolean
  // The class doing the turn's work, or the last one that did.
  active: TaskClass
  bug: Bug
  guild: Guild
  // Combo, best combo and bugs defeated in this session; memory only, never stored.
  counters: Counters
  lastActivityAt: number
  recent: readonly Entry[]
  // Calls in progress, oldest first: the last one is the most recent not yet finished.
  running: readonly Running[]
  // How long the last turn that ended took, as its `turn.complete` reported it; null before the first.
  lastTurnMs: number | null
  // The tokens the turns spent, in memory only: never stored, traced or toasted.
  tokens: Tokens
  // What each class spent of the session's cost, as an estimate; in memory only, never stored, traced or toasted.
  gold: Gold
}

export const createTracker = (guild: Guild, now: number): Tracker => ({
  turn: null,
  planMode: false,
  active: DEFAULT_CLASS,
  bug: NO_BUG,
  guild,
  counters: NO_COUNTERS,
  lastActivityAt: now,
  recent: [],
  running: [],
  lastTurnMs: null,
  tokens: NO_TOKENS,
  gold: NO_GOLD,
})

// What a finished turn spent, as its `turn.complete` reported it: a turn with no usage (interrupted, an API
// error) adds nothing, and a subagent's goes to the subagents' own total.
export const tokensSpent = (tracker: Tracker, usage: unknown, isSubagent: boolean): Tracker => {
  const tokens = addTurn(tracker.tokens, usage, isSubagent)

  return tokens === tracker.tokens ? tracker : { ...tracker, tokens }
}

// A reading of the session's cost closes an interval: the change since the last reading is split between the
// classes of the operations that finished in it, or goes to the active class when none did.
export const costMeasured = (tracker: Tracker, usd: unknown): Tracker => {
  const gold = goldMeasured(tracker.gold, usd, tracker.active)

  return gold === tracker.gold ? tracker : { ...tracker, gold }
}

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
    turn: { id: start.id, prompt: start.prompt, tools: [], startedAt: start.now },
    running: [],
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

export const callStarted = (tracker: Tracker, call: Running): Tracker => ({
  ...tracker,
  running: [...tracker.running.filter(item => item.id !== call.id), call].slice(-MAX_TOOLS),
})

// A call ends by success, error or refusal alike: it leaves the list.
export const callEnded = (tracker: Tracker, id: number): Tracker =>
  tracker.running.some(item => item.id === id)
    ? { ...tracker, running: tracker.running.filter(item => item.id !== id) }
    : tracker

export type Gain = { cls: TaskClass; xp: number; level: number; leveledUp: boolean }

// A tool call that worked pays its own class, at once: by what it took and what it wrote, plus
// a bonus for making a failing call pass again. Only calls inside a turn pay. A rejected call
// (`rejected`) is neither: it raises no bug, defeats none and pays nothing.
export const toolFinished = (
  tracker: Tracker,
  done: { use: ToolUse; isError: boolean; now: number; durationMs: number; rejected?: boolean },
): { tracker: Tracker; gain?: Gain } => {
  // A call the person turned down did not fail and did not work: the bug stays as it was and nothing is paid.
  if (done.rejected === true) return { tracker: { ...tracker, lastActivityAt: done.now } }

  const bug = onToolResult(tracker.bug, {
    category: categoryOf(done.use.tool, done.use.command),
    isError: done.isError,
    now: done.now,
  })
  const resolved = tracker.bug.phase === 'alive' && bug.phase === 'defeated'
  const turn = tracker.turn
  const counters = onOperation(tracker.counters, { isError: done.isError, defeated: resolved && !done.isError })
  const cls = classOf(done.use, tracker.planMode)
  // A call that ran in a turn, whether it worked or not, weighs on its class in the next reading of the cost.
  const gold = turn === null ? tracker.gold : goldOperation(tracker.gold, cls)
  const moved: Tracker = { ...tracker, bug, counters, gold, lastActivityAt: done.now }
  if (turn === null || done.isError) return { tracker: moved }

  const xp = operationXp({ durationMs: done.durationMs, lines: done.use.lines ?? 0 }) + (resolved ? BUG_BONUS : 0)
  const added = addXp(tracker.guild, cls, xp)
  const entry: Entry = { cls, xp, at: done.now, tool: done.use.tool }

  return {
    tracker: { ...moved, guild: added.guild, recent: [...tracker.recent, entry].slice(-MAX_RECENT) },
    gain: { cls, xp, level: added.level, leveledUp: added.leveledUp },
  }
}

// A defeated bug leaves once its animation ran, a live one after the quiet period.
export const tick = (tracker: Tracker, now: number): Tracker => {
  const bug = bugAt(tracker.bug, now)

  return bug === tracker.bug ? tracker : { ...tracker, bug }
}

// The operations were paid as they finished; a turn the model answered pays a little
// more for the answer, and an interrupted one or one an API error killed only closes.
export const completeTurn = (
  tracker: Tracker,
  end: { id: string; reason: string; now: number; durationMs: number },
): { tracker: Tracker; gain?: Gain } => {
  const turn = tracker.turn
  if (turn === null || turn.id !== end.id) return { tracker }

  const idle: Tracker = { ...tracker, turn: null, running: [], lastActivityAt: end.now, lastTurnMs: end.durationMs }
  if (end.reason !== 'answer') return { tracker: idle }

  const added = addXp(tracker.guild, tracker.active, ANSWER_XP)

  return {
    tracker: {
      ...idle,
      guild: added.guild,
      recent: [...tracker.recent, { cls: tracker.active, xp: ANSWER_XP, at: end.now, tool: 'resposta' }].slice(-MAX_RECENT),
    },
    gain: { cls: tracker.active, xp: ANSWER_XP, level: added.level, leveledUp: added.leveledUp },
  }
}
