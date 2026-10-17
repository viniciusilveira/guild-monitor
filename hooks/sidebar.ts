import type { BugPhase } from '../types'
import type { Size } from './layout'
import { CELLS } from './layout'

export type SidebarLayout = {
  // The active character's size, or null when only text fits.
  active: Size | null
  // The other two characters side by side, one over the other, or not at all.
  others: 'row' | 'stack' | null
  bug: boolean
}

const GAP = 1
const SIDE_BY_SIDE = CELLS.mini.columns * 2 + GAP

// What fits in a narrow column that the person sizes: the active character as
// large as the width lets it, then the others and the bug under the stats.
// Below the width of a reduced character only text is left.
export const chooseSidebarLayout = (columns: number, bandSize: 'full' | 'compact', bug: BugPhase): SidebarLayout => {
  if (columns < CELLS.mini.columns) return { active: null, others: null, bug: false }

  return {
    active: bandSize === 'full' && columns >= CELLS.full.columns ? 'full' : 'mini',
    others: columns >= SIDE_BY_SIDE ? 'row' : 'stack',
    bug: bug !== 'none',
  }
}
