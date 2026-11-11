# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/FrozenYty/dsh-memory-notebook/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.8.1
[0.8.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.8.0
[0.7.1]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.7.1
[0.7.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.7.0
[0.6.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.6.0
[0.5.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.5.0
[0.4.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.4.0
[0.3.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.3.0
[0.2.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.2.0
[0.1.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.1.0
