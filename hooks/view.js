import { animationFor, bugAt, DEFAULTS } from './guild';
import { CLASSES, progressOf } from './xp';
export const usageFrom = (figures) => ({
    contextPercent: figures.context.percent,
    rateLimits: figures.rateLimits,
    costUsd: figures.cost?.usd,
});
// A figure the engine does not have at the moment (a window that has not been
// read yet, a context with no response behind it) leaves the last one known as
// it was: the attributes belong to the session, and a gap in the reports must
// not blank them.
export const mergeUsage = (known, fresh) => {
    const kinds = new Set(fresh.rateLimits.map(limit => limit.kind));
    return {
        contextPercent: fresh.contextPercent ?? known.contextPercent,
        rateLimits: [...known.rateLimits.filter(limit => !kinds.has(limit.kind)), ...fresh.rateLimits],
        costUsd: fresh.costUsd ?? known.costUsd,
    };
};
const percentLeft = (used) => used === undefined ? null : Math.max(0, Math.min(100, Math.round(100 - used)));
export const buildView = (tracker, usage, now, settings = DEFAULTS) => {
    const snapshot = {
        working: tracker.turn !== null,
        active: tracker.active,
        idleMs: now - tracker.lastActivityAt,
        contextPercent: usage.contextPercent,
    };
    const week = usage.rateLimits.find(limit => limit.kind === 'seven_day');
    const hours = usage.rateLimits.find(limit => limit.kind === 'five_hour');
    return {
        active: tracker.active,
        working: snapshot.working,
        chars: CLASSES.map(cls => {
            const progress = progressOf(tracker.guild[cls].xp);
            return {
                cls,
                anim: animationFor(cls, snapshot, settings),
                level: progress.level,
                xpInLevel: progress.current,
                xpNeeded: progress.needed,
            };
        }),
        bug: bugAt(tracker.bug, now).phase,
        hp: percentLeft(week?.percentUsed),
        mana: percentLeft(hours?.percentUsed),
        stamina: percentLeft(usage.contextPercent),
        manaResetsAt: hours?.resetsAt ?? null,
        costUsd: usage.costUsd ?? null,
    };
};
// Which frame of an animation shows `elapsed` ms after it began: a loop wraps
// around, a one-shot stays on its last frame.
export const frameAt = (durations, elapsed, loop) => {
    const total = durations.reduce((sum, ms) => sum + ms, 0);
    if (durations.length === 0 || total <= 0 || elapsed <= 0)
        return 0;
    if (!loop && elapsed >= total)
        return durations.length - 1;
    let rest = elapsed % total;
    for (let i = 0; i < durations.length; i += 1) {
        const ms = durations[i] ?? 0;
        if (rest < ms)
            return i;
        rest -= ms;
    }
    return durations.length - 1;
};
export const sheetIdFor = (cls, anim) => `${cls}_${anim}`;
export const NAMES = { mago: 'Mago', guerreiro: 'Guerreiro', explorador: 'Explorador' };
export const COLORS = { mago: '#8E6BBF', guerreiro: '#C8423A', explorador: '#4C9A5B' };
// Colors of the meters, after the usual game HUD conventions: health goes green,
// yellow, red as it drops; mana is blue; stamina orange; experience purple; gold gold.
export const METER_COLORS = { mana: '#4A90E2', stamina: '#F39C12', xp: '#9B59B6', gold: '#F1C40F', unknown: '#7F8C8D' };
export const healthColor = (percent) => {
    if (percent === null)
        return METER_COLORS.unknown;
    if (percent > 50)
        return '#2ECC71';
    if (percent >= 25)
        return '#F1C40F';
    return '#E74C3C';
};
const DOING = { mago: 'planejando', guerreiro: 'em combate', explorador: 'explorando' };
export const stateText = (cls, anim) => {
    if (anim === 'trabalho')
        return DOING[cls];
    if (anim === 'cansado')
        return 'cansado';
    if (anim === 'dormindo')
        return 'dormindo';
    return 'de prontidao';
};
// ▰▰▰▱▱▱: `percent` of `width` cells filled; empty while the figure is unknown.
export const bar = (percent, width = 8) => {
    const filled = percent === null ? 0 : Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
    return '▰'.repeat(filled) + '▱'.repeat(width - filled);
};
export const percentText = (percent) => (percent === null ? '--' : `${percent}%`);
export const costText = (usd) => (usd === null ? '--' : `$${usd.toFixed(2)}`);
// "2h13" or "47min": time left until a window resets, empty when unknown or past.
export const untilReset = (resetsAt, now) => {
    if (resetsAt === null)
        return '';
    const at = Date.parse(resetsAt);
    if (Number.isNaN(at) || at <= now)
        return '';
    const minutes = Math.ceil((at - now) / 60000);
    if (minutes < 60)
        return `${minutes}min`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
};
