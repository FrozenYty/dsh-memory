# 0007 — The notebook's policy lives in the notebook, not in a skill

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** —

## Context

The notebook's rules — what earns an entry, how entries are shaped, how they age out — lived in
a separate skill (`~/.agents/skills/dsh-memory/SKILL.md`, 185 lines). The entries lived in
`.agents/memory/`.

That split had three costs:

- **A second concept to load.** The policy was reached only when the skill's `description`
  matched the situation. A model that did not think about "memory" never loaded the rules that
  say when to write.
- **Two things that can drift.** Rules and entries travel separately; a change to the entry
  format had to be made in one place and applied in another.
- **Nothing travels with the notebook.** Copy `.agents/memory/` to another machine and the
  entries arrive with their rules missing.

## Decision

The policy becomes one ordinary entry: `.agents/memory/notebook-policy.md`. The skill directory
is deleted.

Supporting decisions:

- The entry is listed in `INDEX.md` like any other, so the notebook is self-describing without
  extra machinery.
- `status: verified`, because the policy is granted by the user rather than observed by the
  agent — this is the one entry where that is obviously true.
- The injected index header names it: "`notebook-policy.md` holds this notebook's own rules."
  That line is the only permanent cost, roughly fifty characters per request, and it is what
  makes the policy discoverable now that no skill description advertises it.
- The policy obeys itself: it carries an `Evidence:` line that says plainly that it is a policy
  and not a checkable claim, so the audit does not report it as missing evidence.

## Consequences

- One file to edit when the rules change, in the same directory as the entries they govern.
- Nothing is loaded until something actually asks for it; the policy costs one index line.
- The policy appears as a candidate for recall when a message mentions memory itself, which is
  the intended behaviour and the reason its `triggers` name that vocabulary.
- Deleting the skill removes a concept from the profile: there is no "memory skill" to arm,
  disable, or keep in sync.
- The notebook still explains itself with the plugin uninstalled, because the policy is inside
  it.

## Alternatives rejected

- **Inject the whole policy through the plugin's prompt section.** It is 185 lines; paying that
  on every request to save one file read is the opposite of this plugin's purpose.
- **Keep the skill and put entries in it too.** Then the skill and the notebook are two stores
  with two lifetimes, which is the drift problem in a new form.
- **Put the policy in the plugin's `docs/` only.** Good for maintainers, invisible to the model
  that has to write the entries.

See also: [`docs/architecture-en.md`](../architecture-en.md) § Where the policy lives.
