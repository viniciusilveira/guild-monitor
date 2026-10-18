import type { Elements } from 'claude-code'

import type { ViewModel } from '../types'
import type { TaskClass } from './classify'
import { counterLine, counterSegments } from './counters'
import { doingLine } from './doing'
import { goldTexts } from './gold'
import type { Layout, Size } from './layout'
import { CELLS, INFO_COLUMNS } from './layout'
import type { SidebarLayout } from './sidebar'
import { STATS_COLUMNS } from './sidebar'
import { modelFit, tokenText } from './tokens'
import { agoText, bandForecast, bar, COLORS, costText, durationText, fitForecast, healthColor, METER_COLORS, NAMES, TOKENS_COLOR, percentText, restText, untilReset, URGENT_COLOR } from './view'

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

// A length of time the view carries in whole seconds, or `--` while it is unknown.
const seconds = (value: number | null): string => (value === null ? '--' : durationText(value * 1000))

// The lines of the active character's stats, each in the color of its meter. What the character does (or
// that it rests, is tired or sleeps) is the line above them, so the stats do not repeat it.
const statLines = (ui: Elements['terminal'], view: ViewModel, active: Char, now: number, width: number, turnTimer = false) => {
  const { Box, Text } = ui
  const xpPercent = active.xpNeeded > 0 ? Math.round((active.xpInLevel / active.xpNeeded) * 100) : 0
  const reset = untilReset(view.manaResetsAt, now)
  const name = `${NAMES[active.cls]} Nv.${active.level}`
  const model = view.model === null ? null : modelFit(view.model, width - name.length - 1)

  return [
    <Box key="name" flexDirection="row" gap={1}>
      <Text bold color={COLORS[active.cls]}>
        {name}
      </Text>
      {model !== null && <Text dimColor>{model}</Text>}
    </Box>,
    <Text key="xp" color={METER_COLORS.xp}>{`XP ${bar(xpPercent)} ${active.xpInLevel}/${active.xpNeeded}`}</Text>,
    <Text key="hp" color={healthColor(view.hp)}>{`HP ${bar(view.hp)} ${percentText(view.hp)}`}</Text>,
    <Text key="mp" color={view.mana === null ? METER_COLORS.unknown : METER_COLORS.mana}>
      {`MP ${bar(view.mana)} ${percentText(view.mana)}${reset === '' ? '' : ` ${reset}`}`}
    </Text>,
    <Text key="st" color={view.stamina === null ? METER_COLORS.unknown : METER_COLORS.stamina}>
      {`ST ${bar(view.stamina)} ${percentText(view.stamina)}`}
    </Text>,
    <Text key="gold" color={view.costUsd === null ? METER_COLORS.unknown : METER_COLORS.gold}>
      {`ouro ${costText(view.costUsd)}${turnTimer && view.working && view.turnSeconds !== null ? ` · turno ${seconds(view.turnSeconds)}` : ''}`}
    </Text>,
  ]
}

type Forecast = NonNullable<ViewModel['forecast']['fiveHour']>

const forecastColors = (forecast: Forecast) => (forecast.urgent ? { color: URGENT_COLOR } : { dimColor: true })

// The panel's lines, one per window that has something to say: 5h first, the nearer one.
const forecastLines = (ui: Elements['terminal'], view: ViewModel, width: number) => {
  const { Text } = ui
  const windows = [
    { key: 'forecast-5h', label: '5h', forecast: view.forecast.fiveHour },
    { key: 'forecast-7d', label: '7d', forecast: view.forecast.sevenDay },
  ]

  return windows.flatMap(({ key, label, forecast }) => {
    const text = forecast === null ? null : fitForecast(label, forecast, width)

    return forecast === null || text === null
      ? []
      : [
          <Text key={key} {...forecastColors(forecast)}>
            {text}
          </Text>,
        ]
  })
}

// The band's one line for the windows, or nothing.
const bandForecastLine = (ui: Elements['terminal'], view: ViewModel) => {
  const { Text } = ui
  const chosen = bandForecast(view.forecast)
  const text = chosen === null ? null : fitForecast(chosen.label, chosen.line, INFO_COLUMNS)

  return chosen === null || text === null ? null : (
    <Text key="forecast" {...forecastColors(chosen.line)}>
      {text}
    </Text>
  )
}

// The panel's lines of tokens: the last turn, the session and the subagents, each only when it has something to
// say; a low cache hit rate is red. None at all before a turn reports usage.
const tokenLines = (ui: Elements['terminal'], view: ViewModel, width: number) => {
  const { Text } = ui
  const rows = [
    { key: 'tokens-turn', label: 'tokens', line: view.tokens?.turn ?? null },
    { key: 'tokens-session', label: 'sessão', line: view.tokens?.session ?? null },
    { key: 'tokens-subagents', label: 'subagentes', line: view.tokens?.subagents ?? null },
  ]

  return rows.flatMap(({ key, label, line }) => {
    const text = line === null ? null : tokenText(label, line, width)

    return line === null || text === null
      ? []
      : [
          <Text key={key} color={line.low ? URGENT_COLOR : TOKENS_COLOR}>
            {text}
          </Text>,
        ]
  })
}

// The panel's lines of the gold by class, an estimate (the "~"): none until the cost has changed, and none when
// not even the shortest form fits the width.
const goldLines = (ui: Elements['terminal'], view: ViewModel, width: number) => {
  const { Text } = ui
  const texts = view.gold === null ? null : goldTexts(view.gold, width)

  return view.gold === null || texts === null
    ? []
    : view.gold.map((line, i) => (
        <Text key={`gold-${line.cls}`} color={COLORS[line.cls]}>
          {texts[i]}
        </Text>
      ))
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
  // One line for the windows. With a full character it follows the stats; with a reduced one (8 rows) it takes
  // the legend's line, and the bug's warning comes before it.
  const forecast = bandForecastLine(ui, view)

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
          {statLines(ui, view, active, now, INFO_COLUMNS, true)}
          {layout.active === 'full' && forecast}
          {layout.bugBelow ? (
            <Raster key="bug" columns={mini.columns} rows={mini.rows} cells={cellsFor('bug', 'bug', 'mini')} />
          ) : view.bug !== 'none' && !layout.bug ? (
            <Text color="red">bug na área!</Text>
          ) : layout.active === 'mini' && forecast !== null ? (
            forecast
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
            {statLines(ui, view, active, now, STATS_COLUMNS)}
            {legend}
            {forecastLines(ui, view, STATS_COLUMNS)}
            {bugUnderStats && bugBox}
          </Box>
        )}
      </Box>
      {layout.stats === 'below' && statLines(ui, view, active, now, columns)}
      {layout.stats === 'below' && legend}
      {layout.stats === 'below' && forecastLines(ui, view, columns)}
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
      <Text key="counters" color={METER_COLORS.gold}>{counterLine(counterSegments(view.counters))}</Text>
      {goldLines(ui, view, columns)}
      <Text key="session-time" dimColor>{`sessão ${seconds(view.sessionSeconds)}`}</Text>
      <Text key="turn-time" dimColor>{`turno ${seconds(view.turnSeconds)}`}</Text>
      {tokenLines(ui, view, columns)}
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
