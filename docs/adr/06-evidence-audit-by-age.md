# 0006 — Evidence is audited by age and completeness, never by execution

- **Status:** Accepted
- **Date:** 2026-11-11
- **Superseded by:** —

## Context

[ADR 0005](05-trust-status-and-mandatory-evidence.md) made `Evidence:` mandatory and preserved it
through budget clamping. That records evidence; it does not check it. An entry written six months
ago carries a command that may no longer produce the same output, and nothing notices — the class of
decay the notebook's own policy calls *evidence rot*.

The obvious answer is to run the recorded commands. It was rejected.

- **A notebook is arbitrary markdown.** The string after `Evidence:` is written by an agent and by
  hand. It can contain a harmless `Test-NetConnection` or a `Remove-Item -Recurse`. A verifier that
  executes whatever it finds is a remote-code-execution surface with a markdown front-end.
- **Many claims have no runnable command.** Several entries record an error *message* rather than a
  command — that text is the evidence, and there is nothing to execute.
- **Output comparison is not decidable in general.** "Still holds" would need a per-entry expectation
  format, which is a schema and a second thing to maintain.

## Decision

Audit two properties that are safe to compute, and report the rest to a human:

1. **Completeness** — does the entry carry an `Evidence:` line at all?
2. **Age** — was the file touched within `--stale-days`?

Age is the honest proxy. The entry nobody has revisited is the one whose evidence is most likely
wrong, and the timestamp is already in the filesystem — no frontmatter field to keep in sync, and a
hand edit moves it too.

Two interfaces expose it: `scripts/check-evidence.mjs` for a terminal or CI, and the `memory_audit`
tool so the agent can report what needs re-checking without the user asking.

Promoting an entry with `memory_verify` moves its `updated` timestamp, because reviewing an entry is
precisely the moment its evidence was last confirmed.

## Consequences

- Nothing in this repository executes commands taken from a notebook. The audit cannot be turned
  into an arbitrary-code path by a poisoned memory.
- Age is a proxy, not proof. An entry re-confirmed yesterday can be wrong; an untouched one can be
  right. The audit points at candidates for review, it does not certify them.
- The loop is: report → human re-runs the command → `memory_verify` (or edit) → age resets. Every
  step is visible in `git diff`.
- Audit is informational by default; `--strict` fails when an entry lacks evidence. The notebook
  owner decides which mode their own pipeline uses.

## Alternatives rejected

- **Execute every `Evidence:` command.** See Context: a markdown file would become a command
  execution surface.
- **A whitelist of read-only commands.** Useful in principle, but the whitelist is either too narrow
  to cover this notebook (PowerShell, git, ripgrep, device queries) or wide enough to be unsafe
  again.
- **An LLM judge reads the entry and decides whether it still seems true.** Cannot run the command,
  so it cannot actually verify; adds a model call to a read path whose whole point is costing
  nothing.
- **No audit.** Leaves evidence rot named in the policy and unchecked in practice.

See also: [`docs/architecture-en.md`](../architecture-en.md) § Evidence hygiene.
