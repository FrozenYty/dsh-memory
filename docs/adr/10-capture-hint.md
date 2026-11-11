# 0010 — A capture hint before compaction, not automatic capture

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** —

## Context

Every other part of this plugin makes the notebook *usable*. Nothing made it **written to**. Capture
depended entirely on the model deciding, in the middle of a task, that something was worth keeping —
the most expensive possible moment to ask, and the least reliable. The highest-value entries are user
corrections, which arrive exactly when attention is on the work.

Two designs were available:

- **EverOS's split**: capture raw events automatically at every turn boundary with no model call, then
  extract in a batch later. Sound, and it costs a buffer, a lifecycle, and a second store to keep in
  step. It also needs its own service.
- **engramory's reminder**: when the conversation is close to compaction, tell the model to save what
  matters. No buffer, no extraction, no new state.

Measured against the constraint this plugin exists for — no dependencies, no model call on the read
path, nothing resident but the index — the second is the only one that fits.

## Decision

A one-shot hint, published through the runtime context channel when context pressure crosses a
configurable fraction of the window (default 0.6; `0` disables it):

- it is published **once per session**, not per turn or per step;
- it names the shape of thing worth keeping — a trap, a correction, a mechanism that only became clear
  after a failure — and says to ignore it otherwise;
- it **writes nothing**. It asks; the model decides, with `memory_write`.

## Consequences

- One message per session, at the last moment where it still helps: after compaction the session's
  reasoning is a summary, and the details are gone.
- The pressure figure comes from `tokenMeter.contextPressure`. The service does not expose the
  compaction threshold, so the fraction is a configurable guess rather than a mirror of the host's
  policy. It is deliberately below any plausible threshold; firing early costs one short message.
- A session whose pressure never reaches the fraction gets no hint. Accepted: a short session that
  ends before compaction already has its context intact, and the model can still write on its own.
- Nothing is captured that the model did not choose. A model that ignores the hint loses the same
  facts it would have lost before — this is an improvement to the odds, not a guarantee, and calling it
  "automatic capture" would overstate it.

## Alternatives rejected

- **Automatic raw-event capture with deferred extraction.** The better design, and the one to adopt if
  this plugin ever grows a store. It buys durability at the cost of a buffer whose lifecycle, failure
  modes, and reconciliation then need their own design — too much for a plugin whose entire selling
  point is that installing it is free.
- **Hint on every turn.** Becomes noise within an hour, and noise is ignored.
- **Write on the model's behalf, e.g. dump the last N tool calls.** Produces log entries, not lessons;
  the notebook's policy is explicit that a log is not what this is.
