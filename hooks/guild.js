export const DEFAULTS = { sleepAfterMs: 90000, tiredAtPercent: 75 };
// Working beats everything and only the active class works; a rested
// character after a long idle sleeps; one in a heavy context is tired;
// the rest wait.
export const animationFor = (cls, snapshot, settings = DEFAULTS) => {
    if (snapshot.working && cls === snapshot.active)
        return 'trabalho';
    if (!snapshot.working && snapshot.idleMs >= settings.sleepAfterMs)
        return 'dormindo';
    if ((snapshot.contextPercent ?? 0) >= settings.tiredAtPercent)
        return 'cansado';
    return 'parado';
};
export const NO_BUG = { phase: 'none', category: '', since: 0 };
// How long the defeat animation stays before the bug is gone.
export const DEFEAT_MS = 1200;
const RUNNERS_WITH_SUBCOMMAND = /^[a-z][\w.-]*$/;
// What makes two tool calls the same kind: the tool, and for Bash the program
// and its subcommand (`npm test`, `git push`), so a passing `npm test` beats a
// failing `npm test` but not a failing `git push`.
export const categoryOf = (tool, command) => {
    if (tool !== 'Bash')
        return tool;
    const [head = '', second = ''] = (command ?? '').trim().split(/\s+/);
    const sub = RUNNERS_WITH_SUBCOMMAND.test(second) ? ` ${second}` : '';
    return `Bash:${head}${sub}`;
};
export const onToolResult = (bug, result) => {
    if (result.isError)
        return { phase: 'alive', category: result.category, since: result.now };
    if (bug.phase === 'alive' && bug.category === result.category) {
        return { phase: 'defeated', category: bug.category, since: result.now };
    }
    return bug;
};
// The bug a clock tick sees: a defeated one is gone once its animation ran.
export const bugAt = (bug, now) => bug.phase === 'defeated' && now - bug.since >= DEFEAT_MS ? NO_BUG : bug;
