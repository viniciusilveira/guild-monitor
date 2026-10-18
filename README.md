# Guild Monitor

**English** · [Português](README.pt-BR.md)

A [Claude Code](https://claude.com/claude-code) mod that turns your session monitor into a tiny RPG. A guild of three pixel-art characters lives in a side panel (or a band above your prompt), works while the agent works, and levels up as tasks get done. Your usage limits, context window and cost show up as game meters.

> **Not affiliated with Anthropic.** The orange mascot is a fan-made homage to the Claude Code mascot. "Claude" and "Claude Code" are trademarks of Anthropic.

<p align="center">
  <img src="docs/art/mago_design_preview16x.png" alt="Mage" width="160">
  <img src="docs/art/guerreiro_design_preview16x.png" alt="Warrior" width="160">
  <img src="docs/art/explorador_design_preview16x.png" alt="Explorer" width="160">
  <img src="docs/art/bug_design_preview16x.png" alt="Bug" width="160">
</p>

## What it does

- **Three characters, one per kind of work.** The one on stage follows what the agent is *doing*, not what you typed.
- **Animated in the terminal.** Full-size sprites (32×16 cells) drawn with half-block characters and truecolor, with no image protocol needed. Works in iTerm2, foot and inside tmux.
- **Meters** for the 7-day limit, the 5-hour limit, the context window and the session cost.
- **XP and levels per class**, paid per operation and kept between sessions.
- **A bug** that shows up every time a tool call fails, is defeated when it works again and leaves on its own after 2 minutes without a new error.

## The guild

| Character | Does | Comes on stage when the agent… |
|---|---|---|
| **Mage** | plans | is in plan mode, or organises the work (`TodoWrite`, `AskUserQuestion`, plan tasks, `Plan` subagents) |
| **Warrior** | executes and fixes | changes things: `Edit`, `Write`, `MultiEdit`, shell commands that are not read-only, other subagents |
| **Explorer** *(default)* | researches and investigates | reads or searches: `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, read-only shell commands, `Explore` subagents |

The character on stage is the one most of the **last three tool calls** belong to (a tie goes to the latest). Before the first tool call of a turn, the prompt gives a first guess ("fix the bug" → Warrior, "plan the feature" → Mage); with nothing to go on, it is the Explorer.

### States

| State | When | Animation |
|---|---|---|
| working | a turn is running | the active character works |
| tired | context ≥ 75% (configurable) | everyone looks worn out |
| asleep | idle for 90 s (configurable) | everyone sleeps |
| idle | otherwise | everyone waits, blinking |

<table align="center">
  <tr>
    <td align="center"><img src="docs/art/mago_trabalho_preview.gif" width="128"><br>Mage working</td>
    <td align="center"><img src="docs/art/guerreiro_trabalho_preview.gif" width="128"><br>Warrior working</td>
    <td align="center"><img src="docs/art/explorador_trabalho_preview.gif" width="128"><br>Explorer working</td>
    <td align="center"><img src="docs/art/bug_parado_preview.gif" width="128"><br>Bug</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/art/mago_parado_preview.gif" width="128"><br>Idle</td>
    <td align="center"><img src="docs/art/guerreiro_cansado_preview.gif" width="128"><br>Tired</td>
    <td align="center"><img src="docs/art/explorador_dormindo_preview.gif" width="128"><br>Asleep</td>
    <td align="center"><img src="docs/art/bug_derrotado_preview.gif" width="128"><br>Defeated</td>
  </tr>
</table>

## Meters

| Meter | Shows | Color |
|---|---|---|
| **HP** | what is left of the 7-day usage window | green above 50%, yellow 25–50%, red below 25% |
| **MP** | what is left of the 5-hour window, with the time until it resets | blue |
| **ST** (stamina) | what is left of the context window | orange |
| **Gold** | what the session has cost, in USD | gold |
| **XP** | progress to the next level of the active character | purple |

HP and MP come from your subscription's rate limits: outside a subscription (for instance with an API key) they show `--`. A figure the session has not reported yet keeps its last known value, so the meters never blank when you switch characters.

## Forecast of the windows

Next to HP and MP the guild says when each window runs out **at the current pace**, in Portuguese like the rest of the interface: `5h esgota em ~40min`, `7d esgota em ~3 dias`, `5h dura até o reset` (it lasts until the window resets) or `7d sem consumo` (nothing is being used). It is red when the window runs out before it resets.

- It is estimated from the readings of the rate limits the plugin already takes, with the average slope of the recent ones (the last hour for the 5-hour window, the last two days for the week). The percent moves in whole points, so it only says something with at least 3 readings, over 10 minutes (2 hours for the week) and a variation of 2 points. Before that nothing is shown: **the forecast never invents a number**. The time is rounded up in steps of 5 minutes; the week shows days.
- When a window resets (a new reset time, or the percent drops) the readings start over, and the forecast comes back once there are enough new ones. A window the session stops reporting stops being forecast.
- In the side panel each window has its own line under the legend. In the bottom band there is room for one: the window that runs out before its reset, otherwise the 5-hour one. In the compact band (8 rows) it takes the line of the legend and gives way to the `bug na área!` warning. In a narrow panel the text loses the `em` (`5h esgota ~40min`) and, if even that does not fit, the line is left out.
- Only the recent readings exist, in memory: nothing is saved to the store, to the `/guild trace` log or shown in a toast. The option `showForecast` set to `off` hides it all.
- The demo scenes show a made-up forecast: `5h esgota em ~1h30` in red and `7d dura até o reset`.

## XP and levels

Every tool call that finishes **without error** pays XP at once to the class it belongs to, so a task that explores, plans and then executes feeds all three characters:

```
operation XP = 2  +  min(seconds / 2, 4)  +  min(lines written / 20, 4)      (10 at most)
```

- Time is how long the call ran. Lines are what an edit or a new file wrote.
- Defeating a bug pays **+10** to the class that made the passing call.
- A turn that ends with an answer pays **+3** to the active class.
- Interrupted turns keep what was already paid.

Level `n` starts at `40 × (n − 1)²` XP: level 2 at 40, level 3 at 160, level 4 at 360, level 5 at 640. XP is saved in the plugin store (`guild.v1`) and survives restarts. A toast announces each new level.

## The bug

When a tool call fails, the bug appears under the active character's stats. A later successful call **of the same kind** defeats it (for shell commands, the same program and subcommand: `npm test`, `git push`; for other tools, the same tool). If no such call comes, the bug leaves on its own after **2 minutes without a new tool error**; a new error restarts that count. Calls refused by a permission or a hook, and the ones **you reject yourself** (a declined plan, a denied permission, an interrupted question), are not failures: they raise no bug, defeat no live bug and pay no XP. In `/guild trace` they show as `RECUSADA`, not `ERRO`. Spotting a rejection is best effort: a rejected plan or question is always recognized, but for the other tools it relies on the refusal text of the engine, which can change between versions, and a shell command you interrupt while it runs still raises a bug.

## What the character is doing now

A line at the top of the side panel (and at the top of the stats in the bottom band, when they fit) says what the active character is doing right now, for example `Warrior: editando register.tsx` or `Explorer: pesquisando na web`. The text is in Portuguese, like the rest of the interface.

- The line follows the tool calls: it appears when a call starts and goes away when it ends, whether it succeeded, failed or was refused by a permission or a hook. With several calls in parallel, the most recent one that has not finished wins. A call that waits for your permission shows as in progress until you answer, and goes away once it is refused: the engine's permission check runs after this mod's hook and the answer to the dialog is not observable, so a refused call cannot be told apart beforehand. 
- One verb per kind of tool: `lendo` (Read), `buscando` (Grep, Glob), `pesquisando na web` (WebSearch, WebFetch), `editando` (Edit), `escrevendo` (Write), `executando` (Bash), `planejando` (plans and to-do lists) and `chamando um aliado` (subagents; what the subagent does inside is not shown).
- The target is only the file name, without the directory, or, for a shell command, only the program and a plain subcommand (`npm test`, `git commit`), cut at 24 characters. Flags, values, `NAME=value` assignments, URLs and credentials are never shown, since the panel may be shared or captured; `…` marks what was left out. It exists **only on screen and in memory**: it is never saved to the store or to the `/guild trace` log.
- When nothing runs, or the turn ends, the line shows the resting state: `de prontidão`, `cansado` or `dormindo`.
- In a narrow panel the line gives up the name, then the target, and ends as the verb alone.
- The demo scenes `explorador`, `mago`, `guerreiro` and `bug` show a call in progress; `cansado` and `dormindo` show the resting state. The screenshots below were taken before this line existed and do not show it.

## Session and turn timers

The side panel shows two timers, just above the latest operations: `sessão 1h05` (how long the session has been open) and `turno 32s` (how long the current turn has run). The labels are in Portuguese, like the rest of the interface, and the format is short: `32s` under a minute, `4min` under an hour, `1h05` after that.

- **Session timer.** It counts from the session's real start, which the engine reports: a resumed session counts from its first launch, and `/clear` starts it over (the new start is picked up within 2 seconds). It reads `--` while the start is unknown.
- **Turn timer.** It runs from your prompt until the answer, then stops and keeps the final duration, the one the engine reports when the turn completes (not a local subtraction), until the next turn begins. It reads `--` before the first turn. An interrupted or failed turn keeps its duration too.
- **Bottom band.** It shows only the turn timer, on the gold line (`ouro $1.50 · turno 32s`), and only while a turn runs, so the compact band's 8 lines still hold.
- **Redraws.** The timers are kept in whole seconds, so the view changes (and the panel redraws) once per second, not at every animation frame. Nothing about them is saved to the store, the `/guild trace` log or a toast.
- **Demo scenes.** All of them show both timers: `explorador`, `mago`, `guerreiro` and `bug` with a session open for `1h05` and a turn running for `32s`; `cansado` and `dormindo` with `1h05` and the last turn's `4min`.

## Combo and defeated bugs

The side panel has a line of counters above the gold split and the session and turn timers, for example `combo x7 · melhor x9 · bugs 3`: the **combo** (operations in a row that finished without error), the **best combo** of the session (`melhor`) and the **bugs defeated** in the session. The labels are in Portuguese, like the rest of the interface.

- **Combo.** It grows with every operation that finishes without error and resets on a failure; the failure still raises the bug as before. Calls you or a hook refused, and calls made by subagents, are ignored: they neither raise nor reset it (the same rule as the XP).
- **Hidden below 3.** The combo and the best combo only show from 3 on, so the panel is not filled with `x1`. Before that the line is just `bugs 0`.
- **Bugs defeated.** Each defeat counts once: the moment a live bug goes down, the same one that pays the XP bonus.
- **Memory only.** Nothing is saved to the store, the `/guild trace` log or a toast, and everything starts over with the session. Lifetime totals are a separate feature.
- **Bottom band.** It does not show the counters, so the compact band's 8 lines still hold.
- **Demo scenes.** All of them show made-up values, `combo x7 · melhor x9 · bugs 3`; the `bug` scene has just lost its combo and shows `melhor x9 · bugs 3`.

## Gold by class (estimate)

The side panel splits the session's cost between the three characters, between the counters and the session timer:

```
Mago ~$1.20 (35%)
Guerreiro ~$1.71 (50%)
Explorador ~$0.51 (15%)
```

It is an **estimate**, not accounting: that is what the `~` stands for. The cost arrives in separate readings (every 2 seconds and whenever the engine reports a measurement) and the plugin does not know which call caused which part of it.

- **The rule.** The change in cost between two readings goes to the class of the operations that finished in that interval. If more than one class worked in it, the change is split in proportion to each class's number of operations; with no operation (the model only answered) it goes to the active class. The first reading is only the starting point: it attributes nothing, so on a resumed session the split adds up to what was spent since the plugin began to watch.
- **Always adds up.** The three amounts add up exactly to the change in cost since that starting point (the money is counted in whole micro-dollars, so there is no floating point drift). The percentages add up to 100: each is rounded down and the rest goes to the biggest fractions. The amounts are shown rounded to cents.
- **Odd readings.** A cost that did not change attributes nothing. A cost that drops (a `/clear` starts the session's cost over) clears the split and starts again from the new value. A reading that is missing, `NaN`, negative or over a billion dollars is ignored altogether.
- **Operations.** Every tool call of the main agent that finishes inside a turn counts, whether it worked or failed. Calls you or a hook refused do not. Calls made by subagents are ignored (the same guard as the XP and the combo, `agentId`): what a subagent costs is part of the session's cost and goes to the main agent's class that ran in the interval.
- **No lines before a change.** Until the cost has changed once, the lines are not shown.
- **Narrow panel.** The three lines always use the same form, the longest that fits: `Mago ~$1.20 (35%)`, then `Mago ~$1.20 35%`, then `Mag ~$1.20 35%`, then just `~$1.20 35%`; if not even that fits, the lines are left out.
- **Session only.** Nothing is saved to the store, the `/guild trace` log or a toast, and everything starts over with the session. A history by class is a separate feature.
- **Bottom band.** It does not show the split, so the compact band's 8 lines still hold.
- **Demo scenes.** All of them show a made-up split that adds up to the demo's $3.42: `Mago ~$1.20 (35%)`, `Guerreiro ~$1.71 (50%)` and `Explorador ~$0.51 (15%)`.

## Tokens and cache hit rate

The side panel shows, right above the latest operations, how many tokens the session spent and how much the prompt cache helped:

```
tokens  input 142k · output 18k · cache 87%
sessão  input 1,2M · output 96k · cache 91%
subagentes input 30k · output 4,1k · cache 38%
```

The labels are in Portuguese, like the rest of the interface.

- **Three lines.** `tokens` is the last main-agent turn that reported usage, `sessão` (session) is the session's running total and `subagentes` is the running total of subagent turns, on a line of its own so it does not blur the main agent's (it exists only after the first subagent turn; with no main turn yet, it is the only one).
- **The numbers.** They come from the end of each turn: uncached input, output, cache read and cache written. The `input` shown is everything the model read (uncached + cache read + cache written). The **cache hit rate** is cache read / (cache read + uncached input + cache written), per turn and accumulated (the rate of the sum, not the mean of the rates). When it cannot be computed (output only), the line says `cache --`.
- **Abbreviation.** One formatter abbreviates with a decimal comma: `999`, `12,4k`, `142k`, `1,2M`.
- **Low rate.** Under 50% the line turns red; 50% or more uses the normal color.
- **Turns without usage.** An interrupted turn or one ended by an API error carries no usage and adds nothing; the lines stay as they were (and do not show before the first turn with usage).
- **Model.** The model of the last main-agent turn shows dim beside the active character's name (`Guerreiro Nv.3 sonnet-5-5`, without the `claude-` prefix and the date). If it does not fit it shows only the family (`sonnet`), and if not even that, it is left out.
- **Narrow panel.** Each line takes the longest form that fits: `tokens  input 142k · output 18k · cache 87%`, then `tokens  in 142k · out 18k · 87%`, then `tokens  142k/18k 87%`, then just `tokens  87%`; if not even the last fits, the line is left out.
- **Bottom band.** It does not show the token lines (the compact band's 8 lines still hold); it shows only the dim model beside the name.
- **Memory only.** Nothing is saved to the store, the `/guild trace` log or a toast, and everything starts over with the session.
- **Demo scenes.** All of them show made-up values: `tokens  input 142k · output 18k · cache 87%`, `sessão  input 1,2M · output 96k · cache 91%` and `subagentes input 30k · output 4,1k · cache 38%` (this one in red, to show the low rate), with the model `sonnet-5-5` beside the name. While a scene runs, the real usage is ignored.

## Side panel

On a wide terminal in Claude Code's fullscreen layout (`/tui fullscreen`, 110 columns or more), the guild opens as a **panel to the left of the conversation**:

- the active character at full size, with its stats **beside** it, and the bug right under the stats when a tool call fails;
- the other two characters under them, and a list of the **latest XP payments** (`3min Warrior +6 Edit`);
- the width is yours: drag the panel's edge and the layout follows (stats drop under the character when narrow, then the character shrinks);
- the **×** in the panel's corner closes it and brings the bottom band back; `/guild panel` opens it again.

It opens by itself from 144 columns (110 once you opened it yourself), unless you closed it: the choice is remembered. Where there is no room (a narrow terminal, or the classic non-fullscreen layout) the guild stays as the band above the prompt, so it is never missing.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-explorador.png" alt="Explorer" width="280"><br>Explorer</td>
    <td align="center"><img src="docs/screenshots/panel-mago.png" alt="Mage" width="280"><br>Mage</td>
    <td align="center"><img src="docs/screenshots/panel-guerreiro.png" alt="Warrior" width="280"><br>Warrior</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-bug.png" alt="Bug" width="280"><br>Bug</td>
    <td align="center"><img src="docs/screenshots/panel-cansado.png" alt="Tired" width="280"><br>Tired</td>
    <td align="center"><img src="docs/screenshots/panel-dormindo.png" alt="Asleep" width="280"><br>Asleep</td>
  </tr>
</table>

| Command | Does |
|---|---|
| `/guild panel` | open the side panel and keep opening it |
| `/guild bar` | close the panel and go back to the bottom band |
| `/guild trace [N\|clear]` | print the record of the last N tool calls (default 20): who was on screen, who got the XP (`ERRO` marks a failure, `RECUSADA` a call you rejected), and a summary; `clear` erases it. Only tool names, classes and the program name of a shell command are kept, never prompts, paths, arguments or variables |
| `/guild <scene>` | show a demo scene (`explorador`, `mago`, `guerreiro`, `bug`, `cansado`, `dormindo`); `/guild off` returns to the real session |

## Requirements

- Claude Code with mod support. Developed and tested on **2.1.302**.
- A terminal with truecolor. Tested on **iTerm2** (macOS) and **foot** (Linux), with and without **tmux** (use `set -ga terminal-features ",*:RGB"` or `Tc` if colors look flat).
- For the side panel: the fullscreen layout (`/tui fullscreen`) and 110 columns or more. For the bottom band: 16 rows free above the prompt (the reduced one needs 8).

## Install

Pick one.

**1. From the marketplace in this repo**

```sh
claude plugin marketplace add viniciusilveira/guild-monitor
claude plugin install guild-monitor@guild-monitor
```

**2. Load it from a clone, for one session**

```sh
git clone https://github.com/viniciusilveira/guild-monitor.git
claude --plugin-dir ./guild-monitor
```

**3. Load it from a clone, for every session**

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$HOME/guild-monitor"
```

Restart Claude Code and the guild appears above the prompt.

## Configuration

| Option | Default | What it does |
|---|---|---|
| `sleepAfterSeconds` | `90` | idle time after which the guild falls asleep |
| `tiredAtPercent` | `75` | context filling at which everyone gets tired |
| `bandSize` | `full` | `full`: active character full size (16 rows); `compact`: everyone reduced (8 rows) |
| `layout` | `auto` | `auto`: side panel where it fits, bottom band otherwise; `bar`: only the band; `panel`: only the panel |
| `demo` | `off` | a fixed scene with made-up figures: `explorador`, `mago`, `guerreiro`, `bug`, `cansado`, `dormindo` |
| `showForecast` | `on` | `on`: shows when the 5-hour and 7-day windows run out at the current pace; `off`: hides the forecast |

Set them on install (`claude plugin install … --config bandSize=compact`), with `claude plugin configure guild-monitor`, or in `/plugin`.

The band adapts to the terminal: first the active character, then the stats beside it, then the other two characters. It hides when even the active character does not fit.

### Demo mode

`demo` shows invented numbers (HP 72%, MP 45% with 2h13 to reset, ST 64%, $3.42, a level-4 Warrior, and a forecast: the 5-hour window running out in `~1h30`) in a fixed scene and **ignores the real session and saves nothing**. Handy for screenshots and for a first look. Leave it at `off` for real use.

You do not need to restart to change scenes: type `/guild bug` (or any other scene) and the band switches at once; `/guild off` goes back to the real session. The command changes the scene for the current session only.

## Screenshots of the bottom band

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/explorador.png" alt="Explorer"><br>Explorer</td>
    <td align="center"><img src="docs/screenshots/mago.png" alt="Mage"><br>Mage</td>
    <td align="center"><img src="docs/screenshots/guerreiro.png" alt="Warrior"><br>Warrior</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/bug.png" alt="Bug"><br>Bug</td>
    <td align="center"><img src="docs/screenshots/cansado.png" alt="Tired"><br>Tired</td>
    <td align="center"><img src="docs/screenshots/dormindo.png" alt="Asleep"><br>Asleep</td>
  </tr>
</table>


## Development

To check a change, run the one command that CI runs too (`npm ci` once to install the pinned TypeScript):

```sh
scripts/verify             # type check, tests and plugin validation; stops at the first failure
```

The steps one by one:

```sh
claude plugin test .       # unit tests of the pure modules and of what the band and the panel show
claude plugin validate .   # manifest and hook checks
tsc -p .                   # type check (see below)
node scripts/build-sprites.mjs   # rebuild hooks/sprites.generated.ts from art/
```

- `.claude-plugin/types/` holds the Claude Code type declarations, which the engine writes there when it loads the plugin as a mod. It is git-ignored; `tsc -p .` needs it, so `scripts/verify` stops with a message when it is missing (CI sets `VERIFY_SKIP_TYPES=1` and skips the type check).
- `scripts/engine-check` runs one short `claude -p` session with the installed plugin and checks that its hooks wrote the trace log. It needs a logged-in Claude Code, so it is for a developer machine, not for CI.
- All the logic is in small pure modules with tests: `classify.ts` (who is on stage), `guild.ts` (animation states and the bug), `counters.ts` (combo and defeated bugs, and the counters line), `forecast.ts` (when the usage windows run out), `xp.ts` (XP and levels), `tracker.ts` (everything the guild remembers), `view.ts` (what the band shows), `doing.ts` (verbs and targets of the line), `layout.ts`, `raster.ts` (sprite → half-block cells), `gold.ts` (gold split by class), `tokens.ts` (tokens, cache hit rate and abbreviated numbers), `demo.ts`. Only `register.tsx` and `render.tsx` talk to the engine.
- The mod runs without Node or a DOM, so it cannot decode PNG. `scripts/build-sprites.mjs` reads the Aseprite export in `art/` and writes the frames as data (`hooks/sprites.generated.ts`), plus a half-size version of each one for the small characters.
- The art was made in Aseprite (32×32 frames, one shared 21-color palette).

## Roadmap

- A short status line for when the band is hidden.

## License

[MIT](LICENSE), code and art alike. Not affiliated with, endorsed by or sponsored by Anthropic.
