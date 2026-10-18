export type TaskClass = 'mago' | 'guerreiro' | 'explorador'

// One tool call of a turn, as the hook saw it: the tool, and for Bash its
// command, for Agent the kind of subagent.
export type ToolUse = { tool: string; command?: string; subagent?: string; lines?: number }

export type TurnSignals = {
  prompt: string
  planMode: boolean
  tools: readonly ToolUse[]
}

const MUTATING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const LOOKING = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch', 'NotebookRead'])
const PLANNING = new Set(['TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate'])
const READ_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'pwd', 'which', 'tree', 'stat', 'file', 'du', 'df',
  'echo', 'printf', 'sort', 'uniq', 'diff', 'jq', 'env', 'whoami', 'date', 'type', 'cd',
  'cut', 'tr', 'nl', 'column', 'basename', 'dirname', 'realpath', 'readlink', 'uname', 'hostname', 'id', 'ps', 'lsof',
  'less', 'more',
])
const READ_GIT = new Set(['log', 'status', 'diff', 'show', 'branch', 'blame', 'remote', 'ls-files', 'rev-parse', 'describe'])
// Subcommands that only read, by program: `gh pr view`, `claude plugin list`.
const READ_GH = new Set(['pr view', 'pr list', 'pr diff', 'pr checks', 'pr status', 'issue view', 'issue list', 'repo view'])
const READ_CLAUDE = new Set(['plugin list', '--version'])

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)

// Splits at | || && ; that are not inside quotes, so `sed -n '1p;3p'` and
// `grep -E 'a|b'` stay one piece.
const pieces = (command: string): string[] => {
  const result: string[] = []
  let current = ''
  let quote = ''

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]

    if (quote) {
      if (char === quote) quote = ''
      current += char
    } else if (char === "'" || char === '"') {
      quote = char
      current += char
    } else if (char === '|' || char === ';' || (char === '&' && command[i + 1] === '&')) {
      result.push(current)
      current = ''
      if (command[i + 1] === char) i += 1
    } else {
      current += char
    }
  }

  return [...result, current]
}

// `sed` edits in place with -i, alone or inside a cluster (-ni, -i.bak), or --in-place.
const sedEditsInPlace = (args: string[]): boolean => args.some(arg => /^-[A-Za-z]*i/.test(arg) || arg.startsWith('--in-place'))

// `awk` reads unless its program runs a command (system, getline, a pipe), comes
// from a file we cannot see (-f) or edits in place (-i). Writing to a file is a
// redirection, already caught for the whole command.
const awkRunsCode = (args: string[], text: string): boolean =>
  /\bsystem\s*\(|\bgetline\b|\|/.test(text) || args.some(arg => /^(-f|--file|-i|--include)/.test(arg))

const isReadPart = (text: string): boolean => {
  const [head = '', ...args] = words(text)
  const [second = '', third = ''] = args

  if (head === 'git') return READ_GIT.has(second)
  if (head === 'gh') return READ_GH.has(`${second} ${third}`)
  if (head === 'claude') return READ_CLAUDE.has(`${second} ${third}`.trim())
  if (head === 'sed') return !sedEditsInPlace(args)
  if (head === 'awk') return !awkRunsCode(args, text)

  return READ_COMMANDS.has(head)
}

// A command only looks when every piece of a pipeline or && chain does and
// nothing is redirected into a file.
export const isReadOnlyCommand = (raw: string): boolean => {
  const command = raw.replace(/\d*>>?\s*\/dev\/null/g, '')
  if (/(^|[^>])>{1,2}(?!&)|\btee\b/.test(command)) return false

  return pieces(command)
    .filter(part => words(part).length > 0)
    .every(isReadPart)
}

// What a tool call counts as: acting changes things, looking reads them,
// planning organises the work.
export const kindOf = (use: ToolUse): 'act' | 'look' | 'plan' => {
  if (MUTATING.has(use.tool)) return 'act'
  if (LOOKING.has(use.tool)) return 'look'
  if (PLANNING.has(use.tool)) return 'plan'
  if (use.tool === 'Bash') return isReadOnlyCommand(use.command ?? '') ? 'look' : 'act'
  if (use.tool === 'Agent' || use.tool === 'Task') {
    if (use.subagent === 'Plan') return 'plan'
    if (use.subagent === 'Explore') return 'look'

    return 'act'
  }

  return 'act'
}

// Words of a prompt, with a weight each. Fixing and building words weigh most
// on the acting side, investigating words on the looking side, and a failure
// noun alone (bug, error) only leans a little towards looking, so "corrija o
// bug" is the warrior and "investigue o bug" the explorer.
const FIX_WORDS =
  /\b(fix|corrig\w*|corrij\w*|consert\w*|arrum\w*|resolv\w*|solve|implement\w*|refator\w*|refactor\w*)\b/g
const TASK_WORDS =
  /\b(crie|criar|cria|adicion\w*|add|escrev\w*|write|renome\w*|rename|delet\w*|remov\w*|instal\w*|build|compil\w*|rode|rodar|execut\w*|deploy|commit|push|test|tests|teste|testes|testar)\b/g
const INVESTIGATE_WORDS = /\b(investig\w*|debug\w*|depur\w*|diagnos\w*)\b/g
const LOOK_WORDS =
  /\b(search|find|explor\w*|pesquis\w*|procur\w*|busc\w*|onde|where|explain|explic\w*|entend\w*|understand|mostr\w*|show|list\w*)\b/g
const WEB_WORDS = /\b(internet|web|online|site|sites|documentacao|docs)\b/g
const FAILURE_WORDS = /\b(bug|bugs|erro|erros|error|errors|falh\w*|fail\w*)\b/g
const PLAN_WORDS = /\b(plan\w*|planej\w*|plano|planos|arquitet\w*|architect\w*|brainstorm\w*|spec|proposta|estrateg\w*|strateg\w*|roadmap)\b/g
const SOFT_PLAN_WORDS = /\b(design|desenho)\b/g

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

// What the prompt alone says the work is, if it says; a tie goes to acting,
// then planning.
export const classifyPrompt = (prompt: string): TaskClass | undefined => {
  const text = normalize(prompt)
  const act = count(text, FIX_WORDS) * 3 + count(text, TASK_WORDS) * 2
  const plan = count(text, PLAN_WORDS) * 4 + count(text, SOFT_PLAN_WORDS) * 2
  const look = count(text, INVESTIGATE_WORDS) * 3 + count(text, LOOK_WORDS) * 2 + count(text, WEB_WORDS) * 2 + count(text, FAILURE_WORDS)
  const top = Math.max(act, plan, look)

  if (top === 0) return undefined
  if (act === top) return 'guerreiro'
  if (plan === top) return 'mago'

  return 'explorador'
}

// What a turn is when nothing says otherwise: the warrior is for fixing and
// doing, so the neutral class is the one that looks around.
export const DEFAULT_CLASS: TaskClass = 'explorador'

const CLASS_OF = { act: 'guerreiro', look: 'explorador', plan: 'mago' } as const

// The class of what the tools were doing: the one most of them did, a tie going
// to the most recent. Undefined without tools.
export const classifyTools = (tools: readonly ToolUse[]): TaskClass | undefined => {
  const counts: Record<TaskClass, number> = { mago: 0, guerreiro: 0, explorador: 0 }
  let last: TaskClass | undefined

  for (const use of tools) {
    last = CLASS_OF[kindOf(use)]
    counts[last] += 1
  }

  const top = Math.max(counts.mago, counts.guerreiro, counts.explorador)

  return last === undefined ? undefined : counts[last] === top ? last : (Object.keys(counts) as TaskClass[]).find(cls => counts[cls] === top)
}

const linesOf = (text: unknown): number => (typeof text === 'string' && text.length > 0 ? text.split('\n').length : 0)

// Lines a call writes, as far as its input shows: the new text of an edit or a new file.
export const linesWritten = (input: Record<string, unknown>): number => {
  const edits = Array.isArray(input.edits) ? input.edits : []
  const inEdits = edits.reduce<number>(
    (sum, edit) => sum + (typeof edit === 'object' && edit !== null ? linesOf((edit as Record<string, unknown>).new_string) : 0),
    0,
  )

  return linesOf(input.new_string) + linesOf(input.content) + inEdits
}

// Who a single tool call belongs to: plan mode is the mage's, otherwise its kind.
export const classOf = (use: ToolUse, planMode: boolean): TaskClass => (planMode ? 'mago' : CLASS_OF[kindOf(use)])

// How many of the latest tool calls say what the agent is doing now.
const RECENT_TOOLS = 3

// What the agent is doing decides: plan mode is the mage's, otherwise the kind of
// its latest tool calls (reading is the explorer's, changing things the
// warrior's, organising the work the mage's). The prompt only guesses before the
// first tool call, and the explorer is the default.
export const classify = (signals: TurnSignals): TaskClass => {
  if (signals.planMode) return 'mago'

  return classifyTools(signals.tools.slice(-RECENT_TOOLS)) ?? classifyPrompt(signals.prompt) ?? DEFAULT_CLASS
}
