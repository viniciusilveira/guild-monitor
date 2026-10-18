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
  // The latest payments of XP, oldest first.
  recent: RecentOp[]
  // The latest call that has not finished, or null when nothing runs.
  doing: Doing | null
  // Whole seconds since the session began (null while unknown) and of the current turn, or of the last one
  // that ended (null before the first). Whole seconds, so the view only changes when a second does.
  sessionSeconds: number | null
  turnSeconds: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'guild-monitor': { view: ViewModel | null; panel: boolean }
  }
}
