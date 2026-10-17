import { expect, test } from 'claude-code/testing'

import { choiceOf, demoState, SCENES, sceneOf } from './demo'
import { DEFAULTS } from './guild'
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
