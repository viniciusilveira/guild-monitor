import { expect, test } from 'claude-code/testing'

import { doingLine, targetOf, VERBS, verbOf } from './doing'

test('doing verbs: every kind of tool has one verb in the single table', async () => {
  const expected: Array<[string, string]> = [
    ['Read', 'lendo'],
    ['Grep', 'buscando'],
    ['Glob', 'buscando'],
    ['WebSearch', 'pesquisando na web'],
    ['WebFetch', 'pesquisando na web'],
    ['Edit', 'editando'],
    ['MultiEdit', 'editando'],
    ['NotebookEdit', 'editando'],
    ['Write', 'escrevendo'],
    ['Bash', 'executando'],
    ['TodoWrite', 'planejando'],
    ['ExitPlanMode', 'planejando'],
    ['Agent', 'chamando um aliado'],
    ['Task', 'chamando um aliado'],
  ]

  for (const [tool, verb] of expected) expect(verbOf(tool)).toBe(verb)

  expect([...new Set(Object.values(VERBS))].sort()).toEqual(
    ['buscando', 'chamando um aliado', 'editando', 'escrevendo', 'executando', 'lendo', 'pesquisando na web', 'planejando'].sort(),
  )
})

test('doing target: a file shows only its name, without the directory', async () => {
  expect(targetOf('Edit', { file_path: '/Users/me/src/hooks/register.tsx' })).toBe('register.tsx')
  expect(targetOf('Read', { file_path: 'a/b/guild.ts' })).toBe('guild.ts')
  expect(targetOf('Write', { file_path: 'C:\\work\\notes.md' })).toBe('notes.md')
  expect(targetOf('NotebookEdit', { notebook_path: '/x/y/lab.ipynb' })).toBe('lab.ipynb')
  expect(targetOf('Edit', {})).toBeUndefined()
  expect(targetOf('Grep', { pattern: 'segredo', path: '/x' })).toBeUndefined()
})

test('doing target: a command shows its first three words', async () => {
  expect(targetOf('Bash', { command: 'npm test' })).toBe('npm test')
  expect(targetOf('Bash', { command: '  git   commit -m "mensagem"  ' })).toBe('git commit -m…')
  expect(targetOf('Bash', { command: '' })).toBeUndefined()
})

test('doing target: a long file name or command is cut with an ellipsis', async () => {
  const file = targetOf('Edit', { file_path: '/d/' + 'a'.repeat(40) + '.ts' })
  expect(file).toBe('a'.repeat(23) + '…')
  expect(file?.length).toBe(24)

  const exact = 'b'.repeat(24)
  expect(targetOf('Edit', { file_path: exact })).toBe(exact)

  const command = targetOf('Bash', { command: 'cat ' + 'x'.repeat(60) })
  expect(command?.length).toBe(24)
  expect(command?.endsWith('…')).toBe(true)
})

test('doing line: fits whole, then without the name, then only the verb', async () => {
  const doing = { verb: 'editando', target: 'register.tsx' }
  const line = (columns: number) => doingLine({ name: 'Guerreiro', doing, rest: 'de prontidão', columns })

  expect(line(60)).toBe('Guerreiro: editando register.tsx')
  expect(line(32)).toBe('Guerreiro: editando register.tsx')
  expect(line(31)).toBe('editando register.tsx')
  expect(line(21)).toBe('editando register.tsx')
  expect(line(20)).toBe('editando')
  expect(line(3)).toBe('editando')

  expect(doingLine({ name: 'Mago', doing: { verb: 'planejando', target: null }, rest: 'x', columns: 40 })).toBe('Mago: planejando')
  expect(doingLine({ name: 'Guerreiro', doing: null, rest: 'de prontidão', columns: 40 })).toBe('Guerreiro: de prontidão')
  expect(doingLine({ name: 'Guerreiro', doing: null, rest: 'de prontidão', columns: 10 })).toBe('de prontidão')
})
