import { expect, test } from 'claude-code/testing'

import { abbreviate, addTurn, lineOf, modelLabel, NO_TOKENS, tokenText, usageOf } from './tokens'

test('tokens C1: abbreviated numbers', async () => {
  const cases: [number, string][] = [
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [12400, '12,4k'],
    [1_200_000, '1,2M'],
    [-5, '0'],
    [Number.NaN, '0'],
    [142_000, '142k'],
    [999_999, '1M'],
    [Number.POSITIVE_INFINITY, '0'],
  ]

  for (const [value, text] of cases) expect(abbreviate(value)).toBe(text)
})

test('tokens C2: input is all the prompt and the rate is read over it', async () => {
  const totals = usageOf({ input_tokens: 1000, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1000, output_tokens: 500 })
  expect(totals).not.toBeNull()
  if (totals === null) return

  expect(lineOf(totals)).toEqual({ input: 10_000, output: 500, cache: 80, low: false })
  // Each of the four counts moves the figures it belongs to.
  expect(lineOf({ ...totals, uncached: 2000 })).toMatchObject({ input: 11_000, cache: 73 })
  expect(lineOf({ ...totals, cacheRead: 0 })).toMatchObject({ input: 2000, cache: 0 })
  expect(lineOf({ ...totals, cacheWritten: 3000 })).toMatchObject({ input: 12_000, cache: 67 })
  expect(lineOf({ ...totals, output: 9 })).toMatchObject({ output: 9, cache: 80 })
})

test('tokens C3: an undefined rate reads cache -- and never NaN', async () => {
  const totals = usageOf({ output_tokens: 700 })
  expect(totals).not.toBeNull()
  if (totals === null) return

  const line = lineOf(totals)
  expect(line.cache).toBeNull()
  expect(line.low).toBe(false)
  expect(tokenText('tokens', line, 80)).toBe('tokens  input 0 · output 700 · cache --')
  expect(tokenText('tokens', line, 20)).not.toMatch(/NaN|undefined|Infinity/)
})

test('tokens C4: invalid fields count as zero and an empty usage adds nothing', async () => {
  const bad = { input_tokens: Number.NaN, output_tokens: -3, cache_read_input_tokens: '9', cache_creation_input_tokens: 100 }
  expect(usageOf(bad)).toEqual({ uncached: 0, output: 0, cacheRead: 0, cacheWritten: 100 })
  expect(usageOf({ input_tokens: 5 })).toEqual({ uncached: 5, output: 0, cacheRead: 0, cacheWritten: 0 })
  expect(usageOf({ input_tokens: 5.7 })).toEqual({ uncached: 5, output: 0, cacheRead: 0, cacheWritten: 0 })

  for (const empty of [undefined, null, 7, 'x', {}, { input_tokens: 0, output_tokens: -1 }, { output_tokens: Number.NaN }]) {
    expect(usageOf(empty)).toBeNull()
    expect(addTurn(NO_TOKENS, empty, false)).toBe(NO_TOKENS)
    expect(addTurn(NO_TOKENS, empty, true)).toBe(NO_TOKENS)
  }
})

test('tokens C18: the model name drops its prefix and date', async () => {
  expect(modelLabel('claude-sonnet-5-5')).toBe('sonnet-5-5')
  expect(modelLabel('claude-opus-4-1-20250805')).toBe('opus-4-1')
  expect(modelLabel('gpt-x')).toBe('gpt-x')
})

test('tokens totals: turns add up, the rate is of the sum and the subagents stay apart', async () => {
  const one = { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10, model: 'claude-a-1' }
  const two = { input_tokens: 0, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 20, model: 'claude-b-2' }
  const sub = { input_tokens: 50, output_tokens: 5, model: 'claude-c-3' }

  const after = addTurn(addTurn(addTurn(NO_TOKENS, one, false), sub, true), two, false)
  expect(after.last).toEqual({ uncached: 0, output: 20, cacheRead: 900, cacheWritten: 0 })
  expect(after.session).toEqual({ uncached: 100, output: 30, cacheRead: 900, cacheWritten: 0 })
  // 900 of 1000, not the mean of 0% and 100%.
  expect(lineOf(after.session ?? { uncached: 0, output: 0, cacheRead: 0, cacheWritten: 0 }).cache).toBe(90)
  expect(after.subagents).toEqual({ uncached: 50, output: 5, cacheRead: 0, cacheWritten: 0 })
  expect(after.model).toBe('claude-b-2')
})

test('tokens threshold: the line is low below 50 percent only', async () => {
  const at = (read: number, other: number) => lineOf({ uncached: other, output: 1, cacheRead: read, cacheWritten: 0 })

  expect(at(49, 51).low).toBe(true)
  expect(at(50, 50).low).toBe(false)
  expect(at(87, 13).low).toBe(false)
  expect(at(0, 10).low).toBe(true)
  // The rounded figure on screen decides: 49.6 shows 50 and is not low.
  expect(at(496, 504)).toMatchObject({ cache: 50, low: false })
})

test('tokens text: the text picks the longest form that fits and drops out when none does', async () => {
  const line = { input: 142_000, output: 18_000, cache: 87, low: false }

  expect(tokenText('tokens', line, 80)).toBe('tokens  input 142k · output 18k · cache 87%')
  expect(tokenText('tokens', line, 35)).toBe('tokens  in 142k · out 18k · 87%')
  expect(tokenText('tokens', line, 20)).toBe('tokens  142k/18k 87%')
  expect(tokenText('tokens', line, 11)).toBe('tokens  87%')
  expect(tokenText('tokens', line, 10)).toBeNull()
  expect(tokenText('subagentes', line, 20)).toBe('subagentes 87%')
  expect(tokenText('subagentes', line, 80)).toBe('subagentes input 142k · output 18k · cache 87%')
})
