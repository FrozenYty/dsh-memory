# dsh-memory

English | [中文](README-zh.md)

[![ci](https://github.com/FrozenYty/dsh-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/FrozenYty/dsh-memory/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![build step](https://img.shields.io/badge/build-none-brightgreen)
![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)

> A well-indexed notebook the agent can see — not a service that remembers on your behalf.

A DeepSeek Harness profile bundle that turns a directory of markdown files into the agent's memory: an
index in the system prompt, one file per subject, and seven tools to read, write and audit it. No
embeddings, no server, no model call on the read path. An empty notebook costs zero bytes.

[github.com/FrozenYty/dsh-memory](https://github.com/FrozenYty/dsh-memory)

## Status

- Current version: v0.23.2.
- **In daily use, on the notebook it was written for.** 48 entries and 236 recorded reads between
  2026-11-11 and 2026-11-13. Both numbers come from the plugin's own `usage.jsonl`, so they are a record
  rather than a claim.
- **Three silent defects were found and fixed by its own gates in one session**: every evidence line was
  being cut to 300 characters, a long pasted message evicted the current request from the recall query,
  and the index order could never let a new entry climb past an old one. Each is now a test and a
  mutation — see [CHANGELOG.md](CHANGELOG.md).
- **Not covered**: a notebook big enough to overflow the index (the counted-overflow path is
  fixture-tested, never exercised on real data), and any Harness build other than the installed one.
- Release list: [CHANGELOG.md](CHANGELOG.md). Design and tradeoffs:
  [docs/architecture-en.md](docs/architecture-en.md). Decisions: [the ADRs](docs/adr/). Recall
  measurements: [`tests/qrels.json`](tests/qrels.json).

## The contract

An agent session starts blank. Everything learned the hard way — a toolchain that fails on long paths, a
driver that lies about its settings, an installer that silently writes to the wrong environment — is
re-learned next time at the same cost.

The existing answers trade one problem for another. **Vector stores and memory servers** rank well but add
a service, an index to keep in sync, and a store you cannot `git diff`. **Notes plus an instruction
file** stay legible, but nothing makes the agent read them at the moment it matters.

This plugin takes the second shape and fixes two things: **when to look**, and **when to write**.

1. **A resident index.** Each entry appears as its filename plus a one-line summary, clipped to a fixed
   length. The summary is what lets the model decide whether reading is worth a call — a filename can
   start a read, it cannot prevent one. An empty notebook injects **zero bytes**.
2. **The model reads what it needs.** The index header tells it to call `memory_read` when a name matches
   what it is about to do. **Nothing is injected automatically** — the measurements below are the reason,
   and `recallEnabled` opts into automatic matching instead.
3. **Seven tools** to read, write, verify, audit, diagnose and account for entries, with evidence required
   on every write.

The notebook is ordinary markdown: one file per subject, an optional `INDEX.md` fixing their order,
optional frontmatter, and one entry stating the rules for writing into it. That policy **ships with the
plugin** and is seeded into any notebook that lacks one, never overwriting an edited copy.

## How well it works

Two things are measured, and the second is why automatic recall is off by default.

**Matching quality**, on a 29-entry notebook, both directions at once, judged set committed in
[`tests/qrels.json`](tests/qrels.json):

| Query set | Result |
|---|---|
| On-topic questions in the notebook's own vocabulary | 52/52 |
| New phrasings, written from the situation | 6/18 |
| Off-topic queries in `tests/qrels.json` | 0/24 fired |

**And then the set nobody writes for themselves** — ordinary talk that merely shares vocabulary:

| Typed | What it pulled in |
|---|---|
| an exam certificate was issued | the TLS entry — one word covers both senses |
| the notebook is running hot | the notebook policy — "notebook" is also a laptop |
| there are a lot of plugins | two plugin entries, from a remark about nothing |
| **Ordinary talk sharing vocabulary** | **5/18 fired** |

The measured set was written in Chinese; the phrasings above are its English equivalents. The failure is
not language-specific — one word covering two senses is enough — but the tokeniser grants a lone Chinese
word of two characters the weight of two hits, which is what made it fire so readily there.

The 24 clean queries were written by the same person who wrote the triggers, which is exactly why they
are clean. The hostile set was not.

**Raising the gate does not separate them.** Correct recalls and false positives both score 4–5, and
lifting the floor to 6 costs four of six correct recalls to remove four of five false positives:

```
score | recall | false positives
  4   |  6/18  |  5/18
  5   |  6/18  |  5/18
  6   |  2/18  |  1/18
  8   |  1/18  |  0/18
```

So the default is what Claude Code does: **the index names every entry, and the model reads one when a
name matches.** No matcher, no false positives.

When it does match, it is lexical: it compares words. Describe a problem in terms the entry already uses
and it fires; describe the *symptom* while the entry records the *mechanism* — you say "the photos come
out black", the entry says "black frame" — and it does not. That is the limit `recallEnabled: true`
inherits.

**If you want it to actually find things, write triggers in the words you complain in, not the words a
manual would use.** That is the single highest-leverage thing you can do.

## Install

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

A first install activates through hot reload. Replacing an already-installed copy needs a restart.

## Configure

Set values under the `memory` row in the profile's `cordis.patch.yml`. This bundle declares no `Config`
schema, so values are taken as given; the defaults below are applied in code.

| Key | Default | Meaning |
|---|---|---|
| `workspaceDir` | `.agents/memory` | Notebook directory, relative to the session working directory. `''` disables this tier. |
| `machineDir` | `''` | Optional machine-wide tier, absolute or `~`-prefixed. The workspace tier wins name collisions. |
| `showIndex` | `true` | Inject the filename index. |
| `indexBudgetChars` | `9000` | Ceiling on how many entries are **named** in the index, not on how many the notebook may hold. Entries past it are counted and stay recallable. |
| `indexSummaryChars` | `60` | Characters of summary per index line. `0` falls back to bare filenames — more entries, less about each. |
| `recallEnabled` | `false` | Publish a matching entry for the turn. Off by default: a lexical matcher cannot tell "certificate error" from "certificate exam". |
| `recallBudgetChars` | `1400` | Ceiling on one recall publication. |
| `maxRecall` | `2` | Maximum entries published for one message. |
| `minRecallScore` | `4` | Weighted score floor (trigger phrase 5–7, filename 4, title 3, body 1). |
| `minRecallHits` | `2` | Distinct query tokens that must match. |
| `minQueryChars` | `6` | Shorter messages never trigger recall. |
| `skipAcknowledgements` | `true` | Ignore messages that are only an acknowledgement. |
| `captureHintRatio` | `0.6` | Context-window fraction at which the one-shot "save what matters" hint appears. `0` disables it. |

**The budget is a dial, not a ceiling.** It caps what is *resident* — how many entries the model can see
without asking — never what the notebook can hold. Entries past it are counted in the index, stay
callable, and `memory_list` names them. See [ADR 0014](docs/adr/14-index-budget-is-residency.md).

It also decides **when the index is re-ranked**, which is a cache concern rather than a memory one. The
index is a section of the system prompt, so changing it invalidates the prompt cache from the first
changed line. Every write pays that once and cannot avoid it; a *read* must not pay it at all, which is
why the order is recomputed **only once the notebook no longer fits**. Below the budget every entry is
named regardless of position, so the ranking would decide nothing — and a session that merely read an
entry would reorder the next session's index for no benefit.

**The index is a snapshot taken when a session begins.** An entry written mid-session is therefore absent
from that session's index — the one that just wrote it — and present in the next one's. That is where the
change is free: a session that has not been sent yet has no cache to lose. The entry is not hidden: it is
in the conversation that wrote it, `recall` matches it, `memory_list` names it, and `INDEX.md` on disk is
updated immediately.

**What it costs per request**, not per notebook:

| Cost | Value |
|---|---|
| Index line | ~89 characters, ~24 tokens |
| Index at the default budget | ~9000 characters, ~2500 tokens, about 100 entries |
| Empty notebook | 0 bytes |
| Embeddings, model calls on the read path, background consolidation | none |

## Write an entry

One file per subject. Frontmatter is optional; `INDEX.md` only fixes order.

```markdown
---
status: verified
triggers: platformio, firmware, flash, compile, path too long, will not install
---

# Conclusion, usable on its own — 2026-11-02

Symptom, mechanism, workaround.

Evidence: `exact command or error text that proves it`
```

- **`triggers`** is the recall vocabulary, and it decides whether the entry is ever found. Write the
  words **you would actually type**:

  | you would type | do not list only |
  |---|---|
  | it broke when I moved to another machine | forwarding, absolute path, drive letter |
  | the browser works but the command does not | curl, tls, schannel |
  | the photos come out black | black frame, white balance |

  Multi-word phrases match only when every word appears — keep them specific (`dotnet pipe denied`, not
  `denied`). Avoid a **single generic word** (`configuration`, `permission`, `restart`): once it pairs
  with any second hit it drags the entry into unrelated messages. Never use a single character of a CJK
  script — it cannot earn the second hit that makes a match.
- **`status`** is `candidate` (default), `verified`, or `disputed`. Disputed entries are never indexed and
  never recalled.
- **`Evidence:`** is required when writing through `memory_write`. It must prove the claim **on its own**:
  the command, what went in, and what came back all belong in the line, so whoever opens the file next
  does not need another file to still exist. "See `probe.py`" is not evidence — the output is.

## Tools

| Tool | Purpose |
|---|---|
| `memory_list` | Names, trust statuses and titles — including entries past the index budget. |
| `memory_read` | One entry in full. |
| `memory_write` | Create or update; `evidence` required. Reports whether the entry is resident, and names any field it had to cut. |
| `memory_verify` | Promote to `verified`, or retire to `disputed`. |
| `memory_audit` | No `Evidence:`, untouched for long, prose not in English, `INDEX.md` drift in either direction. |
| `memory_health` | Whether memory is broken or merely had nothing to say: `ok`, `degraded`, `broken`, `absent`, `unconfigured`. |
| `memory_usage` | Which entries were ever read, and which never were. Entry names and dates only — never the query. |

## What it never does

- **Never calls a model or a service on the read path.** The index is computed from the filesystem; recall
  is a word comparison; both are pure functions of what is on disk.
- **Never writes without evidence.** `memory_write` refuses an empty one, and a clamped recall keeps the
  `Evidence:` line rather than dropping it — an entry without its evidence reads as an unverifiable claim.
- **Never executes a recorded command.** `memory_audit` checks age and completeness, never runs anything: a
  notebook is arbitrary markdown, and a checker that ran what it found would be an arbitrary-code surface.
- **Never rewrites an edited policy.** It seeds one into a notebook that lacks it, by exclusive create, and
  leaves an edited copy alone.
- **Never records what you searched for.** `usage.jsonl` holds a date and an entry name. No query text, no
  session id, no path.
- **Never loses an entry to the budget.** Over-budget entries are counted in the index and stay reachable
  by every tool.

## Questions

**Every `memory_*` tool reports `unknown tool`.**
The plugin failed to load. Almost always a schema the host rejects — the host validates tool schemas while
loading and rejects the whole plugin, not one tool. Check the host log; the rules it enforces are copied
into `tests/core.test.mjs` under *every tool schema stays inside the host subset*.

**Memory never fires.**
Call `memory_health` first. It separates "broken" from "nothing matched" — two states that look identical
from a query that returned nothing. If it says `ok`, the notebook is fine and the vocabulary is the
problem.

**An entry was written but is not in the index.**
It is past `indexBudgetChars`. `memory_write` said so in its `indexOverflow`; `memory_usage` shows whether
anything ever reads it.

**Memory stops being saved.**
The notebook directory is not writable. `memory_health` reports that specifically — it is the failure that
looks like everything working.

**Does it remember for me?**
No. It makes a curated notebook visible and lets the agent write back; the measurements above say why
automatic recall is off. The useful mental model is a well-indexed notebook, not an assistant.

**Why does the index order change on its own?**
It is ranked on every sync from trust status and how recently an entry was read, so the entries that
earned their place stay in front and a new one still gets its chance. Hand-editing `INDEX.md` is pointless
by design — see [ADR 0017](docs/adr/17-index-order-from-use.md).

## Limits this design accepts

- **Lexical matching, and it is the binding limit.** Around one question in five finds the right entry when
  phrased in words the notebook does not contain. Deliberate: the alternative costs a service or a model
  call per turn, and the published evidence that either buys answer quality does not hold up. The fix is
  vocabulary, not algorithm.
- **Nothing is captured automatically.** Closure is the model deciding to call `memory_write`. A one-shot
  hint before compaction nudges it; that is not raw event capture and is not claimed to be.
- **No visible "context injected" row.** A profile-linked bundle cannot import `@deepseek-ai/*` packages
  ([ADR 0001](docs/adr/01-zero-dependency-host-half.md)), so recall rides the runtime-context channel. The
  benefit: nothing enters the session log and the injection survives compaction.
- **`verified` is not enforced.** Anything the model writes is `candidate` until something promotes it, and
  the model can promote its own entry. It is a signal, not proof of human review.
- **No cross-workspace tier by default.** `machineDir` exists for it; off unless configured.

## Verify

```sh
node tests/core.test.mjs                    # behavioural checks, no dependencies
node scripts/mutation-scan.mjs              # 88 mutations, each must be killed
node scripts/eval-recall.mjs                # recall judgements over tests/qrels.json
node scripts/check-docs.mjs                 # ADRs listed, links, language pairs, locale keys, version
node scripts/check-paths.mjs                # no machine-specific paths in any document
node scripts/check-evidence.mjs --dir tests/fixtures/notebook
node scripts/check-index.mjs --dir tests/fixtures/notebook
```

CI runs all of them and blocks a merge. **The mutation scan is not decoration**: it breaks each
load-bearing line in turn and requires a test to fail, and it exits non-zero if a mutation no longer
applies — *a scanner testing less than it claims is the quietest way to lie.*

A passing local run proves less than it looks: `node --check` is not a type check, and the document checks
never look at JavaScript.

## Documents

| Question | Document |
|---|---|
| What does it promise, and how do I install it? | this README |
| How is it built, and what are the tradeoffs? | [docs/architecture-en.md](docs/architecture-en.md) |
| Why was a decision made the way it is? | [docs/adr/](docs/adr/) — one file per decision |
| Which test holds which decision in place? | [docs/traceability-en.md](docs/traceability-en.md) |
| What do the tests cover, and what do they not prove? | [docs/test-plan-en.md](docs/test-plan-en.md) |
| What does a term mean here? | [docs/glossary-en-zh.md](docs/glossary-en-zh.md) |
| What changed between versions? | [CHANGELOG.md](CHANGELOG.md) |
| How do we branch, commit and merge? | [CONTRIBUTING.md](CONTRIBUTING.md) |
| What are an assistant's rules here? | [AGENTS.md](AGENTS.md) |

## License

MIT. See [LICENSE](LICENSE).
