import type { ChoiceSet } from './choices'

// The color schemes of the meters. Each scheme is one map, and the screen takes every color of a meter, of the
// tokens line and of a warning from it: there is no color of those left in the other modules.
//
// What stays out of the schemes on purpose: the three class colors (`COLORS` in view.ts: the identity of a
// character, which the character palettes will own) and the sprites' pixels. Dim text has no color of its own.

export const METER_SCHEMES = ['padrao', 'contraste', 'daltonico'] as const

export type MeterScheme = (typeof METER_SCHEMES)[number]

export type MeterColors = {
  // Health goes from high to low as the percent drops: above 50, from 25 to 50, below 25.
  hpHigh: string
  hpMid: string
  hpLow: string
  mana: string
  stamina: string
  xp: string
  gold: string
  // A figure nobody reported (shown as `--`).
  unknown: string
  // The lines of tokens; a low cache hit rate and a window that runs out use `urgent`.
  tokens: string
  urgent: string
  // The bug's warning.
  alert: string
}

// `padrao` is the colors the monitor always had, after the usual game HUD conventions.
const padrao: MeterColors = {
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
}

// `contraste`: bright colors of at least 7:1 against black (WCAG AAA), the gray lighter than the default.
const contraste: MeterColors = {
  hpHigh: '#00FF66',
  hpMid: '#FFFF00',
  hpLow: '#FF6B6B',
  mana: '#66B2FF',
  stamina: '#FF9900',
  xp: '#E066FF',
  gold: '#FFD700',
  unknown: '#C0C0C0',
  tokens: '#00FFFF',
  urgent: '#FF6B6B',
  alert: '#FF6B6B',
}

// `daltonico`: the Okabe-Ito palette (Okabe and Ito, "Color Universal Design", 2008), made to be told apart with
// protanopia, deuteranopia and tritanopia. Health does not rely on green against red: its levels fall in lightness
// too (a pale tint of sky blue, sky blue, vermillion). Mana is blue, stamina orange, experience reddish purple,
// gold yellow, the unknown a light gray; the tokens line is bluish green and the warnings vermillion.
//
// Every color keeps at least 4.5:1 against black (WCAG AA), for a reader who already has trouble with color. The
// strict Okabe-Ito blue (#0072B2, 4.05:1) and a dark gray (#6A6A6A, 3.88:1) fell short, so two roles leave the
// strict palette: mana is that blue mixed 20% with white (#2687BE, 5.29:1), and the unknown is a light gray
// (#C0C0C0, 11.54:1, which also keeps it 16 or more CIE76 away from the purple under deuteranopia, where a mid gray
// is not). The pale HP tint is a tint of the palette's sky blue as well. Colors still assume a dark background.
const daltonico: MeterColors = {
  hpHigh: '#BFE6FA',
  hpMid: '#56B4E9',
  hpLow: '#D55E00',
  mana: '#2687BE',
  stamina: '#E69F00',
  xp: '#CC79A7',
  gold: '#F0E442',
  unknown: '#C0C0C0',
  tokens: '#009E73',
  urgent: '#D55E00',
  alert: '#D55E00',
}

export const SCHEMES: Record<MeterScheme, MeterColors> = { padrao, contraste, daltonico }

export const METER_CHOICES: ChoiceSet<MeterScheme> = {
  field: 'meters',
  names: METER_SCHEMES,
  fallback: 'padrao',
  command: '/guild meters',
  noun: 'Esquema',
  scope: 'dos medidores',
}
