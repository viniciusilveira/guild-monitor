import { DEFAULTS } from './guild';
import { createTracker, startTurn, toolFinished, toolStarted } from './tracker';
import { addXp, emptyGuild } from './xp';
// Scenes for screenshots and a first look: made-up figures, nothing read from
// the session and nothing saved.
export const SCENES = ['explorador', 'mago', 'guerreiro', 'bug', 'cansado', 'dormindo'];
export const sceneOf = (value) => SCENES.find(scene => scene === value);
const MINUTE_MS = 60000;
const demoGuild = () => {
    const levels = [
        ['mago', 130],
        ['guerreiro', 420],
        ['explorador', 55],
    ];
    return levels.reduce((guild, [cls, xp]) => addXp(guild, cls, xp).guild, emptyGuild());
};
const working = (tracker, now, tool) => toolStarted(startTurn(tracker, { id: 'demo', prompt: '', now }), { tool }, now);
export const demoState = (scene, now, settings = DEFAULTS) => {
    const base = createTracker(demoGuild(), now);
    const usage = {
        contextPercent: scene === 'cansado' ? 88 : 36,
        rateLimits: [
            { kind: 'seven_day', percentUsed: 28 },
            { kind: 'five_hour', percentUsed: 55, resetsAt: new Date(now + 133 * MINUTE_MS).toISOString() },
        ],
        costUsd: 3.42,
    };
    if (scene === 'explorador')
        return { tracker: working(base, now, 'WebSearch'), usage };
    if (scene === 'mago')
        return { tracker: working(base, now, 'TodoWrite'), usage };
    if (scene === 'guerreiro')
        return { tracker: working(base, now, 'Edit'), usage };
    if (scene === 'bug') {
        const edit = working(base, now, 'Edit');
        const failed = toolFinished(edit, { use: { tool: 'Bash', command: 'npm test' }, isError: true, now, durationMs: 0 });
        return { tracker: failed.tracker, usage };
    }
    const resting = { ...base, active: 'guerreiro' };
    if (scene === 'cansado')
        return { tracker: resting, usage };
    return { tracker: { ...resting, lastActivityAt: now - settings.sleepAfterMs - 1000 }, usage };
};
