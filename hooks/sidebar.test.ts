import { expect, test } from 'claude-code/testing'

import { chooseSidebarLayout } from './sidebar'

test('a wide column has the full character, the others side by side and the bug', async () => {
  expect(chooseSidebarLayout(40, 'full', 'alive')).toEqual({ active: 'full', others: 'row', bug: true })
  expect(chooseSidebarLayout(33, 'full', 'none')).toEqual({ active: 'full', others: 'row', bug: false })
})

test('a column that just holds the full character stacks the others', async () => {
  expect(chooseSidebarLayout(32, 'full', 'none')).toEqual({ active: 'full', others: 'stack', bug: false })
})

test('a narrower column gets the reduced character, and the compact setting always does', async () => {
  expect(chooseSidebarLayout(31, 'full', 'defeated')).toEqual({ active: 'mini', others: 'stack', bug: true })
  expect(chooseSidebarLayout(16, 'full', 'none')).toEqual({ active: 'mini', others: 'stack', bug: false })
  expect(chooseSidebarLayout(60, 'compact', 'none')).toEqual({ active: 'mini', others: 'row', bug: false })
})

test('below the width of a reduced character only text is left', async () => {
  expect(chooseSidebarLayout(15, 'full', 'alive')).toEqual({ active: null, others: null, bug: false })
  expect(chooseSidebarLayout(0, 'full', 'none')).toEqual({ active: null, others: null, bug: false })
})
