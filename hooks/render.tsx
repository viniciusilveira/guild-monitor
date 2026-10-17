import type { Elements } from 'claude-code'

import type { ViewModel } from '../types'
import type { TaskClass } from './classify'
import type { Layout, Size } from './layout'
import { CELLS, INFO_COLUMNS } from './layout'
import { bar, COLORS, costText, healthColor, METER_COLORS, NAMES, percentText, stateText, untilReset } from './view'

// The cells of one Raster, given its key, who it draws and at what size. The
// caller keeps track of what it handed out, to animate it later.
export type CellsFor = (key: string, who: TaskClass | 'bug', size: Size) => string

export type BandArgs = {
  view: ViewModel
  layout: Layout
  now: number
  cellsFor: CellsFor
}

// The band above the prompt: the active character, its attributes, the other
// two characters and, when a tool is failing, the bug.
export const bandTree = (ui: Elements['terminal'], args: BandArgs) => {
  const { Box, Text, Raster } = ui
  const { view, layout, now, cellsFor } = args
  const active = view.chars.find(char => char.cls === view.active) ?? view.chars[0]
  if (active === undefined) return undefined

  const own = CELLS[layout.active]
  const mini = CELLS.mini
  const xpPercent = active.xpNeeded > 0 ? Math.round((active.xpInLevel / active.xpNeeded) * 100) : 0
  const reset = untilReset(view.manaResetsAt, now)

  return (
    <Box flexDirection="row" alignItems="flex-end" gap={1}>
      <Raster
        key={`char:${active.cls}`}
        columns={own.columns}
        rows={own.rows}
        cells={cellsFor(`char:${active.cls}`, active.cls, layout.active)}
      />
      {layout.info && (
        <Box flexDirection="column" width={INFO_COLUMNS} alignSelf="flex-start">
          <Text bold color={COLORS[active.cls]}>
            {`${NAMES[active.cls]} Nv.${active.level}`}
          </Text>
          <Text dimColor>{stateText(active.cls, active.anim)}</Text>
          <Text color={METER_COLORS.xp}>{`XP ${bar(xpPercent)} ${active.xpInLevel}/${active.xpNeeded}`}</Text>
          <Text color={healthColor(view.hp)}>{`HP ${bar(view.hp)} ${percentText(view.hp)}`}</Text>
          <Text color={view.mana === null ? METER_COLORS.unknown : METER_COLORS.mana}>
            {`MP ${bar(view.mana)} ${percentText(view.mana)}${reset === '' ? '' : ` ${reset}`}`}
          </Text>
          <Text color={view.stamina === null ? METER_COLORS.unknown : METER_COLORS.stamina}>
            {`ST ${bar(view.stamina)} ${percentText(view.stamina)}`}
          </Text>
          <Text color={view.costUsd === null ? METER_COLORS.unknown : METER_COLORS.gold}>{`ouro ${costText(view.costUsd)}`}</Text>
          {view.bug !== 'none' && !layout.bug && !layout.bugBelow && <Text color="red">bug na área!</Text>}
          {layout.bugBelow ? (
            <Raster key="bug" columns={mini.columns} rows={mini.rows} cells={cellsFor('bug', 'bug', 'mini')} />
          ) : (
            <Text dimColor>HP=7d MP=5h ST=ctx</Text>
          )}
        </Box>
      )}
      {layout.others &&
        view.chars
          .filter(char => char.cls !== view.active)
          .map(char => (
            <Box flexDirection="column">
              <Raster
                key={`char:${char.cls}`}
                columns={mini.columns}
                rows={mini.rows}
                cells={cellsFor(`char:${char.cls}`, char.cls, 'mini')}
              />
              <Text dimColor>{`${NAMES[char.cls]} Nv.${char.level}`}</Text>
            </Box>
          ))}
      {layout.bug && (
        <Box flexDirection="column">
          <Raster key="bug" columns={mini.columns} rows={mini.rows} cells={cellsFor('bug', 'bug', 'mini')} />
          <Text color="red">Bug</Text>
        </Box>
      )}
    </Box>
  )
}
