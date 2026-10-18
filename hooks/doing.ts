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
const FILE_FIELDS = ['file_path', 'notebook_path']
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead'])

const cut = (text: string): string => (text.length > MAX_TARGET ? `${text.slice(0, MAX_TARGET - 1)}…` : text)

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PROGRAM_NAME = /^[A-Za-z0-9._+-]{1,30}$/
// A subcommand (`git commit`, `npm test`): letters and hyphens only. Anything with a digit, `=`, `:`, `/`, `@`,
// `.`, a leading `-` or a quote can be a value (a token, a password, a URL) and is never shown.
const SUBCOMMAND = /^[A-Za-z][A-Za-z-]{0,19}$/

// What a shell command shows: the program (no path) and at most a plain subcommand after it. Leading
// `NAME=value` words, `env` with its assignments and flags, and everything else of the command (flags, values,
// URLs, credentials) are left out, because the target is drawn on a screen that may be shared. A cut is marked `…`.
const commandTarget = (command: string): string | undefined => {
  const words = command.trim().split(/\s+/).filter(Boolean)
  let at = 0
  let inEnv = false

  while (at < words.length) {
    const word = words[at] ?? ''
    if (ASSIGNMENT.test(word) || (inEnv && word.startsWith('-'))) at += 1
    else if (word === 'env' && !inEnv) {
      inEnv = true
      at += 1
    } else break
  }

  // `env` alone (or with only assignments and flags) is the program.
  const program = (words[at] ?? (inEnv ? 'env' : '')).split('/').pop() ?? ''
  if (!PROGRAM_NAME.test(program)) return undefined

  const second = words[at + 1]
  const shown = second !== undefined && SUBCOMMAND.test(second) ? `${program} ${second}` : program
  const used = words[at] === undefined ? at : at + (shown === program ? 1 : 2)
  const omitted = used < words.length || (at > 0 && words[at] !== undefined)

  return cut(omitted ? `${shown}…` : shown)
}

// What the line shows after the verb: the file name without its directory, or the program (and a
// plain subcommand) of a shell command, cut with an ellipsis. Nothing else is shown, and nothing here is ever saved.
export const targetOf = (tool: string, input: Record<string, unknown>): string | undefined => {
  if (FILE_TOOLS.has(tool)) {
    const path = FILE_FIELDS.map(field => input[field]).find((value): value is string => typeof value === 'string')
    const name = path?.split(/[\\/]/).filter(Boolean).pop()

    return name === undefined ? undefined : cut(name)
  }

  if (tool === 'Bash' && typeof input.command === 'string') return commandTarget(input.command)

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
