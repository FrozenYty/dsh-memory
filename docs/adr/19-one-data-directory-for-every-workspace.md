# 19. One data directory for every workspace

> Status: accepted · Date: 2026-11-16 · Supersedes: the `workspaceDir` default in ADR 0013's follow-up
> questions · Superseded by: —

## Context

This plugin resolves one directory and reads and writes the notebook there. Until now the default was
`workspaceDir: '.agents/memory'`, a **relative** path resolved against the session's working directory:

```js
if (config.workspaceDir && cwd) add(resolve(cwd, config.workspaceDir))
```

That is the shape of a known failure in this workspace, not a hypothetical one. `dsh-cleaner` resolved its
trash directory through a chain that ended in "the profile's default directory", which follows whichever
workspace was opened last; when a repository moved, the trash directory moved with it, and the old
deletions stayed behind looking like they had never happened.

**A data directory that moves is the one failure a user cannot see.** The notes are still on disk, so a
fresh empty notebook reads as "nothing was ever written" rather than as a bug. Nothing errors, nothing
warns, and the loss looks like a decision the user made.

The exposure here was the same: the workspace's `.agents/memory` held 79 entries and a usage log, and it
was there only because that happened to be the workspace.

## Decision

**The notebook lives at `~/.agents/memory`, computed on every call, and nothing else participates.**

The order is exactly three legs:

1. a configured `workspaceDir` (absolute or `~/`),
2. the `DSH_MEMORY_DATA_DIR` environment variable,
3. `join(homedir(), '.agents', 'memory')`.

**Not the workspace. Not the profile's default directory. Not the repository's location. Not
`import.meta.url` or `__dirname`.** `resolveDirs(config, cwd)` still accepts a working directory and
**deliberately ignores it** — `void cwd` — because every call site passes one and because a parameter that
says out loud "the caller may offer a directory" describes the trap honestly: the answer does not depend
on it.

**`workspaceDir` defaults to `''`, not to a path.** When it held `'.agents/memory'` there was no way to
tell "the user configured this" from "the default happened to have this value", so the environment leg
could never be reached. Empty means unconfigured; the fallback lives in one place.

**The directory is `memory`, not `dsh-memory`.** The family drops the package prefix: `~/.agents/cleaner/`
is where `dsh-cleaner` keeps its trash. Using the full package name here would have been a second
convention with no reason behind it.

## Consequences

- **The path is in the index header** — `Notes live in <absolute path>` — so a user can confirm where
  their data is without asking. This costs ~70 characters of prompt prefix, which is the reason the budget
  test's assertion changed rather than the reason to hide the path.
- **A relative `workspaceDir` is now resolved against the process's cwd**, not the session's. That is
  deliberate and is why the default is empty: a relative configured value is the user's own choice, and it
  is still not allowed to follow the session.
- **`machineDir` is unaffected.** It is a second, read-only directory for notes shared across workspaces;
  it never decides where writes go. `resolveDirs(...)[0]` is always the writable notebook.
- **Existing data was copied, not moved.** The old directory is kept as a backup until the user removes it
  deliberately. Both copies are readable; the plugin now reads only the new one.
- **The tests say where the notebook is.** Every test config carries an absolute path, because a test that
  relies on where it happens to be standing has the same defect the plugin had — and three of them did,
  writing `INDEX.md` and four entries into the repository root once the default stopped following `cwd`.

## How this is held in place

`tests/core.test.mjs` §20 asserts that two decoy working directories produce the same directory and the
same entry count, and that an empty config names `~/.agents/memory` rather than nothing. Removing the
`void cwd` guard, or reintroducing `resolve(cwd, ...)`, fails those assertions.
