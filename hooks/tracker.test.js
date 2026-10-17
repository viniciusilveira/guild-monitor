import { expect, test } from 'claude-code/testing';
import { DEFEAT_MS } from './guild';
import { completeTurn, createTracker, setPlanMode, startTurn, tick, toolFinished, toolStarted, } from './tracker';
import { emptyGuild } from './xp';
const fresh = () => createTracker(emptyGuild(), 0);
const edit = { tool: 'Edit' };
const read = { tool: 'Read' };
const npmTest = { tool: 'Bash', command: 'npm test' };
test('a new tracker starts as the explorer with an empty guild', async () => {
    const tracker = fresh();
    expect(tracker.active).toBe('explorador');
    expect(tracker.turn).toBe(null);
    expect(tracker.bug.phase).toBe('none');
});
test('the class follows the turn: the prompt first, then the tools', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 10 });
    expect(tracker.active).toBe('explorador');
    tracker = toolStarted(tracker, read, 11);
    expect(tracker.active).toBe('explorador');
    tracker = toolStarted(tracker, edit, 12);
    expect(tracker.active).toBe('guerreiro');
});
test('plan mode makes the turn the mage and leaving it gives the class back', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'corrija o bug', now: 0 });
    expect(tracker.active).toBe('guerreiro');
    tracker = setPlanMode(tracker, true);
    expect(tracker.active).toBe('mago');
    tracker = setPlanMode(tracker, false);
    expect(tracker.active).toBe('guerreiro');
});
const finish = (tracker, use, now, durationMs = 0, isError = false) => {
    const started = toolStarted(tracker, use, now);
    return toolFinished(started, { use, isError, now, durationMs });
};
test('each operation that worked pays its own class at once, by time and size', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 });
    const searched = finish(tracker, { tool: 'WebSearch' }, 1, 4000);
    expect(searched.gain).toEqual({ cls: 'explorador', xp: 4, level: 1, leveledUp: false });
    const planned = finish(searched.tracker, { tool: 'TodoWrite' }, 2);
    expect(planned.gain?.cls).toBe('mago');
    expect(planned.gain?.xp).toBe(2);
    const edited = finish(planned.tracker, { tool: 'Edit', lines: 45 }, 3, 0);
    expect(edited.gain).toEqual({ cls: 'guerreiro', xp: 4, level: 1, leveledUp: false });
    tracker = edited.tracker;
    expect(tracker.guild.explorador.xp).toBe(4);
    expect(tracker.guild.mago.xp).toBe(2);
    expect(tracker.guild.guerreiro.xp).toBe(4);
    expect(tracker.turn?.earned).toEqual({ explorador: 4, mago: 2, guerreiro: 4 });
});
test('in plan mode every operation belongs to the mage', async () => {
    const tracker = setPlanMode(startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 }), true);
    expect(finish(tracker, { tool: 'Read' }, 1).gain?.cls).toBe('mago');
});
test('a failed operation and one outside a turn pay nothing', async () => {
    const inTurn = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 });
    expect(finish(inTurn, edit, 1, 0, true).gain).toBe(undefined);
    expect(finish(fresh(), edit, 1).gain).toBe(undefined);
    expect(finish(fresh(), edit, 1).tracker.guild).toEqual(emptyGuild());
});
test('an answered turn pays a little for the answer and keeps what each class earned in the history', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'corrija o bug', now: 0 });
    tracker = finish(tracker, read, 1).tracker;
    tracker = finish(tracker, edit, 2).tracker;
    const done = completeTurn(tracker, { id: 't1', reason: 'answer', now: 3 });
    expect(done.gain).toEqual({ cls: 'guerreiro', xp: 3, level: 1, leveledUp: false });
    expect(done.tracker.guild.guerreiro.xp).toBe(5);
    expect(done.tracker.guild.explorador.xp).toBe(2);
    expect(done.tracker.guild.mago.xp).toBe(0);
    expect(done.tracker.turn).toBe(null);
    expect(done.tracker.recent).toEqual([
        { cls: 'guerreiro', xp: 5, at: 3 },
        { cls: 'explorador', xp: 2, at: 3 },
    ]);
});
test('a level is reached by operations and the gain says so', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'oi', now: 0 });
    let leveled = 0;
    for (let i = 0; i < 20; i += 1) {
        const step = finish(tracker, { tool: 'Read' }, i, 6000);
        tracker = step.tracker;
        if (step.gain?.leveledUp)
            leveled += 1;
    }
    expect(tracker.guild.explorador.xp).toBe(100);
    expect(leveled).toBe(1);
});
test('an interrupted or failed turn pays nothing but is over', async () => {
    const started = startTurn(fresh(), { id: 't1', prompt: 'corrija', now: 0 });
    for (const reason of ['aborted', 'error', 'refusal']) {
        const done = completeTurn(started, { id: 't1', reason, now: 5 });
        expect(done.gain).toBe(undefined);
        expect(done.tracker.guild).toEqual(emptyGuild());
        expect(done.tracker.turn).toBe(null);
        expect(done.tracker.lastActivityAt).toBe(5);
    }
});
test('the completion of another turn is ignored', async () => {
    const started = startTurn(fresh(), { id: 't1', prompt: 'corrija', now: 0 });
    expect(completeTurn(started, { id: 'other', reason: 'answer', now: 5 }).tracker).toEqual(started);
    expect(completeTurn(fresh(), { id: 't1', reason: 'answer', now: 5 }).gain).toBe(undefined);
});
test('a failing call raises the bug, a passing call of the same kind defeats it and pays a bonus to who did it', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 });
    tracker = finish(tracker, npmTest, 1, 0, true).tracker;
    expect(tracker.bug.phase).toBe('alive');
    expect(tracker.guild.guerreiro.xp).toBe(0);
    tracker = finish(tracker, edit, 3).tracker;
    expect(tracker.bug.phase).toBe('alive');
    const fixed = finish(tracker, npmTest, 5);
    expect(fixed.tracker.bug.phase).toBe('defeated');
    // 2 for the operation, 10 for the bug
    expect(fixed.gain).toEqual({ cls: 'guerreiro', xp: 12, level: 1, leveledUp: false });
});
test('a bug defeated pays only the call that defeated it', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 });
    tracker = finish(tracker, npmTest, 1, 0, true).tracker;
    tracker = finish(tracker, npmTest, 2).tracker;
    expect(tracker.guild.guerreiro.xp).toBe(12);
    expect(finish(tracker, npmTest, 3).gain?.xp).toBe(2);
});
test('the defeated bug leaves with the clock', async () => {
    let tracker = startTurn(fresh(), { id: 't1', prompt: 'rode os testes', now: 0 });
    tracker = toolFinished(tracker, { use: npmTest, isError: true, now: 1, durationMs: 0 }).tracker;
    tracker = toolFinished(tracker, { use: npmTest, isError: false, now: 1000, durationMs: 0 }).tracker;
    expect(tick(tracker, 1000 + DEFEAT_MS - 1).bug.phase).toBe('defeated');
    expect(tick(tracker, 1000 + DEFEAT_MS).bug.phase).toBe('none');
});
test('activity outside a turn keeps the guild awake without starting one', async () => {
    const tracker = toolStarted(fresh(), read, 50);
    expect(tracker.turn).toBe(null);
    expect(tracker.lastActivityAt).toBe(50);
});
