# 0014 — The index budget caps residency, not capacity

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** the write-refusal half of [0009](09-derived-index-and-write-refusal.md); the derived index itself stands

## Context

[ADR 0009](09-derived-index-and-write-refusal.md) refused any write that would push the injected index
past `indexBudgetChars`. The reasoning was sound at the time: past the budget the renderer truncated,
an entry past the cut was never injected, and nothing reported the drop — so refusing protected the
fact from being silently lost.

Two measurements made that reasoning obsolete.

**The budget was doing two jobs and doing both badly.** It decided how many tokens the index costs *and*
how many entries the notebook can hold. Those are different questions with different answers, and one
number cannot serve both. Measured: 1400 characters is about 326 tokens per turn, and about 34 entries.
A user who wants 200 entries was told to accept 2034 tokens per turn — for a list mostly of names they
will never need in a given conversation.

**The refusal protected less than it appeared to.** A refused write left the fact in the conversation,
which is better than losing it, but it also made the model stop and manage storage in the middle of a
task. The failure it prevented was silence; the failure it caused was friction at the worst moment. And
the silence was easy to fix directly.

## Decision

**`indexBudgetChars` caps what is resident. It is no longer a capacity limit and no longer refuses
anything.**

- The index names entries up to the budget, then states the remainder as a count with the way to see
  them: `… and N more, all listed by memory_list`. An omission the model cannot see is the original
  problem; a counted omission is not silent.
- **New entries are placed at the top of `INDEX.md`.** Residency is finite, and what was just learned is
  the most likely thing to be needed next. Appending put it last, so a notebook at its budget hid a fact
  the moment it was written.
- **A write reports `indexResident` and `indexOverflow`** rather than failing. The entry always lands.
  What the writer learns is whether the entry is visible, and how many others stopped being visible to
  make room.
- Every entry stays reachable regardless: recall matches against all of them, and `memory_list` names
  them.

## Consequences

- **Capacity is unbounded and cost is chosen.** The user sets one number that means "how many tokens am
  I willing to spend on this every turn", and it no longer implies a ceiling on how much they may
  record. 700 characters is ~200 tokens and 10 resident entries; the rest are one `memory_list` away.
- Overflow becomes a `degraded` finding in `memory_health`, not `broken`. The notebook works; some
  entries are merely not visible unprompted.
- Non-resident entries are genuinely less discoverable: they can be reached by recall (whose hit rate is
  poor) or by the model choosing to call `memory_list`. The count is what gives the model a reason to.
- `indexBudgetVerdict` and `projectedIndexChars` are gone, replaced by `indexResidency`. Their whole
  purpose was to decide a refusal that no longer happens.
- An update to an existing entry never displaces anything, because it does not add a line. Only new
  entries cost someone else's residency.

## Alternatives rejected

- **Raise the budget until capacity stops mattering.** Linear in tokens (4000 characters is ~1143 tokens
  per turn for 109 entries) and it postpones the problem rather than separating the two questions.
- **Shorten filenames.** Measured: capping names at 18 characters raises capacity from 34 to 56 at the
  same budget. But the filename is a strong matching signal, so shortening trades recall for capacity —
  and it renders names like `forwardable-text-carri`.
- **Compress the format** (drop the bullet, drop `.md`). Measured at 34 → 39 entries. Not worth the
  inconsistency.
- **Keep refusing, and let the user retire entries to make room.** It works, and it is what 0009 said.
  But it makes the user manage a limit that no longer exists for any reason except the renderer.
- **Do not inject an index at all; let the model call `memory_list`.** Saves all 326 tokens and is what
  Claude Code deliberately does not do — a model that has not been told what exists has no reason to
  ask.
