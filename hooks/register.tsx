import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register, StateDollar } from 'claude-code'

import type { ViewModel } from '../types'
import type { TaskClass, ToolUse } from './classify'
import { classOf, kindOf, linesWritten } from './classify'
import { targetOf } from './doing'
import { choiceOf, demoState, SCENES, sceneOf } from './demo'
import type { Settings } from './guild'
import { DEFAULTS, isRejection } from './guild'
import type { Size } from './layout'
import { chooseLayout } from './layout'
import { chooseSidebarLayout } from './sidebar'
import { encodeFrame } from './raster'
import { bandTree, sidebarTree } from './render'
import { FRAME_SIZE, MINI_SIZE, PALETTE, SHEETS } from './sprites.generated'
import type { Gain, Tracker } from './tracker'
import type { TraceEntry } from './trace'
import { appendTrace, describeTrace, parseTrace, programOf } from './trace'
import { callEnded, callStarted, completeTurn, createTracker, setPlanMode, startTurn, tick, toolFinished, toolStarted } from './tracker'
import type { Usage } from './view'
import { buildView, frameAt, mergeUsage, NAMES, sheetIdFor, usageFrom } from './view'
import { emptyGuild, parseGuild } from './xp'

const STORE_KEY = 'guild.v1'
const TICK_MS = 50
// How often the session's figures are read again, whatever the engine reports: a report may never come.
const USAGE_EVERY_MS = 2_000

const viewAtom = atom({ plugin: 'guild-monitor', key: 'view' } as const, null)
// Whether the side panel is up, so the band yields to it.
const panelAtom = atom({ plugin: 'guild-monitor', key: 'panel' } as const, false)

const PANEL_ID = 'guild'
// Wide enough for the full character with its stats beside it (see `STATS_COLUMNS`).
const PANEL_COLUMNS = 62
// What the person chose about the panel, kept between sessions.
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

type PublishCache = { signature: string }

// The band redraws when the view it reads changes, so a view is published as soon as an event
// changes what it is made of, not at the next tick; one equal to the last published is not written.
const publishView = async ($: StateDollar, view: ViewModel, cache: PublishCache): Promise<void> => {
  const signature = JSON.stringify(view)
  if (signature === cache.signature) return

  cache.signature = signature
  await update($, viewAtom, () => view)
}

// A gain is saved with the guild and a new level is announced.
const applyGain = async ($: Pick<CoreEngineInterface, 'store' | 'ui'>, tracker: Tracker, gain: Gain | undefined): Promise<void> => {
  if (gain === undefined) return

  await $.store.set(STORE_KEY, tracker.guild)
  if (gain.leveledUp) $.ui.toast(`${NAMES[gain.cls]} subiu para o nível ${gain.level}!`)
}

type PanelDollar = Pick<CoreEngineInterface, 'store' | 'ui' | 'state'>

// Opens the pane, which the engine seats beside the transcript when there is room and
// otherwise leaves undrawn. `remember` keeps it open for the next sessions: a command
// of the person's does, the opening at the start does not.
const showPanel = async ($: PanelDollar, remember: boolean): Promise<{ isPlaced: boolean; reason?: string }> => {
  const opened = await $.ui.open({ id: PANEL_ID, title: 'Guilda', columns: PANEL_COLUMNS })
  const isPlaced = opened.isPlaced === true

  await update($, panelAtom, () => isPlaced)
  if (isPlaced && remember) await $.store.set(UI_KEY, { panel: true })

  return { isPlaced, reason: 'reason' in opened ? String(opened.reason) : undefined }
}

const saveTrace = async ($: Pick<CoreEngineInterface, 'store'>, trace: readonly TraceEntry[]): Promise<void> => {
  await $.store.set(TRACE_KEY, trace)
}

const hidePanel = async ($: PanelDollar): Promise<void> => {
  await update($, panelAtom, () => false)
  await $.store.set(UI_KEY, { panel: false })
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    sleepAfterMs: positive(options.sleepAfterSeconds, DEFAULTS.sleepAfterMs / 1000) * 1000,
    tiredAtPercent: positive(options.tiredAtPercent, DEFAULTS.tiredAtPercent),
  }
  const bandSize = options.bandSize === 'compact' ? 'compact' : 'full'
  const layoutMode = options.layout === 'bar' || options.layout === 'panel' ? options.layout : 'auto'
  // A demo scene shows made-up figures and ignores the session.
  let scene = sceneOf(options.demo)

  let tracker: Tracker = createTracker(emptyGuild(), 0)
  let usage: Usage = { rateLimits: [] }
  let trace: TraceEntry[] = []
  let bandId: string | undefined
  // False until the guild is read from the store: before that the band keeps showing the last view.
  let isReady = false
  // Identifies each call in progress, so parallel calls end one by one.
  let nextCallId = 0
  const mounted = new Map<string, Mounted>()

  const cache: PublishCache = { signature: '' }

  const stateAt = (now: number): { tracker: Tracker; usage: Usage } =>
    scene === undefined ? { tracker, usage } : demoState(scene, now, settings)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guild',
      description: 'Abre ou fecha o painel lateral da guilda e mostra cenas de demonstração',
      argumentHint: `[panel|bar|trace|${SCENES.join('|')}|off]`,
    })
    tracker = createTracker(parseGuild(await $.store.get(STORE_KEY)), await $.clock.now())
    usage = mergeUsage(usage, usageFrom(await $.session.usage()))
    trace = parseTrace(await $.store.get(TRACE_KEY))
    isReady = true
    cache.signature = ''

    // The panel opens by itself where there is room (the engine decides), unless the person closed it.
    const kept = await $.store.get(UI_KEY)
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
          usage = mergeUsage(usage, usageFrom(await $.session.usage()))
        }

        const state = stateAt(now)
        const view = buildView(state.tracker, state.usage, now, settings)
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

    const choice = choiceOf(e.args)

    if (choice.kind === 'unknown') return { text: `Use /guild panel | bar | trace [N|clear] | ${SCENES.join(' | ')} | off` }

    scene = choice.kind === 'scene' ? choice.scene : undefined

    return { text: choice.kind === 'scene' ? `Cena: ${choice.scene}` : 'Sessão real' }
  })

  on('turn.start', async ($, e, next) => {
    if (scene !== undefined) return next(e)

    const now = await $.clock.now()
    tracker = startTurn(tracker, { id: e.turnId, prompt: e.text, now })
    trace = appendTrace(trace, { at: now, what: 'turn', tool: 'início (palpite do prompt)', shown: tracker.active, planMode: tracker.planMode })
    await saveTrace($, trace)
    await publishView($, buildView(tracker, usage, now, settings), cache)

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
    }

    const startedAt = await $.clock.now()
    // The target is for the screen only: it goes into the tracker's memory and nowhere else.
    const callId = (nextCallId += 1)
    tracker = callStarted(toolStarted(tracker, use, startedAt), { id: callId, tool: use.tool, target: targetOf(use.tool, input) })
    await publishView($, buildView(tracker, usage, startedAt, settings), cache)

    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      tracker = callEnded(tracker, callId)
      await publishView($, buildView(tracker, usage, await $.clock.now(), settings), cache)
      throw error
    }

    // A refused call is not in progress: it leaves the line at once.
    tracker = callEnded(tracker, callId)

    // A call a hook or a permission refused did not fail on its own: it neither raises nor defeats a bug.
    if ('deny' in ran && ran.deny) {
      await publishView($, buildView(tracker, usage, await $.clock.now(), settings), cache)
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
      await publishView($, buildView(tracker, usage, finishedAt, settings), cache)
    }

    return ran
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || scene !== undefined) return next(e)

    const now = await $.clock.now()
    const done = completeTurn(tracker, { id: e.turnId, reason: e.reason, now })
    tracker = done.tracker
    await publishView($, buildView(tracker, usage, now, settings), cache)

    await applyGain($, tracker, done.gain)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    usage = mergeUsage(usage, usageFrom(e))
    await publishView($, buildView(tracker, usage, await $.clock.now(), settings), cache)

    return next(e)
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

    // Reading the atom draws the panel again when the view changes.
    const published = await read($, viewAtom)
    const now = await $.clock.now()
    const state = stateAt(now)
    const view = isReady ? buildView(state.tracker, state.usage, now, settings) : published
    if (view === null) return next(e)

    const layout = chooseSidebarLayout(e.props.bodyColumns, bandSize, view.bug)

    bandId = e.requestId
    mounted.clear()

    const tree = sidebarTree($.ui.resolve(e), {
      view,
      columns: e.props.bodyColumns,
      layout,
      now,
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
    const now = await $.clock.now()
    const state = stateAt(now)
    const view = isReady ? buildView(state.tracker, state.usage, now, settings) : published
    if (view === null) return next(e)

    const layout = chooseLayout(e.props.bodyColumns, e.props.maxRows, bandSize, view.bug)
    if (layout === null) return next(e)

    bandId = e.requestId
    mounted.clear()

    const tree = bandTree($.ui.resolve(e), {
      view,
      layout,
      now,
      cellsFor: (key, who, size) => {
        const spec = specFor(who, view, state.tracker, now)
        mounted.set(key, { who, size, sheetId: spec.sheetId, frame: spec.frame })

        return cellsOf(spec.sheetId, size, spec.frame) ?? ''
      },
    })

    return tree ?? next(e)
  })
}
