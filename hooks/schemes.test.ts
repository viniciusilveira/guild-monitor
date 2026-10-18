import { expect, test } from 'claude-code/testing'

import type { MeterColors } from './schemes'
import { METER_CHOICES, METER_SCHEMES, SCHEMES } from './schemes'

// Color science for the checks, written here from the published definitions (nothing is taken from the schemes'
// own code): WCAG 2.x relative luminance and contrast ratio, CIE76 distance in CIELAB, and the Machado,
// Oliveira and Fernandes (2009) matrices for the three kinds of dichromacy at full severity.
const channels = (hex: string): [number, number, number] => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number]

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]

  return (light + 0.05) / (dark + 0.05)
}

type Vision = 'normal' | 'protan' | 'deutan' | 'tritan'
const VISIONS: Vision[] = ['normal', 'protan', 'deutan', 'tritan']
const MACHADO: Record<Exclude<Vision, 'normal'>, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}

const seen = (hex: string, vision: Vision): [number, number, number] => {
  const rgb = channels(hex).map(linear)
  if (vision === 'normal') return rgb as [number, number, number]

  return MACHADO[vision].map(row => Math.min(1, Math.max(0, (row[0] ?? 0) * (rgb[0] ?? 0) + (row[1] ?? 0) * (rgb[1] ?? 0) + (row[2] ?? 0) * (rgb[2] ?? 0)))) as [number, number, number]
}

const lab = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)

  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
const distance = (a: string, b: string, vision: Vision) => {
  const [la, lb] = [lab(seen(a, vision)), lab(seen(b, vision))]

  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

// The colors that stand for a meter on screen. Tokens and the urgent red are lines, not meters.
const METERS = ['hpHigh', 'hpMid', 'hpLow', 'mana', 'stamina', 'xp', 'gold', 'unknown'] as const
const BLACK = '#000000'
const MIN_DISTANCE = 15
const MIN_HP_STEP = 1.5

test('meters C1: padrao keeps exactly today\'s colors', async () => {
  expect(SCHEMES.padrao).toEqual({
    hpHigh: '#2ECC71',
    hpMid: '#F1C40F',
    hpLow: '#E74C3C',
    mana: '#4A90E2',
    stamina: '#F39C12',
    xp: '#9B59B6',
    gold: '#F1C40F',
    unknown: '#7F8C8D',
    tokens: '#5DADE2',
    urgent: '#E74C3C',
    alert: 'red',
  })
  expect(METER_SCHEMES).toEqual(['padrao', 'contraste', 'daltonico'])
  expect(METER_CHOICES.fallback).toBe('padrao')
})

test('meters C3: daltonico HP levels differ in luminance, not only in hue', async () => {
  const { hpHigh, hpMid, hpLow } = SCHEMES.daltonico

  expect(luminance(hpHigh)).toBeGreaterThan(luminance(hpMid))
  expect(luminance(hpMid)).toBeGreaterThan(luminance(hpLow))
  expect(contrast(hpHigh, hpMid)).toBeGreaterThanOrEqual(MIN_HP_STEP)
  expect(contrast(hpMid, hpLow)).toBeGreaterThanOrEqual(MIN_HP_STEP)
  expect(contrast(hpHigh, hpLow)).toBeGreaterThanOrEqual(MIN_HP_STEP * MIN_HP_STEP)
  // And the three are not the same hue with a different name: no two share a value.
  expect(new Set([hpHigh, hpMid, hpLow]).size).toBe(3)
})

test('meters C4: daltonico meters stay apart under the common kinds of color blindness', async () => {
  const colors = SCHEMES.daltonico

  for (const vision of VISIONS) {
    for (const [i, first] of METERS.entries()) {
      for (const second of METERS.slice(i + 1)) {
        const apart = distance(colors[first], colors[second], vision)

        expect(`${vision} ${first}/${second} ${apart >= MIN_DISTANCE}`).toBe(`${vision} ${first}/${second} true`)
      }
    }
  }
})

test('meters C5: the unknown gray stays apart in every scheme', async () => {
  for (const scheme of METER_SCHEMES) {
    const colors = SCHEMES[scheme]

    for (const vision of VISIONS) {
      for (const meter of METERS.filter(name => name !== 'unknown')) {
        const apart = distance(colors.unknown, colors[meter], vision)

        expect(`${scheme} ${vision} unknown/${meter} ${apart >= MIN_DISTANCE}`).toBe(`${scheme} ${vision} unknown/${meter} true`)
      }
    }
  }
})

test('meters C7: contraste colors reach contrast 7 over black', async () => {
  const colors = SCHEMES.contraste as MeterColors

  for (const [name, value] of Object.entries(colors)) {
    expect(`${name} ${contrast(value, BLACK) >= 7}`).toBe(`${name} true`)
  }
})

test('meters C25: daltonico colors keep a floor of contrast 4.5 over black', async () => {
  for (const [name, value] of Object.entries(SCHEMES.daltonico)) {
    expect(`${name} ${contrast(value, BLACK) >= 4.5}`).toBe(`${name} true`)
  }
})
