# 0001 — The Host half imports no `@deepseek-ai` package

- **Status:** Accepted
- **Date:** 2026-11-11
- **Superseded by:** —

## Context

A bundle installed into a profile by absolute path becomes a `link:` dependency. The profile sets
`autoInstallPeers: false` and `nodeLinker: hoisted`, and pnpm does not install a linked package's
dependencies or resolve its peers into the linked directory. Node resolves bare specifiers from the
bundle's own real path, so neither the profile's `node_modules` nor the harness installation is an
ancestor of it.

The first build of this plugin imported `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-llm`, and
`@deepseek-ai/dsh-tools`. Installation failed:

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'
```

Declaring the package as a dependency does not help: nothing installs it next to the linked
directory. Peers fail the same way, which also removes `createUserMessage`.

## Decision

The Host half of this plugin imports nothing from the harness. It uses `node:` builtins plus relative
imports of its own files, and nothing else.

- Tool definitions are plain canonical JSON Schema objects — the `ToolDefinition` shape the registry
  consumes directly: `{ name, description, parameters, output: { schema, render }, execute }`.
- Prompt text is registered through `ctx.systemPrompt.section` / `ctx.systemPrompt.context`, which
  are Cordis services reached through `ctx`, not imports.
- The plugin declares no `Config` schema; configuration defaults live in code and are merged at
  `apply`. Values from the profile patch are accepted as given.

`@local/team-control` in the same workspace is the working precedent and states the same rule in its
own header.

## Consequences

- Installation works with no build step and no dependency tree.
- `createUserMessage` is unavailable, which decides
  [ADR 0003](03-match-only-recall-into-runtime-context.md).
- Configuration is unvalidated. A wrong type surfaces at runtime as a broken behaviour rather than at
  activation as a diagnostic. Accepted for a single-maintainer plugin; revisit if a second user
  needs configuration safety.
- Publishing to npm would lift the constraint, because a published package gets a real dependency
  tree. That is a future option, not a reason to add imports now.

## Alternatives rejected

- **Publish to npm so dependencies resolve.** Would work, but adds a release pipeline to solve a
  packaging problem the zero-dependency design already solves.
- **Put the package under the profile directory so ancestors resolve.** The harness's own guidance
  forbids creating packages in the profile, and it would tie the checkout to one machine.
- **Vendor the harness packages into the bundle.** Copies of harness code drift silently against the
  running version.

See also: `docs/architecture-en.md` § Harness constraints that shaped the design.
