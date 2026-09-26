# Launch Timer

Task tools want a date. Knowledge work doesn't keep dates. You plan something for Tuesday, Tuesday goes sideways, and now you're re-shuffling four other things to make room for it.

Launch Timer swaps the date for a **window**. Give a task 14 days. It counts down like a launch clock (T-14 … T-1), reaches **T0**, and then keeps counting up (T+1, T+2 …). Nothing alarms. Missing the window only flips the sign, and sorting by the count floats neglected things to the top without any rescheduling.

- **One stored value:** a T-zero date under the key `t0`. The count is always calculated, never stored.
- **Working on something doesn't touch it.** Only you change the date.
- **No lock-in.** Everything written is a plain date. Turn the plugin off and nothing is lost.

## What's here

| Path | What it is | Needs |
|---|---|---|
| `manifest.json`, `main.js`, `styles.css` | The Obsidian plugin | Obsidian 1.4+ |
| `scripts/launch_timer.py` | Builds a "Launch Board" note from the whole vault | Python 3.8+, standard library only, no plugins |
| `examples/Launch Dashboard (Dataview).md` | Dataview dashboard: open tasks, grouped by tag, grouped by note, done, notes | Dataview (plain DQL, no JS queries) |
| `examples/Launch Timer.base` | Obsidian Bases view for notes with `t0` | Core Bases plugin |
| `examples/Example meeting.md` | Sample tasks to try it on | — |

Each piece works on its own. Use any combination.

## The syntax

On a task line (Dataview inline field):

```markdown
- [ ] Draft the call for papers #symposium [t0:: 2026-10-08]
```

On a whole note (front matter):

```yaml
---
t0: 2026-10-08
---
```

When a task with a `t0` is checked off, the plugin adds Dataview's own completion field, `[completion:: 2026-10-05]`. Unchecking removes it.

## The plugin

### Install
1. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
2. In your vault, create the folder `.obsidian/plugins/launch-timer/`. The `.obsidian` folder is hidden; on a Mac, press Cmd+Shift+. in Finder to show it.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. In Obsidian: Settings → Community plugins → turn on **Launch Timer**. If it isn't listed, press the reload button next to "Installed plugins".

No build step. `main.js` is plain, commented JavaScript, so read it before you trust it.

### Commands
- **Set launch window on this task**: cursor on a checkbox line → type a number of days → writes `[t0:: date]`
- **Set launch window on this note**: type a number of days → writes `t0` in front matter
- **Clear launch window on this note**

### The badge
Five dots on a fixed 21-day scale. No number.

The row always reads left to right, like time passing.

- **Before T0:** grey dots sit at the right end, and empty slots fill in from the left as T0 approaches. Five grey means 17+ days out; one grey dot at the far right means about a day.
- **At T0:** five empty outlines.
- **After T0:** dots in your accent colour (Settings → Appearance → Accent color) grow from the left, with empty slots on the right. Five means 17+ days past.
- **Done:** frozen where it landed, dimmed, with a ✓.

Hover a badge to see the number and the date.

- **Live Preview:** the badge stands in for the date. Put the cursor on the line, or click the badge, to see and edit the raw text.
- **Source mode:** always raw text, no badges.
- **Reading view** and **Dataview** results show the badge too.
- The **status bar** shows the badge for the current note's `t0`.

### Settings
- **Badge stands in for the date.** Off keeps the date visible with the badge beside it.
- **Show the number beside the dots.** Off by default.
- **Stamp completion date.** Adds and removes `[completion:: date]` as tasks are checked and unchecked.

## The script

For people who'd rather not run plugins.

```bash
python3 scripts/launch_timer.py /path/to/vault
```

It reads every unchecked task with a `[t0:: date]`, plus notes with `t0` in front matter, and writes `Launch Board.md` at the vault root. The board has a table sorted furthest-past-the-window first, with tags and a link back to each task's note, and a Done section showing where each finished task landed. It changes no other files.

Options:
- `--convert` also rewrites bare numbers, so `[t0:: 14]` or `t0: 14` becomes today + 14. It prints every file it changes.
- `--out "Folder/Board.md"` writes the board somewhere else.
- `--today 2026-10-01` pretends it's another day, for testing.

If the script changes a note that's open in Obsidian, close and reopen the note to see the change.

## The Dataview dashboard

Copy `examples/Launch Dashboard (Dataview).md` into your vault. The count math goes through milliseconds, because Dataview splits a date difference into months plus days, so `.days` alone would be wrong past a month. With the plugin on, the T column shows dots. Without it, you see the raw date, still correctly sorted.

## Credit

The idea: a partner's wish for a task clock that doesn't punish a missed Tuesday. Built by Sandra with Claude, 2026.
