import type { Elements } from 'claude-code'

import type { ViewModel } from '../types'
import type { TaskClass } from './classify'
import { doingLine } from './doing'
import type { Layout, Size } from './layout'
import { CELLS, INFO_COLUMNS } from './layout'
import type { SidebarLayout } from './sidebar'
import { STATS_COLUMNS } from './sidebar'
import { agoText, bar, COLORS, costText, healthColor, METER_COLORS, NAMES, percentText, restText, stateText, untilReset } from './view'

// The cells of one Raster, given its key, who it draws and at what size. The
// caller keeps track of what it handed out, to animate it later.
export type CellsFor = (key: string, who: TaskClass | 'bug', size: Size) => string

export type BandArgs = {
  view: ViewModel
  layout: Layout
  now: number
  cellsFor: CellsFor
}

type Char = ViewModel['chars'][number]

// What the active character is doing right now, or resting; it gives up the name and then the target
// when the width does not hold them.
const doingText = (ui: Elements['terminal'], view: ViewModel, active: Char, columns: number) => {
  const { Text } = ui

  return (
    <Text key="doing" bold color={COLORS[active.cls]}>
      {doingLine({ name: NAMES[active.cls], doing: view.doing, rest: restText(active.anim), columns })}
    </Text>
  )
}

// The lines of the active character's stats, each in the color of its meter.
const statLines = (ui: Elements['terminal'], view: ViewModel, active: Char, now: number) => {
  const { Text } = ui
  const xpPercent = active.xpNeeded > 0 ? Math.round((active.xpInLevel / active.xpNeeded) * 100) : 0
  const reset = untilReset(view.manaResetsAt, now)

  return [
    <Text key="name" bold color={COLORS[active.cls]}>
      {`${NAMES[active.cls]} Nv.${active.level}`}
    </Text>,
    <Text key="state" dimColor>
      {stateText(active.cls, active.anim)}
    </Text>,
    <Text key="xp" color={METER_COLORS.xp}>{`XP ${bar(xpPercent)} ${active.xpInLevel}/${active.xpNeeded}`}</Text>,
    <Text key="hp" color={healthColor(view.hp)}>{`HP ${bar(view.hp)} ${percentText(view.hp)}`}</Text>,
    <Text key="mp" color={view.mana === null ? METER_COLORS.unknown : METER_COLORS.mana}>
      {`MP ${bar(view.mana)} ${percentText(view.mana)}${reset === '' ? '' : ` ${reset}`}`}
    </Text>,
    <Text key="st" color={view.stamina === null ? METER_COLORS.unknown : METER_COLORS.stamina}>
      {`ST ${bar(view.stamina)} ${percentText(view.stamina)}`}
    </Text>,
    <Text key="gold" color={view.costUsd === null ? METER_COLORS.unknown : METER_COLORS.gold}>
      {`ouro ${costText(view.costUsd)}`}
    </Text>,
  ]
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
          {doingText(ui, view, active, INFO_COLUMNS)}
          {statLines(ui, view, active, now)}
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

export type SidebarArgs = {
  view: ViewModel
  // The width of the panel's body, which decides how much of the doing line fits.
  columns: number
  layout: SidebarLayout
  now: number
  cellsFor: CellsFor
}

const HISTORY_ROWS = 8

// The side panel: the same guild as the band, stacked in one column, with the
// latest XP payments at the bottom. The engine scrolls what does not fit.
export const sidebarTree = (ui: Elements['terminal'], args: SidebarArgs) => {
  const { Box, Text, Raster } = ui
  const { view, columns, layout, now, cellsFor } = args
  const active = view.chars.find(char => char.cls === view.active) ?? view.chars[0]
  if (active === undefined) return undefined

  const mini = CELLS.mini
  const others = view.chars.filter(char => char.cls !== view.active)
  const history = view.recent.slice(-HISTORY_ROWS).reverse()

  // Beside a full character the bug fits right under the stats: seven lines and eight rows are its 16.
  const bugUnderStats = layout.bug && layout.stats === 'beside' && layout.active === 'full'
  // What each meter stands for: it is eight lines with the stats, so the bug under them still fits in 16 rows.
  const legend = (
    <Text key="legend" dimColor>
      HP=7d MP=5h ST=ctx
    </Text>
  )
  const bugBox = (
    <Box key="bug-box" flexDirection="column">
      <Raster key="bug" columns={mini.columns} rows={mini.rows} cells={cellsFor('bug', 'bug', 'mini')} />
    </Box>
  )

  return (
    <Box flexDirection="column">
      {doingText(ui, view, active, columns)}
      <Box flexDirection="row" gap={1}>
        {layout.active !== null && (
          <Raster
            key={`char:${active.cls}`}
            columns={CELLS[layout.active].columns}
            rows={CELLS[layout.active].rows}
            cells={cellsFor(`char:${active.cls}`, active.cls, layout.active)}
          />
        )}
        {layout.stats === 'beside' && (
          <Box flexDirection="column" width={STATS_COLUMNS} alignSelf="flex-start">
            {statLines(ui, view, active, now)}
            {legend}
            {bugUnderStats && bugBox}
          </Box>
        )}
      </Box>
      {layout.stats === 'below' && statLines(ui, view, active, now)}
      {layout.stats === 'below' && legend}
      {layout.bug && !bugUnderStats && bugBox}
      {layout.others !== null && (
        <Box flexDirection={layout.others === 'row' ? 'row' : 'column'} gap={1}>
          {others.map(char => (
            <Box key={`box:${char.cls}`} flexDirection="column">
              <Raster
                key={`char:${char.cls}`}
                columns={mini.columns}
                rows={mini.rows}
                cells={cellsFor(`char:${char.cls}`, char.cls, 'mini')}
              />
              <Text dimColor>{`${NAMES[char.cls]} Nv.${char.level}`}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Text dimColor>Últimas operações</Text>
      {history.length === 0 && <Text dimColor>nenhuma ainda</Text>}
      {history.map((entry, i) => (
        <Text key={`op:${i}`} color={COLORS[entry.cls]}>
          {`${agoText(entry.at, now).padEnd(5)} ${NAMES[entry.cls]} +${entry.xp} ${entry.tool}`}
        </Text>
      ))}
    </Box>
  )
}
