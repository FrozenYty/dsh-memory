# 0005 — Every write carries evidence; trust is a three-state field

- **Status:** Accepted
- **Date:** 2026-11-11
- **Superseded by:** —

## Context

A memory system's worst failure is not forgetting. It is a confidently wrong entry that is injected
again every session: the agent acts on a false belief about its own knowledge, and the mistake
compounds instead of decaying.

Two properties make that likely in an automatic system:

- **Consolidation can fabricate.** A summary produced by a model can state something the transcript
  never said, and it reads identically to a true entry.
- **Nothing distinguishes verified from guessed.** If every entry is equally trusted, the model has
  no way to hedge and the human has no way to retract.

The notebook already had an `Evidence:` convention — a claim carries the exact command or error that
proves it. It was a convention only: nothing required it and nothing preserved it.

## Decision

Three changes turn the convention into a gate:

1. **`evidence` is a required parameter of `memory_write`.** A write without it fails. The evidence
   is rendered as an `Evidence:` line in the file, so it is visible in `git diff` and does not depend
   on this plugin.
2. **`status` is a frontmatter field with three values:** `candidate` (default, produced
   automatically), `verified` (granted by the human), `disputed` (wrong or no longer applicable).
3. **A clamped recall keeps the `Evidence:` line.** When an entry is too long for the budget, the
   clamp preserves the opening conclusion and the trailing evidence rather than truncating linearly.
   An entry injected without its evidence reads as an unverifiable assertion.

`disputed` entries are filtered out of the index and the candidate set entirely — invisible, not
annotated.

## Consequences

- A wrong memory has a one-word repair that takes effect immediately and needs no plugin state.
- `candidate` is still injected. Excluding it would mean a new memory never takes effect until a
  human reviews it, which defeats automatic capture; the label is the compromise.
- The human is in the loop for promotion, so an unattended system accumulates candidates. Accepted:
  promotion is cheap, and a trusted-but-wrong entry is expensive.
- Evidence is *recorded*, not *verified*. Nothing re-runs the command. A future `verify` pass that
  executes recorded evidence and flags mismatches is the natural next step; it is not built here.

## Alternatives rejected

- **Trust automatically granted.** Removes the only signal that distinguishes a guess from a
  checked fact.
- **An LLM judge decides trust.** Adds a model call per write, and moves the decision from the person
  who can actually check it to a model that cannot run the command.
- **No status field.** Loses the ability to keep a disproven entry as history while stopping it from
  being injected.

See also: [`docs/architecture-en.md`](../architecture-en.md) § Trust states.
