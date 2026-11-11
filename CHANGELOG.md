# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/FrozenYty/dsh-memory-notebook/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.4.0
[0.3.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.3.0
[0.2.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.2.0
[0.1.0]: https://github.com/FrozenYty/dsh-memory-notebook/releases/tag/v0.1.0
