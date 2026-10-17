import { expect, test } from 'claude-code/testing';
import { addXp, emptyGuild, levelOf, parseGuild, operationXp, progressOf, xpForLevel } from './xp';
test('levels start at 0, 40, 160, 360 and 640 XP', async () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 40, 160, 360, 640]);
    expect(levelOf(0)).toBe(1);
    expect(levelOf(39)).toBe(1);
    expect(levelOf(40)).toBe(2);
    expect(levelOf(159)).toBe(2);
    expect(levelOf(160)).toBe(3);
    expect(levelOf(-5)).toBe(1);
});
test('level and XP floor agree for the first hundred levels', async () => {
    for (let level = 1; level <= 100; level += 1) {
        expect(levelOf(xpForLevel(level))).toBe(level);
        expect(levelOf(xpForLevel(level + 1) - 1)).toBe(level);
    }
});
test('progress says where the character stands inside its level', async () => {
    expect(progressOf(0)).toEqual({ level: 1, current: 0, needed: 40 });
    expect(progressOf(55)).toEqual({ level: 2, current: 15, needed: 120 });
});
test('an operation pays 2 XP, plus up to 4 for its time and up to 4 for what it wrote, 10 at most', async () => {
    expect(operationXp({ durationMs: 0, lines: 0 })).toBe(2);
    expect(operationXp({ durationMs: 1999, lines: 19 })).toBe(2);
    expect(operationXp({ durationMs: 2000, lines: 0 })).toBe(3);
    expect(operationXp({ durationMs: 60000, lines: 0 })).toBe(6);
    expect(operationXp({ durationMs: 0, lines: 40 })).toBe(4);
    expect(operationXp({ durationMs: 0, lines: 5000 })).toBe(6);
    expect(operationXp({ durationMs: 60000, lines: 5000 })).toBe(10);
    expect(operationXp({ durationMs: -5, lines: -5 })).toBe(2);
});
test('XP goes to one class and a level up says so', async () => {
    const first = addXp(emptyGuild(), 'mago', 30);
    expect(first.guild.mago.xp).toBe(30);
    expect(first.guild.guerreiro.xp).toBe(0);
    expect(first.leveledUp).toBe(false);
    const second = addXp(first.guild, 'mago', 15);
    expect(second.guild.mago.xp).toBe(45);
    expect(second.level).toBe(2);
    expect(second.leveledUp).toBe(true);
    expect(addXp(second.guild, 'mago', 1).leveledUp).toBe(false);
});
test('adding XP never touches the guild it was given and ignores nonsense amounts', async () => {
    const guild = emptyGuild();
    addXp(guild, 'mago', 100);
    expect(guild.mago.xp).toBe(0);
    expect(addXp(guild, 'mago', -50).guild.mago.xp).toBe(0);
    expect(addXp(guild, 'mago', 12.9).guild.mago.xp).toBe(12);
});
test('stored data that is missing or wrong starts from zero, the rest is kept', async () => {
    expect(parseGuild(undefined)).toEqual(emptyGuild());
    expect(parseGuild('banana')).toEqual(emptyGuild());
    expect(parseGuild(null)).toEqual(emptyGuild());
    expect(parseGuild({ mago: { xp: 90 }, guerreiro: { xp: 'muito' }, explorador: { xp: -3 } })).toEqual({
        mago: { xp: 90 },
        guerreiro: { xp: 0 },
        explorador: { xp: 0 },
    });
    expect(parseGuild({ guerreiro: { xp: 12.7 } }).guerreiro.xp).toBe(12);
});
