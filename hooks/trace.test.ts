import { expect, test } from 'claude-code/testing'

import type { TraceEntry } from './trace'
import { appendTrace, describeTrace, MAX_TRACE, parseTrace, programOf, summarizeTrace } from './trace'

const tool = (patch: Partial<TraceEntry> = {}): TraceEntry => ({
  at: 1_000,
  what: 'tool',
  tool: 'Read',
  kind: 'look',
  shown: 'explorador',
  paid: 'explorador',
  planMode: false,
  ...patch,
})

test('the trace keeps the latest entries and drops the oldest', async () => {
  let trace: TraceEntry[] = []

  for (let i = 0; i < MAX_TRACE + 30; i += 1) trace = appendTrace(trace, tool({ at: i }))

  expect(trace.length).toBe(MAX_TRACE)
  expect(trace[0]?.at).toBe(30)
  expect(trace[MAX_TRACE - 1]?.at).toBe(MAX_TRACE + 29)
  expect(appendTrace([], tool(), 3).length).toBe(1)
})

test('stored data that is wrong is left out and the rest is kept', async () => {
  const good = tool({ program: 'npm', paid: undefined })
  const parsed = parseTrace([good, { at: 'x', what: 'tool', shown: 'mago' }, null, 7, { at: 1, what: 'tool', shown: 'dragao' }, { at: 2, what: 'nope', shown: 'mago' }])

  expect(parsed.length).toBe(1)
  expect(parsed[0]).toEqual({ ...good, isError: undefined })
  expect(parseTrace(undefined)).toEqual([])
  expect(parseTrace('lixo')).toEqual([])
})

test('the summary counts who was on screen at each tool call, not at turns or modes', async () => {
  const trace = [
    tool({ shown: 'guerreiro' }),
    tool({ shown: 'guerreiro' }),
    tool({ shown: 'explorador' }),
    tool({ what: 'turn', tool: 'início', shown: 'mago' }),
  ]

  expect(summarizeTrace(trace)).toEqual({ mago: 0, guerreiro: 2, explorador: 1 })
})

test('the description has the summary, then the latest entries with what was on screen and who got the XP', async () => {
  const trace = [
    tool({ at: 0, tool: 'Bash', program: 'sed', kind: 'act', shown: 'guerreiro', paid: 'guerreiro' }),
    tool({ at: 1_000, tool: 'Bash', program: 'npm', kind: 'act', shown: 'guerreiro', paid: undefined, isError: true }),
    tool({ at: 2_000, what: 'mode', tool: 'plano ligado', shown: 'mago', planMode: true, kind: undefined, paid: undefined }),
  ]
  const text = describeTrace(trace, 2)
  const lines = text.split('\n')

  expect(lines.length).toBe(3)
  expect(lines[0]).toBe('Em cena nas 2 chamadas registradas: mago 0, guerreiro 2, explorador 0')
  expect(lines[1]?.includes('Bash:npm (act) ERRO | em cena: guerreiro | XP: -')).toBe(true)
  expect(lines[2]?.includes('modo: plano ligado | em cena: mago')).toBe(true)
  expect(describeTrace([], 5)).toBe('Registro vazio.')
})

test('the program of a command is its name and nothing that could be a secret or a path', async () => {
  expect(programOf('npm test')).toBe('npm')
  expect(programOf('  git   status ')).toBe('git')
  expect(programOf('API_KEY=abc123 npm test')).toBe('npm')
  expect(programOf('FOO=1 BAR=2 node script.js')).toBe('node')
  expect(programOf('/Users/x/segredo/run.sh --go')).toBe('run.sh')
  expect(programOf('./run.sh')).toBe('run.sh')
})

test('a word that is not a plain program name is left out, whole', async () => {
  expect(programOf('')).toBe(undefined)
  expect(programOf('API_KEY=abc123')).toBe(undefined)
  expect(programOf('https://host/path?token=abc')).toBe(undefined)
  expect(programOf('K="a b" cmd')).toBe(undefined)
  expect(programOf(`${'x'.repeat(31)} go`)).toBe(undefined)
  expect(programOf(`${'x'.repeat(30)} go`)).toBe('x'.repeat(30))
})

test('a stored program that is not a plain name is dropped when the trace is read', async () => {
  const parsed = parseTrace([tool({ program: 'API_KEY=abc123' }), tool({ program: 'npm' }), tool({ program: 'y'.repeat(200) })])

  expect(parsed.map(entry => entry.program)).toEqual([undefined, 'npm', undefined])
})

test('the trace marks a rejection apart from a failure', async () => {
  const refused = tool({ tool: 'ExitPlanMode', kind: 'plan', paid: undefined, rejected: true })
  const failed = tool({ tool: 'Bash', program: 'npm', kind: 'act', paid: undefined, isError: true })

  expect(refused.isError).toBeUndefined()
  expect(parseTrace([refused, failed])).toEqual([
    { ...refused, program: undefined, isError: undefined },
    { ...failed, rejected: undefined },
  ])

  const lines = describeTrace([refused, failed], 5).split('\n')
  expect(lines[1]).toContain('ExitPlanMode (plan) RECUSADA')
  expect(lines[1]).not.toContain('ERRO')
  expect(lines[2]).toContain('Bash:npm (act) ERRO')
  expect(lines[2]).not.toContain('RECUSADA')
})
