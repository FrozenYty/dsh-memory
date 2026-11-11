# 0011 — Recall is measured against written judgements, not a benchmark

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** —

## Context

Every recall change so far — the Chinese-word rule, the mixed-script tokenizer fix, the strong-match
requirement, the trigger re-tuning — was judged by a test set the same person wrote as the
implementation. That set found real defects, but only after the defects were already visible for
another reason. It also reported `15/15` and `1/41` as if those numbers meant something.

They do not, quite. At n=15 a perfect score has a 95% interval of 0.796–1.000; at n=41, one false
positive spans 0.004–0.126. **The suite could not distinguish a one-case change from noise**, so
"this improved recall" was not a claim it could support.

A survey of open-source memory systems made the point harder to ignore: every published number
checked either failed to reproduce, or reproduced without moving answer quality. `agent-memory`
reports +7.6pp Recall@5 from adding vector fusion and, in the same paragraph, answer replay 17/24 vs
18/24. `basic-memory`'s own table shows a grep baseline at recall@5 0.846 in 5ms against 0.951 in
754ms for the full stack.

## Decision

**A written judgement set, asserted case by case, run in CI.**

- `test/qrels.json` states, for 52 queries, which entry must be recalled first, and for 24 off-topic
  queries, that nothing may be. Each case is a claim about behaviour, so one flip is a result — not a
  delta to average away.
- `scripts/eval-recall.mjs` runs them and reports per-entry reachability plus a Wilson interval on
  each rate. The interval is printed because it is the honest answer to "how much do these totals
  tell us", and at this size the answer is "less than you would like".
- The fixture notebook grew from 5 to 13 entries, because a fixture smaller than the real corpus
  cannot model its false positives.
- `test-core.mjs` reads the off-topic list from the same file, so the two suites cannot drift.

## Consequences

- A change that flips any case fails CI. Accepting an intended flip is a reviewed edit to a data
  file, visible in the diff — which is the point: changing the expectation becomes a decision someone
  can see, rather than a side effect of changing the code.
- Reachability is counted per entry, so an entry nothing can reach is a failure rather than a share
  of an aggregate.
- The interval reports the limit instead of hiding it. At 52 cases a two-case change is not
  statistically distinguishable, and the tool says so rather than implying a conclusion.
- The judgement set is now the thing to extend. It is cheap to grow — one line per claim — and it is
  the only asset here that gets more valuable with the corpus.

## Alternatives rejected

- **A benchmark corpus (LongMemEval and similar).** They measure retrieval over thousands of sessions.
  This notebook has tens of entries, and the survey found the published benchmarks either
  unreproducible or disconnected from answer quality. A judgement set over the actual corpus is
  smaller, honest, and about the case that matters.
- **Statistical significance as the gate.** With 52 cases it would pass changes that matter and fail
  ones that do not. Assertion is stricter and more legible.
- **A single aggregate score.** It hides an unreachable entry, which is the failure most worth
  catching.
