# Test plan

> Chinese version: [test-plan-zh.md](test-plan-zh.md). This file is the source of truth.

> Owner: @FrozenYty · Revisit when: a layer is added, or a claimed guarantee stops being one

What is tested, at which layer, and — the part usually omitted — **what none of it proves**. The last
section is the reason this document exists: a suite that is trusted beyond its reach is worse than a
smaller one that is not.

## 1. The layers

Five layers, cheapest first. Each answers a question the one below it cannot.

| Layer | Command | Answers | Cost |
|---|---|---|---|
| **Behavioural** | `node tests/core.test.mjs` | Does the code do what the ADRs say? | ~1 s |
| **Recall judgements** | `node scripts/eval-recall.mjs` | Does a given query reach the entry a human says it should? | ~0.5 s |
| **Hostile queries** | `node scripts/eval-hostile.mjs --dir tests/fixtures/notebook` | Does ordinary talk that shares vocabulary stay silent? | ~0.5 s |
| **Mutation scan** | `node scripts/mutation-scan.mjs` | Would the suite notice if this line broke? | ~2 min |
| **Assertion strength** | `node scripts/assertion-strength.mjs` | Can this assertion fail at all? | ~0.2 s |

Plus six **gates** that inspect documents and history rather than behaviour: `check-docs`,
`check-paths`, `check-evidence`, `check-index`, `check-commit-messages`, and `node --check` on both
sources. All of them run in CI and block a merge.

## 2. What each layer holds

### Behavioural — `tests/core.test.mjs`

**184 checks in 22 sections**, against `tests/fixtures/notebook` only: a test that needs data outside
the repository passes here and fails in CI, which is exactly what happened before the fixture existed.

| § | Covers |
|---|---|
| 1 | Discovery, index construction, budget, empty notebook |
| 2 | Tokenising, the acknowledgement gate, prefix floor |
| 3–4 | Recall on English and on plain Chinese queries |
| 5 | Rendering stays inside its budget without losing `Evidence:` |
| 6 | Trust status, writing, frontmatter carry-through |
| 7 | Evidence hygiene, language, duplicate evidence lines |
| 8 | Index drift, both directions |
| 9 | Policy seeding and never overwriting |
| 10–11 | False-positive budget; glued mixed-script input |
| 12–13 | Derived index; budget is residency, not capacity |
| 15 | Health: broken is not the same as empty |
| 16 | Usage log format, recovery from a collapsed file |
| 17–18 | Tool schemas stay inside the host subset; the host API guard |
| 19–20 | Malformed entry still loads; a read is counted |
| 21–22 | Path resolution and dedup; every directory seeded and synced; dates are local |

### Recall judgements — `tests/qrels.json`

**52 on-topic + 24 off-topic**, each stating which entry must be found first, or that nothing may fire.
Written by the author, not scraped: the question is whether the rule matches a human's sense of
relevance, not how it ranks against another implementation (ADR 0011).

A flipped case is a **result**, not a side effect — fix the rule, or change the judgement deliberately.

### Hostile queries — `tests/hostile.json`

**18 cases, 16 expected silent**, each with a note saying why. Ordinary talk that shares vocabulary with
the notebook. **This layer fails today** — 4 of 18 fire — and that failure is the documented reason
`recallEnabled` defaults to `false` (ADR 0015). It is not in CI for that reason; it is a measurement,
not a gate.

### Mutation scan — `scripts/mutation-scan.mjs`

**73 mutations, 73 killed.** Each breaks one line the way a plausible mistake would, then runs the whole
suite. A survivor means no test noticed — either an uncovered line or an equivalent change, which the
scan cannot tell apart.

The scan restores both sources after every mutation and re-verifies at the end; the caller compares
SHA256 against a backup. **A tool that edits source and can leave it broken on a crash is worse than no
tool** — that is why the restore is not a `catch` but a `finally` plus a verification pass.

It exits 1 if a mutation does not apply, because **a scanner testing less than it claims is the quietest
way to lie**.

### Assertion strength — `scripts/assertion-strength.mjs`

**164 assertions parsed, 2 suspicious, both legitimate.** Finds assertions that cannot fail: a literal,
only `!== undefined`, only "not empty", a tautology. It flags; a human decides — `x === true` is strong
or weak depending on what `x` is.

## 3. The worked example that justifies the layers

The 39-mutation scan once reported **39 killed, 0 survived** while two of five fixes had no protection.
Reverting the code to its pre-fix state left the suite green:

| Defect | Caught by the reverted run? | Why |
|---|---|---|
| Update erased `summary` | yes, 4 tests | asserted on content |
| Unknown frontmatter key erased | yes | same |
| Directory named twice counted twice | yes, 1 test | asserted on a count |
| **Dates were UTC** | **no** | ran at 11:30, when UTC and local share a calendar day — it only distinguishes them between 00:00 and 07:59 |
| **Only the first directory was seeded/synced** | **no** | the suite only ever configured one directory |

Both gaps were closed — the date with a **static** guard no clock can dodge, the directories by invoking
the real `systemPrompt.section` callback. The scan now reports **8 failures on the pre-fix code**.

**The lesson is in the numbers**: a green suite and a meaningful suite are different measurements, and
only the second one was being reported.

## 4. What none of this proves

- **73 mutations over ~950 lines is a sample.** It says every construct it touches is defended. It does
  not say the untouched remainder is.
- **The assertion checker cannot judge intent.** It finds suspicious shapes, not wrong assertions.
- **Neither tool can find a bug nobody thought to break.** They measure the tests, not the plugin.
- **The behavioural suite is not a type check.** `node --check` is syntax only, and the document gates
  never look at JavaScript.
- **Recall quality is measured on a fixture, not on the author's notebook.** The fixture is frozen on
  purpose (its `README.md` says why), so a rule that works there may still misfire on real notes.
- **Nothing here tests DSH itself.** The host's schema validator, prompt channels and event names are
  taken as given; ADR 0001 explains why they cannot be imported and therefore cannot be asserted on.

## 5. When a test is considered done

One rule: **revert the fix and watch the suite fail.** A test that cannot fail is decoration, and the
mutation scan exists because reading a test cannot tell you which kind it is.

Corollary: **a fix reported without that check is a guess.** Both defects in §3 were "fixed and tested"
before the revert showed the tests were passing for the wrong reason.
