// The material result of the session's work: the distinct files edited, the lines written and the shell
// commands run. It lives in memory with the tracker and starts over with the session; no path is kept.
export type Damage = {
  // A short fingerprint of each edited file, the latest last; never the path itself.
  files: readonly string[]
  lines: number
  commands: number
}

export const NO_DAMAGE: Damage = { files: [], lines: 0, commands: 0 }

// The most files remembered, so a very long session does not grow without limit.
export const MAX_FILES = 1_000

// What the screen needs of the damage: only the three numbers.
export type DamageView = { files: number; lines: number; commands: number }

// A short fingerprint of a path (53 bits, in base 36): it tells two files apart and says nothing of where they are.
export const fileKey = (path: string): string => {
  let a = 0xdeadbeef
  let b = 0x41c6ce57

  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)

  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36)
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// The fingerprint of the file a tool call edits, from its input; undefined for any other call.
export const fileOf = (tool: string, input: Record<string, unknown>): string | undefined => {
  if (!FILE_TOOLS.has(tool)) return undefined
  const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path

  return typeof path === 'string' && path.length > 0 ? fileKey(path) : undefined
}

// A call that worked and was paid: `lines` is the value the XP took, `file` the fingerprint of the file an edit
// touched, and `isCommand` says it ran a shell command.
export type Deed = { lines: number; file?: string; isCommand: boolean }

export const onDeed = (damage: Damage, deed: Deed): Damage => ({
  files: deed.file === undefined ? damage.files : [...damage.files.filter(key => key !== deed.file), deed.file].slice(-MAX_FILES),
  lines: damage.lines + Math.max(0, deed.lines),
  commands: damage.commands + (deed.isCommand ? 1 : 0),
})

export const damageView = (damage: Damage): DamageView => ({ files: damage.files.length, lines: damage.lines, commands: damage.commands })

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

// `3 arquivos`, `142 linhas`, `8 comandos`: none of them while there is no damage.
export const damageSegments = (damage: DamageView): string[] =>
  damage.files === 0 && damage.lines === 0 && damage.commands === 0
    ? []
    : [plural(damage.files, 'arquivo', 'arquivos'), plural(damage.lines, 'linha', 'linhas'), plural(damage.commands, 'comando', 'comandos')]
