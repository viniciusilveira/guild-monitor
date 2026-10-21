import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register, StateDollar } from 'claude-code'

import type { ViewModel } from '../types'
import type { TaskClass, ToolUse } from './classify'
import { classOf, kindOf, linesWritten } from './classify'
import { compactionToast, countsAsCompaction } from './compactions'
import { fileOf } from './damage'
import { targetOf } from './doing'
import { chooseFrom, describeChoices, helpText, mergeSaved, requestOf, savedChoice, savedText } from './choices'
import { choiceOf, demoState, SCENES, SCHEME_SCENES, sceneOf, schemeOfScene } from './demo'
import type { History } from './forecast'
import { EMPTY_HISTORY, recordReadings } from './forecast'
import type { Settings } from './guild'
import { DEFAULTS, isRejection } from './guild'
import type { Size } from './layout'
import { chooseLayout } from './layout'
import { chooseSidebarLayout } from './sidebar'
import { encodeFrame } from './raster'
import { bandTree, sidebarTree } from './render'
import type { MeterScheme } from './schemes'
import { METER_CHOICES, SCHEMES } from './schemes'
import { FRAME_SIZE, MINI_SIZE, PALETTE, SHEETS } from './sprites.generated'
import type { Gain, Tracker } from './tracker'
import type { TraceEntry } from './trace'
import { appendTrace, describeTrace, parseTrace, programOf } from './trace'
import { callEnded, callStarted, compacted, completeTurn, costMeasured, createTracker, intervalNow, setPlanMode, staminaMeasured, startTurn, tick, tokensSpent, toolFinished, toolStarted } from './tracker'
import type { Usage } from './view'
import { buildView, frameAt, mergeUsage, NAMES, percentLeft, sheetIdFor, usageFrom } from './view'
import { emptyGuild, parseGuild } from './xp'

const STORE_KEY = 'guild.v1'
const TICK_MS = 50
// How often the session's figures are read again, whatever the engine reports: a report may never come.
const USAGE_EVERY_MS = 2_000

const viewAtom = atom({ plugin: 'guild-monitor', key: 'view' } as const, null)
// Whether the side panel is up, so the band yields to it.
const panelAtom = atom({ plugin: 'guild-monitor', key: 'panel' } as const, false)
// The color scheme of the meters: what is read from it is the name, and a change of it draws the screen again.
const metersAtom = atom({ plugin: 'guild-monitor', key: 'meters' } as const, '')

const PANEL_ID = 'guild'
// Wide enough for the full character with its stats beside it (see `STATS_COLUMNS`).
const PANEL_COLUMNS = 62
// What the person chose about the interface (the panel, the meters' scheme), kept between sessions: preferences only.
const UI_KEY = 'guild.ui.v1'
// The record of who was on screen at each step, kept to investigate the choice of character later.
const TRACE_KEY = 'guild.trace.v1'

const isClosedByPerson = (stored: unknown): boolean =>
  typeof stored === 'object' && stored !== null && (stored as { panel?: unknown }).panel === false

// What a Raster of the band shows right now, so the clock only repaints it
// when the frame or the animation changes.
type Mounted = { who: TaskClass | 'bug'; size: Size; sheetId: string; frame: number }

type Spec = { sheetId: string; frame: number }

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

// Frames are encoded the first time they are drawn and kept.
const encoded = new Map<string, string>()

const cellsOf = (sheetId: string, size: Size, frame: number): string | undefined => {
  const key = `${sheetId}/${size}/${frame}`
  const hit = encoded.get(key)
  if (hit !== undefined) return hit

  const sheet = SHEETS[sheetId]
  const pixels = size === 'full' ? sheet?.frames[frame] : sheet?.mini[frame]
  if (pixels === undefined) return undefined

  const side = size === 'full' ? FRAME_SIZE : MINI_SIZE
  const cells = encodeFrame(pixels, side, side, PALETTE)
  encoded.set(key, cells)

  return cells
}

// Which animation a character plays and which of its frames shows at `now`.
const specFor = (who: TaskClass | 'bug', view: ViewModel, tracker: Tracker, now: number): Spec => {
  if (who === 'bug') {
    const defeated = view.bug === 'defeated'
    const sheetId = sheetIdFor('bug', defeated ? 'derrotado' : 'parado')
    const sheet = SHEETS[sheetId]
    const elapsed = defeated ? now - tracker.bug.since : now

    return { sheetId, frame: sheet === undefined ? 0 : frameAt(sheet.durations, elapsed, sheet.loop) }
  }

  const sheetId = sheetIdFor(who, view.chars.find(char => char.cls === who)?.anim ?? 'parado')
  const sheet = SHEETS[sheetId]

  return { sheetId, frame: sheet === undefined ? 0 : frameAt(sheet.durations, now, sheet.loop) }
}

export type PublishCache = { signature: string }

// The band redraws when the view it reads changes, so a view is published as soon as an event
// changes what it is made of, not at the next tick; one equal to the last published is not written.
const publishView = async ($: StateDollar, view: ViewModel, cache: PublishCache): Promise<void> => {
  const signature = JSON.stringify(view)
  if (signature === cache.signature) return

  cache.signature = signature
  await update($, viewAtom, () => view)
}

// The monitor only watches: a view that cannot be published must never change what a tool call does or
// returns. The next publish starts again from a clean cache.
export const publishQuietly = async ($: StateDollar, make: () => ViewModel | Promise<ViewModel>, cache: PublishCache): Promise<void> => {
  try {
    await publishView($, await make(), cache)
  } catch {
    cache.signature = ''
  }
}

// A gain is saved with the guild and a new level is announced.
const applyGain = async ($: Pick<CoreEngineInterface, 'store' | 'ui'>, tracker: Tracker, gain: Gain | undefined): Promise<void> => {
  if (gain === undefined) return

  await $.store.set(STORE_KEY, tracker.guild)
  if (gain.leveledUp) $.ui.toast(`${NAMES[gain.cls]} subiu para o nível ${gain.level}!`)
}

type PanelDollar = Pick<CoreEngineInterface, 'store' | 'ui' | 'state'>

// One preference saved, the others kept.
const saveUi = async ($: Pick<CoreEngineInterface, 'store'>, field: string, value: unknown): Promise<void> => {
  await $.store.set(UI_KEY, mergeSaved(await $.store.get(UI_KEY), field, value))
}

// Opens the pane, which the engine seats beside the transcript when there is room and
// otherwise leaves undrawn. `remember` keeps it open for the next sessions: a command
// of the person's does, the opening at the start does not.
const showPanel = async ($: PanelDollar, remember: boolean): Promise<{ isPlaced: boolean; reason?: string }> => {
  const opened = await $.ui.open({ id: PANEL_ID, title: 'Guilda', columns: PANEL_COLUMNS })
  const isPlaced = opened.isPlaced === true

  await update($, panelAtom, () => isPlaced)
  if (isPlaced && remember) await saveUi($, 'panel', true)

  return { isPlaced, reason: 'reason' in opened ? String(opened.reason) : undefined }
}

const saveTrace = async ($: Pick<CoreEngineInterface, 'store'>, trace: readonly TraceEntry[]): Promise<void> => {
  await $.store.set(TRACE_KEY, trace)
}

const hidePanel = async ($: PanelDollar): Promise<void> => {
  await update($, panelAtom, () => false)
  await saveUi($, 'panel', false)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    sleepAfterMs: positive(options.sleepAfterSeconds, DEFAULTS.sleepAfterMs / 1000) * 1000,
    tiredAtPercent: positive(options.tiredAtPercent, DEFAULTS.tiredAtPercent),
  }
  const bandSize = options.bandSize === 'compact' ? 'compact' : 'full'
  // The forecast of the windows: on unless the person turned it off (anything else counts as on).
  const showForecast = options.showForecast !== 'off'
  const layoutMode = options.layout === 'bar' || options.layout === 'panel' ? options.layout : 'auto'
  // A demo scene shows made-up figures and ignores the session.
  let scene = sceneOf(options.demo)
  // The meters' scheme: the choice saved by `/guild meters` wins over the option; with neither, `padrao`.
  let meters: MeterScheme = chooseFrom(METER_CHOICES, [options.meters])
  // A scheme scene forces its scheme while it runs, and saves nothing.
  const colorsNow = () => SCHEMES[(scene === undefined ? undefined : schemeOfScene(scene)) ?? meters]

  let tracker: Tracker = createTracker(emptyGuild(), 0)
  let usage: Usage = { rateLimits: [] }
  // The recent readings of the rate limits, for the forecast: in memory only, never saved.
  let history: History = EMPTY_HISTORY
  let trace: TraceEntry[] = []
  let bandId: string | undefined
  // False until the guild is read from the store: before that the band keeps showing the last view.
  let isReady = false
  // Identifies each call in progress, so parallel calls end one by one.
  let nextCallId = 0
  const mounted = new Map<string, Mounted>()

  const cache: PublishCache = { signature: '' }

  const stateAt = (now: number): { tracker: Tracker; usage: Usage; history: History } =>
    scene === undefined ? { tracker, usage, history } : demoState(scene, now, settings)

  // What the view shows of the forecast comes from `history`, and from nothing when the option is off.
  const viewOf = (from: Tracker, figures: Usage, now: number, readings: History = history): ViewModel =>
    buildView(from, figures, now, settings, showForecast ? readings : EMPTY_HISTORY)

  // A measurement of the context brings the message of a compaction waiting for it; the toast is not behind an
  // option yet (`alerts` does not exist), so the call sites below are the one place that would be.
  const stamina = (contextPercent: number | undefined): string | undefined => {
    const done = staminaMeasured(tracker, percentLeft(contextPercent))
    tracker = done.tracker

    return done.announce === undefined ? undefined : compactionToast(done.announce)
  }

  // Only what the engine just reported is a reading: the known figures that `mergeUsage` keeps for a window
  // the engine did not report again would count as readings in which nothing changed.
  const record = (fresh: Usage, now: number): void => {
    if (showForecast) history = recordReadings(history, fresh.rateLimits, now)
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guild',
      description: 'Abre ou fecha o painel lateral da guilda, troca o esquema de cores dos medidores e mostra cenas de demonstração',
      argumentHint: `[panel|bar|trace|meters [${METER_CHOICES.names.join('|')}]|${[...SCENES, ...SCHEME_SCENES].join('|')}|off]`,
    })
    const startedAt = await $.clock.now()
    tracker = createTracker(parseGuild(await $.store.get(STORE_KEY)), startedAt)
    const first = usageFrom(await $.session.usage())
    usage = mergeUsage(usage, first)
    history = EMPTY_HISTORY
    record(first, startedAt)
    trace = parseTrace(await $.store.get(TRACE_KEY))
    isReady = true
    cache.signature = ''

    // The panel opens by itself where there is room (the engine decides), unless the person closed it.
    const kept = await $.store.get(UI_KEY)
    meters = chooseFrom(METER_CHOICES, [savedChoice(METER_CHOICES, kept), options.meters])
    await update($, metersAtom, () => meters)
    const wantsPanel = layoutMode === 'panel' || (layoutMode === 'auto' && !isClosedByPerson(kept))
    if (wantsPanel) await showPanel($, false)

    let isBusy = false
    let nextUsageAt = 0

    $.clock.every(TICK_MS, async () => {
      if (isBusy) return
      isBusy = true

      try {
        const now = await $.clock.now()
        tracker = tick(tracker, now)

        if (now >= nextUsageAt) {
          nextUsageAt = now + USAGE_EVERY_MS
          // The interval is the one at the moment of asking: a call that ends while the answer is on its way is the next one's.
          const asked = intervalNow(tracker)
          const fresh = usageFrom(await $.session.usage())
          usage = mergeUsage(usage, fresh)
          tracker = costMeasured(tracker, fresh.costUsd, asked)
          const rested = stamina(fresh.contextPercent)
          if (rested !== undefined) $.ui.toast(rested)
          record(fresh, now)
        }

        const state = stateAt(now)
        const view = viewOf(state.tracker, state.usage, now, state.history)
        await publishView($, view, cache)

        if (bandId === undefined) return

        for (const [key, shown] of mounted) {
          const spec = specFor(shown.who, view, state.tracker, now)
          if (spec.sheetId === shown.sheetId && spec.frame === shown.frame) continue

          const cells = cellsOf(spec.sheetId, shown.size, spec.frame)
          if (cells === undefined) continue

          const result = await $.ui.blit({ requestId: bandId, key, cells })
          if (!('deny' in result && result.deny)) {
            shown.sheetId = spec.sheetId
            shown.frame = spec.frame
          }
        }
      } finally {
        isBusy = false
      }
    })

    return next(e)
  })

  // `/guild bug` shows that scene at once; `/guild off` goes back to the real session.
  on('command.run', { command: 'guild' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()

    if (word === 'panel') {
      const opened = await showPanel($, true)

      return { text: opened.isPlaced ? 'Painel aberto' : `Sem espaço para o painel: ${opened.reason}` }
    }

    if (word === 'trace' || word.startsWith('trace ')) {
      const arg = word.slice('trace'.length).trim()

      if (arg === 'clear') {
        trace = []
        await saveTrace($, trace)

        return { text: 'Registro apagado.' }
      }

      const count = Number.parseInt(arg, 10)

      return { text: describeTrace(trace, Number.isFinite(count) && count > 0 ? count : 20) }
    }

    if (word === 'bar') {
      await $.ui.close({ id: PANEL_ID })

      return { text: 'Painel fechado: a barra inferior voltou' }
    }

    if (word === 'meters' || word.startsWith('meters ')) {
      const request = requestOf(METER_CHOICES, word.slice('meters'.length))

      if (request.kind === 'list') return { text: describeChoices(METER_CHOICES, meters) }
      if (request.kind === 'invalid') return { text: helpText(METER_CHOICES, request.typed) }

      meters = request.name
      await saveUi($, METER_CHOICES.field, meters)
      await update($, metersAtom, () => meters)

      // A scheme scene keeps its own scheme on screen: the choice is saved, and the answer says it is not showing yet.
      const forced = scene === undefined ? undefined : schemeOfScene(scene)
      const note = forced !== undefined && forced !== meters ? `, mas a cena ${scene} mostra o esquema dela até /guild off` : ''

      return { text: `${savedText(METER_CHOICES, meters)}${note}` }
    }

    const choice = choiceOf(e.args)

    if (choice.kind === 'unknown') return { text: `Use /guild panel | bar | trace [N|clear] | meters [${METER_CHOICES.names.join('|')}] | ${[...SCENES, ...SCHEME_SCENES].join(' | ')} | off` }

    scene = choice.kind === 'scene' ? choice.scene : undefined

    return { text: choice.kind === 'scene' ? `Cena: ${choice.scene}` : 'Sessão real' }
  })

  on('turn.start', async ($, e, next) => {
    if (scene !== undefined) return next(e)

    const now = await $.clock.now()
    tracker = startTurn(tracker, { id: e.turnId, prompt: e.text, now })
    trace = appendTrace(trace, { at: now, what: 'turn', tool: 'início (palpite do prompt)', shown: tracker.active, planMode: tracker.planMode })
    await saveTrace($, trace)
    await publishView($, viewOf(tracker, usage, now), cache)

    return next(e)
  })

  // The monitor only watches: if it fails, the call goes on as if it were not there.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || scene !== undefined) return next(e)

    const input: Record<string, unknown> = { ...e }
    const use: ToolUse = {
      tool: e.tool,
      command: typeof input.command === 'string' ? input.command : undefined,
      subagent: typeof input.subagent_type === 'string' ? input.subagent_type : undefined,
      lines: linesWritten(input),
      file: fileOf(e.tool, input),
    }

    const startedAt = await $.clock.now()
    // The target is for the screen only: it goes into the tracker's memory and nowhere else.
    const callId = (nextCallId += 1)
    tracker = callStarted(toolStarted(tracker, use, startedAt), { id: callId, tool: use.tool, target: targetOf(use.tool, input) })
    await publishQuietly($, () => viewOf(tracker, usage, startedAt), cache)

    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      tracker = callEnded(tracker, callId)
      await publishQuietly($, async () => viewOf(tracker, usage, await $.clock.now()), cache)
      throw error
    }

    // A refused call is not in progress: it leaves the line at once.
    tracker = callEnded(tracker, callId)

    // What follows only records the call: whatever fails there, the tool's own result goes back as it is.
    try {
      // A call a hook or a permission refused did not fail on its own: it neither raises nor defeats a bug.
      if ('deny' in ran && ran.deny) {
        await publishQuietly($, async () => viewOf(tracker, usage, await $.clock.now()), cache)
      } else {
        const finishedAt = await $.clock.now()
        const rejected = isRejection({ tool: use.tool, isError: ran.isError === true, text: ran.text })
        const done = toolFinished(tracker, {
          use,
          isError: ran.isError === true,
          rejected,
          now: finishedAt,
          durationMs: finishedAt - startedAt,
        })
        tracker = done.tracker
        trace = appendTrace(trace, {
          at: finishedAt,
          what: 'tool',
          tool: use.tool,
          program: use.command === undefined ? undefined : programOf(use.command),
          kind: kindOf(use),
          shown: tracker.active,
          paid: done.gain?.cls ?? (ran.isError === true ? undefined : classOf(use, tracker.planMode)),
          planMode: tracker.planMode,
          isError: ran.isError === true && !rejected ? true : undefined,
          rejected: rejected ? true : undefined,
        })
        await saveTrace($, trace)
        await applyGain($, tracker, done.gain)
        await publishQuietly($, () => viewOf(tracker, usage, finishedAt), cache)
      }
    } catch {
      cache.signature = ''
    }

    return ran
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (scene !== undefined) return next(e)

    const now = await $.clock.now()
    // What the turn spent: a subagent's turn only adds to its own total and goes no further.
    tracker = tokensSpent(tracker, e.usage, e.agentId !== undefined)
    if (e.agentId !== undefined) {
      await publishView($, viewOf(tracker, usage, now), cache)

      return next(e)
    }

    const done = completeTurn(tracker, { id: e.turnId, reason: e.reason, now, durationMs: e.durationMs })
    tracker = done.tracker
    await publishView($, viewOf(tracker, usage, now), cache)

    await applyGain($, tracker, done.gain)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const asked = intervalNow(tracker)
    const now = await $.clock.now()
    usage = mergeUsage(usage, usageFrom(e))
    tracker = costMeasured(tracker, usageFrom(e).costUsd, asked)
    const rested = stamina(usageFrom(e).contextPercent)
    if (rested !== undefined) $.ui.toast(rested)
    record(usageFrom(e), now)
    await publishView($, viewOf(tracker, usage, now), cache)

    return next(e)
  })

  // The conversation was compacted. The monitor only watches: the compaction's own result goes back as it is.
  on('session.compact', async ($, e, next) => {
    // The stamina known before it: a measurement that arrives during the compaction is not yet a recovery.
    const before = percentLeft(usage.contextPercent)
    const result = await next(e)

    try {
      if (scene === undefined && countsAsCompaction({ trigger: e.trigger, agentId: e.agentId, skipped: result.skip !== undefined })) {
        tracker = compacted(tracker, before)
        await publishQuietly($, async () => viewOf(tracker, usage, await $.clock.now()), cache)
      }
    } catch {
      cache.signature = ''
    }

    return result
  })

  // The footer's mode labels are the only place the engine says plan mode is on.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const planMode = e.props.modes.some(mode => /plan/i.test(mode))
    const changed = planMode !== tracker.planMode
    tracker = setPlanMode(tracker, planMode)

    // Written to the store with the next event: a drawing does not write.
    if (changed) {
      trace = appendTrace(trace, { at: await $.clock.now(), what: 'mode', tool: planMode ? 'plano ligado' : 'plano desligado', shown: tracker.active, planMode })
    }

    return next(e)
  })

  // The side panel: the same guild as the band, stacked, drawn where the engine seats the pane.
  on('ui.render', { component: 'Pane', requestId: PANEL_ID }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    // Reading the atoms draws the panel again when the view or the meters' scheme changes.
    const published = await read($, viewAtom)
    await read($, metersAtom)
    const now = await $.clock.now()
    const state = stateAt(now)
    const view = isReady ? viewOf(state.tracker, state.usage, now, state.history) : published
    if (view === null) return next(e)

    const layout = chooseSidebarLayout(e.props.bodyColumns, bandSize, view.bug)

    bandId = e.requestId
    mounted.clear()

    const tree = sidebarTree($.ui.resolve(e), {
      view,
      columns: e.props.bodyColumns,
      layout,
      now,
      colors: colorsNow(),
      cellsFor: (key, who, size) => {
        const spec = specFor(who, view, state.tracker, now)
        mounted.set(key, { who, size, sheetId: spec.sheetId, frame: spec.frame })

        return cellsOf(spec.sheetId, size, spec.frame) ?? ''
      },
    })

    return tree ?? next(e)
  })

  // Closed by the person (the engine's × mark) or by `/guild bar`: the band comes back and stays.
  on('ui.close', { id: PANEL_ID }, async ($, e, next) => {
    if (e.origin.kind !== 'unload') await hidePanel($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || layoutMode === 'panel') return next(e)

    // While the side panel is up it is the guild's place; the band is its fallback.
    if (await read($, panelAtom)) return next(e)

    // Reading the atom is what draws the band again when it changes; what is drawn is the view
    // of this very moment, so the character, its XP and the figures always agree.
    const published = await read($, viewAtom)
    await read($, metersAtom)
    const now = await $.clock.now()
    const state = stateAt(now)
    const view = isReady ? viewOf(state.tracker, state.usage, now, state.history) : published
    if (view === null) return next(e)

    const layout = chooseLayout(e.props.bodyColumns, e.props.maxRows, bandSize, view.bug)
    if (layout === null) return next(e)

    bandId = e.requestId
    mounted.clear()

    const tree = bandTree($.ui.resolve(e), {
      view,
      layout,
      now,
      colors: colorsNow(),
      cellsFor: (key, who, size) => {
        const spec = specFor(who, view, state.tracker, now)
        mounted.set(key, { who, size, sheetId: spec.sheetId, frame: spec.frame })

        return cellsOf(spec.sheetId, size, spec.frame) ?? ''
      },
    })

    return tree ?? next(e)
  })
}
