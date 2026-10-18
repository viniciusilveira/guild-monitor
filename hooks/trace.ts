import type { TaskClass } from './classify'
import { CLASSES } from './xp'

// What happened, in order to find out later who was on screen at each step and why.
// Only names and classes are kept: no prompts, no paths, no full commands.
export type TraceEntry = {
  at: number
  what: 'tool' | 'turn' | 'mode'
  // The tool called, or what the event was.
  tool?: string
  // First word of a shell command (the program), to see why it counted as it did.
  program?: string
  kind?: 'act' | 'look' | 'plan'
  // The character on screen once the event was taken in.
  shown: TaskClass
  // The class that got the XP of a tool call that worked.
  paid?: TaskClass
  planMode: boolean
  isError?: boolean
}

export const MAX_TRACE = 200

export const appendTrace = (trace: readonly TraceEntry[], entry: TraceEntry, max = MAX_TRACE): TraceEntry[] =>
  [...trace, entry].slice(-max)

const isClass = (value: unknown): value is TaskClass => CLASSES.some(cls => cls === value)

// What the store hands back is JSON anyone could have edited: keep the entries that make sense.
export const parseTrace = (stored: unknown): TraceEntry[] => {
  if (!Array.isArray(stored)) return []

  const kept: TraceEntry[] = []

  for (const item of stored) {
    if (typeof item !== 'object' || item === null) continue

    const raw = item as Record<string, unknown>
    if (typeof raw.at !== 'number' || !Number.isFinite(raw.at) || !isClass(raw.shown)) continue
    if (raw.what !== 'tool' && raw.what !== 'turn' && raw.what !== 'mode') continue

    kept.push({
      at: raw.at,
      what: raw.what,
      tool: typeof raw.tool === 'string' ? raw.tool : undefined,
      program: typeof raw.program === 'string' ? raw.program : undefined,
      kind: raw.kind === 'act' || raw.kind === 'look' || raw.kind === 'plan' ? raw.kind : undefined,
      shown: raw.shown,
      paid: isClass(raw.paid) ? raw.paid : undefined,
      planMode: raw.planMode === true,
      isError: raw.isError === true ? true : undefined,
    })
  }

  return kept.slice(-MAX_TRACE)
}

const two = (n: number): string => String(n).padStart(2, '0')

const clock = (at: number): string => {
  const date = new Date(at)

  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

const line = (entry: TraceEntry): string => {
  const when = clock(entry.at)
  const plan = entry.planMode ? ' [plano]' : ''

  if (entry.what === 'turn') return `${when} turno: ${entry.tool ?? ''} | em cena: ${entry.shown}${plan}`
  if (entry.what === 'mode') return `${when} modo: ${entry.tool ?? ''} | em cena: ${entry.shown}`

  const target = entry.program === undefined ? entry.tool : `${entry.tool}:${entry.program}`
  const result = entry.isError === true ? ' ERRO' : ''

  return `${when} ${target ?? '?'} (${entry.kind ?? '?'})${result} | em cena: ${entry.shown} | XP: ${entry.paid ?? '-'}${plan}`
}

// How often each class was on screen across the tool calls, to see a lopsided guild at a glance.
export const summarizeTrace = (trace: readonly TraceEntry[]): Record<TaskClass, number> => {
  const counts: Record<TaskClass, number> = { mago: 0, guerreiro: 0, explorador: 0 }

  for (const entry of trace) if (entry.what === 'tool') counts[entry.shown] += 1

  return counts
}

// The last `count` entries as text, newest last, with the summary of the whole trace above.
export const describeTrace = (trace: readonly TraceEntry[], count: number): string => {
  if (trace.length === 0) return 'Registro vazio.'

  const counts = summarizeTrace(trace)
  const head = `Em cena nas ${trace.filter(entry => entry.what === 'tool').length} chamadas registradas: mago ${counts.mago}, guerreiro ${counts.guerreiro}, explorador ${counts.explorador}`

  return [head, ...trace.slice(-Math.max(1, count)).map(line)].join('\n')
}
