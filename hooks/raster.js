import { PIXEL_CHARS } from './sprites.generated';
// The terminal's own color, for the half of a cell a sprite leaves empty.
export const DEFAULT_COLOR = 0x01000000;
const UPPER_HALF = 0x2580;
const LOWER_HALF = 0x2584;
const FULL = 0x2588;
const SPACE = 0x20;
// A sprite is width x height characters of PIXEL_CHARS ('0' transparent), each
// naming a color of `palette`. A cell shows two stacked pixels: an upper half
// block drawn in the top pixel's color over the bottom pixel's, so a sprite
// of w x h pixels takes w columns and h / 2 rows.
export const encodeWords = (frame, width, height, palette) => {
    if (height % 2 !== 0)
        throw new Error(`height ${height} must be even`);
    if (frame.length !== width * height)
        throw new Error(`frame has ${frame.length} pixels, expected ${width * height}`);
    const rows = height / 2;
    const words = new Uint32Array(width * rows * 3);
    const at = (x, y) => palette[PIXEL_CHARS.indexOf(frame.charAt(y * width + x))] ?? -1;
    for (let row = 0; row < rows; row += 1) {
        for (let x = 0; x < width; x += 1) {
            const top = at(x, row * 2);
            const bottom = at(x, row * 2 + 1);
            let glyph = SPACE;
            let fg = DEFAULT_COLOR;
            let bg = DEFAULT_COLOR;
            if (top >= 0 && bottom >= 0) {
                glyph = top === bottom ? FULL : UPPER_HALF;
                fg = top;
                bg = top === bottom ? DEFAULT_COLOR : bottom;
            }
            else if (top >= 0) {
                glyph = UPPER_HALF;
                fg = top;
            }
            else if (bottom >= 0) {
                glyph = LOWER_HALF;
                fg = bottom;
            }
            const i = (row * width + x) * 3;
            words[i] = glyph;
            words[i + 1] = fg;
            words[i + 2] = bg;
        }
    }
    return words;
};
// `cells` of a Raster: the words as little-endian bytes, base64.
export const toCells = (words) => new Uint8Array(words.buffer).toBase64();
export const encodeFrame = (frame, width, height, palette) => toCells(encodeWords(frame, width, height, palette));
