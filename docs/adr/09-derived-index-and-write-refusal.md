# 0009 — The index is derived data, and a write that would truncate it is refused

- **Status:** Partially superseded by [0014](14-index-budget-is-residency.md) — the derived index
  stands; the write refusal was withdrawn
- **Date:** 2026-11-11
- **Supersedes:** part of [0002](02-filename-index-without-descriptions.md) (the index is no longer a hand-maintained document)

> The derived index decided here is unchanged. The second half — refusing a write that would push the
> injected index past its budget — was withdrawn in ADR 0014, because the budget was redesigned to cap
> residency rather than capacity, which removes the silence the refusal existed to prevent.

## Context

`INDEX.md` was written by hand and updated by the plugin only by appending. Two failures followed, both
observed in this notebook:

- a file added outside the plugin was **not listed**, and an unlisted entry is invisible — the injected
  index never names it, so recall cannot reach it;
- a line for a file that no longer existed survived, making the index lie.

The notebook's own policy asks for a two-way check after every add or retire, and nothing enforced it.
A `check-index` script was added in 0.6.0 that could *report* drift, which is not the same as preventing it.

Separately, the injected index has a character budget. Past it, `buildIndex` truncates. Truncation is
the worst outcome available: the entries past the cut are never injected, so they may as well not
exist, and **nothing reports that they were dropped**. The model believes it has an index of its memory;
it has a prefix of one.

## Decision

**The index is derived from the directory**, rebuilt by the plugin:

- `syncIndexFile` rewrites `INDEX.md` from a directory scan, keeping the order the file already had.
  The plugin owns the lines; the human owns the order, because "most likely first" is a judgement no
  script can make.
- It runs when the plugin writes, when status changes, and once per directory per process on first
  prompt assembly — so a file added or deleted by another tool is reconciled rather than left to rot.
- A write that would push the injected index past its budget is **refused before it lands**, with the
  numbers in the error and a way out: retire an entry with `memory_verify`, or fold two into one.

## Consequences

- The index cannot drift, because it is not maintained — it is computed. `check-index` remains as an
  independent check of the computation, which is why it is still in CI.
- Reordering still works: edit the lines, and the plugin preserves what it finds.
- A refusal keeps the fact in the conversation. It is not lost, only deferred, and the model is told
  exactly how to make room. This is the reason the cap is a refusal rather than a silent drop.
- The cap makes the notebook's size finite and visible. Reaching it is a signal to consolidate, which
  is the maintenance the policy asked for and nobody performed.
- The preamble of `INDEX.md` is now plugin-owned text; a hand-written note above the list is replaced
  on the next sync.

## Alternatives rejected

- **Keep appending, and rely on the check script.** Reporting drift after the fact still leaves the
  window where the index lies, and the check only runs when someone runs it.
- **Truncate silently and let the model cope.** It cannot: it does not know what it was not shown.
- **Refuse to write when the index is merely large.** The rule is "would this entry be truncated", not
  "is the index big" — an update to an existing entry never grows the list and is always allowed.
- **Delete the oldest entry automatically to make room.** Deletion is a judgement about value; the
  plugin has no basis for it. Refusing pushes that judgement to where it belongs.
