# Tasks

> Owner: Yao Tianyu · Revisit when: a task is delivered or re-scoped

Single source of truth for tasks. No issue tracker — this file is the contract.

Phase status lives here. Why it moved lives in `PROGRESS.md`. What a person who installs the bundle gets
lives in `CHANGELOG.md`.

## 1. How to use this file

- Every task has an ID (`P3-02`). Reference it in the PR title when the PR delivers it:
  `fix: … (P3-02)`.
- Tick the box **in the same PR that delivers the task**. Nobody ticks it for someone else.
- Every task states **"Done when"** as a command that can fail, not a feeling. A task without one is not
  ready to start.
- A phase gate is a hard stop: the next phase does not start until every box in the current one is ticked,
  including the gate box.
- Editing a task is a normal commit. Moving a **gate** needs the owner to agree first.

## 2. What this repository is for

A profile bundle that turns a directory of markdown files into an agent's memory — a resident index, one
file per subject, seven tools, no embeddings and no service. The whole argument is in
[`docs/architecture-en.md`](docs/architecture-en.md); the measurements that constrain it are in
[`tests/qrels.json`](tests/qrels.json) and ADR 0018.

Two things it must never become: a service, and something that costs more in prompt cache than it saves in
re-explanation.

## 3. Phases

### P0 — Repository

- [x] **P0-01** Initialise the bundle and the document set (README pair, AGENTS, CONTRIBUTING, `docs/`,
      ADRs, tests) with no dependency and no build step.
  Done when `node --check index.js` passes and the tool schemas load in a real profile.
- [x] **P0-02** CI runs the checks on every pull request.
  Done when `.github/workflows/ci.yml` exists and a pull request shows the `check` job green.
- [x] **P0-03** One local entry point, matching the sibling plugins.
  Done when `node scripts/check.mjs` exits 0 on a clean tree, runs exactly the set CI runs, and exits
  non-zero naming the failing step when a check is broken. *(P0 gate)*

### P1 — The notebook and its tools

- [x] **P1-01** Discovery, `INDEX.md` ordering, frontmatter, and the derived index.
  Done when a file written outside the plugin appears in the index and a deleted one leaves it.
- [x] **P1-02** Seven tools with mandatory evidence and three trust states.
  Done when a write without `evidence` is refused and a `disputed` entry leaves both index and recall.
- [x] **P1-03** Recall: Latin and CJK tokenising, whole phrases, rarity weighting, the acknowledgement
      gate, and a measured false-positive budget.
  Done when `tests/qrels.json` holds on all three sets and 0 of 24 off-topic queries fire.
- [x] **P1-04** Diagnosis: `memory_health` separates *broken* from *nothing matched*.
  Done when each of `ok`/`degraded`/`broken`/`absent`/`unconfigured` has a test. *(P1 gate)*

### P2 — Prompt stability

The index is a `systemPrompt.section`, so anything that changes it costs cache for the whole conversation
behind it. This phase is about not paying for nothing.

- [x] **P2-01** Re-rank the index only once the notebook overflows.
  Done when a read cannot reorder a notebook that fits.
- [x] **P2-02** The index is a per-session snapshot, so a write cannot disturb the session that made it.
  Done when a mid-session write stays out of that session's index and appears in the next one's.
- [x] **P2-03** Measure what a prompt change costs, and record the rule in an ADR.
  Done when `scripts/cache-probe.mjs` reports four reproducible positions and
  [ADR 0018](docs/adr/18-prompt-changes-only-where-nothing-is-cached.md) states the rule. *(P2 gate)*
- [x] **P2-04** Append new entries rather than prepending them.
  Done when the measured 4032-vs-640 difference justifies the change and the tests assert the append.

### P3 — What is still owed

- [x] **P3-01** The traceability table is not machine-checked.
  `docs/traceability-en.md` names tests in prose; renaming a test leaves the row silently pointing at
  nothing. Done when a check fails on a table row that names a test which does not exist.
  *(Done 2026-11-16: `scripts/check-traceability.mjs` found five such rows on its first run. It checks
  both language tables, and a rename in the suite makes it exit 1 naming the file, line, ADR and quote.)*
- [ ] **P3-02** `extractQuery` keeps the newest message's tail; a single message over the limit still loses
      its beginning.
  Acceptable for a paste, unmeasured for a long instruction. Done when a 3000-character message that ends
  with a real request is shown to keep it.
- [ ] **P3-03** The budget cut is computed in two places — `indexResidency` on the write path and
      `syncIndexFile` on the sync path.
  Done when a test asserts both name the same set at the same budget.
- [ ] **P3-04** The cache block size is unknown: 3129 prompt tokens yielded 3072 cacheable, a multiple of
      64, from one sample.
  Done when `cache-probe.mjs` varies the length and reports the quantum, or when it is recorded that one
  sample cannot settle it.
- [ ] **P3-05** 32 of 64 entries have never been read, all 1–4 days old.
  Not a defect — they are recent. Done when a criterion separates "not needed yet" from "never will be",
  and `memory_usage` reports against it.
- [ ] **P3-06** `usage.jsonl` cannot tell an evaluation run from real use; 183 of 252 records came from
      `eval-recall` on 2026-11-11 and they inflate the top of the ranking.
  Done when a record carries its origin, **or** when it is recorded that the top of that list should not
  be trusted.
- [ ] **P3-07** `cache-probe.mjs` measures one scenario per run and its cost estimate does not replicate
      across runs of the *same* scenario.
  Done when a run's figure repeats, or when the variance is characterised and written down.

## 4. Deliberately not tasks

- **A UI.** There is none in the family; a plugin page is the product's job.
- **Embeddings or a service.** ADR 0001 and the measurements in `README.md` settle it; revisiting would
  need evidence, not an opinion.
- **Cross-workspace sharing.** `machineDir` exists and is off by default. Turning it on is a decision, not
  a task.
