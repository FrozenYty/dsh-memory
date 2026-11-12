# Documentation map

> Chinese version: [INDEX-zh.md](INDEX-zh.md). **This file is the source of truth** — where the two
> disagree, this one wins and the Chinese one is behind.

> Owner: @FrozenYty · Revisit when: a document is added, renamed or removed

One page that answers three questions: which document answers what, which one wins when two of them
disagree, and which other files have to change when you touch one. Read this before opening anything
else.

## 1. Where to start

| Question | Read |
|---|---|
| What does this plugin do, and how do I install and configure it? | [README.md](../README.md) |
| How is it built, and what are the tradeoffs? | [architecture-en.md](architecture-en.md) |
| Why was a decision made the way it is? | [adr/](adr/) — one file per decision |
| How do I branch, commit, and pass CI? | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| I am an AI assistant starting work here | [AGENTS.md](../AGENTS.md) |
| What changed between versions? | [CHANGELOG.md](../CHANGELOG.md) |
| What does a term mean here? | [glossary-en-zh.md](glossary-en-zh.md) |
| What do the tests cover, and how is that proved? | [test-plan-en.md](test-plan-en.md) |
| Which test holds a given decision in place? | [traceability-en.md](traceability-en.md) |

## 2. Which one wins

- **A decision record beats a design document.** `docs/adr/` holds decisions that were expensive to
  reverse. `architecture-en.md` describes the current shape; where they disagree, the ADR is the
  authority and the design document is stale.
- **An accepted ADR is closed.** To change a decision, write a new ADR that supersedes it and mark the
  old one `Superseded by NNNN`. Never edit the decision itself to match the present.
- **The code beats both.** If the code and a document disagree, the code is what runs; fix the document
  in the same change.
- **The English half beats the Chinese half.** Every document under `docs/` is an `-en` / `-zh` pair.
  Any disagreement between them is translation lag: `-en` is authoritative, and the fix is to update
  `-zh`.

## 3. What changes together

| Changing | Also change |
|---|---|
| A default in `index.js` | the configuration table in `README.md` **and** `README-zh.md`; `scripts/check-docs.mjs` fails when a key is missing from either |
| A tool name, argument or required field | the tools table in both READMEs, and `docs/architecture-en.md` / `architecture-zh.md` |
| The index or recall budget model | `docs/architecture-*.md` and the cost table in both READMEs |
| Adding a behaviour with a non-obvious tradeoff | a new ADR, and its row in [§5](#5-decision-records) |
| Any user-visible behaviour | `CHANGELOG.md` |
| An entry format field (`triggers`, `status`, `Evidence:`) | both READMEs, `architecture-*.md`, the `memory_write` description |
| Adding or changing a `scripts/*.mjs` gate | the `check` job in CI, and the tables in `AGENTS.md` **and** `CONTRIBUTING.md` |
| The trigger-matching rule (weights, phrases, prefix) | `docs/architecture-*.md`, and the trigger note in both READMEs |
| A recall judgement (what should match what) | `tests/qrels.json` — a flipped case fails CI, so the edit is a reviewed decision, not a side effect |
| A string the plugin page shows (`locale/*.json`) | both languages; `scripts/check-docs.mjs` fails when the key sets differ |
| A version in `package.json` | a `## [x.y.z]` section in `CHANGELOG.md` — one change, and `check-docs` enforces it |
| Adding a `docs/*-en.md` | **the `-zh.md` of the same name**; `scripts/check-docs.mjs` fails when a pair is incomplete |
| A line in `README.md` | English, except the language switcher; `check-docs` fails on any Chinese there. Tokeniser examples in `docs/` keep their original script, because CJK bigram behaviour cannot be shown without one |

## 4. Conventions

- **Everything under `docs/` is an `-en` / `-zh` pair**, enforced by `scripts/check-docs.mjs`. The
  English half is authoritative. The Chinese half is written as Chinese prose, not translated word for
  word.
- **`README.md` is English and `README-zh.md` is Chinese**, each linking to the other as the language
  switcher.
- **`CHANGELOG.md` is English only.** It is appended to in order, and translating it would mean
  maintaining two histories for every release. It is a record, not a document.
- **`docs/adr/` is English only.** An ADR is a decision record read by whoever implements next, and
  that reader's language has nothing to do with the conversation that produced it.
- **`AGENTS.md` and `CONTRIBUTING.md` are English only.** They are instructions to an assistant and to a
  contributor, not reader-facing documents; the conversation they arise from is in Chinese, and
  translating them would put a second copy of the rules somewhere to drift.
- **Nothing machine-specific.** No absolute paths, no user names, no local folder names. Commands are
  written relative to the repository root. `scripts/check-paths.mjs` enforces this across every
  markdown file.
- **A decision expensive to reverse becomes an ADR**, not a paragraph in a changelog. One decision,
  one file; never write it twice.

## 5. Decision records

| # | Decision | Status |
|---|---|---|
| [0001](adr/01-zero-dependency-host-half.md) | The Host half imports no `@deepseek-ai` package | Accepted |
| [0002](adr/02-filename-index-without-descriptions.md) | The injected index is bare filenames, with no descriptions | Superseded by 0016 |
| [0003](adr/03-match-only-recall-into-runtime-context.md) | Recall is match-only and rides the runtime context channel | Accepted |
| [0004](adr/04-bilingual-triggers.md) | Entries carry explicit recall words, in the author's own language | Accepted |
| [0005](adr/05-trust-status-and-mandatory-evidence.md) | Every write carries evidence; trust is a three-state field | Accepted |
| [0006](adr/06-evidence-audit-by-age.md) | Evidence is audited by age and completeness, never by execution | Accepted |
| [0007](adr/07-policy-in-the-notebook.md) | The notebook's policy lives in the notebook, not in a skill | Superseded by 0008 |
| [0008](adr/08-policy-template-and-seeding.md) | The policy ships with the plugin and is seeded where a notebook lacks one | Accepted |
| [0009](adr/09-derived-index-and-write-refusal.md) | The index is derived data; a write that would truncate it is refused | Partially superseded by 0014 |
| [0010](adr/10-capture-hint.md) | A capture hint before compaction, not automatic capture | Accepted |
| [0011](adr/11-judgement-set-for-recall.md) | Recall is measured against written judgements, not a benchmark | Accepted |
| [0012](adr/12-health-check.md) | Capability is diagnosed separately from results | Accepted |
| [0013](adr/13-usage-counts.md) | Recall usage is counted per entry, and records nothing else | Accepted |
| [0014](adr/14-index-budget-is-residency.md) | The index budget caps residency, not capacity | Accepted |
| [0015](adr/15-recall-is-model-driven-by-default.md) | Recall is model-driven by default | Accepted |
| [0016](adr/16-index-carries-summaries.md) | The index carries a one-line summary per entry | Accepted |

Add a row here whenever an ADR is added. `scripts/check-docs.mjs` fails the build when an ADR
exists on disk but is not listed in this table.
