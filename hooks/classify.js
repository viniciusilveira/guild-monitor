const MUTATING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const LOOKING = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch', 'NotebookRead']);
const PLANNING = new Set(['TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate']);
const READ_COMMANDS = new Set([
    'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'pwd', 'which', 'tree', 'stat', 'file', 'du', 'df',
    'echo', 'printf', 'sort', 'uniq', 'diff', 'jq', 'env', 'whoami', 'date', 'type', 'cd',
]);
const READ_GIT = new Set(['log', 'status', 'diff', 'show', 'branch', 'blame', 'remote', 'ls-files', 'rev-parse', 'describe']);
const words = (text) => text.trim().split(/\s+/).filter(Boolean);
// A command only looks when every piece of a pipeline or && chain does and
// nothing is redirected into a file.
export const isReadOnlyCommand = (raw) => {
    const command = raw.replace(/\d*>>?\s*\/dev\/null/g, '');
    if (/(^|[^>])>{1,2}(?!&)|\btee\b/.test(command))
        return false;
    return command
        .split(/\||&&|;|\|\|/)
        .map(part => words(part))
        .filter(parts => parts.length > 0)
        .every(([head = '', second = '']) => READ_COMMANDS.has(head) || (head === 'git' && READ_GIT.has(second)));
};
// What a tool call counts as: acting changes things, looking reads them,
// planning organises the work.
export const kindOf = (use) => {
    if (MUTATING.has(use.tool))
        return 'act';
    if (LOOKING.has(use.tool))
        return 'look';
    if (PLANNING.has(use.tool))
        return 'plan';
    if (use.tool === 'Bash')
        return isReadOnlyCommand(use.command ?? '') ? 'look' : 'act';
    if (use.tool === 'Agent' || use.tool === 'Task') {
        if (use.subagent === 'Plan')
            return 'plan';
        if (use.subagent === 'Explore')
            return 'look';
        return 'act';
    }
    return 'act';
};
// Words of a prompt, with a weight each. Fixing and building words weigh most
// on the acting side, investigating words on the looking side, and a failure
// noun alone (bug, error) only leans a little towards looking, so "corrija o
// bug" is the warrior and "investigue o bug" the explorer.
const FIX_WORDS = /\b(fix|corrig\w*|corrij\w*|consert\w*|arrum\w*|resolv\w*|solve|implement\w*|refator\w*|refactor\w*)\b/g;
const TASK_WORDS = /\b(crie|criar|cria|adicion\w*|add|escrev\w*|write|renome\w*|rename|delet\w*|remov\w*|instal\w*|build|compil\w*|rode|rodar|execut\w*|deploy|commit|push|test|tests|teste|testes|testar)\b/g;
const INVESTIGATE_WORDS = /\b(investig\w*|debug\w*|depur\w*|diagnos\w*)\b/g;
const LOOK_WORDS = /\b(search|find|explor\w*|pesquis\w*|procur\w*|busc\w*|onde|where|explain|explic\w*|entend\w*|understand|mostr\w*|show|list\w*)\b/g;
const WEB_WORDS = /\b(internet|web|online|site|sites|documentacao|docs)\b/g;
const FAILURE_WORDS = /\b(bug|bugs|erro|erros|error|errors|falh\w*|fail\w*)\b/g;
const PLAN_WORDS = /\b(plan\w*|planej\w*|plano|planos|arquitet\w*|architect\w*|brainstorm\w*|spec|proposta|estrateg\w*|strateg\w*|roadmap)\b/g;
const SOFT_PLAN_WORDS = /\b(design|desenho)\b/g;
const normalize = (text) => text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const count = (text, pattern) => text.match(pattern)?.length ?? 0;
// What the prompt alone says the work is, if it says; a tie goes to acting,
// then planning.
export const classifyPrompt = (prompt) => {
    const text = normalize(prompt);
    const act = count(text, FIX_WORDS) * 3 + count(text, TASK_WORDS) * 2;
    const plan = count(text, PLAN_WORDS) * 4 + count(text, SOFT_PLAN_WORDS) * 2;
    const look = count(text, INVESTIGATE_WORDS) * 3 + count(text, LOOK_WORDS) * 2 + count(text, WEB_WORDS) * 2 + count(text, FAILURE_WORDS);
    const top = Math.max(act, plan, look);
    if (top === 0)
        return undefined;
    if (act === top)
        return 'guerreiro';
    if (plan === top)
        return 'mago';
    return 'explorador';
};
// What a turn is when nothing says otherwise: the warrior is for fixing and
// doing, so the neutral class is the one that looks around.
export const DEFAULT_CLASS = 'explorador';
const CLASS_OF = { act: 'guerreiro', look: 'explorador', plan: 'mago' };
// The class of what the tools were doing: the one most of them did, a tie going
// to the most recent. Undefined without tools.
export const classifyTools = (tools) => {
    const counts = { mago: 0, guerreiro: 0, explorador: 0 };
    let last;
    for (const use of tools) {
        last = CLASS_OF[kindOf(use)];
        counts[last] += 1;
    }
    const top = Math.max(counts.mago, counts.guerreiro, counts.explorador);
    return last === undefined ? undefined : counts[last] === top ? last : Object.keys(counts).find(cls => counts[cls] === top);
};
const linesOf = (text) => (typeof text === 'string' && text.length > 0 ? text.split('\n').length : 0);
// Lines a call writes, as far as its input shows: the new text of an edit or a new file.
export const linesWritten = (input) => {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    const inEdits = edits.reduce((sum, edit) => sum + (typeof edit === 'object' && edit !== null ? linesOf(edit.new_string) : 0), 0);
    return linesOf(input.new_string) + linesOf(input.content) + inEdits;
};
// Who a single tool call belongs to: plan mode is the mage's, otherwise its kind.
export const classOf = (use, planMode) => (planMode ? 'mago' : CLASS_OF[kindOf(use)]);
// How many of the latest tool calls say what the agent is doing now.
const RECENT_TOOLS = 3;
// What the agent is doing decides: plan mode is the mage's, otherwise the kind of
// its latest tool calls (reading is the explorer's, changing things the
// warrior's, organising the work the mage's). The prompt only guesses before the
// first tool call, and the explorer is the default.
export const classify = (signals) => {
    if (signals.planMode)
        return 'mago';
    return classifyTools(signals.tools.slice(-RECENT_TOOLS)) ?? classifyPrompt(signals.prompt) ?? DEFAULT_CLASS;
};
