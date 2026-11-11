# 0013 — Recall usage is counted per entry, and records nothing else

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** —

## Context

The plugin could not answer the one question worth asking of a memory system after it has been in use:
**is any of this doing anything?**

An entry recalled many times and opened once is dead weight, and nothing noticed. The notebook could
fill with entries nothing ever matches, and the index budget would be spent on them, while the entries
that matter competed for room. Every mechanism for finding that out requires knowing what recall did,
and the plugin kept no record at all.

The surveys offered two designs, and both had a cost worth arguing about:

- **`dsh-auto-memory`'s delivery ledger**: which memories entered a request, per session and turn, with
  a stated delivery state. Detailed, and it stores session identity and term digests — a privacy
  projection it has to explain.
- **`agent-memory`'s access log**: reads and recalls per entry, feeding a weight that settles over
  sleep and can propose a never-recalled entry for deletion. Effective, and its log lives in `.index/`,
  a rebuildable cache — so `rm -rf .index` silently discards the entire usage history.

## Decision

**A per-entry counter, and nothing else.**

`usage.jsonl` beside the entries gets one line per recall: `{"d":"YYYY-MM-DD","e":"entry-key"}`. No
query text, no session id, no path, no turn, no outcome. `memory_usage` reads it and reports two lists:
entries recall has never published, and entries it has, with a count.

It lives **in the notebook, not in a cache** — the usage history is not rebuildable, so it must not sit
anywhere a routine clean-up deletes.

## Consequences

- The finding is per entry, which is the granularity at which something can be retired. A total would
  hide the one entry nobody uses.
- **The count means sessions reached, not matches found.** An entry already injected in a session is not
  injected again, so one session contributes at most one line per entry. Said plainly in the tool
  description, because a field named "recalls" invites the other reading.
- The log cannot answer "which query failed to match". That is a real loss, and it is the deliberate
  price of not storing what the user typed. Vocabulary is grown by reading the conversation, not by
  mining a transcript.
- Nothing is inferred and nothing is enforced: the report names candidates, and retiring one stays a
  decision made with `memory_verify`.
- Writing is best-effort. A failed append is swallowed, because telemetry is never worth breaking a
  recall over — and a missing line biases the report toward "unused", which is the safe direction.
- Rotation is unnecessary at this scale and is not implemented. Deleting the file resets the counts;
  nothing else depends on it.

## Alternatives rejected

- **Store the query that failed to match.** It would make vocabulary work cheaper and turn the
  notebook's neighbour into a transcript of the user's work. Declined on privacy grounds.
- **Full delivery-state ledger.** Worth it for a system that injects thousands of entries per session
  and can lose them in transit. This plugin injects one bounded index and at most two entries per turn,
  so the state machine would be ceremony.
- **Weight settling and automatic delete proposals.** A weight is only meaningful with enough reads to
  settle, and a notebook of tens of entries does not produce them. Naming the candidate is enough; the
  user decides.
- **Put the log in the plugin's data directory.** It is the first thing a cache clean-up removes, and
  the history cannot be rebuilt from the entries.
