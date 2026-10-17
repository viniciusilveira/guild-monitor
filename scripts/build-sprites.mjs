// Reads the Aseprite export (guild.json + one indexed PNG strip per animation)
// and writes hooks/sprites.generated.ts: one shared color table, every frame
// as a string of palette characters, plus a half-size version of each frame.
//
// The mod runs without Node or a DOM, so it cannot decode PNG itself.
//
//   node scripts/build-sprites.mjs [exportDir]   (default: ./art)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exportDir = process.argv[2] ?? join(root, 'art')
const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'
const TRANSPARENT = -1
// The dark of the eyes: a closed eye is a one pixel line that a 2x2 average would lose.
const EYE = 0x1e1e1e
const BODY = 0xd97757
// Eyes sit in the head: dark pixels lower than this are something else (the
// explorer's lantern window).
const EYE_MAX_ROW = 24

const decodePng = path => {
  const buf = readFileSync(path)
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let ctype = 0
  let plte = null
  let trns = null
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
    }
    if (type === 'PLTE') plte = data
    if (type === 'tRNS') trns = data
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }

  if (ctype !== 3 || depth !== 8 || plte === null) {
    throw new Error(`${path}: expected an 8-bit indexed PNG (color type 3), got type ${ctype}, depth ${depth}`)
  }

  const raw = inflateSync(Buffer.concat(idat))
  const index = Buffer.alloc(width * height)

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (width + 1)]

    for (let x = 0; x < width; x += 1) {
      const v = raw[y * (width + 1) + 1 + x]
      const a = x > 0 ? index[y * width + x - 1] : 0
      const b = y > 0 ? index[(y - 1) * width + x] : 0
      const c = x > 0 && y > 0 ? index[(y - 1) * width + x - 1] : 0
      let out = v

      if (filter === 1) out = v + a
      else if (filter === 2) out = v + b
      else if (filter === 3) out = v + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      index[y * width + x] = out & 255
    }
  }

  const colorOf = i => {
    if (trns !== null && i < trns.length && trns[i] === 0) return TRANSPARENT

    return (plte[i * 3] << 16) | (plte[i * 3 + 1] << 8) | plte[i * 3 + 2]
  }

  return { width, height, colorAt: (x, y) => colorOf(index[y * width + x]) }
}

const manifest = JSON.parse(readFileSync(join(exportDir, 'guild.json'), 'utf8'))
const palette = [TRANSPARENT]
const slotOf = color => {
  let slot = palette.indexOf(color)

  if (slot < 0) {
    palette.push(color)
    slot = palette.length - 1
  }
  if (slot >= CHARS.length) throw new Error(`more than ${CHARS.length} distinct colors`)

  return slot
}

const luminance = color => ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11

// The dark groups that are eyes in a frame: an open eye is 2x2 pixels, a closed
// one 2x1. Found as connected groups so each eye is one thing, wherever the
// character stands in the frame.
const eyeGroups = (frame, size) => {
  const eye = CHARS[palette.indexOf(EYE)]
  const seen = new Set()
  const groups = []

  for (let i = 0; i < frame.length; i += 1) {
    if (frame[i] !== eye || seen.has(i)) continue

    const stack = [i]
    const points = []
    seen.add(i)

    while (stack.length > 0) {
      const at = stack.pop()
      const x = at % size
      const y = Math.floor(at / size)
      points.push([x, y])

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        const next = ny * size + nx
        if (nx >= 0 && nx < size && ny >= 0 && ny < size && frame[next] === eye && !seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }

    const xs = points.map(point => point[0])
    const ys = points.map(point => point[1])
    const group = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
    if (group.y1 <= EYE_MAX_ROW) groups.push(group)
  }

  return groups
}

// Half size: a block of 2x2 pixels keeps its most frequent opaque color (a tie
// goes to the darker one); one opaque pixel in the block is enough to keep it,
// so thin parts like a staff do not vanish.
//
// Eyes are not averaged, because where an eye falls on the 2x2 grid changes
// with the breathing of the character: one frame it is a block, the next two
// blocks one over the other. They are taken out, the face is shrunk without
// them, and each eye is put back as one thing: a single pixel at the place of
// the original.
const shrink = (frame, size, cls) => {
  const half = size / 2
  const eyes = cls === 'bug' ? [] : eyeGroups(frame, size)
  const body = CHARS[slotOf(BODY)]
  const plain = [...frame]

  for (const { x0, x1, y0, y1 } of eyes) {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) plain[y * size + x] = body
  }

  const out = []

  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const counts = new Map()

      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const slot = CHARS.indexOf(plain[(y * 2 + dy) * size + x * 2 + dx])
        if (slot > 0) counts.set(slot, (counts.get(slot) ?? 0) + 1)
      }

      let best = 0
      let bestCount = 0
      const dark = [...counts.keys()].find(slot => palette[slot] === EYE)

      for (const [slot, count] of counts) {
        const darker = best === 0 || luminance(palette[slot]) < luminance(palette[best])
        if (count > bestCount || (count === bestCount && darker)) {
          best = slot
          bestCount = count
        }
      }
      out.push(CHARS[dark ?? best])
    }
  }

  const eye = CHARS[slotOf(EYE)]

  // Every eye is a single pixel, the "-" of the small character, open or
  // closed: at this size a blink is not worth a different shape, and a shape
  // that changes from frame to frame reads as flicker.
  for (const { x0, x1, y0, y1 } of eyes) {
    out[Math.floor((y0 + y1) / 4) * half + Math.floor((x0 + x1) / 4)] = eye
  }

  return out.join('')
}

const size = manifest.frame_width
if (size !== manifest.frame_height || size % 2 !== 0) throw new Error('frames must be square with an even size')

const sheets = {}

for (const sheet of manifest.sheets) {
  const png = decodePng(join(exportDir, sheet.file))
  if (png.width !== sheet.frames * size || png.height !== size) {
    throw new Error(`${sheet.file}: expected ${sheet.frames * size}x${size}, got ${png.width}x${png.height}`)
  }

  const frames = []

  for (let k = 0; k < sheet.frames; k += 1) {
    let frame = ''
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) frame += CHARS[slotOf(png.colorAt(k * size + x, y))]
    frames.push(frame)
  }

  sheets[sheet.id] = {
    id: sheet.id,
    cls: sheet.class,
    anim: sheet.animation,
    view: sheet.view,
    loop: sheet.loop,
    durations: sheet.durations_ms,
    frames,
    mini: frames.map(frame => shrink(frame, size, sheet.class)),
  }
}

const text = `// Generated by scripts/build-sprites.mjs from the Aseprite export in art/: do not edit.
// Pixels are characters of a shared color table: '0' is transparent, the rest
// index PALETTE (0xRRGGBB). Each frame is size x size characters, row by row.

export type SheetData = {
  id: string
  cls: string
  anim: string
  view: string
  loop: boolean
  durations: readonly number[]
  frames: readonly string[]
  mini: readonly string[]
}

export const FRAME_SIZE = ${size}
export const MINI_SIZE = ${size / 2}
export const PIXEL_CHARS = ${JSON.stringify(CHARS)}
export const PALETTE: readonly number[] = ${JSON.stringify(palette)}
export const SHEETS: Readonly<Record<string, SheetData>> = ${JSON.stringify(sheets)}
`

writeFileSync(join(root, 'hooks/sprites.generated.ts'), text)
console.log(`${Object.keys(sheets).length} sheets, ${palette.length - 1} colors, ${text.length} bytes`)
