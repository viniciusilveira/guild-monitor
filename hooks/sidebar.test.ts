import { expect, test } from 'claude-code/testing'

import { chooseSidebarLayout } from './sidebar'

test('a wide column has the full character with the stats beside it, the others side by side and the bug', async () => {
  expect(chooseSidebarLayout(60, 'full', 'alive')).toEqual({ active: 'full', stats: 'beside', others: 'row', bug: true })
  expect(chooseSidebarLayout(57, 'full', 'none')).toEqual({ active: 'full', stats: 'beside', others: 'row', bug: false })
})

test('the stats go under the character when there is no room beside it', async () => {
  expect(chooseSidebarLayout(56, 'full', 'none')).toEqual({ active: 'full', stats: 'below', others: 'row', bug: false })
  expect(chooseSidebarLayout(40, 'full', 'none')).toEqual({ active: 'full', stats: 'below', others: 'row', bug: false })
  expect(chooseSidebarLayout(32, 'full', 'none')).toEqual({ active: 'full', stats: 'below', others: 'stack', bug: false })
})

test('a narrower column gets the reduced character, and the compact setting always does', async () => {
  expect(chooseSidebarLayout(31, 'full', 'defeated')).toEqual({ active: 'mini', stats: 'below', others: 'stack', bug: true })
  expect(chooseSidebarLayout(16, 'full', 'none')).toEqual({ active: 'mini', stats: 'below', others: 'stack', bug: false })
  expect(chooseSidebarLayout(41, 'compact', 'none')).toEqual({ active: 'mini', stats: 'beside', others: 'row', bug: false })
  expect(chooseSidebarLayout(60, 'compact', 'none')).toEqual({ active: 'mini', stats: 'beside', others: 'row', bug: false })
})

test('below the width of a reduced character only text is left', async () => {
  expect(chooseSidebarLayout(15, 'full', 'alive')).toEqual({ active: null, stats: 'below', others: null, bug: false })
  expect(chooseSidebarLayout(0, 'full', 'none')).toEqual({ active: null, stats: 'below', others: null, bug: false })
})
