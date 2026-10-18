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

test('doing target: a command shows its program and a plain subcommand', async () => {
  expect(targetOf('Bash', { command: 'npm test' })).toBe('npm test')
  expect(targetOf('Bash', { command: '  git   commit -m "mensagem"  ' })).toBe('git commit…')
  expect(targetOf('Bash', { command: '/usr/local/bin/node script.js' })).toBe('node…')
  expect(targetOf('Bash', { command: 'ls' })).toBe('ls')
  expect(targetOf('Bash', { command: '' })).toBeUndefined()
})

test('doing target: a long file name or command is cut with an ellipsis', async () => {
  const file = targetOf('Edit', { file_path: '/d/' + 'a'.repeat(40) + '.ts' })
  expect(file).toBe('a'.repeat(23) + '…')
  expect(file?.length).toBe(24)

  const exact = 'b'.repeat(24)
  expect(targetOf('Edit', { file_path: exact })).toBe(exact)

  const command = targetOf('Bash', { command: 'p'.repeat(30) + ' sub' })
  expect(command?.length).toBeLessThanOrEqual(24)
  expect(targetOf('Bash', { command: 'a'.repeat(31) })).toBeUndefined()
  expect(targetOf('Bash', { command: 'p'.repeat(22) + ' build --watch' })).toBe('p'.repeat(22) + ' …')
})

test('doing target: no secret of a shell command ever reaches the text', async () => {
  const cases: Array<[string, string, string]> = [
    ['export TOKEN=ghp_abcdef123456 && x', 'export…', 'ghp_abcdef123456'],
    ['curl -u admin:hunter2 https://x', 'curl…', 'hunter2'],
    ['mysql -psecret123 db', 'mysql…', 'secret123'],
    ['TOKEN=abc123 deploy', 'deploy…', 'abc123'],
    ['A=1 B=segredo7 npm test', 'npm test…', 'segredo7'],
    ['env A=b cmd --x', 'cmd…', 'A=b'],
    ['env -i PASS=zz9 make build', 'make build…', 'zz9'],
    ['curl --password=s3nha https://x', 'curl…', 's3nha'],
    ['curl -H "Authorization: Bearer abc.def.ghi" https://x', 'curl…', 'abc.def'],
    ['git clone https://user:pw1234@github.com/a/b', 'git clone…', 'pw1234'],
    ['curl https://user:pw1234@host/x', 'curl…', 'pw1234'],
    ['echo hunter2', 'echo…', 'hunter2'],
    ['psql postgres://u:pw@h/db', 'psql…', 'pw'],
  ]

  for (const [command, expected, secret] of cases) {
    const target = targetOf('Bash', { command })

    expect(target).toBe(expected)
    expect(target).not.toContain(secret)
  }
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

test('doing target: a command with something left out ends with an ellipsis, one shown whole does not', async () => {
  expect(targetOf('Bash', { command: 'npm test --watch' })).toBe('npm test…')
  expect(targetOf('Bash', { command: 'ls -la' })).toBe('ls…')
  expect(targetOf('Bash', { command: 'npm test' })).toBe('npm test')
  expect(targetOf('Bash', { command: 'git status' })).toBe('git status')
  expect(targetOf('Bash', { command: 'ls' })).toBe('ls')
})
