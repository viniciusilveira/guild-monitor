import type { ViewModel } from '../types'
import { compactionSegments } from './compactions'
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

// The pieces of the counters line, in order. It takes the whole view, so a new counter adds its field to the view
// and its segment here without changing the signature; the line only joins what it is given.
export const counterSegments = (view: ViewModel, short = false): string[] => [
  ...(view.counters.combo >= COMBO_MIN ? [`combo x${view.counters.combo}`] : []),
  ...(view.counters.best >= COMBO_MIN ? [`melhor x${view.counters.best}`] : []),
  `bugs ${view.counters.bugs}`,
  ...damageSegments(view.damage, short),
  ...compactionSegments(view.compactions, short),
]

export const counterLine = (segments: readonly string[]): string => segments.join(' · ')

// The line fitted to the width, like the gold, token and forecast lines: the damage and the compactions in full
// words, else in the short form, else only the segments that fit, in order; combo, best combo and bugs always stay.
export const fitCounterLine = (view: ViewModel, width: number): string => {
  const base = counterSegments({ ...view, damage: { files: 0, lines: 0, commands: 0 }, compactions: 0 })
  const full = counterLine(counterSegments(view))

  if (full.length <= width) return full

  const short = counterSegments(view, true)
  const kept = short.slice(base.length)
  let line = counterLine(short)

  for (let count = kept.length; line.length > width && count > 0; ) {
    count -= 1
    line = counterLine([...base, ...kept.slice(0, count)])
  }

  return line
}
