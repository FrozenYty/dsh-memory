# 16. The index carries a one-line summary per entry

Date: 2026-11-12

## Status

Accepted. Supersedes [ADR 0002](02-filename-index-without-descriptions.md).

## Context

ADR 0002 decided the injected index would be bare filenames, on the grounds that a list without
descriptions cannot decay into truncated prose. It held up for as long as recall did the work of
deciding what to show: the model rarely needed to judge relevance, because a matcher had already
judged it.

[ADR 0015](15-recall-is-model-driven-by-default.md) removed that matcher. The index became the only
thing telling the model what is in the notebook, and it was not enough:

> Asked "how do I commit to GitHub", the model saw `github-repo-operations` in the index, read it, and
> got an entry about the contributors sidebar cache. The name matched the question; the content did not.

The name said *GitHub*. Nothing said *contributor cache*. **A filename can start a read; it cannot
prevent one.**

## Decision

An index line is the filename, an em dash, and a summary clipped to `indexSummaryChars` (default 60):

```
- github-contributor-cache.md — Contributors sidebar caches separately after a history rewrite; toggle the default branch
```

The summary comes from, in order:

1. a `summary:` frontmatter field, when the author wrote one;
2. the entry's own `# heading`, with a trailing `— YYYY-MM-DD` removed.

**There is no third source.** A field nobody fills in would leave most lines as bare filenames again —
which is the failure this ADR exists to fix.

The budget rises from **1400 to 2800 characters**: about 29 entries at 60 characters of summary each,
down from 45 entries with names only. `indexSummaryChars: 0` restores bare filenames exactly, for a
profile that would rather have more entries than more information about them.

## What this costs

- **Fewer entries fit.** 2800 with summaries holds roughly 29; 1400 with names held roughly 45. The
  entries that fall past the budget are still counted in the index, still matched by recall, and still
  named by `memory_list` — [ADR 0014](14-index-budget-is-residency.md) is unchanged.
- **About 700 tokens of prompt prefix instead of 350.** It is stable text and may be cached, but that is
  a property of the host, not a promise this ADR can make.
- **The summary can go stale** where a filename cannot. Mitigated by deriving it from the heading, which
  the policy already requires to be usable on its own — an entry whose heading has rotted was already
  broken in `memory_list` and `memory_audit`.

## What was rejected

**Copying Claude Code exactly.** Its `MEMORY.md` is one line per memory, which is where the shape here
comes from — but its budget is 200 lines or 25KB, roughly 6000 tokens against our 700. Adopting the
format without the budget would give a worse index than either: fewer entries than filenames-only,
vague enough to still mislead, and many times the token cost.

**Fixing the names instead.** `github-repo-operations` needed a description because it was too broad;
renaming it to `github-contributor-cache` removes the need entirely. That was done as well — but it does
not generalise. A name cannot be simultaneously specific enough to need no explanation and general
enough to be written before the entry exists, and the author will not always notice which of their names
are the vague ones.

## Consequences

- **The heading is now load-bearing.** It is read in the index of every session, not only when someone
  opens the entry. A heading like "The USB camera on this machine" now costs the model's attention in
  every session and helps it in none.
- **`summary:` is the escape hatch** for entries whose heading is accurate but too long — the ones that
  would be clipped before the distinguishing part.
- A test asserts the summary is present, is clipped to the configured length, and that
  `indexSummaryChars: 0` restores bare filenames.
