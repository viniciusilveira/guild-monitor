import { expect, test } from 'claude-code/testing'

import type { ToolUse } from './classify'
import { classify, classifyTools, classifyPrompt, DEFAULT_CLASS, isReadOnlyCommand, kindOf } from './classify'

const bash = (command: string): ToolUse => ({ tool: 'Bash', command })
const turn = (prompt: string, tools: ToolUse[] = [], planMode = false) => classify({ prompt, planMode, tools })

test('read-only commands look, anything that writes acts', async () => {
  expect(isReadOnlyCommand('ls -la src')).toBe(true)
  expect(isReadOnlyCommand('git log --oneline | head -5')).toBe(true)
  expect(isReadOnlyCommand('git status && git diff')).toBe(true)
  expect(isReadOnlyCommand('grep -rn foo . 2>/dev/null')).toBe(true)
  expect(isReadOnlyCommand('cat a 2>&1')).toBe(true)
  expect(isReadOnlyCommand('echo hi > out.txt')).toBe(false)
  expect(isReadOnlyCommand('ls | tee list.txt')).toBe(false)
  expect(isReadOnlyCommand('git push origin main')).toBe(false)
  expect(isReadOnlyCommand('npm test')).toBe(false)
  expect(isReadOnlyCommand('grep x f | xargs rm')).toBe(false)
})

const kind = (command: string) => kindOf(bash(command))

test('grep cut head pipeline counts as exploring', async () => {
  expect(kind('grep -rn foo . | cut -c1-190 | head')).toBe('look')
  const tools = [bash('grep -rn foo . | cut -c1-190 | head'), bash('grep -rn foo . | cut -c1-190 | head'), bash('grep -rn foo . | cut -c1-190 | head')]
  expect(classify({ prompt: '', planMode: false, tools })).toBe('explorador')
})

test('sed print without in-place counts as exploring', async () => {
  expect(kind("sed -n '1,20p' file")).toBe('look')
})

test('gh pr view counts as exploring', async () => {
  expect(kind('gh pr view 2')).toBe('look')
})

test('every added program counts as read-only', async () => {
  const programs = ['cut', 'awk', 'tr', 'nl', 'column', 'basename', 'dirname', 'realpath', 'readlink', 'uname', 'hostname', 'id', 'ps', 'lsof', 'less', 'more']
  expect(programs).toHaveLength(16)
  for (const program of programs) expect([program, isReadOnlyCommand(program === 'hostname' ? 'hostname -f' : `${program} arg`)]).toEqual([program, true])
})

test('gh read subcommands count as read-only', async () => {
  const commands = ['gh pr view 2', 'gh pr list', 'gh pr diff 2', 'gh pr checks 2', 'gh pr status', 'gh issue view 3', 'gh issue list', 'gh repo view']
  expect(commands).toHaveLength(8)
  for (const command of commands) expect([command, isReadOnlyCommand(command)]).toEqual([command, true])
})

test('claude plugin list and version count as read-only', async () => {
  expect(isReadOnlyCommand('claude plugin list')).toBe(true)
  expect(isReadOnlyCommand('claude --version')).toBe(true)
})

test('sed options without in-place count as read-only', async () => {
  for (const command of ["sed -n '1p' f", "sed -E 's/a/b/' f", "sed -s 's/a/b/' f", "sed -ne '2p' f", "cat f | sed 's/a/b/'"]) {
    expect([command, isReadOnlyCommand(command)]).toEqual([command, true])
  }
})

test('sed in-place in any spelling still acts', async () => {
  for (const command of ['sed -i s/a/b/ f', "sed -ni 's/a/b/p' f", 'sed -i.bak s/a/b/ f', 'sed --in-place s/a/b/ f']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('xargs python3 mkdir node open and tee still act', async () => {
  for (const command of ['xargs rm', 'python3 script.py', 'mkdir x', 'node app.js', 'open file', 'ls | tee list.txt']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('redirection to a file still acts', async () => {
  for (const command of ['echo x > file', 'echo x >> file', 'cut -c1-5 f > out.txt']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('redirection to dev null still looks', async () => {
  for (const command of ['grep x f > /dev/null', 'cat a 2>&1']) {
    expect([command, kind(command)]).toEqual([command, 'look'])
  }
})

test('one changing piece makes the whole command act', async () => {
  for (const command of ['grep x f | cut -c1-5 | xargs rm', 'git status && mkdir x']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('gh and claude without a read subcommand act', async () => {
  const commands = ['gh pr merge 2', 'gh issue create', 'gh repo delete x', 'gh pr', 'gh', 'claude plugin install x', 'claude', 'claude plugin']
  expect(commands).toHaveLength(8)
  for (const command of commands) expect([command, kind(command)]).toEqual([command, 'act'])
})

test('awk that runs commands or reads a script file acts', async () => {
  for (const command of ['awk \'BEGIN { system("rm x") }\'', 'awk \'{ "date" | getline d }\' f', 'awk -f prog.awk f', "awk -i inplace '{print}' f"]) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('separators inside quotes do not split a command', async () => {
  for (const command of ["sed -n '1p;3p' f", "awk '{print $1; print $2}' f", "grep -E 'a|b' f"]) {
    expect([command, kind(command)]).toEqual([command, 'look'])
  }
})

test('separators outside quotes still split a command', async () => {
  for (const command of ["grep 'a|b' f | xargs rm", 'echo "a;b" ; mkdir x']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('backslash escaped quotes do not hide a separator', async () => {
  for (const command of ["echo \\'; rm x; echo \\'", 'echo \\" ; rm x']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('a quote left open makes the command act', async () => {
  for (const command of ["echo it's; mkdir x", "echo 'a ; rm x", 'echo "a ; rm x']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('balanced quotes and escaped separators still look', async () => {
  for (const command of ["sed -n '1p;3p' f", 'echo "it\'s ; fine"', "echo 'a ; b' | cat", 'echo a\\;b']) {
    expect([command, kind(command)]).toEqual([command, 'look'])
  }
})

test('awk -E, hostname with a name and less -o all act', async () => {
  for (const command of ['awk -E prog.awk f', 'hostname newname', 'less -o out f', 'less -O out f', 'less --log-file=out f']) {
    expect([command, kind(command)]).toEqual([command, 'act'])
  }
})

test('hostname alone or with flags and less without log options still look', async () => {
  for (const command of ['hostname', 'hostname -f', 'less file', 'less -N file']) {
    expect([command, kind(command)]).toEqual([command, 'look'])
  }
})

test('each tool counts as acting, looking or planning', async () => {
  expect(kindOf({ tool: 'Edit' })).toBe('act')
  expect(kindOf({ tool: 'Write' })).toBe('act')
  expect(kindOf({ tool: 'Grep' })).toBe('look')
  expect(kindOf({ tool: 'WebSearch' })).toBe('look')
  expect(kindOf({ tool: 'TodoWrite' })).toBe('plan')
  expect(kindOf(bash('ls'))).toBe('look')
  expect(kindOf(bash('npm run build'))).toBe('act')
  expect(kindOf({ tool: 'Agent', subagent: 'Explore' })).toBe('look')
  expect(kindOf({ tool: 'Agent', subagent: 'Plan' })).toBe('plan')
  expect(kindOf({ tool: 'Agent', subagent: 'general-purpose' })).toBe('act')
  expect(kindOf({ tool: 'SomeNewTool' })).toBe('act')
})

test('the prompt alone says what the work is, in Portuguese or English', async () => {
  expect(classifyPrompt('corrija o bug do login')).toBe('guerreiro')
  expect(classifyPrompt('fix the failing test')).toBe('guerreiro')
  expect(classifyPrompt('planeje a migração do banco')).toBe('mago')
  expect(classifyPrompt('crie um plano de arquitetura')).toBe('mago')
  expect(classifyPrompt('onde está definida a rota de pagamento?')).toBe('explorador')
  expect(classifyPrompt('pesquise como funciona o cache')).toBe('explorador')
  expect(classifyPrompt('investigue a falha do login')).toBe('explorador')
  expect(classifyPrompt('investigue o bug')).toBe('explorador')
  expect(classifyPrompt('debug the login flow')).toBe('explorador')
  expect(classifyPrompt('corrija a falha do login')).toBe('guerreiro')
  expect(classifyPrompt('corrijo o erro')).toBe('guerreiro')
  expect(classifyPrompt('corrigir o bug')).toBe('guerreiro')
  expect(classifyPrompt('conserte o teste')).toBe('guerreiro')
  expect(classifyPrompt('fix the failing bug')).toBe('guerreiro')
  expect(classifyPrompt('rode os testes')).toBe('guerreiro')
  expect(classifyPrompt('implemente o design novo')).toBe('guerreiro')
  expect(classifyPrompt('oi')).toBe(undefined)
  expect(classifyPrompt('')).toBe(undefined)
})

test('accents and case do not matter', async () => {
  expect(classifyPrompt('Planejar a ARQUITETURA')).toBe('mago')
  expect(classifyPrompt('INVESTIGUE o módulo de CACHE')).toBe('explorador')
  expect(classifyPrompt('investigue a falha')).toBe('explorador')
})

test('plan mode is always the mage', async () => {
  expect(turn('corrija o bug', [{ tool: 'Edit' }], true)).toBe('mago')
})

test('what the agent is doing decides: reading is the explorer, changing things the warrior, organising the mage', async () => {
  expect(turn('explique o código', [{ tool: 'Read' }, { tool: 'Edit' }])).toBe('guerreiro')
  expect(turn('planeje', [bash('npm test')])).toBe('guerreiro')
  expect(turn('corrija o bug do login', [{ tool: 'Read' }, { tool: 'Grep' }])).toBe('explorador')
  expect(turn('planeje a feature', [{ tool: 'Read' }, { tool: 'Grep' }, { tool: 'Glob' }])).toBe('explorador')
  expect(turn('oi', [{ tool: 'TodoWrite' }, { tool: 'TodoWrite' }, { tool: 'Read' }])).toBe('mago')
})

test('the class follows the latest tool calls as the turn goes on', async () => {
  const research = [{ tool: 'WebSearch' }, { tool: 'WebSearch' }]

  expect(turn('explore na internet', research)).toBe('explorador')
  expect(turn('explore na internet', [...research, { tool: 'Edit' }, { tool: 'Edit' }])).toBe('guerreiro')
  expect(turn('explore na internet', [...research, { tool: 'Edit' }, { tool: 'Edit' }, { tool: 'Read' }, { tool: 'Read' }])).toBe('explorador')
})

test('the prompt only guesses until the first tool call, and the explorer is the default', async () => {
  expect(DEFAULT_CLASS).toBe('explorador')
  expect(turn('')).toBe('explorador')
  expect(turn('oi')).toBe('explorador')
  expect(turn('corrija o bug do login')).toBe('guerreiro')
  expect(turn('planeje a feature')).toBe('mago')
  expect(turn('investigue a falha', [{ tool: 'Read' }, { tool: 'Grep' }])).toBe('explorador')
})

test('the turn belongs to who did most of its work', async () => {
  const tools = [{ tool: 'Read' }, { tool: 'Grep' }, { tool: 'Read' }, { tool: 'Edit' }]

  expect(classifyTools(tools)).toBe('explorador')
  expect(classifyTools([{ tool: 'Read' }, { tool: 'Edit' }])).toBe('guerreiro')
  expect(classifyTools([])).toBe(undefined)
})
