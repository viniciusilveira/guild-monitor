import { classify, classOf, DEFAULT_CLASS } from './classify';
import { bugAt, categoryOf, NO_BUG, onToolResult } from './guild';
import { addXp, ANSWER_XP, BUG_BONUS, CLASSES, operationXp } from './xp';
const MAX_TOOLS = 500;
const MAX_RECENT = 20;
const NOTHING_EARNED = () => ({ mago: 0, guerreiro: 0, explorador: 0 });
export const createTracker = (guild, now) => ({
    turn: null,
    planMode: false,
    active: DEFAULT_CLASS,
    bug: NO_BUG,
    guild,
    lastActivityAt: now,
    recent: [],
});
// The class follows the turn as it unfolds: first the prompt, then the tools.
const reclassify = (tracker) => tracker.turn === null
    ? tracker
    : {
        ...tracker,
        active: classify({ prompt: tracker.turn.prompt, planMode: tracker.planMode, tools: tracker.turn.tools }),
    };
export const setPlanMode = (tracker, planMode) => tracker.planMode === planMode ? tracker : reclassify({ ...tracker, planMode });
export const startTurn = (tracker, start) => reclassify({
    ...tracker,
    turn: { id: start.id, prompt: start.prompt, tools: [], earned: NOTHING_EARNED() },
    lastActivityAt: start.now,
});
export const toolStarted = (tracker, use, now) => tracker.turn === null
    ? { ...tracker, lastActivityAt: now }
    : reclassify({
        ...tracker,
        turn: { ...tracker.turn, tools: [...tracker.turn.tools, use].slice(-MAX_TOOLS) },
        lastActivityAt: now,
    });
// A tool call that worked pays its own class, at once: by what it took and what it wrote, plus
// a bonus for making a failing call pass again. Only calls inside a turn pay.
export const toolFinished = (tracker, done) => {
    const bug = onToolResult(tracker.bug, {
        category: categoryOf(done.use.tool, done.use.command),
        isError: done.isError,
        now: done.now,
    });
    const resolved = tracker.bug.phase === 'alive' && bug.phase === 'defeated';
    const turn = tracker.turn;
    const moved = { ...tracker, bug, lastActivityAt: done.now };
    if (turn === null || done.isError)
        return { tracker: moved };
    const cls = classOf(done.use, tracker.planMode);
    const xp = operationXp({ durationMs: done.durationMs, lines: done.use.lines ?? 0 }) + (resolved ? BUG_BONUS : 0);
    const added = addXp(tracker.guild, cls, xp);
    return {
        tracker: { ...moved, guild: added.guild, turn: { ...turn, earned: { ...turn.earned, [cls]: turn.earned[cls] + xp } } },
        gain: { cls, xp, level: added.level, leveledUp: added.leveledUp },
    };
};
// A defeated bug leaves once its animation ran.
export const tick = (tracker, now) => {
    const bug = bugAt(tracker.bug, now);
    return bug === tracker.bug ? tracker : { ...tracker, bug };
};
// The operations were paid as they finished; a turn the model answered pays a little
// more for the answer, and an interrupted one or one an API error killed only closes.
export const completeTurn = (tracker, end) => {
    const turn = tracker.turn;
    if (turn === null || turn.id !== end.id)
        return { tracker };
    const answered = end.reason === 'answer';
    const earned = { ...turn.earned };
    if (answered)
        earned[tracker.active] += ANSWER_XP;
    const history = CLASSES.filter(cls => earned[cls] > 0).map(cls => ({ cls, xp: earned[cls], at: end.now }));
    const idle = {
        ...tracker,
        turn: null,
        lastActivityAt: end.now,
        recent: [...tracker.recent, ...history].slice(-MAX_RECENT),
    };
    if (!answered)
        return { tracker: idle };
    const added = addXp(tracker.guild, tracker.active, ANSWER_XP);
    return {
        tracker: { ...idle, guild: added.guild },
        gain: { cls: tracker.active, xp: ANSWER_XP, level: added.level, leveledUp: added.leveledUp },
    };
};
