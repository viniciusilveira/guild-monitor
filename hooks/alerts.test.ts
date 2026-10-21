import { expect, test } from 'claude-code/testing'

import { alertsOn, alertText, crossing, NO_METER, resetText } from './alerts'
import type { Band, MeterAlert, Reading } from './alerts'
import { compacted, createTracker, metersMeasured } from './tracker'
import { emptyGuild } from './xp'

// The bands that fire along a sequence of readings of one meter (`undefined` where nothing fires).
const along = (readings: ReadonlyArray<number | null | Reading>, from: MeterAlert = NO_METER): Array<Band | undefined> => {
  let state = from

  return readings.map(reading => {
    const done = crossing(state, typeof reading === 'object' && reading !== null ? reading : { value: reading })
    state = done.state

    return done.fire
  })
}

const at = (time: string) => `2026-01-01T${time}:00.000Z`

test('alerts C1: 30, 19 and 9 fire nothing, band 20 and band 10, in that order', async () => {
  expect(along([30, 19, 9])).toEqual([undefined, 20, 10])
  // 20 is not below 20; 19 is.
  expect(along([20])).toEqual([undefined])
  expect(along([10, 9])).toEqual([20, 10])
})

test('alerts C2: hovering around 20 warns once; 25 re-arms band 20 and 15 re-arms band 10', async () => {
  expect(along([19, 21, 19, 22, 19])).toEqual([20, undefined, undefined, undefined, undefined])
  expect(along([19, 24, 19, 25, 19])).toEqual([20, undefined, undefined, undefined, 20])
  // Band 10 re-arms at 15, not at 14; band 20 stays warned while the value is below 25.
  expect(along([9, 14, 9, 15, 9])).toEqual([10, undefined, undefined, undefined, 10])
})

test('alerts C3: a drop from 25 to 8 fires only band 10, and a later 15 does not fire band 20', async () => {
  expect(along([25, 8, 15, 14])).toEqual([undefined, 10, undefined, undefined])
})

test('alerts C4: a window that resets re-arms; a reset that moves less than 5 minutes does not', async () => {
  const first = { value: 15, resetsAt: at('12:00') }

  expect(along([first, { value: 15, resetsAt: at('17:00') }])).toEqual([20, 20])
  expect(along([first, { value: 15, resetsAt: at('12:04') }])).toEqual([20, undefined])
  // No reset time in a reading does not change the window.
  expect(along([first, { value: 15 }])).toEqual([20, undefined])
})

test('alerts C5: an absent value fires nothing and re-arms nothing', async () => {
  expect(along([15, null, 15])).toEqual([20, undefined, undefined])
  expect(along([null, null])).toEqual([undefined, undefined])
  // An absent reading in the middle does not wipe the memory of the last value either.
  expect(along([15, null, 30, 15])).toEqual([20, undefined, undefined, 20])
})

test('alerts C6: a compaction re-arms the stamina only, in the tracker', async () => {
  const all = { hp: { value: 15 }, mp: { value: 15 }, st: { value: 15 } }
  const first = metersMeasured(createTracker(emptyGuild(), 0), all)
  expect(first.fires.map(fire => fire.meter)).toEqual(['hp', 'mp', 'st'])

  expect(metersMeasured(first.tracker, all).fires).toEqual([])

  const after = metersMeasured(compacted(first.tracker, 15), all)
  expect(after.fires.map(fire => fire.meter)).toEqual(['st'])
  expect(after.fires[0]).toMatchObject({ band: 20, value: 15 })
})

test('alerts C8: the texts of MP and HP carry the value and the time to the reset', async () => {
  const start = Date.parse(at('12:00'))

  expect(resetText(new Date(start + 100 * 60_000).toISOString(), start)).toBe('1h40')
  expect(resetText(new Date(start + (3 * 24 + 5) * 3_600_000).toISOString(), start)).toBe('3d 5h')
  expect(resetText(new Date(start + 45 * 60_000).toISOString(), start)).toBe('45min')
  expect(resetText(null, start)).toBe('')
  expect(resetText(new Date(start - 1).toISOString(), start)).toBe('')

  expect(alertText('mp', 20, 18, '1h40')).toBe('O Mago está quase sem mana: 18%, reinicia em 1h40')
  expect(alertText('hp', 20, 18, '3d 5h')).toBe('O Guerreiro está quase sem vida: 18%, reinicia em 3d 5h')
  expect(alertText('mp', 10, 8, '1h40')).toBe('O Mago está com a mana por um fio: 8%, reinicia em 1h40')
  expect(alertText('mp', 20, 18, '')).toBe('O Mago está quase sem mana: 18%')
})

test('alerts C9: the stamina text reminds that /compact recovers it and has no reset time', async () => {
  expect(alertText('st', 10, 9, '')).toBe('O Explorador está com o fôlego por um fio: 9%. /compact recupera')
  expect(alertText('st', 20, 18, '')).toBe('O Explorador está quase sem fôlego: 18%. /compact recupera')
  expect(alertText('st', 20, 18, '1h40')).toBe('O Explorador está quase sem fôlego: 18%. /compact recupera')
})

test('alerts C11 unit: only the exact word off turns the alerts off', async () => {
  expect(alertsOn('off')).toBe(false)

  for (const value of ['on', undefined, null, 'talvez', 'ON', 'Off', ' off', '', 0, 1, true, false, {}]) expect(alertsOn(value)).toBe(true)
})

test('alerts C8 days: days truncate, the 24 hour boundary, round days and the HP text of band 10', async () => {
  const start = Date.parse(at('12:00'))
  const after = (minutes: number) => resetText(new Date(start + minutes * 60_000).toISOString(), start)

  // 3d 5h30min stays 3d 5h and 3d 23h59 stays 3d 23h: never rounded up to 24h or to the next day.
  expect(after(3 * 1440 + 5 * 60 + 30)).toBe('3d 5h')
  expect(after(3 * 1440 + 23 * 60 + 59)).toBe('3d 23h')
  // Below 24 hours the hours and minutes stay; 24h00 is the first with days.
  expect(after(23 * 60 + 59)).toBe('23h59')
  expect(after(24 * 60)).toBe('1d')
  // A round number of days has no hours.
  expect(after(3 * 1440)).toBe('3d')

  expect(alertText('hp', 10, 8, '3d 5h')).toBe('O Guerreiro está com a vida por um fio: 8%, reinicia em 3d 5h')
})
