# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.3] — 2026-11-12

### Added

- **The mutation scan goes from 39 to 68.** The first pass covered the fixes; this one covers the
  machinery the fixes sit on — **tokenising, scoring, selection, rendering, message extraction**. The
  second batch found **29 mutations and all 29 were killed too**, so the answer did not change, but the
  evidence is now 68 lines of it instead of 39.
- **`scripts/assertion-strength.mjs`** — the other half of the question. Mutation scanning asks whether
  the suite notices a broken line; this asks whether an **assertion is capable of failing at all**.
  **158 checks parsed, 2 suspicious, both legitimate** (`created === true` where `created` is a boolean).

### Notes

- **The first version of the assertion analyser was wrong** and reported six suspicions that were not
  there: it took everything up to the closing paren as the condition, so the **third** argument — the
  failure message — was analysed as if it were the assertion. `?? '(no summary line)'` looked like a
  masked assertion when it was only the text shown on failure. Splitting arguments by bracket depth
  fixed it.
- **A mutation that does not apply is worse than no mutation.** Three of the first batch silently did
  nothing because the code I quoted from memory was not the code in the file; the scanner reported them
  as "did not apply", which is the only reason they were noticed. It now reports that count separately
  and exits non-zero if any fails to apply.

## [0.18.2] — 2026-11-12

### Added

- **`scripts/mutation-scan.mjs`** — breaks one thing at a time and reports whether the suite notices.
  **39 mutations, 39 killed, 0 survived.** The point is not the number: it is that "the tests pass" and
  "the tests would fail if this broke" are different claims, and only the second one is worth anything.
  A survivor is a question, not a verdict — the scan cannot distinguish an uncovered line from an
  equivalent change.

### Notes

- **39 mutations over 900 lines is a sample, not a proof.** It says every construct it touched is
  defended. It does not say the untested remainder is. The honest reading is *"nothing I broke went
  unnoticed"*, not *"nothing is broken"*.
- **The scan restores both sources after every mutation and re-verifies the restore at the end**, then
  the caller compares hashes against a backup. A tool that edits your source and can leave it broken on
  a crash is worse than no tool; this one has been run eleven times today without a scratch.

## [0.18.1] — 2026-11-12

### Added

- **Mutation-tested coverage for the last two fixes.** Reverting the 0.18.0 code to its pre-fix state
  left the suite green for two of the five defects: **the UTC date and the multi-directory wiring** had
  no test that could fail. Both are now covered — the machine tier being seeded and index-synced is
  asserted through the section callback that actually does it, and the date has a **static** guard
  because a runtime assertion can only catch a UTC regression between 00:00 and 07:59 local time. For
  the other sixteen hours the two calendars agree and it passes either way; that is exactly how three
  `toISOString()` call sites survived a suite that looked comprehensive.
- **The static guard caught a fourth `toISOString` reference immediately** — in a comment. Comment
  text is stripped before the check, because the fix's own explanation names the function it replaced.

### Notes

- **Reverting the fix and re-running the suite is now how a fix gets called done.** A test that cannot
  fail is not coverage; it is the appearance of it. Eight tests now fail on the pre-0.18.0 code, one
  per defect.

## [0.18.0] — 2026-11-12

### Fixed

A full audit of the write path, the date handling and the multi-directory handling. Four defects, and
one of them was destroying data that another change had just started relying on.

- **An update erased the entry's `summary`.** `writeEntryFile` rewrote the frontmatter from scratch and
  only knew three keys, so `summary:` — which the index shows, and which makes an entry more than a
  filename — disappeared on any update while the body survived. **Every frontmatter key the author added
  was lost the same way.** Fixed by carrying the existing metadata through and taking ownership only of
  `status`, `updated`, `triggers` and `summary`, the same way `setStatus` already did.
- **`memory_write` had no way to set a summary.** The index reads it, no tool wrote it, so it could only
  be added by hand-editing the file. There is now an optional `summary` parameter; omitted on an update
  it preserves the existing one rather than clearing it.
- **Dates were UTC.** Three call sites used `toISOString().slice(0, 10)`, which is the UTC day — so a
  write between 00:00 and 07:59 in +08 was recorded as the **previous day**, and `memory_audit` would
  age it from a date the author never wrote it. Now uses the local calendar.
- **Several code paths read only the first configured directory.** Policy seeding, index syncing, read
  telemetry and `memory_usage` all took `resolveDirs(...)[0]`. With `machineDir` configured that meant
  the machine tier was never seeded, never index-synced, its reads were logged against the *workspace*
  log, and `memory_usage` could never see that its entries were used. All four now cover every
  configured directory.
- **The same directory named twice was scanned twice**, which made `memory_usage` read one log twice and
  double every count. `resolveDirs` now deduplicates on the resolved path.

### Added

- **Nine checks for path resolution**, a group with no direct coverage before — it was reached only
  indirectly, and the multi-directory bugs lived exactly there.

### Notes

- **`diagnoseNotebook` still reports only the first directory.** Merging two notebooks into one health
  report is a real design question rather than a one-line fix, and `machineDir` is off by default; it
  is recorded in the PR instead of guessed at.
- **`notebook-policy.md` carries no `updated`**, deliberately: the policy is the notebook's rules, and
  rules do not age. The absence is why `memory_audit` ignores it.

## [0.17.1] — 2026-11-12

### Fixed

- **A usage log written without a trailing newline read as empty.** Any tool that rewrites a file
  without newlines — an editor, a script, `Set-Content -NoNewline` — makes the next append land on the
  same line as the previous record. One line holding two objects parses as neither, so **the whole log
  returned zero**, not just the damaged record. A 10KB file with 183 records reported `recorded: 0`
  while every byte of it was intact.
- **`recordUsage` now terminates the last line before appending**, so it cannot create the condition;
  **`readUsage` splits several records on one line**, so a log written wrong by something else still
  reads right. Both are covered by tests that failed before the change: the first reproduces the exact
  string this repository produced, `{"d":"2026-01-01","e":"first"}{"d":"2026-11-12","e":"second"}`.

### Notes

- **The failure was invisible in every way that usually signals one.** The file existed, its size was
  correct, writes reported success, and the tool that reads it returned a well-formed empty result. It
  was found by noticing that `recorded` had gone from 183 to 0 between two calls.
- **This is the second time a fallback that always succeeds hid a bug.** The first was `summary:` doing
  nothing while the index rendered fine; here an unreadable log looks exactly like a notebook nobody has
  used. `memory_usage` reporting zero is now worth reading twice.

## [0.17.0] — 2026-11-12

### Changed

- **The index now carries a one-line summary per entry, and its budget rises from 1400 to 2800.**
  Supersedes [ADR 0002](docs/adr/02-filename-index-without-descriptions.md), which chose bare filenames
  because a list without descriptions cannot decay into truncated prose. That held while a matcher
  decided what to show. With recall off ([ADR 0015](docs/adr/15-recall-is-model-driven-by-default.md)),
  the index is the only thing telling the model what is in the notebook, and a filename cannot do it:
  asked about commit steps it read `github-repo-operations` — the name said *GitHub*, the question was
  about GitHub, and the entry was about the contributors sidebar cache. **A filename can start a read;
  it cannot prevent one.**
- **The summary comes from `summary:` frontmatter when present, otherwise the entry's own heading**, with
  a trailing date stripped. There is no third source — a field nobody fills in would leave most lines as
  bare filenames again, which is the failure being fixed. `indexSummaryChars: 0` restores the old
  behaviour exactly.
- **Cost: about 700 tokens of prompt prefix instead of 350, and roughly 29 resident entries instead of
  45.** Entries past the budget remain counted, matched and listed — ADR 0014 is untouched.

### Added

- `indexSummaryChars`, and [ADR 0016](docs/adr/16-index-carries-summaries.md) recording what was
  rejected: copying Claude Code's format without its budget (200 lines/25KB, ~6000 tokens, against our
  700) would give a worse index than either — fewer entries than names-only, still vague, many times the
  cost.
- Five checks: the summary is present, clipped to the configured length, and `0` restores filenames.

### Fixed

- **`indexSummaryChars: 0` clipped one character instead of all of them.** `slice(0, -1)` on a budget of
  zero drops the last character rather than the string, so "filenames only" produced nearly every
  summary. Found by the test that asserts the behaviour, not by reading the code.

## [0.16.0] — 2026-11-12

### Changed

- **`memory_usage` counts reads, not only automatic publications.** Turning recall off by default left it
  frozen: it recorded what a matcher published, and nothing was published any more, so every entry would
  have read as never used forever — including ones written that same day. `memory_read` now records too.
- **This is the better signal anyway.** An automatic publication means a matcher fired; a read means the
  model chose the entry because it needed it. The tool's description now says which it counts, and that a
  count is sessions reached rather than calls made — a second read of the same entry in one session is
  not new information.

### Added

- **A test that a read is recorded.** It is the only usage path left now, so it needs to be covered
  rather than assumed. Three checks: the read returns the entry, the read is logged, and a read of a
  missing name logs nothing.
- **`test/fixtures/README.md`**, stating that the fixture notebook is deliberately frozen and that its
  entry names no longer match the live notebook. Six of them were merged there; the suite asserts
  against the old names, and a fixture that followed every tidy-up of personal notes would not be a
  fixture.

### Notes

- **A failed assertion caught a real distinction, not a bug.** The new test initially read
  `readRows[0].e` and got `{day, entry}` instead — the log stores short keys (`d`, `e`) to keep it small,
  and `readUsage` maps them to readable ones. Worth knowing before writing another test against that log.

## [0.15.2] — 2026-11-12

### Changed

- **No more tags, and no releases.** This is a plugin one person and a friend use; nothing consumes a
  version tag, and twenty-two of them accumulated from habit. The version stays in `package.json` because
  the plugin page shows it and it identifies what is installed — but it is no longer published as a tag.
- **Every version link in this file now points at a commit** rather than at
  `releases/tag/…`, which would have 404'd the moment the tags went. The commit a version was cut from
  never moves, so `## [0.15.1]` still opens something.

### Notes

- The 22 tags were deleted from local and remote. Their commits remain; nothing was rewritten, and
  `git log` is unchanged. Only the bookmarks are gone.
- GitHub Releases were never created at all — `list_releases` returns empty. A release page would have
  duplicated what this file already records in more detail.

## [0.15.1] — 2026-11-11

### Changed

- **The English README carries no Chinese.** It had fourteen lines of it — the hostile query table, the
  symptom-versus-mechanism example, the trigger advice, a frontmatter sample — all of which a reader who
  does not read Chinese had to skip. They are now English equivalents. The Chinese README keeps the
  original phrasings, because that is where they are the real thing rather than a translation.
- **The same two tables in `architecture-en.md` were converted**, for the same reason.

### Added

- **A check that `README.md` stays English**, allowing only the language switcher. Verified by adding one
  Chinese line: it fails naming the line number.

### Notes

- **Two kinds of Chinese are deliberately kept in English documents.** Tokeniser examples (`mcp挂了`,
  `贡献者`, `今天天气怎么样`) cannot be explained in a language without CJK bigrams — the behaviour they
  demonstrate does not exist there. And `CHANGELOG.md` keeps every original phrasing, including release
  entries that quote what the plugin page used to say, because a changelog that edits its own history
  stops being evidence.
- The check is limited to `README.md` rather than applied to `docs/`, for exactly that first reason.

## [0.15.0] — 2026-11-11

### Changed

- **Automatic recall is off by default.** The index still names every entry and its header still tells
  the model to read one with `memory_read` when a name matches — but nothing is injected automatically
  unless `recallEnabled: true` is set. This is Claude Code's design, adopted after measuring why our
  version misbehaved.
- **The reason is a measurement, not a preference.** A hostile set — ordinary talk that merely shares
  vocabulary with the notebook — fired **5 of 18 times**: 证书考试过了 pulled the TLS entry, 笔记本屏幕有点暗
  pulled the notebook policy, 插件挺多的 pulled two plugin entries. The 24 off-topic queries in
  `qrels.json` fire zero times, but they were written by the same person who wrote the triggers.
- **A threshold sweep showed the gate cannot fix it.** Correct recalls and false positives both score
  4–5; raising the floor from 5 to 6 removes four of five false positives and four of six correct
  recalls. `hits=3` leaves 1/18 recalled. There is no middle setting — see the table in the README.

### Added

- [ADR 0015](docs/adr/15-recall-is-model-driven-by-default.md), recording the measurement, the
  alternative that was rejected, and the consequence that matters: a model that never reads the index
  recalls nothing, and that failure is invisible where a wrong injection is not.
- **Two new harness documents in the README** — the hostile query set and the threshold sweep — because
  the old "0 false positives in 24" was true and misleading at once.

### Notes

- **This is a behaviour change, not a removal.** `recallEnabled: true` restores the previous default
  exactly. The matcher, its tests, and its evaluation are untouched.
- **`memory_usage` counts automatic publications only.** A notebook used entirely through `memory_read`
  will report every entry as never used. The tool now says so rather than implying dead entries.

## [0.14.1] — 2026-11-11

### Fixed

- **The test fixture's policy still named `dsh-memory-notebook`.** The rename covered `templates/` but
  not `test/fixtures/`, so the template the plugin seeds from was correct while the copy the tests run
  against was not. Two copies of one document, one of them updated.

### Added

- **A check that the two policy copies stay identical.** "The fixture ships the same policy as the
  template" was a claim in a comment and enforced nowhere. This is the seventh check of the same shape —
  a hand-maintained copy of something that lives elsewhere, invisible until it diverges — and the third
  one this rename exposed. Verified by adding a line to the fixture only: it fails naming that line.

## [0.14.0] — 2026-11-11

### Changed

- **Renamed to `dsh-memory`.** It was `dsh-memory-notebook`. The old name described the implementation —
  a notebook — while the thing itself is the harness's memory; "notebook" is how it is stored, not what
  it is for. Every current occurrence moved: the package name, the patch id (`memory-notebook` →
  `memory`), the plugin identity (`export const name`), the three prompt-section names, and the XML tag
  the model sees (`<memory-notebook>` → `<memory>`). GitHub URLs follow the planned repository rename.
  The display name is now 记忆 / Memory.
- **This is a breaking rename in the install sense.** A profile row that names `dsh-memory-notebook`
  will not resolve. The plugin needs reinstalling against the new package name.

### Notes

- **`dsh-memory` is taken on npm** — published 2026-08-13 by `bbnopromo`, a SQLite FTS5 memory plugin.
  This repository is not published and is installed by path, so the collision has no effect today. It
  becomes real the moment either side publishes, and that is the reason to know it now rather than
  later.
- One line in this file still says `dsh-memory-notebook`: the v0.5.0 entry recording that the `@local/`
  scope was dropped. That sentence was true when written. A changelog that edits its own history stops
  being evidence.

## [0.13.3] — 2026-11-11

### Changed

- **The plugin description is now one line you would actually say.** It was forty-eight characters of
  explanation — a shared notebook, plain markdown, it can see them, open them, write back. All true,
  all useful in a README, none of it what a plugin page is for. It is now **你的经验，它看得见。** /
  **Your experience, visible to the agent.** It names what the user has, not what the software does.
  It says *can see*, not *remembers*, because measured recall is about one question in five on fresh
  phrasing and the stronger verb would be a claim the data contradicts. The honest numbers stay on the
  README's first screen: a card exists to earn a click, the honesty belongs inside.
- **Both READMEs now open with the same line**, followed by one clause saying what the thing is — a
  slogan with no noun leaves a reader unsure whether this is a memory system or a note-taking app.

### Added

- **Three consistency checks, replacing three things that were maintained by memory.** A version bump
  and its changelog entry are one change; a locale key exists in both languages or neither; every key
  in `index.js` `DEFAULTS` appears in both README tables. None of the three was visible to any check
  before, and all three had already gone wrong at least once — the version in this very release, the
  locale files at v0.13.2, and the configuration table whenever a default changed. Each was verified
  to fail, not only to pass: an unrecorded `9.9.9`, a key added to one locale, and a deleted table row
  each produce a named failure.
- **A version consistency check.** `scripts/check-docs.mjs` requires the version in `package.json` to
  have a matching `## [x.y.z]` section in `CHANGELOG.md`. This release is why: the tag was pushed
  before the version bump and the changelog entry, so `v0.13.3` pointed at a commit that still said
  `0.13.2` in `package.json`. Nothing noticed — not CI, not the tests, and not me until the tag had
  already been published.

## [0.13.2] — 2026-11-11

### Changed

- **The plugin's own description now says what it is, not how it works.** It read *"把 .agents/memory
  里的笔记索引注入系统提示，并只在消息真正命中时召回那一条"* — pure mechanism, so a reader learns
  nothing about whether they want it, and `.agents/memory` is a setting they may have changed. It now
  leads with the shared notebook and the three things it can do with it. `locale/en.json` and
  `package.json` said two different things in English; both are now written deliberately, with the
  npm one longer and search-friendly.

### Added

- **A locale consistency check.** `scripts/check-docs.mjs` compares the key sets of `locale/*.json`
  and rejects an empty string. Nothing read those files for consistency before, so a key added to one
  language and forgotten in the other degraded the plugin page silently — it renders blank rather than
  falling back. Verified by adding a key to one file and confirming the check names it.

## [0.13.1] — 2026-11-11

### Changed

- **Both READMEs rewritten.** The old text said "memory the agent actually uses" and never mentioned
  that it usually does not. It now leads with the measured limit — around one question in five finds
  the right entry when phrased in words the notebook does not contain — because a reader who installs
  expecting an assistant that remembers for them will be disappointed, and a reader who understands it
  is an indexed notebook will not be.
- **Three sections added to both READMEs:** a measured quality table, a comparison against the four
  nearest projects, and a troubleshooting list. The comparison draws on a survey of the field; the
  troubleshooting covers the failure this project actually hit — a schema the host rejects unloads the
  whole plugin, and every tool turns into `unknown tool` with nothing saying why.
- **The trigger advice now says what the measurement showed.** Write the words you complain in, not the
  words a manual would use, with the four concrete pairs that took a blind set from 3/14 to 11/11.
- **`docs/architecture-en.md` gained a contents list and a "What it measures" section.** Seventeen
  sections over three hundred lines had no navigation, and the measured generalisation numbers existed
  only in a conversation.

### Fixed

- **Six stale facts across both READMEs.** "Four tools" (seven), "67 checks" (now described by coverage
  instead of a count), "five-entry fixture" (fourteen), and a cost table quoting eleven entries at 620
  characters — the notebook was at twenty-five entries and 1173 characters. The cost table is now
  **per entry**, because a total goes stale and a rate does not.
- **`docs/architecture-en.md` described a mechanism that no longer exists.** Its "Revisit when" line
  still named "the notebook stops fitting in the index budget", which v0.13.0 removed; the failure
  table still described truncation; and it said `ctx.tools.register` × 4.
- **A paragraph interrupted a list in the Matching section**, splitting it in two. It is now one list
  followed by the note.
- `docs/INDEX-en.md` gained the coupling it was missing: a recall judgement lives in `test/qrels.json`,
  and changing one is a reviewed decision rather than a side effect.

## [0.13.0] — 2026-11-11

### Changed

- **The index budget now caps residency, not capacity.** It was doing two jobs and doing both badly: it
  decided how many tokens the index costs *and* how many entries the notebook may hold, and one number
  cannot serve both. Measured, 1400 characters is ~326 tokens per turn and ~34 entries, so wanting 200
  entries meant accepting ~2034 tokens per turn. The budget now answers only the token question, and
  capacity is unbounded. [ADR 0014](docs/adr/14-index-budget-is-residency.md)
- **A write is no longer refused on budget.** It cannot lose a fact any more, so the refusal protected
  nothing and made the model manage storage mid-task. Writes report `indexResident` and `indexOverflow`.
- **New entries go to the top of `INDEX.md`**, not the bottom. Residency is finite and what was just
  learned is the most likely thing to be needed next; appending meant a notebook at its budget hid a
  fact the moment it was written.

### Added

- **A counted overflow.** The index ends with `… and N more, all listed by memory_list` instead of a bare
  ellipsis. A model that cannot see the omission has no reason to look further; a counted one is not
  silent. Those entries stay recallable the whole time.
- `memory_health` reports `indexResident` and `indexOverflow`, and treats overflow as `degraded` rather
  than `broken` — the notebook works, some entries are merely not visible unprompted.
- The index always names at least one entry. With a budget at or below the header's own length it would
  otherwise list none, telling the model a notebook exists without saying what is in it.

### Removed

- `indexBudgetVerdict` and `projectedIndexChars`, replaced by `indexResidency`. Their whole purpose was
  to decide a refusal that no longer happens.

## [0.12.0] — 2026-11-11

### Added

- **`memory_usage`: which entries are actually used.** Recall now writes one line per published entry —
  a date and an entry name — to `usage.jsonl` beside the entries, and the tool reports which entries
  recall has never published. An entry injected many times and opened once is dead weight, and nothing
  noticed before. Counted per entry, and at most once per session — an entry already injected in a
  session is not injected again, so the count is sessions reached, not matches found.
  The privacy bound is deliberate: no query text, no session id, no path. The cost is that it cannot
  answer "which query failed to match". [ADR 0013](docs/adr/13-usage-counts.md)
- **A host API guard.** `apply` checks for `systemPrompt.section`, `systemPrompt.context` and
  `tools.register`, and throws when one is missing. `inject` covers the services, but a host release can
  keep a service and change its shape; a plugin that silently does nothing is worse than one that fails
  to load, because nothing tells the user which happened.

## [0.11.0] — 2026-11-11

### Added

- **`memory_health`: capability diagnosed separately from results.** A notebook that cannot be read and
  a notebook with nothing relevant both return no hits, and a query result cannot tell them apart — so
  the user concludes the feature is useless while the plugin is either fine or broken and says nothing
  either way. It reports whether the notebook can be read and **written**, whether `INDEX.md` agrees
  with the directory, how many more entries fit before the index truncates, which entries lack triggers
  or `Evidence:`, and whether this session actually injected an index or published a recall.
  `absent` and `unconfigured` are not failures. [ADR 0012](docs/adr/12-health-check.md)
- The fixture notebook carries a policy entry, so the healthy state it asserts is the state a real
  notebook is in.

### Changed

- The evidence-hygiene check builds its own bad entry instead of borrowing one from the fixture. It was
  asserting that the code works by relying on the fixture happening to contain a violation.

## [0.10.0] — 2026-11-11

### Added

- **A recall judgement set and the tool to run it.** `test/qrels.json` holds 52 statements about what
  the notebook should recall and 24 queries it must ignore, and `scripts/eval-recall.mjs` runs them,
  reporting per-entry reachability and a Wilson interval on each rate. It is an assertion set, not a
  benchmark: a single flipped case fails the run. Without this, a change could move the totals by one
  and be indistinguishable from noise.
- **A strong-signal rarity rule.** A single-word trigger that only one entry claims now counts as two
  hits, exactly as a filename does. "需要设置 proxy 吗" matched `proxy` — its only signal, pointing at
  exactly one entry — and stopped one hit short of the floor. The rule converges by itself: a term
  stops being unique the moment a second entry wants it, so nothing needs maintaining as the notebook
  grows.
- **Tie-break by evidence count.** Two entries can reach the same score by different routes; a camera
  question scored the camera entry and the sandbox-pipe entry equally because "access denied" appears
  in both, and recency decided which one the model saw. More matched evidence now wins.

### Changed

- The fixture notebook grew from 5 entries to 13. A five-entry fixture cannot model false positives
  that appear at twenty, and its recall rate has a confidence interval wide enough to hide a
  regression.
- The off-topic list in `test-core.mjs` now reads `test/qrels.json`, so the unit tests and the
  evaluation cannot drift apart.

## [0.9.0] — 2026-11-11

### Added

- **A capture hint.** Once per session, when context pressure crosses `captureHintRatio` (default 0.6),
  the plugin says the conversation is close to compaction and names the kind of thing worth writing.
  It writes nothing; the model decides with `memory_write`. Capture previously depended entirely on
  the model choosing, mid-task, to record something — the least reliable moment to ask.
  [ADR 0010](docs/adr/10-capture-hint.md)
- **Write-time rejection.** A write that would push the injected index past its budget is refused
  before it lands, with the numbers and a way out. Truncation is the failure this prevents: entries
  past the cut are never injected and nothing reports it. [ADR 0009](docs/adr/09-derived-index-and-write-refusal.md)

### Changed

- **The index is derived from the directory, not maintained by hand.** `syncIndexFile` rebuilds
  `INDEX.md` from a scan, keeping the order already there. A file added by another tool is indexed; a
  deleted one drops out. This closes the drift the notebook had produced twice, and which a check
  script could only report after the fact.
- `readIndexFiles` now parses list items only. Prose above the list may name a file in backticks — the
  index header does exactly that for the policy — and counting it duplicated that entry in the order.

## [0.8.1] — 2026-11-11

### Fixed

- **Body-only matches could recall.** Body words count one each and were uncapped, so a long entry
  that quoted the sentence `今天天气怎么样` collected six body hits from that sentence and recalled on
  nothing but coincidence. Writing a memory entry that quoted its own test sentences made this
  visible: three unrelated queries started recalling it. A hit now requires a strong match — a
  trigger, the filename, or the title; body text explains an entry, it does not identify it.

## [0.8.0] — 2026-11-11

### Fixed

- **Mixed script without a separator recalled nothing.** `tokenize` split on non-word characters,
  so `mcp挂了` stayed one token, was classified as CJK, and was shredded into bigrams — `mcp`
  disappeared from the query entirely, and `platformio编译` became ten junk fragments. Typing mixed
  script without spaces is the normal case for a Chinese user; Latin and CJK runs are now extracted
  separately, so `mcp挂了` and `mcp 挂了` tokenise identically.

### Changed

- A single-word trigger that is also part of the entry's filename now counts as two hits. Such a word
  is the entry's identifier (`tls`, `mcp`, `platformio`) and one is enough on its own, which is what
  makes `tls 握手失败` recall without lowering the floor for ordinary words.
- A trigger that is a whole Chinese word of two or more characters also counts two. Bigram splitting
  gave a two-character word one hit and a three-character word two, so `贡献者` recalled alone while
  `相机` did not; a Chinese word can never become an identifier either, because filenames are ASCII.
  Vague follow-ups went from 7/15 to 15/15.

### Added

- Two recall-quality suites in the test run: a false-positive budget over 15 off-topic queries that
  share vocabulary with the fixture notebook, and glued mixed-script recall. Recall improvements are
  paid for against the first suite.

### Notes

- Granting Chinese words their second hit exposed seven single-word triggers that were too broad to
  stand alone (`重启`, `路径`, `下载`, `描述`, `清单`, `表格`, `计数`); at first it took the false-positive
  rate from 2.4% to 22%. Each became a phrase, returning it to 2.4% while keeping the vague
  follow-ups. Measured on a real 18-entry notebook: 18/18 entries reachable, 15/15 vague follow-ups,
  1/41 false positives.

## [0.7.1] — 2026-11-11

### Fixed

- The bundled policy was seeded only from the index section, so a profile with `showIndex: false`
  and recall enabled never received it. Seeding now also runs from the recall path.
- Updating an entry without passing `triggers` erased the existing ones: the entry survived but
  stopped being findable, and nothing reported it. An omitted value now keeps the stored triggers;
  an explicit value replaces them.

## [0.7.0] — 2026-11-11

### Changed

- A matched trigger phrase now counts one hit per word instead of one, so a three-word phrase clears
  the two-hit floor by itself. This is what lets a short message recall the right entry without
  lowering the floor for ordinary single words — `mcp 挂了` recalls the MCP entry, while a bare
  generic word still does not recall anything.

### Fixed

- Recall vocabulary retuned against measured false positives: generic single words (`服务器`, `配置`,
  `写入`, `目录`, `权限`, `api`, `安装`, `依赖`) were removed or folded into phrases, and colloquial
  phrases (`mcp 挂了`, `相机 打不开`, `pio`) were added. Measured on a real notebook: 0 false positives
  across 14 off-topic queries, 0 misses across 11 on-topic ones (previously 5 misses and 1 false
  positive). Triggers live in the notebook, not in this repository — the matching rule is the only
  code change here.

## [0.6.0] — 2026-11-11

### Added

- Prefix tolerance in recall: a query word matches a trigger, name or title word when one is the
  other's prefix and both reach five characters. Below that floor the match must be exact, so `env`
  still does not match `environment`. Body matching stays exact.
- `scripts/check-index.mjs`, and an index-drift section in `memory_audit`: both directions between
  `INDEX.md` and the directory. The policy asked for this after every add or retire; it is now a
  command that can fail.

### Fixed

- The READMEs and `architecture-en.md` promised "no stemming beyond a shared five-character prefix"
  while `scoreEntry` matched words exactly. The documents were right and the code was not; the
  prefix rule now exists.

## [0.5.0] — 2026-11-11

### Changed

- The package name dropped its `@local/` scope: it is now `dsh-memory-notebook`, matching the
  repository name and the plugin's display name. The scope protected nothing — the package is
  private and never published — and it made two locally built plugins on this machine look like
  different kinds of thing. The link path does not change; only the package identifier does, so the
  plugin has to be removed and re-added.

## [0.4.0] — 2026-11-11

### Fixed

- A fresh install had no policy. `notebook-policy.md` was created in the author's own notebook and
  shipped nowhere, so the injected index header named a file that existed for exactly one user
  ([ADR 0008](docs/adr/08-policy-template-and-seeding.md), which supersedes 0007).

### Added

- `templates/notebook-policy.md`: the policy now ships with the plugin and is seeded into a notebook
  that lacks one. Exclusive create — an edited policy is never overwritten — once per directory per
  process, and only where `.agents/memory/` already exists.
- The index header names the policy only when that entry is present.

## [0.3.0] — 2026-11-11

### Changed

- The notebook's policy moved out of a skill and into `notebook-policy.md` inside the notebook
  ([ADR 0007](docs/adr/07-policy-in-the-notebook.md)). The skill directory is gone, and the
  injected index header names the policy entry so it stays discoverable. The notebook is now
  self-contained: entries and the rules governing them travel as one directory.

## [0.2.0] — 2026-11-11

### Added

- `memory_audit` tool and `scripts/check-evidence.mjs`: report entries with no `Evidence:` line and
  entries untouched beyond `--stale-days`. Neither executes the recorded commands — a notebook is
  arbitrary markdown, so age is the proxy for evidence rot ([ADR 0006](docs/adr/06-evidence-audit-by-age.md)).
- `memory_verify` now refreshes the entry's `updated` date, so reviewing an entry resets its audit
  age.
- `test/fixtures/notebook`: a five-entry fixture, so the suite behaves the same locally and in CI.

### Changed

- The test suite no longer resolves the author's own notebook outside the repository. It read
  `../../.agents/memory`, which exists on one machine and in no CI checkout, so every
  notebook-dependent check failed on the first CI run.

## [0.1.0] — 2026-11-11

First release. The plugin was built for one notebook and has been running against it since.

### Added

- **Resident filename index.** `.agents/memory/*.md` is reduced to one line per entry and appended to
  the system prompt at section order 4100. Entries marked `disputed` are excluded. An empty notebook
  injects zero bytes.
- **Match-only recall.** A user message is matched against entry triggers, filenames, titles and
  bodies; the best one or two entries are published through the runtime context channel at order
  4101, at most once per session each.
- **Bilingual triggers.** An entry may declare a `triggers:` frontmatter line of recall words in the
  author's own language, matched at the highest weight. This is what lets a Chinese question recall
  an English entry.
- **Four tools:** `memory_list`, `memory_read`, `memory_write` (evidence required), `memory_verify`.
- **Trust states.** `candidate` (default), `verified`, `disputed`; the last is never indexed or
  recalled.
- **Budget clamping that preserves evidence.** A recalled entry too long for the budget keeps its
  opening conclusion and its trailing `Evidence:` line.
- **Tests.** 46 behavioural checks against a real notebook, no dependencies.
- **Optional machine tier.** `machineDir` adds a machine-wide notebook beneath the workspace one.

### Known limitations

- Recall rides the runtime context channel, so there is no visible "context injected" row in the
  conversation. A profile-linked bundle cannot import the harness message constructor; see
  [ADR 0001](docs/adr/01-zero-dependency-host-half.md).
- Matching is lexical. There is no vector search and no synonym expansion beyond `triggers`.
- Configuration is not schema-validated.

[Unreleased]: https://github.com/FrozenYty/dsh-memory/compare/dd0dad9...HEAD
[0.18.2]: https://github.com/FrozenYty/dsh-memory/commit/dd0dad9
[0.18.1]: https://github.com/FrozenYty/dsh-memory/commit/20acd20
[0.18.0]: https://github.com/FrozenYty/dsh-memory/commit/32f2ad8
[0.17.1]: https://github.com/FrozenYty/dsh-memory/commit/d7baca1
[0.17.0]: https://github.com/FrozenYty/dsh-memory/commit/1fa1d32
[0.16.0]: https://github.com/FrozenYty/dsh-memory/commit/96e0283
[0.15.2]: https://github.com/FrozenYty/dsh-memory/commit/b5607b80887f6c6f3089d9913106ca2666065122
[0.15.1]: https://github.com/FrozenYty/dsh-memory/commit/149d357afdc114fd811471c11e87f20e8e95d3c5
[0.15.0]: https://github.com/FrozenYty/dsh-memory/commit/2e95a7ae61e0fb1967605124a5b937208852859d
[0.14.1]: https://github.com/FrozenYty/dsh-memory/commit/5189f46c93d89299b02f9405114f06454ef95ef0
[0.14.0]: https://github.com/FrozenYty/dsh-memory/commit/f6859d2a767c1273b68a39112c5cb18716cf39f9
[0.13.3]: https://github.com/FrozenYty/dsh-memory/commit/9c36f95c8cfd73e0d946e3649d9787d3decf9f0f
[0.13.2]: https://github.com/FrozenYty/dsh-memory/commit/8051af5b727dc646d8a123adcd97b7528abe170f
[0.13.1]: https://github.com/FrozenYty/dsh-memory/commit/574ee46763bd59a489c3e07944f150bcd87168b2
[0.13.0]: https://github.com/FrozenYty/dsh-memory/commit/5fabea84513f8f8191062a019b30f02f03bce8d3
[0.12.0]: https://github.com/FrozenYty/dsh-memory/commit/1d8f4365aec1dee013b5c38ae31142bbb5f2fac4
[0.11.0]: https://github.com/FrozenYty/dsh-memory/commit/fefbb2d9b26f8dd60977f030f65e97096a2ad99c
[0.10.0]: https://github.com/FrozenYty/dsh-memory/commit/c4f7f24a553f954d7679b51ce923be30a4c078fb
[0.9.0]: https://github.com/FrozenYty/dsh-memory/commit/c6ad1ea83055d7ff59b8c35a44425b2eb435d669
[0.8.1]: https://github.com/FrozenYty/dsh-memory/commit/39ab0e462890443a776744f389fd5d08092fcf0c
[0.8.0]: https://github.com/FrozenYty/dsh-memory/commit/17e163ae9b09513974e1da435ae01142b09b7f2f
[0.7.1]: https://github.com/FrozenYty/dsh-memory/commit/726506f82ac156e975a921bd5bef4d364792417e
[0.7.0]: https://github.com/FrozenYty/dsh-memory/commit/8fba1b81b7fbae45c432ed4a6e4113408c926bb6
[0.6.0]: https://github.com/FrozenYty/dsh-memory/commit/ebf33631d6bbd33dc5e2d8d93956a4b57d53eb9f
[0.5.0]: https://github.com/FrozenYty/dsh-memory/commit/7525cd8b971fa18f60cafd2626f105c88885c297
[0.4.0]: https://github.com/FrozenYty/dsh-memory/commit/3a07fca0bc6a67b648ffccdc2b78288f2e48ba2a
[0.3.0]: https://github.com/FrozenYty/dsh-memory/commit/c58b4453b24bec52662ecc0ae9852afc4982cc44
[0.2.0]: https://github.com/FrozenYty/dsh-memory/commit/0aefd975595dc2150f7682058409161d1a62cf2c
[0.1.0]: https://github.com/FrozenYty/dsh-memory/commit/8918ffb24cb0249d28497d212fa383a116fbc0cb
