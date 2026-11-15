# Progress

> Append-only. One dated entry per day; never edit an older one.

Why a thing was decided, and how it was checked, lives here. What a person who installs the bundle gets
lives in `CHANGELOG.md`; what is still owed lives in `PLAN.md`. Nothing is written in two of them for the
same reason.

**The record starts here, not at the beginning.** This repository's history before 2026-11-15 is in
`CHANGELOG.md`, which carries both the release notes and, in its longer entries, the reasoning. This file
takes over the second job from here on so the changelog can stay a release note.

## 2026-11-15

- **One local entry point, `scripts/check.mjs`, and it contains no checks (P0-03).** It runs the ten
  commands CI runs, in order, reports each by name, and exits non-zero naming the one that failed. Every
  rule still lives in the script that owns it — a second copy in the aggregator would be a second thing to
  keep in step, which is the failure mode this repository keeps producing. Verified: 9 of 9 steps pass on a
  clean tree; removing `meta.description` from `locale/zh.json` makes it exit 1 naming
  `documents · ADRs, links, locales, version, policy copies`; restoring that key returns it to 0.

- **Four attempts to capture a child process's output failed before the fifth worked, and the working
  shape was already in this repository.** This sandbox denies the named pipe a captured child needs:

  | attempt | what happened |
  |---|---|
  | `spawnSync(node, args, { encoding: 'utf8' })` | `stdout: undefined`; every step read as failed |
  | `stdio: 'pipe'` | `error: EPERM spawnSync …` — the child is refused, not the check |
  | `spawnSync('cmd', ['/c', '"<node>" … > file'])` | `cmd` re-escapes the quotes into `\"…\"` and cannot find the command |
  | `execFileSync('cmd', ['/c', 'node … > file'])` | `cmd` rejects the redirected path: *"The filename, directory name, or volume label syntax is incorrect"* |

  `check-commit-messages.mjs` already solves it — **hand the child a file descriptor**,
  `stdio: ['ignore', out, err]` — and that is what the aggregator uses now. **Four rounds were spent
  guessing at quoting and paths; the answer was one `openSync` away, in a sibling script.** The lesson is
  the same one the notebook keeps recording: when a mechanism refuses, look for a caller that already
  succeeds rather than reasoning about the refusal.

- **`PLAN.md` and `PROGRESS.md` were added, and the three records were given distinct jobs** in
  `AGENTS.md` §4: the task board answers *what is still owed and how each item is proved*, this file
  answers *what changed and how it was checked*, and `CHANGELOG.md` answers *what an installer gets*. The
  earlier reading — that this repository did not need a task ledger because it is one person's and
  conversation-driven — was defensible but had never been written down, so every new session re-derived
  it. **A decision that is not recorded is re-litigated**, which costs more than the file.

- **Two premises of the brief that asked for this work did not survive checking**, and both were recorded
  rather than worked around:
  - it described CI as "the six checks plus a syntax pass"; CI also runs `tests/core.test.mjs`, so the
    aggregator runs seven checks and the acceptance criterion of an exact set match settles it;
  - it placed `cache-probe.mjs` behind `--full` while also requiring the gate to touch no network. That
    probe calls a paid API, so it sits behind `--probe` and `--full` does not include it. `--full` also
    warns that `mutation-scan.mjs` edits the source it mutates, because a gate that leaves a mutation
    behind on Ctrl-C would be worse than a slow one.

- **The `recalls` field became `sessions`** (`0.24.0`), because it counted sessions reached and read as
  times recalled; the tool's own description already said so. This is the third time in this repository
  that a name and its behaviour disagreed in a way nothing checked.

- **Two scripts were nearly made into gates that would have reported a working system as broken.**
  `eval-hostile` exits 1 whenever any case marked "silent" fires — it currently reports 6 of 18, and that
  six is *why* `recallEnabled` is false, not a defect. `cache-probe` reports a measurement and calls a paid
  API. Both are now behind `--instruments`, and the split between `--full` and it is by **kind** (a gate
  exits non-zero only on a fault) rather than by speed, which was the first and wrong organising idea.

- **The mutation scan takes about five seconds, not the ten minutes this work assumed.** Discovered by
  running `--full` rather than reasoning about it; the documentation had already been written claiming
  otherwise. **A number nobody measured is a number that will be wrong**, which is the same lesson as the
  withdrawn cache figure two days earlier.

- **The icon was redrawn in the palette the sibling plugins share** (`0.24.1`): `#1b3a5c` card, `#7fd1ff`
  body, `#ffd479` accent. Three plugins used the same three hex values and this one used none of them.
  Rendered with PIL before committing — Chromium cannot start in this sandbox, its mojo platform channel
  being the same denied pipe — so the comparison sheet is a re-statement of each icon's primitives, not a
  faithful render, and that limitation is in the changelog too.

- **A measurement that had been published as fact was withdrawn.** `0.23.7` reported that a one-character
  change at the head of the index recomputed all 4160 cached tokens. The run's own warm baseline reported
  `cached 0`, so the figure it was subtracted from was inferred. Once the probe could establish a real
  baseline, the four positions measured repeatably — 4032 at the head, 640 at the tail of a section, 576
  at the head of the history, 0 at its tail — and the original claim survived in shape and not in detail.
  **Two withdrawals in two days, both the same mistake: reading a plausible number as a fact.**
