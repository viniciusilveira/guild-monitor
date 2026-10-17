import type { BugPhase } from '../types'

export type Size = 'full' | 'mini'

// A character of 32x32 pixels takes 32 columns and 16 rows; the reduced one half of each.
export const CELLS: Record<Size, { columns: number; rows: number }> = {
  full: { columns: 32, rows: 16 },
  mini: { columns: 16, rows: 8 },
}

export const INFO_COLUMNS = 28
const GAP = 1

export type Layout = {
  active: Size
  info: boolean
  others: boolean
  // The bug beside the characters, or under the stats of the active one when it has the room.
  bug: boolean
  bugBelow: boolean
}

// What fits in the band: the active character first, then the text beside it,
// then the other two characters, then the bug. Nothing at all when even the
// active one does not fit.
export const chooseLayout = (
  columns: number,
  rows: number,
  bandSize: 'full' | 'compact',
  bug: BugPhase,
): Layout | null => {
  const active: Size = bandSize === 'full' && rows >= CELLS.full.rows ? 'full' : 'mini'
  const own = CELLS[active].columns
  if (rows < CELLS[active].rows || columns < own) return null

  const withInfo = own + GAP + INFO_COLUMNS
  const withOthers = withInfo + GAP + CELLS.mini.columns * 2 + GAP
  const withBug = withOthers + GAP + CELLS.mini.columns

  const info = columns >= withInfo
  // A full character is 16 rows tall: eight lines of stats and the bug's eight fit beside it.
  const bugBelow = bug !== 'none' && info && active === 'full'

  return {
    active,
    info,
    others: columns >= withOthers,
    bug: bug !== 'none' && !bugBelow && columns >= withBug,
    bugBelow,
  }
}
