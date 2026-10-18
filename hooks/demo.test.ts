import { expect, test } from 'claude-code/testing'

import { choiceOf, demoState, SCENES, SCHEME_SCENES, schemeOfScene, sceneOf } from './demo'
import { DEFAULTS } from './guild'
import { goldTotal } from './gold'
import { buildView } from './view'

const NOW = 5_000_000
const viewOf = (scene: (typeof SCENES)[number]) => {
  const state = demoState(scene, NOW)

  return buildView(state.tracker, state.usage, NOW)
}

test('only the known scenes are scenes', async () => {
  expect(sceneOf('bug')).toBe('bug')
  expect(sceneOf('off')).toBe(undefined)
  expect(sceneOf(undefined)).toBe(undefined)
  expect(sceneOf(3)).toBe(undefined)
})

test('each class scene shows that class at work, with the same made-up figures', async () => {
  for (const cls of ['explorador', 'mago', 'guerreiro'] as const) {
    const view = viewOf(cls)

    expect(view.active).toBe(cls)
    expect(view.working).toBe(true)
    expect(view.chars.find(char => char.cls === cls)?.anim).toBe('trabalho')
    expect(view.bug).toBe('none')
    expect([view.hp, view.mana, view.stamina, view.costUsd]).toEqual([72, 45, 64, 3.42])
  }
})

test('the guild has levels of its own in the demo', async () => {
  expect(viewOf('mago').chars.map(char => [char.cls, char.level])).toEqual([
    ['mago', 2],
    ['guerreiro', 4],
    ['explorador', 2],
  ])
})

test('the bug scene has the warrior fighting a living bug', async () => {
  const view = viewOf('bug')

  expect(view.active).toBe('guerreiro')
  expect(view.bug).toBe('alive')
})

test('tired is a heavy context and sleeping is a long idle, with no turn running', async () => {
  const tired = viewOf('cansado')
  const asleep = viewOf('dormindo')

  expect(tired.working).toBe(false)
  expect(tired.stamina).toBe(12)
  expect(tired.chars.every(char => char.anim === 'cansado')).toBe(true)
  expect(asleep.chars.every(char => char.anim === 'dormindo')).toBe(true)
  expect(asleep.stamina).toBe(64)
  expect(DEFAULTS.sleepAfterMs > 0).toBe(true)
})

test('the command word picks a scene, turns the demo off or is unknown', async () => {
  expect(choiceOf('bug')).toEqual({ kind: 'scene', scene: 'bug' })
  expect(choiceOf('  Mago ')).toEqual({ kind: 'scene', scene: 'mago' })
  expect(choiceOf('off')).toEqual({ kind: 'off' })
  expect(choiceOf('')).toEqual({ kind: 'unknown' })
  expect(choiceOf('dragao')).toEqual({ kind: 'unknown' })
})

test('the demo shows a history of payments, newest last, in every scene', async () => {
  for (const scene of SCENES) {
    const recent = viewOf(scene).recent

    expect(recent.length).toBe(5)
    expect(recent.map(entry => entry.at)).toEqual([...recent.map(entry => entry.at)].sort((a, b) => a - b))
    expect(recent.every(entry => entry.at <= NOW)).toBe(true)
  }
})

test('demo doing: the class scenes have a call in progress and the rest scenes none', async () => {
  expect(viewOf('guerreiro').doing).toEqual({ verb: 'editando', target: 'register.tsx' })
  // In the bug scene the edit is still running while the failed command has already ended.
  expect(viewOf('bug').doing).toEqual({ verb: 'editando', target: 'register.tsx' })
  expect(viewOf('explorador').doing).toEqual({ verb: 'pesquisando na web', target: null })
  expect(viewOf('mago').doing).toEqual({ verb: 'planejando', target: null })
  expect(viewOf('cansado').doing).toBe(null)
  expect(viewOf('dormindo').doing).toBe(null)
})

test('gold C24: every demo scene splits the demo cost', async () => {
  expect(SCENES.length).toBe(6)

  for (const scene of SCENES) {
    const state = demoState(scene, NOW)
    const view = buildView(state.tracker, state.usage, NOW)

    expect(view.gold).toEqual([
      { cls: 'mago', micros: 1_200_000, percent: 35 },
      { cls: 'guerreiro', micros: 1_710_000, percent: 50 },
      { cls: 'explorador', micros: 510_000, percent: 15 },
    ])
    // The demo's split begins at zero: it adds up to the whole cost, so no caption.
    expect(view.goldPartial).toBe(false)
    expect(goldTotal(state.tracker.gold)).toBe(Math.round((state.usage.costUsd ?? 0) * 1e6))
  }
})

test('meters C20: there is one demo scene per scheme', async () => {
  expect([...SCHEME_SCENES]).toEqual(['esquema-padrao', 'esquema-contraste', 'esquema-daltonico'])
  expect(SCHEME_SCENES.map(scene => schemeOfScene(scene))).toEqual(['padrao', 'contraste', 'daltonico'])
  // The scenes of the figures force no scheme.
  expect(SCENES.map(scene => schemeOfScene(scene))).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])

  for (const scene of SCHEME_SCENES) {
    expect(sceneOf(scene)).toBe(scene)
    expect(choiceOf(`  ${scene.toUpperCase()} `)).toEqual({ kind: 'scene', scene })
  }
})

test('meters C22: the state of a scheme scene walks HP 72, 38 and 15 every 3 seconds', async () => {
  const hpAt = (scene: (typeof SCHEME_SCENES)[number], at: number) => {
    const state = demoState(scene, at)

    return buildView(state.tracker, state.usage, at).hp
  }

  for (const scene of SCHEME_SCENES) {
    // Three seconds apart, whatever the clock starts at: high, medium and low come in turn, and then again.
    for (const start of [0, 1_000_000, 5_000_000, 7_654_321]) {
      const first = Math.floor(start / 9_000) * 9_000
      const levels = [0, 1, 2, 3, 4, 5].map(step => hpAt(scene, first + step * 3_000 + 1_500))

      expect(levels).toEqual([72, 38, 15, 72, 38, 15])
    }
  }

  // Inside one step the level does not move.
  expect([hpAt('esquema-daltonico', 9_000), hpAt('esquema-daltonico', 11_999)]).toEqual([72, 72])
})

test('meters C20: a scheme scene is the warrior at work with the demo figures', async () => {
  for (const scene of SCHEME_SCENES) {
    const state = demoState(scene, NOW)
    const view = buildView(state.tracker, state.usage, NOW)

    expect(view.active).toBe('guerreiro')
    expect(view.working).toBe(true)
    expect(view.doing).toEqual({ verb: 'editando', target: 'register.tsx' })
    expect([view.mana, view.stamina, view.costUsd]).toEqual([45, 64, 3.42])
  }
})
