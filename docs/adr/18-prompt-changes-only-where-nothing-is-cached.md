# 0018 — A prompt section may change only where there is no cache to lose

## The decision

**Everything this plugin injects into a prompt is either frozen for the life of a session, or absent.**
A value that has to change is not admitted at all, and a value that is admitted changes exactly once —
when a session begins, before anything has been sent, where nothing is cached yet.

Stated as a rule to check a future change against:

> **Would this make bytes that have already been sent come out different?**
> If yes, it must happen at session start, or not at all.

The prompt is assembled from two surfaces, and the rule applies to both:
`ctx.systemPrompt.section` lands at the head of the prompt (surface node 0, in
`@deepseek-ai/dsh-agent-loop`'s terms), and `ctx.systemPrompt.context` lands as one message inside the
history. Prefix caching matches from the start, so a changed byte at the head invalidates everything
after it, while a changed history message invalidates only what follows that message.

## What it costs to get this wrong

The index is a `systemPrompt.section`, so it sits at the head. An entry written during a session used to
change it on the next turn, which invalidated the cache for the whole conversation behind it — **one full
recompute per memory write, on a plugin whose entire premise is being cheap**. Nothing tests prompt-cache
behaviour, so the cost was invisible: the plugin kept working, the note kept being saved, and the only
symptom was a bill nobody was reading.

Two versions were needed to close it, and the intermediate one was wrong in a way worth recording.

- **0.23.4 — order is re-ranked only once the notebook overflows.** Below `indexBudgetChars` every entry
  is named regardless of position, so the ranking decided nothing while still being recomputed on every
  sync. Since `usage.jsonl` feeds the ranking, a session that merely *read* an entry reordered the next
  session's index.
- **0.23.5 — the index is a per-session snapshot.** A write still changes what the *next* session sees,
  but not the session that made it. Refreshing at session start is free, because a session that has not
  been sent has no cache to lose.

## Two claims that were wrong, and why

Both were made in this repository's own changelog before being corrected, and both are the same mistake:
**reasoning about the mechanism without asking what was actually constrained.**

**Wrong: "stopping the re-rank will reduce write-time invalidation."**
It could not. Inserting a line at the top of the index and re-ranking the whole index both make the first
line differ, and a prefix cache compares from the first line. **The cost of a change is not what varies
between those two designs — only its timing does.**

**Wrong: "write-time invalidation is inherent."**
It is inherent to the index *changing*. It is not inherent to **when** the change happens. A snapshot
taken at session start and held is still a change, it just lands where nothing has been cached.

**The generalisable form**: a prefix cache constrains *the cost of a change*, never *the choice of when
to make it*. Confusing the two is what produced both errors, and the second one nearly closed the
question — a claim of "inherent" ends the search.

## What this does not do

- **It does not make the plugin cache-neutral.** A session that writes an entry is not disturbed; the
  next session sees a different index, and pays for it. That is the correct place to pay and it is still
  a payment.
- **It does not cover `recallEnabled: true`.** The recall text is re-evaluated per step, so a turn whose
  match changes replaces the runtime-context message and invalidates what follows it. DSH limits the
  damage — a snapshot is committed only when its text differs (`dsh-agent-loop`, *"Create an uncommitted
  snapshot only when the retained value differs"*) — so an unmatched turn costs nothing. But the
  frequency is the caller's, not ours, and it is one more reason the default is off
  ([ADR 0015](15-recall-is-model-driven-by-default.md)).
- **It is now measured, and it was measured last.** For two versions the reasoning above rested on the
  mechanism alone, and the ADR said so. A probe against the relay in use settled it — and corrected the
  claim that it *could not* be settled: the field exists under a name this repository had not looked for.

  ```
  request 1  index A + history      prompt 4223, cached    0, created 4160
  request 2  index A + history      prompt 4223, cached 4160, created    0
  request 3  index B + history      prompt 4223, cached    0, created 4160
  ```

  Request 3 differs from request 2 by **one character, on the last line of the index**. It recomputed the
  whole 4160-token prefix. **A one-character edit at the front costs the entire conversation behind it**,
  which is the entire justification for this ADR and is now an observation rather than an inference.
- **The relay reports cache accounting as `usage.prompt_tokens_details.cached_tokens`**, not as
  `prompt_cache_hit_tokens`. A probe looking only for the latter name concludes, wrongly, that the
  deployment cannot be measured — which is what happened here first. The same payload carries
  `created_cache_tokens`, which is what makes a cold/warm pair interpretable.
- **It does not constrain the harness.** Long sessions are compacted, which rewrites the prompt and
  invalidates everything; capture hints are injected once per session. Neither is this plugin's doing,
  and both will dominate any hit-rate observation.

## Consequences

- **The index is a snapshot of the notebook as the session began.** An entry written mid-session is absent
  from that session's index and present in the next one's. It is not hidden: it is in the conversation
  that wrote it, `recall` matches every entry regardless of the index, `memory_list` names them all, and
  `INDEX.md` on disk is updated immediately.
- **Re-ranking is gated on overflow** ([ADR 0017](17-index-order-from-use.md)), because below the budget
  position decides nothing and the ranking would be pure cost.
- **`indexBySession` must be released on `session/disposed`**, with the rest of the per-session state. A
  cache that outlives its session holds a full index string per session for the life of the process.
- **A new injected value has to answer the rule before it ships.** Being cheap per token and being cheap
  per cache miss are different questions, and this plugin is only the first of them by construction.
- **Two tests hold this in place**: a read does not reorder a notebook that fits, and an entry written
  mid-session stays out of that session's index. Both were confirmed by reverting the change and watching
  them fail.
- **No test asserts the cache behaviour itself**, and none can: the suite never calls the API. The probe
  that produced the numbers above lives outside the repository, in a session scratch folder. **Re-running
  it after a change to prompt injection is the manual step this ADR cannot automate.**
