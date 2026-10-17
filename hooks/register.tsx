import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register, StateDollar } from 'claude-code'

import type { ViewModel } from '../types'
import type { TaskClass, ToolUse } from './classify'
import { linesWritten } from './classify'
import { demoState, sceneOf } from './demo'
import type { Settings } from './guild'
import { DEFAULTS } from './guild'
import type { Size } from './layout'
import { chooseLayout } from './layout'
import { encodeFrame } from './raster'
import { bandTree } from './render'
import { FRAME_SIZE, MINI_SIZE, PALETTE, SHEETS } from './sprites.generated'
import type { Gain, Tracker } from './tracker'
import { completeTurn, createTracker, setPlanMode, startTurn, tick, toolFinished, toolStarted } from './tracker'
import type { Usage } from './view'
import { buildView, frameAt, mergeUsage, NAMES, sheetIdFor, usageFrom } from './view'
import { emptyGuild, parseGuild } from './xp'

const STORE_KEY = 'guild.v1'
const TICK_MS = 50
// How often the session's figures are read again, whatever the engine reports: a report may never come.
const USAGE_EVERY_MS = 2_000

const viewAtom = atom({ plugin: 'guild-monitor', key: 'view' } as const, null)

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

export const register: Register = (on, options) => {
  const settings: Settings = {
    sleepAfterMs: positive(options.sleepAfterSeconds, DEFAULTS.sleepAfterMs / 1000) * 1000,
    tiredAtPercent: positive(options.tiredAtPercent, DEFAULTS.tiredAtPercent),
  }
  const bandSize = options.bandSize === 'compact' ? 'compact' : 'full'
  // A demo scene shows made-up figures and ignores the session.
  const scene = sceneOf(options.demo)

  let tracker: Tracker = createTracker(emptyGuild(), 0)
  let usage: Usage = { rateLimits: [] }
  let bandId: string | undefined
  // False until the guild is read from the store: before that the band keeps showing the last view.
  let isReady = false
  const mounted = new Map<string, Mounted>()

  const cache: PublishCache = { signature: '' }

  const stateAt = (now: number): { tracker: Tracker; usage: Usage } =>
    scene === undefined ? { tracker, usage } : demoState(scene, now, settings)

  on('session.start', async ($, e, next) => {
    tracker = createTracker(parseGuild(await $.store.get(STORE_KEY)), await $.clock.now())
    usage = mergeUsage(usage, usageFrom(await $.session.usage()))
    isReady = true
    cache.signature = ''

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

  on('turn.start', async ($, e, next) => {
    if (scene !== undefined) return next(e)

    const now = await $.clock.now()
    tracker = startTurn(tracker, { id: e.turnId, prompt: e.text, now })
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
    tracker = toolStarted(tracker, use, startedAt)
    await publishView($, buildView(tracker, usage, startedAt, settings), cache)
    const ran = await next(e)

    // A call a hook or a permission refused did not fail on its own: it neither raises nor defeats a bug.
    if (!('deny' in ran && ran.deny)) {
      const finishedAt = await $.clock.now()
      const done = toolFinished(tracker, {
        use,
        isError: ran.isError === true,
        now: finishedAt,
        durationMs: finishedAt - startedAt,
      })
      tracker = done.tracker
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
  on('ui.render', { component: 'SessionMode' }, (_$, e, next) => {
    tracker = setPlanMode(tracker, e.props.modes.some(mode => /plan/i.test(mode)))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

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
