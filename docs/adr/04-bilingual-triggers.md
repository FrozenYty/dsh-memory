# 0004 — Entries carry explicit recall words, in the author's own language

- **Status:** Accepted
- **Date:** 2026-11-11
- **Superseded by:** —

## Context

Notebook bodies are written in English, because that is the repository convention. The person using
them speaks Chinese. A message such as "上次那个相机白平衡的事" shares no tokens with an English
entry titled "The USB camera on this machine": `相机` and `白平衡` are CJK bigrams that appear
nowhere in the body.

Measured on the real notebook before any change: six Chinese queries, zero matches. The mechanism
was working; the vocabulary was not shared.

Three ways to bridge the gap:

- **Translate the bodies.** Loses the English repository convention and doubles maintenance.
- **Embed both languages.** Requires an embedding model on the read path — the thing this plugin
  exists to avoid.
- **Declare the recall words explicitly.** One frontmatter line per entry, in whatever language the
  author actually types.

## Decision

Entries may carry a `triggers` frontmatter line: a comma-separated list of recall words, typically
the author's own language and synonyms for an English body.

`triggers` is the **highest-weight** match field (5, above filename 4, title 3, body 1), because it
is the only field written specifically to be matched against. Entries without triggers still match
on filename, title and body.

## Consequences

- Six Chinese queries that previously matched nothing matched the intended entry after adding the
  line, verified in the test suite.
- The line is optional, so existing notebooks keep working unchanged.
- It is hand-maintained vocabulary. The failure mode is a new entry written without triggers, and
  the symptom is a Chinese question that never recalls it. The write tool's description asks for
  them; the test suite checks that the baseline notebook retains them.
- Triggers are also the first place to look when a recall is wrong: an over-broad word (for example
  `权限`, "permission") can pull an entry into unrelated conversations.

## Alternatives rejected

- **Automatic translation at write time.** Adds a model call and a second language to keep in sync.
- **CJK segmentation with a dictionary.** Would help Chinese-to-Chinese, not Chinese-to-English,
  which is the actual gap.
- **Vector similarity.** Solves it, and costs a model on the read path. Revisit threshold: recall
  misses that adding triggers cannot fix.

See also: [`docs/architecture-en.md`](../architecture-en.md) § Matching.
