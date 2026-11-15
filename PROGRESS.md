# Progress

> Append-only. One dated entry per day; never edit an older one.

Why a thing was decided, and how it was checked, lives here. What a person who installs the bundle gets
lives in `CHANGELOG.md`; what is still owed lives in `PLAN.md`. Nothing is written in two of them for the
same reason.

**The record starts here, not at the beginning.** This repository's history before 2026-11-15 is in
`CHANGELOG.md`, which carries both the release notes and, in its longer entries, the reasoning. This file
takes over the second job from here on so the changelog can stay a release note.

## 2026-11-16

- **The notebook's directory was whatever workspace happened to be open, and that is now fixed (ADR 0019).**
  `workspaceDir` defaulted to `'.agents/memory'` — a relative path — and `resolveDirs` did
  `resolve(cwd, config.workspaceDir)`. So 79 entries lived in the workspace's `.agents/memory` for no
  better reason than that being the workspace. Move the repository, and the notebook moves with it while the old
  notes stay behind looking like they were never written. **Nothing errors and nothing warns**; the loss
  reads as a decision the user made.

  The new order is three legs — configured field, `DSH_MEMORY_DATA_DIR`, `~/.agents/memory` — computed on
  every call, with `cwd` accepted and `void`-ed. **The cheapest part of the fix was making
  `workspaceDir` default to `''`**, because while it held a path there was no way to distinguish "the user
  configured this" from "the default has this value", and the environment leg could never be reached.

- **The directory is `memory`, not `dsh-memory`, and the user had to tell me.** `~/.agents/cleaner/` is
  where `dsh-cleaner` keeps its trash — the family drops the package prefix. I had written the full
  package name from the brief's `<插件名>` and never checked what the sibling actually did. **That is the
  `reuse-the-product-seam` lesson in its cheapest possible form: one `Get-ChildItem` would have settled
  it, and I wrote three files before looking.**

- **Three tests were quietly relying on where they stood.** Once the default stopped following the process
  cwd, the evidence-writing tests put `INDEX.md`, `long-evidence.md`, `all-cut.md`, `long-body.md`,
  `long-title.md` and `short-evidence.md` **into the repository root** — which is how I found them, as
  untracked files in `git status`. The plugin had exactly this defect; the tests had it too. Every test
  config now carries an absolute path, and one test asserts that two decoy working directories yield the
  same directory and the same entry count.

- **The budget test had to change, and that was a real consequence rather than an inconvenience.** The
  index header names the notebook's absolute path, which is ~70 characters longer than `'notebook'` was.
  At a 400-character budget the header alone is 307, so `tight.text.length <= 400` became unsatisfiable.
  **I widened the assertion rather than shortening the path** — knowing where the data lives is the point
  of this change, and a test that forced it out of the header would have been protecting the wrong thing.

- **The migration was a permissioned operation and I treated it as one.** Writing to `~/.agents/memory`
  was denied by the workspace fence — **not by an ACL**: `FrozenYty` has `FullControl` there, and
  `~/.agents/cleaner` already holds files a plugin wrote. So the plugin can write where my shell cannot,
  which is worth knowing. I asked before moving the data, copied rather than moved, and left both copies
  of all 80 files.

- **Verified from the code, not the filesystem**: `resolveDataDir` returns the home-relative
  `~/.agents/memory`; 78 entries load from it (79 `.md` files, one of which is the index);
  `diagnoseNotebook` reports `status: "ok"` with `problems: []`; and two decoy working directories change
  neither the directory nor the count.


- **The traceability table was already lying in five places, and nothing had noticed (P3-01).** The new
  `scripts/check-traceability.mjs` compares every test name quoted in the table against what the suite and
  the mutation scan actually declare. On its first run it found five rows whose quote exists nowhere:

  | row | quoted | actually |
  |---|---|---|
  | ADR 0005 | `a memory needs evidence` | `the entry carries its evidence` |
  | ADR 0009 | `index is derived, not hand-maintained` | `the derived index has no stale lines` |
  | ADR 0012 | `broken is not the same as empty` | `a notebook that was never created is absent, not broken` |
  | ADR 0014 | `the budget caps residency, not capacity` | `index respects the char budget` |
  | ADR 0015 | `a read through the tool is counted as usage` | `a reached entry is counted` |

  **This is the most expensive kind of stale reference**, because a row pointing at nothing is
  indistinguishable from a row pointing at something — the table is read *as* evidence, and it was
  evidence for a suite that no longer existed in that shape.

- **The check found its own blind spot before the PR did.** A first version read only
  `traceability-en.md`; the Chinese file is a translation of the same rows and would have been left
  unguarded. Extending it to both was not politeness — **guarding one copy of a fact is exactly the defect
  the table itself had just exhibited.**

- **The `(§12)`, `(§15)`, `(§13)`, `(§20)` markers in those rows pointed at nothing either.** They occur
  nowhere else in the repository: `test-plan-en.md` numbers its sections `## 1.`, and the suite has no
  numbered sections. Removed with the names. **A check cannot police that kind of pointer** — it is a
  citation to a document that no longer has that shape — so it is recorded rather than guarded, which is
  the same choice the traceability table itself makes in its second section.

- **Two mistakes of my own, both already written down in the workspace contract.** `node -e` inside
  PowerShell was eaten three times tonight (quotes become `\"`, `||` becomes a pipeline), and a
  `Get-ChildItem -Recurse -Include *.mjs,*.js` search silently matched **zero files** without a trailing
  `\*` on the path, which produced a confident and wrong "none of these exist anywhere". **§7 of the
  workspace `AGENTS.md` had just been written for the first one, and it was still hit** — a rule that is
  read does not replace a habit that is formed. The second is new and belongs in that section.

- **`check.mjs` is now 10 steps and CI carries the tenth.** Verified by renaming one label in the suite:
  the check exits 1 naming `docs/traceability-en.md:21  ADR 0005  "the entry carries its evidence"`, and
  restoring the label returns it to 0.

- **The repository moved from `DSH_FILES\` to `DSH_PLUGINS\`, and nothing in it changed.** The move was
  the workspace's decision, not this repository's: `AGENTS.md` §2 grew a **Plugin source** clause holding
  that code which is linked into a profile and runs in every session is infrastructure rather than output,
  and therefore does not live among the files a session produces. **The reason is recorded there, in the
  workspace contract; this entry records that it happened and how it was checked**, because a repository
  cannot cite its own location as evidence for its own location.

  What moved is the directory. What did not move is anything a reader or an installer sees: no file
  content, no version, no `package.json`, no profile patch beyond the `link:` targets, which the workspace
  repointed before this check ran. The four junctions under the profile's `node_modules` were rebuilt and
  now resolve to the new path.

  Verified: **`node scripts/check.mjs` → 9 of 9, exit 0**, and `--full` → 11 of 11, exit 0, both run from
  the new path. `grep DSH_FILES` over the whole repository returns **one** hit, and it is prose rather than
  a path: `tests/fixtures/notebook/low-integrity-label-writes.md` records that at the time of that
  diagnosis `.agents` carried a low integrity label and `DSH_FILES` and five siblings did not. That
  sentence was true when written, `DSH_FILES` still exists, and editing it would damage the evidence rather
  than update it. `package.json` reads through the junction
  (`dsh-memory`, `0.25.0`), so the link is live rather than a stale copy.

- **The gate turned out to be location-independent, which was not designed for and is worth keeping.**
  `scripts/check.mjs` resolves the repository root from `import.meta.url`, and `check-commit-messages.mjs`
  derives its range from `git merge-base origin/main HEAD`. Neither hardcodes a path, so the move needed no
  edit to either — **the first real event this gate met was one it could not have been written to expect,
  and it passed because it asks the filesystem instead of remembering.** That is the property
  `AGENTS.md`'s "look before you move" is trying to produce, observed rather than asserted.

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
