import type { TokenLine } from '../types'

// The tokens a turn spent, as `turn.complete` reports them: kept in memory with the tracker, shown on the
// panel and never saved. Everything here is pure.

// The four counts of one or more turns, each a whole number that is never negative.
export type Totals = { uncached: number; output: number; cacheRead: number; cacheWritten: number }


export type Tokens = {
  // The last main-agent turn that reported usage, the main agent's total and the subagents' total.
  last: Totals | null
  session: Totals | null
  subagents: Totals | null
  // The model of that last main-agent turn.
  model: string | null
}

export const NO_TOKENS: Tokens = { last: null, session: null, subagents: null, model: null }

// A hit rate under this many percent (as shown, rounded) is highlighted.
export const LOW_CACHE_PERCENT = 50

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

// "12,4k", "1,2M": one decimal below 100 of the unit, none from there, a ",0" dropped. What is not a
// finite positive number reads as "0".
export const abbreviate = (value: number): string => {
  const n = count(value)
  if (n < 1000) return String(n)

  const units: [number, string][] = [
    [1000, 'k'],
    [1_000_000, 'M'],
  ]
  let at = n >= 1_000_000 ? 1 : 0
  let scaled = n / (units[at]?.[0] ?? 1)
  let text = scaled < 100 ? scaled.toFixed(1) : String(Math.round(scaled))

  // 999.95k rounds to 1000k: that is 1M.
  if (at === 0 && Number.parseFloat(text) >= 1000) {
    at = 1
    scaled = n / 1_000_000
    text = scaled.toFixed(1)
  }

  return `${text.replace(/,?\.0$/, '').replace('.', ',')}${units[at]?.[1] ?? ''}`
}

// The counts of a `usage`; null when there is none, or when it is not an object, or when nothing in it counts.
export const usageOf = (raw: unknown): Totals | null => {
  if (typeof raw !== 'object' || raw === null) return null

  const fields = raw as Record<string, unknown>
  const totals: Totals = {
    uncached: count(fields.input_tokens),
    output: count(fields.output_tokens),
    cacheRead: count(fields.cache_read_input_tokens),
    cacheWritten: count(fields.cache_creation_input_tokens),
  }

  return totals.uncached + totals.output + totals.cacheRead + totals.cacheWritten === 0 ? null : totals
}

const sum = (a: Totals | null, b: Totals): Totals =>
  a === null
    ? b
    : {
        uncached: a.uncached + b.uncached,
        output: a.output + b.output,
        cacheRead: a.cacheRead + b.cacheRead,
        cacheWritten: a.cacheWritten + b.cacheWritten,
      }

// A turn that reported no usage adds nothing: the very same state comes back. A subagent's turn goes to its
// own total and touches neither the main agent's figures nor the model shown.
export const addTurn = (tokens: Tokens, usage: unknown, isSubagent: boolean): Tokens => {
  const totals = usageOf(usage)
  if (totals === null) return tokens

  if (isSubagent) return { ...tokens, subagents: sum(tokens.subagents, totals) }

  const model = (usage as { model?: unknown }).model

  return {
    ...tokens,
    last: totals,
    session: sum(tokens.session, totals),
    model: typeof model === 'string' && model !== '' ? model : tokens.model,
  }
}

export const lineOf = (totals: Totals): TokenLine => {
  const input = totals.uncached + totals.cacheRead + totals.cacheWritten
  const cache = input === 0 ? null : Math.round((totals.cacheRead * 100) / input)

  return { input, output: totals.output, cache, low: cache !== null && cache < LOW_CACHE_PERCENT }
}

// "sonnet-5-5": the model id without its `claude-` prefix and its date.
export const modelLabel = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

// The model as far as `room` columns hold it: whole (`sonnet-5-5`), then only the family (`sonnet`), else nothing.
export const modelFit = (label: string, room: number): string | null =>
  [label, label.split('-')[0] ?? label].find(form => form !== '' && form.length <= room) ?? null

// The longest form of the line that fits `width` columns, or null when not even the rate does.
export const tokenText = (label: string, line: TokenLine, width: number): string | null => {
  const head = label.length <= 6 ? `${label}  ` : `${label} `
  const rate = line.cache === null ? '--' : `${line.cache}%`
  const input = abbreviate(line.input)
  const output = abbreviate(line.output)
  const forms = [
    `${head}input ${input} · output ${output} · cache ${rate}`,
    `${head}in ${input} · out ${output} · ${rate}`,
    `${head}${input}/${output} ${rate}`,
    `${head}${rate}`,
  ]

  return forms.find(form => form.length <= width) ?? null
}
