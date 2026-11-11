# 0003 — Recall is match-only and rides the runtime context channel

- **Status:** Accepted
- **Date:** 2026-11-11
- **Superseded by:** —

## Context

When a message matches an entry, the entry has to reach the model. Three surfaces were available,
with different failure modes:

| Surface | Visible to the user | Survives compaction | Enters the session log | Needs `createUserMessage` |
|---|---|---|---|---|
| Synthetic user message via `agent/pre-step` | yes, as a "context injected" row | no — it is conversation history | yes | yes |
| Dynamic `systemPrompt.section` | no | yes | no | no |
| Dynamic `systemPrompt.context` | no | yes | no | no |

[ADR 0001](01-zero-dependency-host-half.md) removes the first row from consideration: a linked
bundle cannot import the message constructor. That leaves the two prompt surfaces.

A `section` is the stable part of the prompt. Putting per-turn recall there would change the
reusable prefix on every turn, which is the one thing a section exists to keep stable. `context` is
the harness's channel for facts that change per step; recall is exactly such a fact.

## Decision

Recall is published through `ctx.systemPrompt.context`, keyed by the session's current query.

- The query is captured on `agent/inbox/claimed` and stored per session.
- The first assembly of a turn computes the match and caches the rendered text against that query.
- Later steps of the same turn return the identical text, so the prefix does not churn within a turn.
- A new claim clears the cache; a new turn may recall again.
- An entry injected in a session is never injected again in that session.

## Consequences

- Recall never enters the conversation log, so it costs nothing to resume and cannot be replayed as
  if the user had said it.
- Recall survives compaction by construction, because it is not conversation history.
- The user does not see a visible "memory was injected" row. This is the accepted cost, and the
  remedy is the `memory_list` tool rather than a UI element.
- Correctness depends on `agent/inbox/claimed` firing before prompt assembly for the turn. If it did
  not, recall would lag by one turn. Verified in practice on the development harness; if a future
  harness changes that order, the observable symptom is recall that arrives one message late.

## Alternatives rejected

- **`agent/pre-step` with a synthetic message.** Better legibility, but it enters the log, is lost to
  compaction, and is unavailable under [ADR 0001](01-zero-dependency-host-half.md).
- **A single dynamic section for both index and recall.** Simpler, but couples a stable list to
  per-turn content and gives up the prefix stability the split buys.
- **Injecting on every step.** Same content, more tokens; the per-turn cache is what makes the cost
  one-time.

See also: [`docs/architecture-en.md`](../architecture-en.md) § Turn lifecycle.
