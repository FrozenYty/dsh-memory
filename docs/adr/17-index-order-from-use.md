# 0017 — The index order is computed from use, and the older claim that it belongs to the human is withdrawn

**Status:** Accepted (supersedes the ordering rule in [0009](09-derived-index-and-write-refusal.md))

**Date:** 2026-11-13

## The decision we are changing

[ADR 0009](09-derived-index-and-write-refusal.md) wrote:

> The plugin owns the lines — a file added outside it is indexed, a deleted one drops out — and **the
> human owns the order**, because "most likely first" is a judgement no script can make.

The mechanism matched: `syncIndexFile` prepended new files and never reshuffled what was already
listed. The reasoning was that a script has nothing to rank by, so arranging the order was the
author's job and the plugin must not undo it.

**It did not hold up in practice, for a reason that is not about judgement.** Nobody reorders a file
they never look at. The order was stable, which is not the same as being right, and an entry that
stopped mattering kept its place indefinitely while a newer one drifted down the list.

## What changed is the evidence, not the reasoning

ADR 0009 was correct that a script cannot invent "most likely first". It was written when the plugin
had **no data at all** about what got used.

It has data now. `usage.jsonl` records each entry that is read and the day it was read
([ADR 0013](13-usage-counts.md)), and every entry carries a trust status
([ADR 0005](05-trust-status-and-mandatory-evidence.md)) and a file timestamp. Three signals, all
produced by the system rather than guessed at it.

**"No script can make this judgement" was true; "therefore a human should" was the part that aged
badly.** The judgement is now derived from what happened, which is a better basis than either.

## The rule

Entries are ranked into five tiers and sorted within each by `max(last used, file modified)`:

| Tier | Condition |
|---|---|
| 1 | `verified`, read in the last 30 days |
| 2 | `verified`, anything else |
| 3 | `candidate`, read in the last 30 days |
| 4 | `candidate`, anything else |
| 5 | `disputed` |

**Ties break on the filename**, and that is not cosmetic: entries written in one session share a
timestamp and the incoming order comes from `readdirSync`, so without it the same notebook produces a
different `INDEX.md` on the next run and every sync rewrites a file that did not change.

Two details carry the design, and both were found by writing the test rather than by reasoning:

- **The 30-day window.** The first implementation compared "used" against "never used" and dropped the
  window. That collapses tiers 1 and 2, and an entry used once last year outranks one written this
  morning — **the cold start becomes permanent after all.** The test `a brand-new entry outranks one
  last used long ago` failed on exactly that, which is why it exists.
- **The `max(...)` sort key.** Ranking within a tier by last use alone puts an entry with no history
  below every used one forever: it is never reachable from the index, so it never accumulates the
  history it would need to climb. Folding in the file's modification time gives a new entry its chance
  without anyone reordering anything by hand.

## What this deliberately does not do

- **It does not delete.** Ranking changes position; nothing leaves the notebook. An entry in tier 5 is
  still reachable through `memory_list` and still recallable by `memory_match`.
- **It does not trust use counts as importance.** A count is a fact about the past, and a busy week can
  make one entry look permanent. The 30-day window is what stops that from hardening into a position.
- **It does not rank on content.** No embeddings, no model call, no scoring of what an entry says —
  the inputs are a date, a status and a filename.

## Consequences

- **`syncIndexFile` reads `usage.jsonl`.** It now depends on a file it used to ignore, and a corrupted
  log changes the order rather than breaking it. `readUsage` already survives a glued or half-written
  file, so the failure mode is a wrong ranking, not a lost index.
- **The order is no longer a place to express intent.** Hand-editing `INDEX.md` is now pointless: the
  next sync recomputes it. The ordering is edited by reading entries and setting status, which is the
  behaviour we want anyway — the previous design allowed an author to arrange an order and never
  maintain it.
- **`disputed` entries stay in `INDEX.md` and sort last.** They are filtered out of the injected index
  either way, but the file must still list every file that exists, or `check-index` reports drift.
- **Six mutations guard this**, covering each of the three details above plus the window, the tie-break
  and the recomputation. All are killed.
