import type { TaskClass } from './classify'

export const CLASSES: readonly TaskClass[] = ['mago', 'guerreiro', 'explorador']

export type Guild = Record<TaskClass, { xp: number }>

export const emptyGuild = (): Guild => ({ mago: { xp: 0 }, guerreiro: { xp: 0 }, explorador: { xp: 0 } })

const STEP = 40
const OPERATION_XP = 2
const TIME_STEP_MS = 2_000
const TIME_BONUS_CAP = 4
const LINES_STEP = 20
const SIZE_BONUS_CAP = 4
export const BUG_BONUS = 10
export const ANSWER_XP = 3

// Level 1 starts at 0 XP, level 2 at 40, level 3 at 160, level 4 at 360.
export const xpForLevel = (level: number): number => STEP * (level - 1) ** 2

export const levelOf = (xp: number): number => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / STEP))

export type Progress = { level: number; current: number; needed: number }

// Where the character stands inside its level: `current` of `needed` XP.
export const progressOf = (xp: number): Progress => {
  const level = levelOf(xp)
  const floor = xpForLevel(level)

  return { level, current: xp - floor, needed: xpForLevel(level + 1) - floor }
}

export type Operation = {
  // How long the tool call ran.
  durationMs: number
  // Lines it wrote, where the call says: an edit or a new file.
  lines: number
}

// What one tool call that worked is worth: a base, plus up to 4 for the time it
// took and up to 4 for the size of what it wrote, 10 at most.
export const operationXp = (operation: Operation): number => {
  const time = Math.min(Math.floor(Math.max(0, operation.durationMs) / TIME_STEP_MS), TIME_BONUS_CAP)
  const size = Math.min(Math.floor(Math.max(0, operation.lines) / LINES_STEP), SIZE_BONUS_CAP)

  return OPERATION_XP + time + size
}

export type Gain = { guild: Guild; level: number; leveledUp: boolean }

export const addXp = (guild: Guild, cls: TaskClass, amount: number): Gain => {
  const before = levelOf(guild[cls].xp)
  const xp = guild[cls].xp + Math.max(0, Math.floor(amount))
  const level = levelOf(xp)

  return { guild: { ...guild, [cls]: { xp } }, level, leveledUp: level > before }
}

// What the store hands back is JSON anyone could have edited: keep the XP that
// is a sane number and start the rest from zero.
export const parseGuild = (stored: unknown): Guild => {
  const guild = emptyGuild()
  if (typeof stored !== 'object' || stored === null) return guild

  for (const cls of CLASSES) {
    const entry = (stored as Record<string, unknown>)[cls]
    const xp = typeof entry === 'object' && entry !== null ? (entry as { xp?: unknown }).xp : undefined

    if (typeof xp === 'number' && Number.isFinite(xp) && xp > 0) guild[cls] = { xp: Math.floor(xp) }
  }

  return guild
}
