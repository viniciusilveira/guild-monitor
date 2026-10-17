import type { TaskClass } from './classify'

export type Animation = 'trabalho' | 'dormindo' | 'cansado' | 'parado'

export type Settings = {
  // Idle time after which characters fall asleep.
  sleepAfterMs: number
  // Context fill, in percent, from which characters tire.
  tiredAtPercent: number
}

export const DEFAULTS: Settings = { sleepAfterMs: 90_000, tiredAtPercent: 75 }

export type Snapshot = {
  // A turn of the main loop is running.
  working: boolean
  // The class doing that turn's work, or the last one that did.
  active: TaskClass
  // Time since the last prompt, tool call or turn end.
  idleMs: number
  // How full the context window is; unknown until the first response.
  contextPercent: number | undefined
}

// Working beats everything and only the active class works; a rested
// character after a long idle sleeps; one in a heavy context is tired;
// the rest wait.
export const animationFor = (cls: TaskClass, snapshot: Snapshot, settings: Settings = DEFAULTS): Animation => {
  if (snapshot.working && cls === snapshot.active) return 'trabalho'
  if (!snapshot.working && snapshot.idleMs >= settings.sleepAfterMs) return 'dormindo'
  if ((snapshot.contextPercent ?? 0) >= settings.tiredAtPercent) return 'cansado'

  return 'parado'
}

export type BugPhase = 'none' | 'alive' | 'defeated'

// The enemy of the warrior: it shows up when a tool fails and goes down when
// the same kind of call succeeds.
export type Bug = { phase: BugPhase; category: string; since: number }

export const NO_BUG: Bug = { phase: 'none', category: '', since: 0 }

// How long the defeat animation stays before the bug is gone.
export const DEFEAT_MS = 1_200

const RUNNERS_WITH_SUBCOMMAND = /^[a-z][\w.-]*$/

// What makes two tool calls the same kind: the tool, and for Bash the program
// and its subcommand (`npm test`, `git push`), so a passing `npm test` beats a
// failing `npm test` but not a failing `git push`.
export const categoryOf = (tool: string, command?: string): string => {
  if (tool !== 'Bash') return tool

  const [head = '', second = ''] = (command ?? '').trim().split(/\s+/)
  const sub = RUNNERS_WITH_SUBCOMMAND.test(second) ? ` ${second}` : ''

  return `Bash:${head}${sub}`
}

export type ToolResult = { category: string; isError: boolean; now: number }

export const onToolResult = (bug: Bug, result: ToolResult): Bug => {
  if (result.isError) return { phase: 'alive', category: result.category, since: result.now }
  if (bug.phase === 'alive' && bug.category === result.category) {
    return { phase: 'defeated', category: bug.category, since: result.now }
  }

  return bug
}

// The bug a clock tick sees: a defeated one is gone once its animation ran.
export const bugAt = (bug: Bug, now: number): Bug =>
  bug.phase === 'defeated' && now - bug.since >= DEFEAT_MS ? NO_BUG : bug
