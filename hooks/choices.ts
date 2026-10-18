// Named choices a person makes with a command (`/guild meters daltonico`) and the plugin keeps between sessions:
// pure functions to validate a name, read what follows the command word, pick the choice among its sources, list
// the names and fold the choice into the saved preferences. The meters' color schemes use it; the character palettes
// can use it the same way, with a set of their own.

export type ChoiceSet<N extends string> = {
  // The field of the saved preferences that holds the choice.
  field: string
  names: readonly N[]
  fallback: N
  // The command as typed, for the help and the list: `/guild meters`.
  command: string
  // What one name is called, singular: "Esquema". `scope` completes it in the texts: "dos medidores".
  noun: string
  scope: string
}

export type ChoiceRequest<N extends string> = { kind: 'list' } | { kind: 'set'; name: N } | { kind: 'invalid'; typed: string }

export const isChoice = <N extends string>(set: ChoiceSet<N>, value: unknown): value is N => set.names.some(name => name === value)

// What follows the command word: nothing lists, a name (any case, any spaces around) sets, anything else is invalid.
export const requestOf = <N extends string>(set: ChoiceSet<N>, args: string): ChoiceRequest<N> => {
  const typed = args.trim().toLowerCase()
  if (typed === '') return { kind: 'list' }

  return isChoice(set, typed) ? { kind: 'set', name: typed } : { kind: 'invalid', typed }
}

// The first source that names a choice wins, so the order of `sources` is the order of precedence; none: the fallback.
export const chooseFrom = <N extends string>(set: ChoiceSet<N>, sources: readonly unknown[]): N => sources.find((source): source is N => isChoice(set, source)) ?? set.fallback

const recordOf = (stored: unknown): Record<string, unknown> | undefined =>
  typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : undefined

// The choice in the saved preferences, or nothing when it is missing or is not one of the names.
export const savedChoice = <N extends string>(set: ChoiceSet<N>, stored: unknown): N | undefined => {
  const value = recordOf(stored)?.[set.field]

  return isChoice(set, value) ? value : undefined
}

// The saved preferences with `field` set, the other fields kept; what was there before, if not a record, is dropped.
export const mergeSaved = (stored: unknown, field: string, value: unknown): Record<string, unknown> => ({ ...recordOf(stored), [field]: value })

// "Esquemas dos medidores:" and one name per line, the current one marked.
export const describeChoices = <N extends string>(set: ChoiceSet<N>, current: N): string =>
  [`${set.noun}s ${set.scope}:`, ...set.names.map(name => (name === current ? `- ${name} (atual)` : `- ${name}`)), `Troque com ${set.command} NOME`].join('\n')

export const helpText = <N extends string>(set: ChoiceSet<N>, typed: string): string => `${set.noun} "${typed}" não existe. Use: ${set.command} ${set.names.join(' | ')}`

export const savedText = <N extends string>(set: ChoiceSet<N>, name: N): string => `${set.noun} ${set.scope}: ${name} (salvo)`
