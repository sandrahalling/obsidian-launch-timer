#!/usr/bin/env python3
"""
Launch Timer — the no-plugin version.

Reads a vault and writes one note, "Launch Board.md", listing everything that
has a T-zero date, sorted so the thing furthest past its window is on top.

What counts:
  - a note with front matter   t0: 2026-10-08
  - an unchecked task line     - [ ] Do the thing #tag [t0:: 2026-10-08]
  - a checked task line with a [tc:: date] completion field goes in a Done
    section, showing where on the clock it landed:
                               - [x] Did it [t0:: 2026-10-08] [tc:: 2026-10-05]
                               → ✓ T-3

Counter = today - t0.  Negative before the window closes, 0 on the day,
then it keeps counting up. Nothing is stored except the date.

By default the only file it writes is the board. With --convert it will also
turn bare numbers into dates in place:
  [t0:: 14]  → [t0:: <today + 14>]
  t0: 14     → t0: <today + 14>
It prints every file it changes.

Usage:
  python3 launch_timer.py /path/to/vault
  python3 launch_timer.py /path/to/vault --convert
  python3 launch_timer.py /path/to/vault --out "Some Folder/Board.md"

Standard library only. Python 3.8+.
"""

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

BOARD_DEFAULT = "Launch Board.md"

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)
FM_T0_RE = re.compile(r"^t0:\s*['\"]?(-?\d+|\d{4}-\d{2}-\d{2})['\"]?\s*$", re.M)
OPEN_TASK_RE = re.compile(r"^\s*[-*+]\s\[ \]\s")
DONE_TASK_RE = re.compile(r"^\s*[-*+]\s\[[xX]\]\s")
COMPLETION_RE = re.compile(r"\[tc::\s*(\d{4}-\d{2}-\d{2})\s*\]")
TAG_RE = re.compile(r"(?<![\w&/])#([\w/-]+)")
INLINE_DATE_RE = re.compile(r"\[t0::\s*(\d{4}-\d{2}-\d{2})\s*\]")
INLINE_NUM_RE = re.compile(r"\[t0::\s*(-?\d+)\s*\]")
SKIP_DIRS = {".obsidian", ".trash", ".git"}


def label(n):
    if n < 0:
        return f"T{n}"
    if n == 0:
        return "T0"
    return f"T+{n}"


def counter(t0, today):
    return (today - t0).days


def parse_date(s):
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def md_files(vault, board_path):
    for p in vault.rglob("*.md"):
        rel = p.relative_to(vault)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if p.resolve() == board_path.resolve():
            continue
        yield p


def convert_numbers(text, today):
    """Turn bare-number t0 values into dates. Returns (new_text, count)."""
    count = 0

    def inline_sub(m):
        nonlocal count
        count += 1
        return f"[t0:: {(today + dt.timedelta(days=int(m.group(1)))).isoformat()}]"

    text = INLINE_NUM_RE.sub(inline_sub, text)

    fm = FM_RE.match(text)
    if fm:
        block = fm.group(1)
        m = FM_T0_RE.search(block)
        if m and re.fullmatch(r"-?\d+", m.group(1)):
            new_date = (today + dt.timedelta(days=int(m.group(1)))).isoformat()
            new_block = block[: m.start()] + f"t0: {new_date}" + block[m.end():]
            text = text[: fm.start(1)] + new_block + text[fm.end(1):]
            count += 1
    return text, count


def link(vault, path):
    rel = path.relative_to(vault).with_suffix("").as_posix()
    if rel == path.stem:
        return f"[[{rel}]]"
    return f"[[{rel}\\|{path.stem}]]"  # escaped pipe, because it sits in a table


def clean_task_text(line):
    text = OPEN_TASK_RE.sub("", line, count=1)
    text = DONE_TASK_RE.sub("", text, count=1)
    text = INLINE_DATE_RE.sub("", text)
    text = COMPLETION_RE.sub("", text)
    text = TAG_RE.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip().replace("|", "\\|")


def tags_of(line):
    return " ".join("#" + t for t in TAG_RE.findall(line))


def main():
    ap = argparse.ArgumentParser(description="Write a Launch Board note from t0 dates in a vault.")
    ap.add_argument("vault", type=Path)
    ap.add_argument("--out", default=BOARD_DEFAULT, help="board path, relative to the vault")
    ap.add_argument("--convert", action="store_true", help="rewrite bare-number t0 values as dates")
    ap.add_argument("--today", help="pretend today is YYYY-MM-DD (for testing)")
    args = ap.parse_args()

    vault = args.vault.expanduser()
    if not vault.is_dir():
        sys.exit(f"Not a folder: {vault}")
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    board_path = vault / args.out

    rows = []  # (counter, t0, what, tags, where)
    done = []  # (landed, t0, completion, what, tags, where)
    for path in md_files(vault, board_path):
        text = path.read_text(encoding="utf-8")

        if args.convert:
            new_text, n = convert_numbers(text, today)
            if n:
                path.write_text(new_text, encoding="utf-8")
                print(f"converted {n} in {path.relative_to(vault)}")
                text = new_text

        fm = FM_RE.match(text)
        if fm:
            m = FM_T0_RE.search(fm.group(1))
            if m:
                t0 = parse_date(m.group(1))
                if t0:
                    rows.append((counter(t0, today), t0, link(vault, path), "", ""))

        for line in text.splitlines():
            m = INLINE_DATE_RE.search(line)
            if not m:
                continue
            t0 = parse_date(m.group(1))
            if not t0:
                continue
            if OPEN_TASK_RE.match(line):
                rows.append((counter(t0, today), t0, clean_task_text(line), tags_of(line), link(vault, path)))
            elif DONE_TASK_RE.match(line):
                c = COMPLETION_RE.search(line)
                finished = parse_date(c.group(1)) if c else None
                if finished:
                    done.append(((finished - t0).days, t0, finished, clean_task_text(line), tags_of(line), link(vault, path)))

    rows.sort(key=lambda r: (-r[0], r[2].lower()))
    done.sort(key=lambda r: r[2], reverse=True)

    out = [
        "# Launch Board",
        "",
        f"Generated {today.isoformat()} by launch_timer.py. Rerun to refresh. Edits here get overwritten.",
        "",
        "| T | What | Tags | Where | T-zero |",
        "|---:|---|---|---|---|",
    ]
    for n, t0, what, tags, where in rows:
        out.append(f"| {label(n)} | {what} | {tags} | {where} | {t0.isoformat()} |")
    if not rows:
        out.append("| | Nothing open has a t0. | | | |")
    if done:
        out += [
            "",
            "## Done",
            "",
            "Where on the clock each one landed. ✓ T-3 means done three days before T-zero.",
            "",
            "| Landed | What | Tags | Where | Done |",
            "|---:|---|---|---|---|",
        ]
        for n, t0, finished, what, tags, where in done:
            out.append(f"| ✓ {label(n)} | {what} | {tags} | {where} | {finished.isoformat()} |")
    out.append("")

    board_path.parent.mkdir(parents=True, exist_ok=True)
    board_path.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {board_path.relative_to(vault)} ({len(rows)} items)")


if __name__ == "__main__":
    main()
