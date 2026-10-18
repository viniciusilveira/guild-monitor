import type { Doing } from '../types'
import type { Running } from './tracker'

// One verb per kind of tool, in a single table. A tool that is not here is running something.
export const VERBS: Record<string, string> = {
  Read: 'lendo',
  NotebookRead: 'lendo',
  Grep: 'buscando',
  Glob: 'buscando',
  LS: 'buscando',
  ToolSearch: 'buscando',
  WebSearch: 'pesquisando na web',
  WebFetch: 'pesquisando na web',
  Edit: 'editando',
  MultiEdit: 'editando',
  NotebookEdit: 'editando',
  Write: 'escrevendo',
  Bash: 'executando',
  TodoWrite: 'planejando',
  EnterPlanMode: 'planejando',
  ExitPlanMode: 'planejando',
  AskUserQuestion: 'planejando',
  TaskCreate: 'planejando',
  TaskUpdate: 'planejando',
  Agent: 'chamando um aliado',
  Task: 'chamando um aliado',
}

const FALLBACK_VERB = 'executando'

export const verbOf = (tool: string): string => VERBS[tool] ?? FALLBACK_VERB

export const MAX_TARGET = 24
const COMMAND_WORDS = 3
const FILE_FIELDS = ['file_path', 'notebook_path']
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead'])

const cut = (text: string): string => (text.length > MAX_TARGET ? `${text.slice(0, MAX_TARGET - 1)}…` : text)

// What the line shows after the verb: the file name without its directory, or the first words of a
// shell command, cut with an ellipsis. Nothing else is shown, and nothing here is ever saved.
export const targetOf = (tool: string, input: Record<string, unknown>): string | undefined => {
  if (FILE_TOOLS.has(tool)) {
    const path = FILE_FIELDS.map(field => input[field]).find((value): value is string => typeof value === 'string')
    const name = path?.split(/[\\/]/).filter(Boolean).pop()

    return name === undefined ? undefined : cut(name)
  }

  if (tool === 'Bash' && typeof input.command === 'string') {
    const words = input.command.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return undefined

    const head = words.slice(0, COMMAND_WORDS).join(' ')
    // Words left out of the line are marked, so a cut never looks like the whole command.
    const text = words.length > COMMAND_WORDS ? `${head}…` : head

    return text.length > MAX_TARGET ? cut(text) : text
  }

  return undefined
}

// The call that counts is the most recent one that has not finished.
export const doingOf = (running: readonly Running[]): Doing | null => {
  const call = running.at(-1)

  return call === undefined ? null : { verb: verbOf(call.tool), target: call.target ?? null }
}

export type LineArgs = { name: string; doing: Doing | null; rest: string; columns: number }

// The line at the top: `Guerreiro: editando register.tsx` when it fits, then without the name,
// then only the verb. The same three steps serve the resting state.
export const doingLine = ({ name, doing, rest, columns }: LineArgs): string => {
  const what = doing === null ? rest : doing.target === null ? doing.verb : `${doing.verb} ${doing.target}`
  const full = `${name}: ${what}`
  if (full.length <= columns) return full
  if (what.length <= columns) return what

  return doing === null ? rest : doing.verb
}
