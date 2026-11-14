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
- **The mechanism is measured; the size of the cost is not.** The distinction matters, and it was blurred
  here for a day. What replicates:

  ```
  an identical prompt, sent twice      cold: created 3264, cached 0
                                       warm: created    0, cached 3264
  an unrelated prompt of equal size     cold: created 3264, cached 0
  ```

  Prefix caching on this deployment is real, observable, and matches on content — an unrelated prompt of
  the same length hits nothing. The field is `usage.prompt_tokens_details.cached_tokens`; the documented
  name `prompt_cache_hit_tokens` is not what this relay sends, and a probe looking only for that name
  concludes, wrongly, that nothing can be measured here.
- **What replicates.** With a retry loop making a real baseline obtainable, and a **unique changed marker
  per run**, four positions measured two or three times each, every one identical:

  ```
  first line of the system section     4032 of 4032 lost   (3/3 runs)
  last line of the system section       640 of 4032 lost   (2/2)
  head of the history                   576 of 4032 lost   (2/2)
  tail of the history                     0 of 4032 lost   (2/2)
  ```

  **Strict prefix matching, confirmed.** The cost is everything after the changed byte — no more, and no
  less. A change at the head is the whole prompt; a change at the tail is nothing.
- **This is why new entries are appended rather than prepended.** A prepended line shifts every existing
  line, so it costs what rewriting the section costs: 4032 tokens against 640, an 84% difference. And
  prepending buys nothing — the index is a per-session snapshot, so an entry written now is invisible to
  this session at any position, and equally visible to the next one.
- **Three probe bugs produced three fake findings before this**, and each one looked like cache behaviour
  rather than a defect: scenarios sharing a prefix, a per-scenario nonce that made them evict each other,
  and a changed marker reused between runs so that every run after the first measured a cache it had
  itself created. **A probe is an instrument; an unvalidated instrument reports its own noise.** The
  `INCONCLUSIVE` exit exists so a broken baseline stops the run instead of becoming a result.
- **The 4160-token figure in this ADR's first version is withdrawn.** It came from a run whose warm
  request reported `cached 0`, so the number it was subtracted from was inferred rather than measured.
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
- **No test asserts the cache behaviour itself**, and none can: the suite never calls the API. `scripts/cache-probe.mjs`
  is the manual instrument, and its own history is a caution — it reports `INCONCLUSIVE` and exits non-zero
  when the warm request does not hit, because a probe that reports a difference against a broken baseline
  manufactures a finding. **Three of its four designs produced numbers that were wrong**, each time by
  measuring something other than what it claimed.
