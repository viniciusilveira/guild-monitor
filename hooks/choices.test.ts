import { expect, test } from 'claude-code/testing'

import type { ChoiceSet } from './choices'
import { chooseFrom, describeChoices, helpText, isChoice, mergeSaved, requestOf, savedChoice, savedText } from './choices'

// A set that has nothing to do with the meters: the module must serve the character palettes just the same.
const LETTERS: ChoiceSet<'a' | 'b'> = { field: 'letter', names: ['a', 'b'], fallback: 'a', command: '/guild letter', noun: 'Letra', scope: 'da guilda' }

test('meters C18: named choices work for any set of names', async () => {
  expect(isChoice(LETTERS, 'b')).toBe(true)
  expect(isChoice(LETTERS, 'c')).toBe(false)
  expect(isChoice(LETTERS, 3)).toBe(false)

  // What follows the command word: nothing lists, a known name (any case, any spaces) sets, anything else is invalid.
  expect(requestOf(LETTERS, '')).toEqual({ kind: 'list' })
  expect(requestOf(LETTERS, '   ')).toEqual({ kind: 'list' })
  expect(requestOf(LETTERS, '  B ')).toEqual({ kind: 'set', name: 'b' })
  expect(requestOf(LETTERS, 'zzz')).toEqual({ kind: 'invalid', typed: 'zzz' })
  expect(requestOf(LETTERS, 'a b')).toEqual({ kind: 'invalid', typed: 'a b' })

  // The first source that names a choice wins; the fallback comes when none does.
  expect(chooseFrom(LETTERS, ['b', 'a'])).toBe('b')
  expect(chooseFrom(LETTERS, [undefined, 'b'])).toBe('b')
  expect(chooseFrom(LETTERS, ['nope', 7, 'b'])).toBe('b')
  expect(chooseFrom(LETTERS, ['nope', undefined])).toBe('a')
  expect(chooseFrom(LETTERS, [])).toBe('a')

  // The saved preferences: a record by field.
  expect(savedChoice(LETTERS, { letter: 'b', panel: false })).toBe('b')
  expect(savedChoice(LETTERS, { letter: 'q' })).toBe(undefined)
  expect(savedChoice(LETTERS, { panel: true })).toBe(undefined)
  expect(savedChoice(LETTERS, null)).toBe(undefined)
  expect(savedChoice(LETTERS, 'b')).toBe(undefined)
  expect(savedChoice(LETTERS, ['b'])).toBe(undefined)

  // Saving a field keeps the others, and tolerates what was there being nothing or nonsense.
  expect(mergeSaved({ panel: true }, 'letter', 'b')).toEqual({ panel: true, letter: 'b' })
  expect(mergeSaved({ panel: true, letter: 'a' }, 'letter', 'b')).toEqual({ panel: true, letter: 'b' })
  expect(mergeSaved(undefined, 'letter', 'b')).toEqual({ letter: 'b' })
  expect(mergeSaved('x', 'letter', 'b')).toEqual({ letter: 'b' })
  expect(mergeSaved(['x'], 'letter', 'b')).toEqual({ letter: 'b' })

  // The texts: the list marks the current one, the help names every choice, the confirmation says it was saved.
  expect(describeChoices(LETTERS, 'b')).toBe('Letras da guilda:\n- a\n- b (atual)\nTroque com /guild letter NOME')
  expect(helpText(LETTERS, 'zzz')).toBe('Letra "zzz" não existe. Use: /guild letter a | b')
  expect(savedText(LETTERS, 'b')).toBe('Letra da guilda: b (salvo)')
})
