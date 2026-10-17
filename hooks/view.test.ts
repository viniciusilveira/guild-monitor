import { expect, test } from 'claude-code/testing'

import { DEFAULTS, DEFEAT_MS } from './guild'
import { chooseLayout } from './layout'
import { completeTurn, createTracker, startTurn, toolFinished } from './tracker'
import { bar, buildView, costText, frameAt, healthColor, mergeUsage, METER_COLORS, percentText, sheetIdFor, stateText, untilReset, usageFrom } from './view'
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
  expect(completeTurn(tracker, { id: 't', reason: 'answer', now: NOW + 20 }).gain?.xp).toBe(3)
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
