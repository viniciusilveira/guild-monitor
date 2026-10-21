export type TaskClass = 'mago' | 'guerreiro' | 'explorador'

export type Animation = 'trabalho' | 'dormindo' | 'cansado' | 'parado'

export type BugPhase = 'none' | 'alive' | 'defeated'

export type CharView = {
  cls: TaskClass
  anim: Animation
  level: number
  // XP gained inside the current level, and what that level asks in all.
  xpInLevel: number
  xpNeeded: number
}

// One payment of XP in the history: who got it, how much, when (ms) and for which tool.
export type RecentOp = {
  cls: TaskClass
  xp: number
  at: number
  tool: string
}

// What the active character is doing now: the verb of the tool and, for a file or a shell command,
// its short target. It lives on screen and in memory only, never in the store.
export type Doing = { verb: string; target: string | null }

// What the screen says about a window running out: the text, a shorter text for a narrow place, and whether it
// comes before the reset (red). In memory and on screen only.
export type ForecastView = { text: string; short: string; urgent: boolean }

// One class's share of the session's cost, an estimate: micro-dollars and whole percent (the three add up to 100).
export type GoldLine = { cls: TaskClass; micros: number; percent: number }

// What the band draws, with the per-frame animation left out: it changes when
// something happens (a turn, a tool, a measurement), not at every frame.
export type ViewModel = {
  active: TaskClass
  working: boolean
  chars: CharView[]
  bug: BugPhase
  // Percent left: HP of the 7-day window, mana of the 5-hour one, stamina of
  // the context. Null while unknown (off a subscription, before a response).
  hp: number | null
  mana: number | null
  stamina: number | null
  manaResetsAt: string | null
  costUsd: number | null
  // What each class spent of that cost, as an estimate, in the order of the classes; null until the cost has changed.
  // In memory and on screen only.
  gold: GoldLine[] | null
  // The split began after the session had already cost something (a resumed session): the lines add up to less than
  // the cost shown, and the screen says so.
  goldPartial: boolean
  // The session's scores, in memory only: operations in a row that worked, the best such run and bugs defeated.
  counters: { combo: number; best: number; bugs: number }
  // The session's damage dealt, in memory only: distinct files edited, lines written and shell commands run, all that worked.
  damage: { files: number; lines: number; commands: number }
  // The latest payments of XP, oldest first.
  recent: RecentOp[]
  // The latest call that has not finished, or null when nothing runs.
  doing: Doing | null
  // The forecast of each subscription window; null while there is not enough data or the option is off.
  forecast: { sevenDay: ForecastView | null; fiveHour: ForecastView | null }
  // Whole seconds since the session began (null while unknown) and of the current turn, or of the last one
  // that ended (null before the first). Whole seconds, so the view only changes when a second does.
  sessionSeconds: number | null
  turnSeconds: number | null
  // The tokens spent, in memory and on screen only: the last main-agent turn with usage, the main agent's total
  // and the subagents' total (each null until there is one); null for all when no turn has reported usage.
  tokens: { turn: TokenLine | null; session: TokenLine | null; subagents: TokenLine | null } | null
  // The model of the last main-agent turn with usage, null before one.
  model: string | null
}

// One line of the tokens on screen: the whole prompt read (uncached + cache read + cache written), what was
// generated and the cache hit rate in percent (null while undefined), with whether that rate is low.
export type TokenLine = { input: number; output: number; cache: number | null; low: boolean }

declare module 'claude-code' {
  interface PluginState {
    'guild-monitor': { view: ViewModel | null; panel: boolean; meters: string }
  }
}
