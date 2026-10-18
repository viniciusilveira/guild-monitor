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

// The pieces of the counters line, in order. Later slices (damage dealt, compactions) add theirs
// to the list; the line only joins what it is given.
export const counterSegments = (counters: Counters): string[] => [
  ...(counters.combo >= COMBO_MIN ? [`combo x${counters.combo}`] : []),
  ...(counters.best >= COMBO_MIN ? [`melhor x${counters.best}`] : []),
  `bugs ${counters.bugs}`,
]

export const counterLine = (segments: readonly string[]): string => segments.join(' · ')
