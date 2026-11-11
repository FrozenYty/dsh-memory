# 0002 — The injected index is bare filenames, with no descriptions

- **Status:** Accepted
- **Date:** 2026-11-11
- **Superseded by:** —

## Context

Every request carries the notebook's index in the system prompt. Three shapes were on the table:

- **Bare filenames.** Cheapest possible line. Nothing can drift, because a filename is the file.
- **Filenames plus a one-line description.** More signal for choosing, but the description is a
  second copy of the truth, maintained by hand.
- **Filenames plus a generated description.** The description is derived from the entry's first
  line, so it cannot drift. Costs index characters proportional to the entry count.

The decisive evidence is what happens under budget pressure. Claude Code's own automatic memory
index is described in its issue tracker (`#104704`) as degrading to "shorter and shorter
descriptions" as the size cap binds, which makes the index harder for the model to use. A
community plugin in the same ecosystem measured its 4 KB budget reaching its ceiling at around
fifty entries, after which truncation is positional and probe recall falls sharply.

Descriptions are therefore the part of an index that loses first, and losing them silently is worse
than never having promised them.

## Decision

The injected index is one line per entry containing only the filename.

Recall quality is not carried by the index. It is carried by `pickHits` at message time
([ADR 0004](04-bilingual-triggers.md)), which matches against filename, title, body and explicit
triggers. The index's only job is to make the model aware that a name exists, so that it can call
`memory_read` when a name looks relevant.

## Consequences

- The index has no meaningful truncation point. Eleven entries measured 620 characters (~172
  tokens); the ceiling exists only as a safety net.
- Discoverability depends on filename quality. That is a content rule, stated in the README and in
  the notebook's own policy, not something the plugin can fix after the fact.
- A recall miss is not compensated by prose in the index. It must be fixed by adding a trigger,
  which is a visible, local edit.
- If the notebook ever grows past the point where a filename alone is enough to choose, the answer
  is to split the notebook, not to pad the index.

## Alternatives rejected

- **Generated descriptions.** Still costs index characters per entry, and at the sizes where the
  problem appears the generated text is exactly what gets cut. The retrieval improvement belongs at
  match time, where it costs nothing when unused.
- **Tags in the index.** Same failure mode as descriptions, plus a taxonomy to maintain.
- **A table of contents with counts.** More characters, less information than the names.

See also: [`docs/architecture-en.md`](../architecture-en.md) § Matching.
