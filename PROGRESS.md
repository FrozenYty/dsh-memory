# Progress

> Append-only. One dated entry per day; never edit an older one.

Why a thing was decided, and how it was checked, lives here. What a person who installs the bundle gets
lives in `CHANGELOG.md`; what is still owed lives in `PLAN.md`. Nothing is written in two of them for the
same reason.

**The record starts here, not at the beginning.** This repository's history before 2026-11-15 is in
`CHANGELOG.md`, which carries both the release notes and, in its longer entries, the reasoning. This file
takes over the second job from here on so the changelog can stay a release note.

## 2026-11-16

- **The lesson came from a sibling, and it cost it twelve tools.** `dsh-team` 0.43.35 registers none of its
  own tools against `@deepseek-ai/dsh` 0.2.2-rc.3: `ctx.agentTeams.tryMembership` no longer exists, that
  call sits in a loop inside `apply`, and one unguarded `TypeError` stops the whole bundle activating.
  **The user sees every tool vanish and no message that says why.**

  Established from three independent sources, which is why I state it: a scan of all 1259 files under the
  installed `@deepseek-ai` tree found **zero** occurrences of the name; `listService` describes the service
  as six members; and the package's own source registers it with `super(ctx, "agentTeams")` and declares
  exactly those six.

- **This plugin already had the right shape and no test for it.** `index.js` probes three required host APIs
  and throws a named error, returns early when the optional service is absent, and catches around the
  optional call. **That is correct and it was accidental** — nothing would have noticed if a later change
  had removed the guard, which is the same distance from the crash as the sibling was.

- **The first two versions of the new test could not fail, and the reason is worth keeping.** Both hid
  `tokenMeter` entirely, so `apply` reached the early return `if (meter === undefined) return ''` and the
  `try`/`catch` was never executed. Deleting the guard left the test green. **The case that kills a bundle
  is the other one** — the service resolves and its member was renamed — and only that case reaches the
  guarded line. With it, deleting the `try`/`catch` fails with
  `meter.contextPressure is not a function`, **the exact production message from the sibling.**

  **Three times today a check passed because it never reached the code it guarded.** A regex would have
  been worse, not better: it cannot tell the two states apart at all.

- **`docs/host-compatibility.md` is deliberately not a document pair.** Every other file under `docs/` is
  an `-en`/`-zh` pair, and this one is not, because it exists to be **forwarded to other bundle
  maintainers** who are not this repository's readers. A translation would be a second copy to keep in
  step for an audience that will copy the English text anyway. `check-docs` rule (i) does not apply to the
  shape, and `check-paths` scans it like any other document.

- **The forwarding rule was applied, not remembered.** The draft was grepped for a drive letter before it
  was finished: a path that resolves here does not resolve for the person receiving it, and that failure is
  invisible to the sender by construction.


- **Rule (h) covered one file and claimed to cover the language.** It checked `README.md` for Chinese and
  stopped there, with a comment explaining that tokeniser examples made `docs/` impossible to check. That
  was true only while the rule had no way to tell a **quotation** from **prose** — and it does: a line
  that is mostly Chinese is a sentence someone forgot to write in English, while `mcp挂了` inside a long
  English line is a quotation. **The rule now covers `README.md` and every `-en.md`, five files.**

- **Nothing needed editing, and that is the finding rather than a disappointment.** All five files were
  already right: every Chinese line in them is a quotation, the densest being 19%. So this change adds no
  fix — it makes the next mistake visible. **A rule added after a defect and a rule added before one look
  identical in the diff and are not the same work**, and saying which one this is matters to whoever reads
  it later.

- **The threshold is a ratio because a list would drift.** Forty percent: quotations sit far below it,
  Chinese prose far above. The alternative — naming the permitted phrases — is the mechanism this
  repository has chosen by mistake more than once (a second copy of a fact, a second place to keep in
  step). **A ratio cannot go stale**, and the failure message prints the share (`92% Chinese`) so the
  verdict is arguable rather than mysterious.

- **Proved by writing the defect**: a Chinese sentence in `docs/architecture-en.md` makes the rule fail
  naming `docs\architecture-en.md:43 (92% Chinese)`, and restoring returns it to green. **Two of my four
  new rules this session were wrong in a way only a failed proof could show** — the Chinese-prose rule
  passed a file containing its own defect until the threshold dropped from four words to two.


- **The Chinese README had drifted into English, and the gate that should have caught it was one-way.**
  Four phrases — `system prompt`, `toolchain`, a bare `recall`, `profile bundle` — sat inside Chinese
  sentences. Rule (h) checked that `README.md` carried no Chinese; **nothing checked the reverse**, so the
  drift was invisible by construction rather than by oversight.

  Two numbers were wrong in both files as well: the stated version was `v0.23.2` while `package.json` said
  0.27.0, and the verify block said **88** mutations where the scan holds **92**. **The README is the one
  document a reader trusts without checking**, which is exactly why its numbers are the worst ones to
  leave stale.

- **The new rule failed to fail twice before it worked, and both failures are worth keeping.**

  First version demanded **four** consecutive English words. The defect is `system prompt` — two — so the
  rule passed a file containing precisely the thing it was written for. **A check that has never failed
  is not a check**, and this one had been written to look right rather than to catch.

  The fix was two words, which then flagged `DeepSeek Harness` and `Claude Code`. The separator I used is
  **case**: proper names are capitalised and a prose phrase inside a Chinese sentence is not, so the rule
  matches lower-case runs only. **That costs no allowlist** — and an allowlist is the part that would have
  drifted next, which is the failure mode this repository keeps producing.

  Proof it bites: putting the sentence back makes it fail naming `line 13: "profile bundle"` and
  `line 126: "system prompt"`; restoring returns it to green.

- **`profile bundle` was in my own "keep this" list and the rule overruled me.** I had decided it was a
  DSH term worth leaving in English; the sentence reads fine without `profile`, so the term was habit
  rather than need. **The rule being stricter than my first judgement is the point of writing it as a
  rule.**

- **`(i)` was never in the script's own header list**, alongside the new `(j)`. Both are documented now:
  a script that describes its rules incompletely leaves the next reader to infer them from the code.


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
