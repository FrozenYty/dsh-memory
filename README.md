# dsh-memory-notebook

English | [中文](README-zh.md)

Persistent memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), built from a
directory of markdown notes. No embeddings, no server, no model call per turn.

**The honest one-line version:** it makes a curated notebook *visible* to the agent and lets it *write
back*. It does not reliably *remember for you*. Measured on its own author's notebook, a question
phrased in words the notebook does not already contain recalls the right entry about **one time in
five**. Read [How well it works](#how-well-it-works) before installing — it is the part most memory
projects leave out.

## The problem

An agent session starts blank. Everything learned the hard way — a toolchain that fails on long paths,
a driver that lies about its settings, an installer that silently writes to the wrong environment — is
re-learned next time, at the same cost.

The existing answers trade one problem for another:

- **Vector stores and memory servers** rank well but add a service, an index to keep in sync, and a
  store the agent cannot `git diff`.
- **Notes plus an instruction file** stay legible, but nothing makes the agent read them at the moment
  it matters. A good notebook nobody opens is a well-organised loss.

This plugin takes the second shape and fixes two things: *when to look*, and *when to write*.

## What it does

1. **A resident index.** The notebook's filenames are appended to the system prompt as a small
   section. No descriptions, so the list cannot decay into truncated prose. An empty notebook injects
   **zero bytes** — the section disappears entirely.
2. **Recall on match.** When a message matches an entry, that entry is published for that turn through
   the runtime-context channel. Each entry at most once per session.
3. **Seven tools** to read, write, verify, audit, diagnose and account for entries — with evidence
   required on every write.

The notebook itself is ordinary markdown: one file per subject, an optional `INDEX.md` fixing their
order, optional frontmatter, and one entry that states the rules for writing into it. That policy
**ships with the plugin** and is seeded into any notebook that lacks one, never overwriting an edited
copy. [docs/architecture-en.md](docs/architecture-en.md) explains why the parts are arranged this way.

## How well it works

Measured on a 25-entry notebook, both directions, with the judged query set committed in
[`test/qrels.json`](test/qrels.json):

| | |
|---|---|
| Queries phrased in the notebook's own vocabulary | **11/11** |
| Queries written blind, avoiding that vocabulary | **3/14** |
| Off-topic queries that stay silent | **0 false positives in 24** |

The gap between those first two rows is the whole story. Matching is lexical: it compares words. When
you describe a problem in terms the entry already uses, it fires. When you describe the *symptom* and
the entry records the *mechanism* — you say "拍出来一片黑", the entry says "黑帧" — it does not.

So the useful mental model is **a well-indexed notebook the agent can see and open**, not an assistant
that remembers on your behalf. What it does reliably is never get in the way: zero false recalls, zero
background work, zero model calls on the read path.

If you want it to actually find things, write triggers in the words you complain in, not the words a
manual would use. That is the single highest-leverage thing you can do.

## How it compares

From a 2026 survey of the field, reading each project's source and issue tracker rather than its
promotional material:

| | this | Claude Code | engramory | OKF agent memory | EverOS |
|---|---|---|---|---|---|
| dependencies | none | n/a | Python scripts | Go binary | service + LLM key |
| model calls on read path | none | none | none | none | yes |
| provenance required | **yes** (`Evidence:`) | no | **no** | optional | recorded |
| trust states | **yes** | no | **no** | OKF tiers | yes |
| aging / audit | **yes** | no | **no** | `stale_after` | yes |
| automatic recall | yes (~20% on new phrasings) | **no** | **no** | codex + index | yes |
| index cap enforcement | no (counted overflow) | warns | **yes** | scorecard | n/a |

Claude Code's auto-memory is the closest in *shape* — index of filenames, one file per subject, detail
opened on demand. It deliberately does **no matching at all**: the model reads names and decides. This
plugin adds matching on top, which is a genuine convenience and a genuinely weak one.

`engramory` shares the shape and adds enforcement this lacks (a hard index cap, multi-host sharing).
It also documents its own gaps, which are this plugin's strengths: no provenance, no trust states, no
aging.

One finding worth more than any mechanism: **every published benchmark in this field that I checked
failed checking** — one project reports +7.6pp recall while its own answer-replay numbers move by one
case, another's headline figure appears in no file in its repository. Measure on your own corpus. The
judgement set shipped here is small, honest, and about the case that matters.

## Install

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

A first install activates through hot reload. Replacing an already-installed copy needs a restart.

## Configure

Set values under the `memory-notebook` row in the profile's `cordis.patch.yml`. This bundle declares no
`Config` schema, so values are taken as given; the defaults below are applied in code.

| Key | Default | Meaning |
|---|---|---|
| `workspaceDir` | `.agents/memory` | Notebook directory, relative to the session working directory. `''` disables this tier. |
| `machineDir` | `''` | Optional machine-wide tier, absolute or `~`-prefixed. The workspace tier wins name collisions. |
| `showIndex` | `true` | Inject the filename index. |
| `indexBudgetChars` | `1400` | Ceiling on how many entries are **named** in the index, not on how many the notebook may hold. Entries past it are counted in the index and stay recallable. |
| `recallEnabled` | `true` | Publish a matching entry for the turn. |
| `recallBudgetChars` | `1400` | Ceiling on one recall publication. |
| `maxRecall` | `2` | Maximum entries published for one message. |
| `minRecallScore` | `4` | Weighted score floor (trigger phrase 5–7, filename 4, title 3, body 1). |
| `minRecallHits` | `2` | Distinct query tokens that must match. |
| `minQueryChars` | `6` | Shorter messages never trigger recall. |
| `skipAcknowledgements` | `true` | Ignore messages that are only an acknowledgement. |
| `captureHintRatio` | `0.6` | Context-window fraction at which the one-shot "save what matters" hint appears. `0` disables it. |

## Write an entry

One file per subject. Frontmatter is optional; `INDEX.md` only fixes ordering.

```markdown
---
status: verified
triggers: platformio, 固件, 烧录, 编译, 路径太长, 装不上, 编译 失败
---

# Conclusion, usable on its own — 2026-11-02

Symptom, mechanism, workaround.

Evidence: `exact command or error text that proves it`
```

- **`triggers`** is the recall vocabulary, and it decides whether the entry is ever found. Write the
  words **you would actually type**, not the words a manual would use:

  | you would type | do not list only |
  |---|---|
  | 换台电脑打开就不对了 | 转发, 绝对路径, 盘符 |
  | 浏览器能打开但命令不行 | curl, tls, schannel |
  | 拍出来一片黑 | 黑帧, 白平衡 |
  | 它怎么没想起来 | 触发词, 召回率 |

  Multi-word phrases count as a phrase and match only when every word appears — keep them specific
  (`dotnet pipe denied`, not `denied`). Avoid a **single generic word** (`configuration`, `permission`,
  `重启`): once it pairs with any second hit it drags the entry into unrelated messages. Never use a
  single Chinese character — it cannot earn the second hit that makes a match.
- **`status`** is `candidate` (default), `verified`, or `disputed`. Disputed entries are never indexed
  and never recalled.
- **`Evidence:`** is required when writing through `memory_write`. A clamped recall keeps that line
  rather than dropping it — an entry without its evidence reads as an unverifiable claim.

## Tools

| Tool | Purpose |
|---|---|
| `memory_list` | Names, trust statuses and titles — including entries past the index budget. |
| `memory_read` | One entry in full. |
| `memory_write` | Create or update; `evidence` required. Reports whether the entry is resident in the index. |
| `memory_verify` | Promote to `verified`, or retire to `disputed`. |
| `memory_audit` | No `Evidence:`, untouched for long, `INDEX.md` drift in either direction. |
| `memory_health` | Whether memory is broken or merely had nothing to say: `ok`, `degraded`, `broken`, `absent`, `unconfigured`. |
| `memory_usage` | Which entries recall has ever published, and which it never has. Entry names and dates only — never the query. |

## Why it is cheap

Per entry, not per notebook — the totals scale but the rates do not:

| Cost | Value |
|---|---|
| Index line, per request | ~34 characters, ~10 tokens |
| One recall publication | at most `recallBudgetChars`, ~390 tokens at the default |
| Empty notebook | 0 bytes |
| Embeddings / model calls on the read path | none |
| Background consolidation | none |

The budget is a **dial, not a ceiling**. 1400 characters is roughly 34 resident entries; 700 is
roughly 10. Capacity is unbounded either way: entries past the budget are counted in the index, stay
recallable, and are listed by `memory_list`. See
[ADR 0014](docs/adr/14-index-budget-is-residency.md).

## When it goes wrong

- **Every `memory_*` tool reports `unknown tool`.** The plugin failed to load. Almost always a schema
  the host rejects — the host validates tool schemas while loading and rejects the whole plugin, not
  one tool. Check the host log; the rules it enforces are copied into `test-core.mjs` under
  *every tool schema stays inside the host subset*.
- **Memory never fires.** Call `memory_health` first. It separates "broken" from "nothing matched" —
  the two states that look identical from a query that returned nothing. If it says `ok`, the notebook
  is fine and the vocabulary is the problem.
- **An entry was written but is not in the index.** It is past `indexBudgetChars`. `memory_write`
  said so in its `indexOverflow`; `memory_usage` will show whether anything ever reads it.
- **Memory stops being saved.** The notebook directory is not writable. `memory_health` reports that
  specifically — it is the failure that looks like everything working.

## Verified

```sh
node test-core.mjs                 # behavioural checks, no dependencies
node scripts/eval-recall.mjs       # recall judgements over test/qrels.json
node scripts/check-paths.mjs       # no machine-specific paths in any document
node scripts/check-docs.mjs         # ADRs listed, language switchers, links resolve
node scripts/check-evidence.mjs --dir test/fixtures/notebook
node scripts/check-index.mjs --dir test/fixtures/notebook
```

CI runs all of them and blocks a merge. The suite covers discovery and `INDEX.md` ordering, index
residency and counted overflow, empty-notebook behaviour, Latin and CJK tokenising including glued
mixed script, the acknowledgement gate, recall in both languages, whole-phrase and rarity-weighted
matching, trust-status transitions, disputed entries disappearing from index and recall, evidence
completeness and aging, usage accounting, capability diagnostics, host-API guarding, and the host's own
tool-schema rules.

## Limits this design accepts

- **Lexical matching, and it is the binding limit.** Around one question in five finds the right entry
  when phrased in words the notebook does not contain. Deliberate: the alternative costs a service or a
  model call per turn, and the published evidence that either buys answer quality does not hold up.
  The fix is vocabulary, not algorithm — see [Write an entry](#write-an-entry).
- **Nothing is captured automatically.** Closure is the model deciding to call `memory_write`. A
  one-shot hint before compaction nudges it; that is not the same as capturing raw events, and it is
  not claimed to be.
- **No visible "context injected" row.** A profile-linked bundle cannot import `@deepseek-ai/*`
  packages ([ADR 0001](docs/adr/01-zero-dependency-host-half.md)), so recall rides the runtime-context
  channel instead of a synthetic user message. The benefit: nothing enters the session log and the
  injection survives compaction.
- **No cross-workspace tier by default.** `machineDir` exists for it; off unless configured, and the
  workspace tier wins name collisions.
- **`verified` is not enforced.** Anything the model writes is `candidate` until something promotes it,
  and the model can promote its own entry. It is a signal, not a proof of human review.

## Documents

- [docs/INDEX-en.md](docs/INDEX-en.md) — the map: what answers which question.
- [docs/architecture-en.md](docs/architecture-en.md) — the design and its tradeoffs.
- [docs/adr/](docs/adr/) — decisions expensive to reverse, one file each.
- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, commits, what CI checks.
- [AGENTS.md](AGENTS.md) — rules for AI assistants working here.

## License

MIT. See [LICENSE](LICENSE).
