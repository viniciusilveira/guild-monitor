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
