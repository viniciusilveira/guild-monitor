import { expect, test } from 'claude-code/testing';
import { DEFAULT_COLOR, encodeWords } from './raster';
// '0' is transparent, '1' red, '2' green in this palette.
const PALETTE = [-1, 0xff0000, 0x00ff00];
const RED = 0xff0000;
const GREEN = 0x00ff00;
const cell = (words, index) => Array.from(words.slice(index * 3, index * 3 + 3));
test('two opaque pixels of different colors become an upper half block over the lower color', async () => {
    const words = encodeWords('1221', 2, 2, PALETTE);
    expect(cell(words, 0)).toEqual([0x2580, RED, GREEN]);
    expect(cell(words, 1)).toEqual([0x2580, GREEN, RED]);
});
test('two opaque pixels of one color become a full block on the default background', async () => {
    const words = encodeWords('11', 1, 2, PALETTE);
    expect(cell(words, 0)).toEqual([0x2588, RED, DEFAULT_COLOR]);
});
test('a lone top pixel is an upper half block and a lone bottom pixel a lower one', async () => {
    const words = encodeWords('1002', 2, 2, PALETTE);
    expect(cell(words, 0)).toEqual([0x2580, RED, DEFAULT_COLOR]);
    expect(cell(words, 1)).toEqual([0x2584, GREEN, DEFAULT_COLOR]);
});
test('two transparent pixels leave the cell empty', async () => {
    const words = encodeWords('00', 1, 2, PALETTE);
    expect(cell(words, 0)).toEqual([0x20, DEFAULT_COLOR, DEFAULT_COLOR]);
});
test('cells are row-major and a sprite of w x h pixels takes w x h / 2 cells', async () => {
    // pixel rows: "10" "10" / "20" "20": red on top, green below it, each in the left column
    const words = encodeWords('10102020', 2, 4, PALETTE);
    expect(words.length).toBe(2 * 2 * 3);
    expect(cell(words, 0)).toEqual([0x2588, RED, DEFAULT_COLOR]);
    expect(cell(words, 1)).toEqual([0x20, DEFAULT_COLOR, DEFAULT_COLOR]);
    expect(cell(words, 2)).toEqual([0x2588, GREEN, DEFAULT_COLOR]);
    expect(cell(words, 3)).toEqual([0x20, DEFAULT_COLOR, DEFAULT_COLOR]);
});
test('an odd height or a frame of the wrong length is refused', async () => {
    expect(() => encodeWords('111', 1, 3, PALETTE)).toThrow();
    expect(() => encodeWords('111', 2, 2, PALETTE)).toThrow();
});
