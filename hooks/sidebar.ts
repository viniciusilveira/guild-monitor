import type { BugPhase } from '../types'
import type { Size } from './layout'
import { CELLS } from './layout'

export type SidebarLayout = {
  // The active character's size, or null when only text fits.
  active: Size | null
  // The stats to the right of the active character, or under it when there is no width.
  stats: 'beside' | 'below'
  // The other two characters side by side, one over the other, or not at all.
  others: 'row' | 'stack' | null
  bug: boolean
}

const GAP = 1
// The widest stat line (`MP ▰▰▰▰▰▰▰▰ 100% 2h13`) with a little to spare.
export const STATS_COLUMNS = 24
const SIDE_BY_SIDE = CELLS.mini.columns * 2 + GAP

// What fits in a narrow column that the person sizes: the active character as
// large as the width lets it, its stats to the right of it when they fit, then
// the bug under them and the others.
// Below the width of a reduced character only text is left.
export const chooseSidebarLayout = (columns: number, bandSize: 'full' | 'compact', bug: BugPhase): SidebarLayout => {
  if (columns < CELLS.mini.columns) return { active: null, stats: 'below', others: null, bug: false }

  const active: Size = bandSize === 'full' && columns >= CELLS.full.columns ? 'full' : 'mini'

  return {
    active,
    stats: columns >= CELLS[active].columns + GAP + STATS_COLUMNS ? 'beside' : 'below',
    others: columns >= SIDE_BY_SIDE ? 'row' : 'stack',
    bug: bug !== 'none',
  }
}
