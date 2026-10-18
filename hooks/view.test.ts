import { expect, test } from 'claude-code/testing'

import { DEFAULTS, DEFEAT_MS } from './guild'
import { chooseLayout } from './layout'
import { completeTurn, createTracker, startTurn, toolFinished } from './tracker'
import { bandForecast, bar, buildView, fitForecast, costText, durationText, frameAt, healthColor, mergeUsage, METER_COLORS, percentText, agoText, sheetIdFor, stateText, untilReset, usageFrom } from './view'
import { addXp, emptyGuild } from './xp'

const NOW = 1_000_000
const usage = (patch = {}) => ({ rateLimits: [], ...patch })

test('the view shows percent left of each window and the context as stamina', async () => {
  const view = buildView(
    createTracker(emptyGuild(), NOW),
    {
      contextPercent: 30,
      rateLimits: [
        { kind: 'seven_day', percentUsed: 12.4 },
        { kind: 'five_hour', percentUsed: 80, resetsAt: '2030-01-01T00:00:00Z' },
      ],
      costUsd: 1.2345,
    },
    NOW,
  )

  expect(view.hp).toBe(88)
  expect(view.mana).toBe(20)
  expect(view.stamina).toBe(70)
  expect(view.manaResetsAt).toBe('2030-01-01T00:00:00Z')
  expect(view.costUsd).toBe(1.2345)
})

test('a figure nobody reported stays unknown instead of becoming zero', async () => {
  const view = buildView(createTracker(emptyGuild(), NOW), usage(), NOW)

  expect(view.hp).toBe(null)
  expect(view.mana).toBe(null)
  expect(view.stamina).toBe(null)
  expect(view.costUsd).toBe(null)
  expect(view.manaResetsAt).toBe(null)
})

test('windows past their limit leave no negative percent', async () => {
  const view = buildView(
    createTracker(emptyGuild(), NOW),
    usage({ contextPercent: 130, rateLimits: [{ kind: 'seven_day', percentUsed: 104 }] }),
    NOW,
  )

  expect(view.hp).toBe(0)
  expect(view.stamina).toBe(0)
})

test('every character is in the view, with its level and the animation it shows', async () => {
  let tracker = createTracker(emptyGuild(), NOW)
  tracker = { ...tracker, guild: addXp(tracker.guild, 'mago', 50).guild }
  tracker = startTurn(tracker, { id: 't', prompt: 'planeje a feature', now: NOW })

  const view = buildView(tracker, usage(), NOW)
  const mago = view.chars.find(char => char.cls === 'mago')
  const guerreiro = view.chars.find(char => char.cls === 'guerreiro')

  expect(view.chars.map(char => char.cls)).toEqual(['mago', 'guerreiro', 'explorador'])
  expect(view.active).toBe('mago')
  expect(view.working).toBe(true)
  expect(mago).toEqual({ cls: 'mago', anim: 'trabalho', level: 2, xpInLevel: 10, xpNeeded: 120 })
  expect(guerreiro?.anim).toBe('parado')
})

test('characters sleep when the guild has been idle long enough and tire in a heavy context', async () => {
  const tracker = createTracker(emptyGuild(), NOW)

  expect(buildView(tracker, usage(), NOW + DEFAULTS.sleepAfterMs).chars.every(char => char.anim === 'dormindo')).toBe(true)
  expect(buildView(tracker, usage({ contextPercent: 80 }), NOW + 1_000).chars.every(char => char.anim === 'cansado')).toBe(true)
})

test('the bug shows in the view and leaves once defeated for long enough', async () => {
  let tracker = startTurn(createTracker(emptyGuild(), NOW), { id: 't', prompt: 'rode os testes', now: NOW })
  const test1 = { tool: 'Bash', command: 'npm test' }

  tracker = toolFinished(tracker, { use: test1, isError: true, now: NOW, durationMs: 0 }).tracker
  expect(buildView(tracker, usage(), NOW).bug).toBe('alive')

  tracker = toolFinished(tracker, { use: test1, isError: false, now: NOW + 10, durationMs: 0 }).tracker
  expect(buildView(tracker, usage(), NOW + 10).bug).toBe('defeated')
  expect(buildView(tracker, usage(), NOW + 10 + DEFEAT_MS).bug).toBe('none')
  expect(completeTurn(tracker, { id: 't', reason: 'answer', now: NOW + 20, durationMs: 0 }).gain?.xp).toBe(3)
})

test('a loop wraps around and a one-shot animation rests on its last frame', async () => {
  const durations = [100, 100, 200]

  expect(frameAt(durations, 0, true)).toBe(0)
  expect(frameAt(durations, 99, true)).toBe(0)
  expect(frameAt(durations, 100, true)).toBe(1)
  expect(frameAt(durations, 250, true)).toBe(2)
  expect(frameAt(durations, 400, true)).toBe(0)
  expect(frameAt(durations, 450, true)).toBe(0)
  expect(frameAt(durations, 500, true)).toBe(1)
  expect(frameAt(durations, 400, false)).toBe(2)
  expect(frameAt(durations, 9_999, false)).toBe(2)
  expect(frameAt(durations, -5, true)).toBe(0)
  expect(frameAt([], 100, true)).toBe(0)
})

test('sheet names follow the export', async () => {
  expect(sheetIdFor('mago', 'trabalho')).toBe('mago_trabalho')
  expect(sheetIdFor('bug', 'derrotado')).toBe('bug_derrotado')
})

test('bars, percents, cost and reset times read well', async () => {
  expect(bar(100)).toBe('▰▰▰▰▰▰▰▰')
  expect(bar(0)).toBe('▱▱▱▱▱▱▱▱')
  expect(bar(50, 4)).toBe('▰▰▱▱')
  expect(bar(null)).toBe('▱▱▱▱▱▱▱▱')
  expect(bar(250, 4)).toBe('▰▰▰▰')
  expect(percentText(42)).toBe('42%')
  expect(percentText(null)).toBe('--')
  expect(costText(0.5)).toBe('$0.50')
  expect(costText(null)).toBe('--')
  expect(untilReset(null, NOW)).toBe('')
  expect(untilReset('lixo', NOW)).toBe('')
  expect(untilReset(new Date(NOW - 5).toISOString(), NOW)).toBe('')
  expect(untilReset(new Date(NOW + 47 * 60_000).toISOString(), NOW)).toBe('47min')
  expect(untilReset(new Date(NOW + 133 * 60_000).toISOString(), NOW)).toBe('2h13')
  expect(stateText('guerreiro', 'trabalho')).toBe('em combate')
  expect(stateText('mago', 'dormindo')).toBe('dormindo')
})

test('health turns green, yellow and red as it drops, and grey when unknown', async () => {
  expect(healthColor(100)).toBe('#2ECC71')
  expect(healthColor(51)).toBe('#2ECC71')
  expect(healthColor(50)).toBe('#F1C40F')
  expect(healthColor(25)).toBe('#F1C40F')
  expect(healthColor(24)).toBe('#E74C3C')
  expect(healthColor(0)).toBe('#E74C3C')
  expect(healthColor(null)).toBe(METER_COLORS.unknown)
})

test('the band shows what fits: active first, then text, others and the bug', async () => {
  expect(chooseLayout(200, 20, 'full', 'alive')).toEqual({ active: 'full', info: true, others: true, bug: false, bugBelow: true })
  expect(chooseLayout(200, 20, 'full', 'none')).toEqual({ active: 'full', info: true, others: true, bug: false, bugBelow: false })
  expect(chooseLayout(100, 20, 'full', 'alive')).toEqual({ active: 'full', info: true, others: true, bug: false, bugBelow: true })
  expect(chooseLayout(70, 20, 'full', 'none')).toEqual({ active: 'full', info: true, others: false, bug: false, bugBelow: false })
  expect(chooseLayout(40, 20, 'full', 'none')).toEqual({ active: 'full', info: false, others: false, bug: false, bugBelow: false })
  expect(chooseLayout(20, 20, 'full', 'none')).toBe(null)
})

test('a short band or the compact setting uses the reduced size, and too short hides the band', async () => {
  expect(chooseLayout(200, 12, 'full', 'none')?.active).toBe('mini')
  expect(chooseLayout(200, 20, 'compact', 'none')?.active).toBe('mini')
  expect(chooseLayout(200, 7, 'full', 'none')).toBe(null)
  expect(chooseLayout(15, 20, 'compact', 'none')).toBe(null)
})

const KNOWN = {
  contextPercent: 40,
  rateLimits: [
    { kind: 'seven_day', percentUsed: 10 },
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2030-01-01T00:00:00Z' },
  ],
  costUsd: 2,
}

test('a report with gaps never blanks what is already known', async () => {
  expect(mergeUsage(KNOWN, { rateLimits: [] })).toEqual(KNOWN)
  expect(mergeUsage(KNOWN, { contextPercent: undefined, rateLimits: [], costUsd: undefined })).toEqual(KNOWN)
})

test('a figure the report does have replaces the known one and the rest stays', async () => {
  const merged = mergeUsage(KNOWN, {
    contextPercent: 55,
    rateLimits: [{ kind: 'five_hour', percentUsed: 45, resetsAt: '2030-01-01T05:00:00Z' }],
    costUsd: 2.5,
  })

  expect(merged.contextPercent).toBe(55)
  expect(merged.costUsd).toBe(2.5)
  expect(merged.rateLimits.find(limit => limit.kind === 'five_hour')?.percentUsed).toBe(45)
  expect(merged.rateLimits.find(limit => limit.kind === 'seven_day')?.percentUsed).toBe(10)
  expect(merged.rateLimits.length).toBe(2)
})

test('a context that drops to zero is a figure, not a gap', async () => {
  expect(mergeUsage(KNOWN, { contextPercent: 0, rateLimits: [] }).contextPercent).toBe(0)
})

test('the session reports convert to usage as they come', async () => {
  expect(usageFrom({ context: { percent: 12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }], cost: { usd: 0.4 } })).toEqual({
    contextPercent: 12,
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    costUsd: 0.4,
  })
  expect(usageFrom({ context: {}, rateLimits: [] })).toEqual({ contextPercent: undefined, rateLimits: [], costUsd: undefined })
})

test('changing the active character changes its XP and nothing of the session figures', async () => {
  let tracker = createTracker(emptyGuild(), NOW)
  tracker = { ...tracker, guild: addXp(addXp(tracker.guild, 'mago', 50).guild, 'guerreiro', 170).guild }

  const asMage = buildView(startTurn(tracker, { id: 'a', prompt: 'planeje a feature', now: NOW }), KNOWN, NOW)
  const asWarrior = buildView(startTurn(tracker, { id: 'b', prompt: 'corrija o bug', now: NOW }), KNOWN, NOW)
  const level = (view: typeof asMage, cls: string) => view.chars.find(char => char.cls === cls)

  expect(asMage.active).toBe('mago')
  expect(asWarrior.active).toBe('guerreiro')
  expect(level(asMage, 'mago')?.xpInLevel).toBe(10)
  expect(level(asWarrior, 'guerreiro')?.level).toBe(3)

  // the figures of the session do not depend on who is active
  for (const key of ['hp', 'mana', 'stamina', 'costUsd', 'manaResetsAt'] as const) {
    expect(asMage[key]).toEqual(asWarrior[key])
    expect(asMage[key] === null).toBe(false)
  }
  // and each character keeps its own XP whoever is active
  expect(asMage.chars).toEqual(asWarrior.chars.map(char => ({ ...char, anim: asMage.chars.find(one => one.cls === char.cls)?.anim ?? char.anim })))
})

test('the bug goes under the stats of a full character, and beside the others only where the stats are not', async () => {
  expect(chooseLayout(62, 20, 'full', 'alive')).toEqual({ active: 'full', info: true, others: false, bug: false, bugBelow: true })
  expect(chooseLayout(40, 20, 'full', 'alive')).toEqual({ active: 'full', info: false, others: false, bug: false, bugBelow: false })
  expect(chooseLayout(200, 12, 'full', 'alive')).toEqual({ active: 'mini', info: true, others: true, bug: true, bugBelow: false })
})

test('how long ago reads as now, minutes or hours', async () => {
  expect(agoText(NOW, NOW)).toBe('agora')
  expect(agoText(NOW - 59_000, NOW)).toBe('agora')
  expect(agoText(NOW - 3 * 60_000, NOW)).toBe('3min')
  expect(agoText(NOW - 65 * 60_000, NOW)).toBe('1h05')
  expect(agoText(NOW + 5_000, NOW)).toBe('agora')
})

test('the view carries the history of XP payments', async () => {
  let tracker = startTurn(createTracker(emptyGuild(), NOW), { id: 't', prompt: 'oi', now: NOW })
  tracker = toolFinished(tracker, { use: { tool: 'Read' }, isError: false, now: NOW + 1, durationMs: 0 }).tracker

  expect(buildView(tracker, usage(), NOW + 2).recent).toEqual([{ cls: 'explorador', xp: 2, at: NOW + 1, tool: 'Read' }])
})

test('timers C1: durationText covers zero, seconds, minutes, hours and negative', async () => {
  const cases: Array<[number, string]> = [
    [0, '0s'],
    [32_000, '32s'],
    [59_900, '59s'],
    [60_000, '1min'],
    [4 * 60_000 + 59_000, '4min'],
    [65 * 60_000, '1h05'],
    [-5_000, '0s'],
  ]

  for (const [ms, text] of cases) expect(durationText(ms)).toBe(text)
})

test('timers C3: the session start comes from the usage figures and a new one wins', async () => {
  const figures = { context: {}, rateLimits: [] }

  expect(usageFrom({ ...figures, startedAt: 5 }).startedAt).toBe(5)
  expect(usageFrom(figures).startedAt).toBe(undefined)
  // A /clear brings a later start: it replaces the known one. A report without a start keeps it.
  expect(mergeUsage(usage({ startedAt: 5 }), usage({ startedAt: 9 })).startedAt).toBe(9)
  expect(mergeUsage(usage({ startedAt: 5 }), usage()).startedAt).toBe(5)

  const sinceStart = (startedAt?: number) => buildView(createTracker(emptyGuild(), NOW), usage({ startedAt }), NOW).sessionSeconds
  expect(sinceStart(NOW - 65 * 60_000)).toBe(3900)
  expect(sinceStart(NOW - 1_999)).toBe(1)
  expect(sinceStart(NOW + 5_000)).toBe(0)
  expect(sinceStart(undefined)).toBe(null)
})

test('timers C4: the turn time runs, then keeps the duration the event reported', async () => {
  const idle = createTracker(emptyGuild(), NOW)
  expect(buildView(idle, usage(), NOW).turnSeconds).toBe(null)

  const running = startTurn(idle, { id: 't1', prompt: 'oi', now: NOW })
  expect(buildView(running, usage(), NOW).turnSeconds).toBe(0)
  expect(buildView(running, usage(), NOW + 32_900).turnSeconds).toBe(32)

  // Another turn's end changes nothing.
  expect(completeTurn(running, { id: 'other', reason: 'answer', now: NOW + 10_000, durationMs: 1_000 }).tracker).toEqual(running)

  // The duration is the event's, whatever the clock says, and it stays as time passes.
  const done = completeTurn(running, { id: 't1', reason: 'answer', now: NOW + 10_000, durationMs: 7_000 }).tracker
  expect(buildView(done, usage(), NOW + 10_000).turnSeconds).toBe(7)
  expect(buildView(done, usage(), NOW + 70_000).turnSeconds).toBe(7)

  // An interrupted or failed turn keeps its duration too; a new turn starts over.
  const aborted = completeTurn(running, { id: 't1', reason: 'aborted', now: NOW + 10_000, durationMs: 4_000 }).tracker
  expect(buildView(aborted, usage(), NOW + 20_000).turnSeconds).toBe(4)
  const next = startTurn(done, { id: 't2', prompt: 'de novo', now: NOW + 80_000 })
  expect(buildView(next, usage(), NOW + 81_000).turnSeconds).toBe(1)
})

test('timers C11b: the view is the same within a second and differs across it', async () => {
  const tracker = startTurn(createTracker(emptyGuild(), NOW), { id: 't1', prompt: 'oi', now: NOW })
  const at = (ms: number) => JSON.stringify(buildView(tracker, usage({ startedAt: NOW - 90_000 }), NOW + ms))

  expect(at(1_050)).toBe(at(1_000))
  expect(at(1_950)).toBe(at(1_000))
  expect(at(2_000)).not.toBe(at(1_950))
  expect(at(0)).not.toBe(at(1_000))
})

const line = (text: string, urgent = false, short = text.replace(' em ', ' ')) => ({ text, short, urgent })

test('forecast C15 fit: a line takes the shorter wording to fit and is dropped when not even that fits', () => {
  const week = line('esgota em ~66 dias')
  const hours = line('esgota em ~50min')
  const reset = line('dura até o reset')

  expect(fitForecast('7d', week, 28)).toBe('7d esgota em ~66 dias')
  // 21 characters do not fit 20: the shorter wording has 18.
  expect(fitForecast('7d', week, 20)).toBe('7d esgota ~66 dias')
  expect(fitForecast('7d', week, 21)).toBe('7d esgota em ~66 dias')
  expect(fitForecast('7d', week, 18)).toBe('7d esgota ~66 dias')
  expect(fitForecast('7d', week, 17)).toBeNull()
  expect(fitForecast('5h', hours, 19)).toBe('5h esgota em ~50min')
  expect(fitForecast('5h', hours, 18)).toBe('5h esgota ~50min')
  expect(fitForecast('7d', reset, 19)).toBe('7d dura até o reset')
  expect(fitForecast('7d', reset, 18)).toBeNull()
  expect(fitForecast('5h', hours, 0)).toBeNull()
})

test('forecast C17 pick: the band line is the urgent window, else the 5h one, else the week', () => {
  const calm = line('dura até o reset')
  const red = line('esgota em ~40min', true)
  const idle = line('sem consumo')

  expect(bandForecast({ fiveHour: null, sevenDay: null })).toBeNull()
  expect(bandForecast({ fiveHour: calm, sevenDay: red })).toEqual({ label: '7d', line: red })
  expect(bandForecast({ fiveHour: red, sevenDay: red })).toEqual({ label: '5h', line: red })
  expect(bandForecast({ fiveHour: calm, sevenDay: idle })).toEqual({ label: '5h', line: calm })
  expect(bandForecast({ fiveHour: null, sevenDay: idle })).toEqual({ label: '7d', line: idle })
  expect(bandForecast({ fiveHour: idle, sevenDay: null })).toEqual({ label: '5h', line: idle })
})
