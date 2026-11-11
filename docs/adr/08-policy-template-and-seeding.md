# 0008 — The policy ships with the plugin and is seeded into a notebook that lacks one

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** [0007](07-policy-in-the-notebook.md)

## Context

[ADR 0007](07-policy-in-the-notebook.md) moved the policy out of a skill and into
`.agents/memory/notebook-policy.md`. It was right about *where the policy belongs* — with the
entries it governs — and wrong about *how it gets there*. The file existed because the author
already had it. A fresh install does not:

- the injected index header named a file that did not exist;
- a new user had no statement of what earns an entry, how entries are shaped, or what `Evidence:`
  means;
- the policy could not be updated with the plugin, because it lived only in one person's data.

The skill it replaced had the opposite property — it shipped with the profile — which is exactly
why the regression was invisible until the plugin was published.

## Decision

The policy is a **package resource**: `templates/notebook-policy.md`.

The plugin seeds it into a notebook that exists but carries no `notebook-policy.md`:

- **Exclusive create.** An existing policy is never overwritten. A user's edits survive an upgrade,
  and a second run is a no-op.
- **Only where a notebook already exists.** Installing the plugin does not create `.agents/memory/`
  in every project the agent opens; the directory's presence is the signal that the user has
  started a notebook there.
- **Once per directory per process**, so the filesystem is not probed on every prompt assembly.
- **The index header is conditional.** The sentence naming `notebook-policy.md` appears only when
  that entry is present. A user who deletes the policy gets a header that does not point at
  nothing.
- **Read-only notebooks are left alone.** A failed seed is swallowed; everything else still works.

## Consequences

- A new install works on the first turn: the policy is seeded, `INDEX.md` lists it, and the header
  names it.
- A user who edits or deletes the policy keeps that choice. Seeding only where nothing exists means
  a notebook can carry an older policy than the plugin — accepted, because silently replacing a
  file the user wrote is worse than a stale policy.
- The repository now ships user-facing content in `templates/`, which `files` must include. A test
  fails if the template is missing, too short, or has no `Evidence:` line.
- The policy is still not injected into the prompt; it costs one index line, as in ADR 0007.

## Alternatives rejected

- **Keep ADR 0007's arrangement and tell users to create the file themselves.** A manual step before
  the plugin does anything useful, and the header would point at a missing file until they did it.
- **Embed the policy in the injected prompt section.** 131 lines on every request.
- **Seed in `apply`.** The plugin has no working directory until an agent exists; a profile-level
  hook would seed once into an arbitrary directory.
- **Overwrite the policy on upgrade.** Keeps every notebook current but discards every user edit.
