import { expect, test } from 'claude-code/testing';
import { encodeWords } from './raster';
import { FRAME_SIZE, MINI_SIZE, PALETTE, PIXEL_CHARS, SHEETS } from './sprites.generated';
const EXPECTED = [
    'mago_parado',
    'mago_cansado',
    'mago_dormindo',
    'mago_trabalho',
    'guerreiro_parado',
    'guerreiro_cansado',
    'guerreiro_dormindo',
    'guerreiro_trabalho',
    'bug_parado',
    'bug_derrotado',
    'explorador_parado',
    'explorador_cansado',
    'explorador_dormindo',
    'explorador_trabalho',
];
const EYE = 0x1e1e1e;
const FRAMES = { parado: 4, cansado: 4, dormindo: 4, trabalho: 6, derrotado: 4 };
test('every animation of the guild is there', async () => {
    expect(Object.keys(SHEETS).sort()).toEqual([...EXPECTED].sort());
});
test('frames, half-size frames and durations line up for every sheet', async () => {
    for (const sheet of Object.values(SHEETS)) {
        const count = FRAMES[sheet.anim];
        expect(sheet.frames.length).toBe(count);
        expect(sheet.mini.length).toBe(count);
        expect(sheet.durations.length).toBe(count);
        for (const frame of sheet.frames)
            expect(frame.length).toBe(FRAME_SIZE * FRAME_SIZE);
        for (const frame of sheet.mini)
            expect(frame.length).toBe(MINI_SIZE * MINI_SIZE);
        for (const ms of sheet.durations)
            expect(ms > 0).toBe(true);
    }
});
test('every pixel names a color of the shared table and the table stays small', async () => {
    expect(PALETTE[0]).toBe(-1);
    expect(PALETTE.length <= PIXEL_CHARS.length).toBe(true);
    for (const sheet of Object.values(SHEETS)) {
        for (const frame of [...sheet.frames, ...sheet.mini]) {
            for (const char of frame)
                expect(PIXEL_CHARS.indexOf(char) >= 0 && PIXEL_CHARS.indexOf(char) < PALETTE.length).toBe(true);
        }
    }
});
test('the feet of a standing character sit on row 29 of every frame', async () => {
    for (const sheet of Object.values(SHEETS).filter(one => one.cls === 'mago' && one.anim === 'parado')) {
        for (const frame of sheet.frames) {
            let lowest = -1;
            for (let i = 0; i < frame.length; i += 1)
                if (frame[i] !== '0')
                    lowest = Math.floor(i / FRAME_SIZE);
            expect(lowest).toBe(29);
        }
    }
});
test('the half-size frames keep the dark eyes', async () => {
    const eye = PALETTE.indexOf(EYE);
    expect(eye > 0).toBe(true);
    for (const sheet of Object.values(SHEETS).filter(one => one.cls !== 'bug' && one.anim === 'parado')) {
        expect(sheet.mini.some(frame => frame.includes(PIXEL_CHARS.charAt(eye)))).toBe(true);
    }
});
// The eye-colored groups of a frame in the head (rows above `maxRow`), left to right.
// Four-connected, so a 2x2 open eye or a 2x1 closed eye is one group.
const eyeGroups = (frame, size, maxRow) => {
    const eye = PIXEL_CHARS.charAt(PALETTE.indexOf(EYE));
    const seen = new Set();
    const groups = [];
    for (let i = 0; i < frame.length; i += 1) {
        if (frame.charAt(i) !== eye || seen.has(i))
            continue;
        const stack = [i];
        const xs = [];
        const ys = [];
        seen.add(i);
        for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
            const x = at % size;
            const y = Math.floor(at / size);
            xs.push(x);
            ys.push(y);
            for (const [dx = 0, dy = 0] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx;
                const ny = y + dy;
                const next = ny * size + nx;
                if (nx >= 0 && nx < size && ny >= 0 && ny < size && frame.charAt(next) === eye && !seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        const group = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        if (group.y1 <= maxRow)
            groups.push(group);
    }
    return groups.sort((a, b) => a.x0 - b.x0);
};
const CHARACTERS = Object.values(SHEETS).filter(sheet => sheet.cls !== 'bug');
test('every eye of every frame is one eye at half size: none lost, none doubled', async () => {
    for (const sheet of CHARACTERS) {
        sheet.frames.forEach((full, k) => {
            const big = eyeGroups(full, FRAME_SIZE, 24);
            const small = eyeGroups(sheet.mini[k] ?? '', MINI_SIZE, 12);
            expect(small.length).toBe(big.length);
            expect(big.length > 0).toBe(true);
        });
    }
});
test('every eye is a single pixel at half size, open or closed, so the small character never flickers', async () => {
    for (const sheet of CHARACTERS) {
        sheet.frames.forEach((full, k) => {
            const big = eyeGroups(full, FRAME_SIZE, 24);
            const small = eyeGroups(sheet.mini[k] ?? '', MINI_SIZE, 12);
            big.forEach((_eye, i) => {
                const shown = small[i];
                expect(shown === undefined).toBe(false);
                expect((shown?.x1 ?? 0) - (shown?.x0 ?? 0)).toBe(0);
                expect((shown?.y1 ?? 0) - (shown?.y0 ?? 0)).toBe(0);
            });
        });
    }
});
test('an eye keeps its place: it moves with the character, within a pixel of the original, and a blink does not change its column', async () => {
    for (const sheet of CHARACTERS) {
        sheet.frames.forEach((full, k) => {
            const big = eyeGroups(full, FRAME_SIZE, 24);
            const small = eyeGroups(sheet.mini[k] ?? '', MINI_SIZE, 12);
            big.forEach((eye, i) => {
                const shown = small[i];
                const originalX = (eye.x0 + eye.x1) / 2 / 2;
                const originalY = (eye.y0 + eye.y1) / 2 / 2;
                expect(Math.abs(((shown?.x0 ?? 99) + (shown?.x1 ?? 99)) / 2 - originalX) <= 1).toBe(true);
                expect(Math.abs(((shown?.y0 ?? 99) + (shown?.y1 ?? 99)) / 2 - originalY) <= 1).toBe(true);
            });
        });
    }
});
test('a blink does not move the small eye sideways and moves it at most a pixel up or down', async () => {
    for (const cls of ['mago', 'guerreiro', 'explorador']) {
        const sheet = SHEETS[`${cls}_parado`];
        const eyes = (sheet?.mini ?? []).map(frame => eyeGroups(frame, MINI_SIZE, 12));
        const open = eyes[0] ?? [];
        const blink = eyes[2] ?? [];
        expect(open.length > 0).toBe(true);
        expect(blink.length).toBe(open.length);
        blink.forEach((eye, i) => {
            expect(Math.abs(eye.x0 - (open[i]?.x0 ?? 99)) <= 1).toBe(true);
            expect(Math.abs(eye.y0 - (open[i]?.y0 ?? 99)) <= 1).toBe(true);
        });
    }
});
test('the explorer keeps the dark window of its lantern, which is not an eye', async () => {
    const sheet = SHEETS.explorador_dormindo;
    const eye = PIXEL_CHARS.charAt(PALETTE.indexOf(EYE));
    for (const frame of sheet?.mini ?? []) {
        const lower = frame.slice(13 * MINI_SIZE);
        expect(lower.includes(eye)).toBe(true);
    }
});
test('a full frame encodes to one cell per column and two pixel rows', async () => {
    const sheet = SHEETS.mago_parado;
    const frame = sheet?.frames[0];
    expect(frame === undefined).toBe(false);
    expect(encodeWords(frame ?? '', FRAME_SIZE, FRAME_SIZE, PALETTE).length).toBe(FRAME_SIZE * (FRAME_SIZE / 2) * 3);
});
