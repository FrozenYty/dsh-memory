# dsh-memory-notebook

English | [中文](README-zh.md)

Low-token persistent memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
It turns a directory of markdown notes into memory the agent actually uses — no embeddings, no
server, no model call per turn.

## The problem

An agent session starts blank. Everything learned the hard way — a toolchain that fails on long
paths, a driver that lies about its settings, an installer that silently writes to the wrong
environment — is re-learned next time, at the same cost.

The existing answers trade one problem for another:

- **Vector stores and memory servers** rank well but add a service, an index to keep in sync, and a
  store the agent cannot `git diff`.
- **Notes plus an instruction file** stay legible, but nothing makes the agent read them at the
  moment it matters. A good notebook nobody opens is a well-organised loss.

This plugin takes the second shape and fixes only the trigger problem. The notes stay ordinary
markdown in your repository; the plugin decides *when to look* and *when to write*.

## What it does

1. **Index, resident.** The notebook's bare filenames are appended to the system prompt as a small
   section. No descriptions, so the list cannot decay into truncated prose. An empty notebook
   injects **zero bytes** — the section disappears entirely.
2. **Recall, on match only.** When a user message matches an entry, that entry is published through
   the dynamic runtime-context channel for that turn. An entry is injected once per session, not
   once per message.
3. **Four tools** so the agent can read and write the notebook deliberately, with evidence required
   on every write.

The notebook itself is untouched: one markdown file per subject, an optional `INDEX.md` fixing
their order, optional frontmatter — and one entry, `notebook-policy.md`, that states the rules for
writing into it. The policy travels with the notebook, so no skill or external document has to
accompany it. See [docs/architecture-en.md](docs/architecture-en.md) for why the parts are arranged
this way.

## Install

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

A first install activates through hot reload. Replacing an already-installed copy needs a restart.

## Configure

Set values under the `memory-notebook` row in the profile's `cordis.patch.yml`. This bundle declares
no `Config` schema, so values are taken as given; the defaults below are applied in code.

| Key | Default | Meaning |
|---|---|---|
| `workspaceDir` | `.agents/memory` | Notebook directory, relative to the session working directory. `''` disables this tier. |
| `machineDir` | `''` | Optional machine-wide tier, absolute or `~`-prefixed. The workspace tier wins name collisions. |
| `showIndex` | `true` | Inject the filename index. |
| `indexBudgetChars` | `1400` | Character ceiling for the index section. |
| `recallEnabled` | `true` | Publish a matching entry for the turn. |
| `recallBudgetChars` | `1400` | Character ceiling for one recall publication. |
| `maxRecall` | `2` | Maximum entries published for one message. |
| `minRecallScore` | `4` | Weighted score floor (trigger phrase 5–7, filename 4, title 3, body 1). |
| `minRecallHits` | `2` | Distinct query tokens that must match. |
| `minQueryChars` | `6` | Shorter messages never trigger recall. |
| `skipAcknowledgements` | `true` | Ignore messages that are only an acknowledgement. |

## Write an entry

One file per subject. Frontmatter is optional; `INDEX.md` is optional and only fixes ordering.

```markdown
---
status: verified
triggers: platformio, 固件, 烧录, 编译, 路径太长
---

# Conclusion, usable on its own — 2026-11-02

Symptom, mechanism, workaround.

Evidence: `exact command or error text that proves it`
```

- **`triggers`** is the recall vocabulary. Write it in the language you speak, even when the body is
  English — matching runs on these words. Entries are comma-separated; a multi-word entry counts as a
  phrase and matches only when every word of it appears, so keep phrases specific (`dotnet pipe
  denied`, not `denied`). An entry without triggers still matches on its filename, title and body,
  but a Chinese message will not find an English body that way.
- **`status`** is `candidate` (default), `verified`, or `disputed`. Disputed entries are never
  indexed and never recalled.
- **`Evidence:`** is required when writing through `memory_write`. A clamped recall keeps that line
  rather than dropping it — an entry without its evidence reads as an unverifiable claim.

## Tools

| Tool | Purpose |
|---|---|
| `memory_list` | Names, trust statuses and titles. |
| `memory_read` | One entry in full. |
| `memory_write` | Create or update an entry; `evidence` is required. |
| `memory_verify` | Promote to `verified`, or retire to `disputed`. |
| `memory_audit` | Entries with no `Evidence:` line, and entries untouched for a long time. |

## Why it is cheap

Measured on this project's own notebook, 11 entries:

| Cost | Value |
|---|---|
| Index section, per request | 620 characters (~172 tokens) |
| One recall publication | at most 1,400 characters (~390 tokens) |
| Empty notebook | 0 bytes |
| Embeddings / LLM calls on the read path | none |
| Background consolidation | none |

The index is one line per entry with no descriptions, so it does not need a budget that truncates
meaningfully. Recall is capped twice: by `maxRecall` in entries and by `recallBudgetChars` in
characters, and an entry is never injected twice in one session.

## Verified

```sh
node test-core.mjs        # 50 checks, no dependencies
node scripts/check-evidence.mjs --dir .agents/memory   # evidence completeness and age
```

The suite runs against a five-entry fixture notebook committed with the repository, so it behaves
the same locally and in CI. It covers: discovery and `INDEX.md` ordering, index shape and budget,
empty-notebook behaviour, Latin and CJK tokenising, the acknowledgement gate, English and Chinese
recall, whole-phrase trigger matching, budget clamping that preserves the `Evidence:` line,
trust-status transitions, disputed entries disappearing from both index and recall, and
malformed-entry tolerance.

## Limits this design accepts

- **Lexical matching.** No synonyms beyond `triggers`, no stemming beyond a shared five-character
  prefix. Deliberate: a wrong recall costs tokens and trust.
- **No visible "context injected" row.** A profile-linked bundle cannot import `@deepseek-ai/*`
  packages (see [ADR 0001](docs/adr/01-zero-dependency-host-half.md)), so recall rides the runtime
  context channel instead of a synthetic user message. The benefit is that nothing enters the session
  log and the injection survives compaction.
- **No cross-workspace tier by default.** `machineDir` exists for that; it is off unless configured,
  and the workspace tier wins name collisions.
- **No vector search.** On a notebook of tens of entries, filenames plus triggers are enough, and the
  failure mode of a missed recall is visible and fixable. Revisit threshold: entries stop fitting in
  the index budget.

## Documents

- [docs/INDEX-en.md](docs/INDEX-en.md) — the map: what answers which question.
- [docs/architecture-en.md](docs/architecture-en.md) — the design and its tradeoffs.
- [docs/adr/](docs/adr/) — decisions expensive to reverse, one file each.
- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, commits, what CI checks.
- [AGENTS.md](AGENTS.md) — rules for AI assistants working here.

## License

MIT. See [LICENSE](LICENSE).
