# Traceability

> Chinese version: [traceability-zh.md](traceability-zh.md). This file is the source of truth.

> Owner: @FrozenYty · Revisit when: an ADR is added, or a guarantee loses its test

Every accepted decision, and **what holds it in place**. A decision recorded in prose and a decision
enforced by something that can fail are different things until this table is filled in — and the last
column is the honest part.

Test names are quoted as they appear in the suite, so a rename that breaks this table is visible as a
stale quote rather than a silent gap.

## 1. Decisions with enforcement

| ADR | Held by | Layer |
|---|---|---|
| [0001](adr/01-zero-dependency-host-half.md) no `@deepseek-ai` import | `package.json` has no `dependencies`; the Host half imports only `node:` builtins. CI's `node --check` would not catch a new import — **the loader would** | structural |
| [0003](adr/03-match-only-recall-into-runtime-context.md) recall rides the runtime context channel | `a host without systemPrompt.section fails loudly`; the section callback is invoked directly in §22 | behavioural |
| [0004](adr/04-bilingual-triggers.md) triggers carry the author's own language | `triggers stop being split on separators`, `a short Chinese run stops being kept whole`, `a two-character Chinese trigger reaches the floor alone` | behavioural + mutation |
| [0005](adr/05-trust-status-and-mandatory-evidence.md) every write carries evidence | `a memory needs evidence` (throws on empty); `an entry without an Evidence line is reported` | behavioural |
| [0006](adr/06-evidence-audit-by-age.md) audited by age, never executed | `age stops being reported` (mutation), `entries age after one day` (mutation). **Nothing ever runs the recorded command** — that is the decision, and its enforcement is the absence of an `exec` call | mutation |
| [0008](adr/08-policy-template-and-seeding.md) policy ships and is seeded | `the bundled policy template ships`, `a second seed is a no-op`, `an edited policy is never overwritten`, `an existing policy is overwritten` (mutation), `the policy template stops shipping` (mutation) | behavioural + mutation |
| [0009](adr/09-derived-index-and-write-refusal.md) index is derived | `index is derived, not hand-maintained` (§12), `the notebook order stops following INDEX.md` (mutation) | behavioural + mutation |
| [0011](adr/11-judgement-set-for-recall.md) measured against written judgements | `tests/qrels.json` exists, is read by two independent suites, and `scripts/eval-recall.mjs` reports 52/52 and 24/24 | judgement set |
| [0012](adr/12-health-check.md) capability diagnosed separately from results | `broken is not the same as empty` (§15); `absent is reported as broken` (mutation) | behavioural + mutation |
| [0013](adr/13-usage-counts.md) counted per entry, nothing else recorded | `the log records a day and an entry name and nothing else`, `no query text reaches the log`, `the usage count stops being per-entry` (mutation) | behavioural + mutation |
| [0014](adr/14-index-budget-is-residency.md) budget caps residency, not capacity | `the budget caps residency, not capacity` (§13); `only one hit is ever returned` (mutation) | behavioural + mutation |
| [0015](adr/15-recall-is-model-driven-by-default.md) recall off by default | `recallEnabled: false` in `DEFAULTS`; `a read through the tool is counted as usage` (§20) keeps the model-driven path measurable; `tests/hostile.json` is the evidence for the decision | behavioural |
| [0016](adr/16-index-carries-summaries.md) index carries a summary | `the summary reaches the index`, `a summary in the frontmatter wins over the heading`, `a summary is not carried across an update` (mutation), `unknown frontmatter keys are dropped` (mutation) | behavioural + mutation |

## 2. Decisions that are conventions, not mechanisms

These cannot fail a build, and pretending otherwise would be worse than saying so.

| ADR | Why there is no test | What would change that |
|---|---|---|
| [0002](adr/02-filename-index-without-descriptions.md) — **superseded by 0016** | The decision was reversed; the supersession marker is the record | — |
| [0007](adr/07-policy-in-the-notebook.md) — **superseded by 0008** | Same | — |
| [0010](adr/10-capture-hint.md) a capture hint before compaction | The hint is a sentence in `index.js`'s prompt section. A test asserts the tool exists and the schema parses; **nothing asserts the hint is good advice** | Only a real session can — this is the same open question as ADR 0015 |

## 3. Guarantees with a known gap

| Guarantee | The gap | What covers it instead |
|---|---|---|
| The Host half is dependency-free (0001) | No test imports `package.json` and asserts `dependencies` is absent | CI installs from a lockfile with no dependencies; an import would fail at load |
| Recall quality on **real** notes | The judgement set runs against the frozen fixture, not the author's notebook | The reader's own judgement, and `memory_usage` showing what was actually read |
| The index reaches the model | `indexInjected` is recorded from the section callback, so it proves **the plugin emitted text**, not that a model read it | Only a real session |
| The notebook language rule | `memory_audit` reports Chinese prose, but nothing prevents a write in Chinese — the check is after the fact, deliberately: refusing a write over language would block a good entry | The audit, plus the rule now stated in the policy and in `memory_write`'s description |
| `memory_audit`'s own correctness | Its output is asserted on synthetic entries, never on the live notebook | Running it — which is how the six Chinese entries were found |

## 4. What this table is for

Three uses, in the order they have actually mattered:

1. **Finding the decisions with no enforcement** — writing it is how the language rule's absence became
   visible, and how `summary:` doing nothing was caught after the fact.
2. **Finding the stale quotes** — a test renamed without updating this file leaves a name that no longer
   exists, which `grep` finds in one command. *This table is not machine-checked; that is its weakness,
   and the one-line fix is a gate that greps each quoted name against the suite.*
3. **Answering "is this decision actually followed?"** without reading 16 ADRs and 184 tests.

## 5. Adding a row

An accepted ADR gets a row in §1, §2 or §3 — **there is no fourth option**, and picking §2 or §3
requires writing a sentence about why nothing enforces it. That sentence is the point: it is what stops
"we decided this" from being mistaken for "this happens".
