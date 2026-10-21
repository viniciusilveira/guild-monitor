import type { ViewModel } from '../types'
import { damageSegments } from './damage'

// The session's scores: the combo (operations in a row that worked), the best combo and the bugs
// defeated. They live in memory with the tracker and start over with the session.
export type Counters = { combo: number; best: number; bugs: number }

export const NO_COUNTERS: Counters = { combo: 0, best: 0, bugs: 0 }

// The combo is hidden below this, so the screen is not filled with "x1".
export const COMBO_MIN = 3

export type Operation = {
  // The call failed: it resets the combo.
  isError: boolean
  // The call took a live bug down (the transition that also pays the XP bonus): it counts once.
  defeated: boolean
}

// A call that was refused is not an operation and never gets here.
export const onOperation = (counters: Counters, operation: Operation): Counters => {
  const combo = operation.isError ? 0 : counters.combo + 1

  return {
    combo,
    best: Math.max(counters.best, combo),
    bugs: counters.bugs + (operation.defeated ? 1 : 0),
  }
}

// The pieces of the counters line, in order. It takes the whole view, so a later slice (compactions) adds its
// field to the view and its segment here without changing the signature; the line only joins what it is given.
export const counterSegments = (view: ViewModel): string[] => [
  ...(view.counters.combo >= COMBO_MIN ? [`combo x${view.counters.combo}`] : []),
  ...(view.counters.best >= COMBO_MIN ? [`melhor x${view.counters.best}`] : []),
  `bugs ${view.counters.bugs}`,
  ...damageSegments(view.damage),
]

export const counterLine = (segments: readonly string[]): string => segments.join(' · ')
