import { sameWindow } from './forecast'
import { untilReset } from './view'

// The alerts for a meter running low (HP, MP, stamina): when a value crosses a band, and what the toast says.
// Everything here is pure; the "already warned" memory lives in the tracker and is never stored.
export type Band = 20 | 10

// From the lowest band up: the one that fires is the lowest the value is below.
const BANDS: readonly Band[] = [10, 20]

// A band warns again only after the value goes back above it by this many points (so 25 for band 20, 15 for band 10).
export const REARM_POINTS = 5

// The `alerts` option: off only for the exact word `off`; anything else (missing, unknown, another case) counts as on.
export const alertsOn = (value: unknown): boolean => value !== 'off'

export type MeterId = 'hp' | 'mp' | 'st'

// A meter in percent left. `value` is null when the engine has none (rate limits off a subscription).
export type Reading = { value: number | null; resetsAt?: string | null }

export type MeterAlert = {
  // The last value read; null before any.
  value: number | null
  // The reset time of the window the warnings belong to (null while unknown).
  resetsAt: string | null
  // The bands already warned in this cycle.
  warned: readonly Band[]
}

export const METERS: readonly MeterId[] = ['hp', 'mp', 'st']

export type Alerts = Record<MeterId, MeterAlert>

export const NO_METER: MeterAlert = { value: null, resetsAt: null, warned: [] }

export const NO_ALERTS: Alerts = { hp: NO_METER, mp: NO_METER, st: NO_METER }

// The warnings forgotten: the next reading below a band warns again.
export const rearm = (state: MeterAlert): MeterAlert => ({ ...state, warned: [] })

// One reading of a meter: the band that fires, if any, and the memory for the next one. A value that does not
// exist fires nothing and re-arms nothing. A drop past both bands fires only the lower one and marks both.
export const crossing = (state: MeterAlert, reading: Reading): { state: MeterAlert; fire?: Band } => {
  const { value } = reading
  if (value === null || !Number.isFinite(value)) return { state }

  const isNewWindow = reading.resetsAt != null && state.resetsAt !== null && !sameWindow(state.resetsAt, reading.resetsAt)
  const kept = (isNewWindow ? [] : state.warned).filter(band => value < band + REARM_POINTS)
  const below = BANDS.filter(band => value < band)
  const fire = below.find(band => !kept.includes(band))

  return { state: { value, resetsAt: reading.resetsAt ?? state.resetsAt, warned: [...new Set([...kept, ...below])] }, fire }
}

const NAME: Record<MeterId, string> = { hp: 'O Guerreiro', mp: 'O Mago', st: 'O Explorador' }
// "quase sem vida" and "com a vida por um fio"
const THING: Record<MeterId, { without: string; withIt: string }> = {
  hp: { without: 'vida', withIt: 'a vida' },
  mp: { without: 'mana', withIt: 'a mana' },
  st: { without: 'fôlego', withIt: 'o fôlego' },
}

// "1h40", "45min" or "3d 5h": the time to the reset; empty when unknown or past.
export const resetText = (resetsAt: string | null, now: number): string => {
  const at = resetsAt === null ? Number.NaN : Date.parse(resetsAt)
  if (!(at > now)) return ''

  const minutes = Math.ceil((at - now) / 60_000)
  if (minutes < 24 * 60) return untilReset(resetsAt, now)

  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes - days * 1440) / 60)

  return hours === 0 ? `${days}d` : `${days}d ${hours}h`
}

// "O Mago está quase sem mana: 18%, reinicia em 1h40". Only the stamina reminds of `/compact` (it has no reset).
export const alertText = (meter: MeterId, band: Band, value: number, reset: string): string => {
  const thing = THING[meter]
  const head = band === 20 ? `${NAME[meter]} está quase sem ${thing.without}` : `${NAME[meter]} está com ${thing.withIt} por um fio`

  return meter === 'st' ? `${head}: ${value}%. /compact recupera` : `${head}: ${value}%${reset === '' ? '' : `, reinicia em ${reset}`}`
}
