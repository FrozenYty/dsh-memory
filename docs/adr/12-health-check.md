# 0012 — Capability is diagnosed separately from results

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** —

## Context

A memory system fails in a way that hides itself. When a query returns no hits, the user cannot tell
three things apart:

- the notebook is not being read at all;
- the notebook is being read and has nothing relevant;
- the notebook is read, has something relevant, and the matching failed.

All three look identical from the outside, and the first two produce the same silence. The user then
concludes the feature does not work and uninstalls it — while the plugin is fine, or broken, and says
nothing either way.

Every other project surveyed had this failure in its issue tracker. `EverOS`'s DSH plugin documents it
about itself: *"Every failure path fails open into `logger.warn`. Memory stopping is not otherwise
visible to the user."* `graphiti#1707` queued two hundred episodes and dropped them while reporting
success. `doobidoo#1467` returned an empty array from a broken backend while the tool protocol never
set an error flag.

The plugin's own failure modes are of this kind: `fail-open` on every path, and the injected index is
absent both when the notebook is empty and when it cannot be read.

## Decision

**`memory_health` checks capability, never recall quality.**

It reports the notebook's state — `ok`, `degraded`, `broken`, `absent`, `unconfigured` — and answers
questions that a query result cannot:

- can the directory be read, and **written** (an unwritable notebook silently loses what is written);
- does `INDEX.md` agree with the directory, in both directions;
- how many characters the injected index needs, against its budget, and how many more entries fit;
- which entries lack triggers or `Evidence:`;
- whether this session actually injected an index and published any recall.

`absent` and `unconfigured` are **not** failures. A plugin that has never been written to has no
directory, and creating one in every project the agent opens would be worse than an empty notebook.

## Consequences

- "Nothing matched" and "nothing works" stop looking the same. That distinction is the whole point;
  the checks are capability, so they never second-guess whether recall should have fired.
- An unwritable notebook is now visible. It is the worst silent case: everything appears to work, and
  nothing persists past the session.
- Remaining index room is reported as an estimate, because the length of a future filename is unknown.
  A number with a stated method beats a boolean.
- `degraded` is a real state with real problems listed — entries without triggers are reachable only by
  name or title, and entries without `Evidence:` cannot be re-checked. Neither stops recall, so neither
  is `broken`.

## Alternatives rejected

- **Log the failures and rely on reading logs.** Nobody reads logs. `EverOS` has the logs and still
  documents the invisibility.
- **Fail loudly at load time.** A missing notebook at load is normal, not an error — the plugin would
  cry wolf on every fresh install.
- **Report recall statistics.** They answer "did matching work", which is a different question and a
  misleading one when the notebook is unreadable.
