import { expect, test } from 'claude-code/testing'

import type { ViewModel } from '../types'
import { publishQuietly } from './register'

const view = { active: 'guerreiro', doing: null } as unknown as ViewModel

// A `$` whose state refuses to be read or written, as an engine in trouble would.
const brokenState = {
  state: {
    get: async () => {
      throw new Error('state is down')
    },
    set: async () => {
      throw new Error('state is down')
    },
  },
} as never

test('publishing a view that fails is swallowed and the next publish starts clean', async () => {
  const cache = { signature: 'old' }

  await expect(publishQuietly(brokenState, () => view, cache)).resolves.toBeUndefined()
  expect(cache.signature).toBe('')

  const failsToBuild = { signature: 'old' }
  await expect(
    publishQuietly(brokenState, () => {
      throw new Error('cannot build')
    }, failsToBuild),
  ).resolves.toBeUndefined()
  expect(failsToBuild.signature).toBe('')
})
