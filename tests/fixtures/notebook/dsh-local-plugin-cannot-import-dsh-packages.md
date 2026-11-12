---
status: candidate
updated: 2026-11-11
triggers: dsh, plugin, 插件, 本地插件, 插件 安装, 装不上, 找不到包, import, ERR_MODULE_NOT_FOUND, 依赖 缺失, peer, 零依赖, bundle, 链接安装
---

# A profile-linked local bundle cannot import any @deepseek-ai package

Symptom: `install_bundle` reports `application: "failed"` and the host warns
`1 entry did not activate`, with `ERR_MODULE_NOT_FOUND` naming an `@deepseek-ai/*` package.

Mechanism: the profile sets `autoInstallPeers: false` and `nodeLinker: hoisted`. A bundle
installed by absolute path becomes a `link:` dependency, and pnpm does not install that
package's dependencies or resolve its peers into the linked directory. Node resolves bare
specifiers from the bundle's own real path, so neither the profile's `node_modules` nor the
dsh installation is an ancestor of it. Declaring the package as a dependency does not help:
nothing installs it next to the linked directory.

Two traps that follow:
- A `dependencies` entry such as `@deepseek-ai/schemastery` fails first and hides the rest.
- Peers fail too; there is no working import of `dsh-llm` / `dsh-tools` from a linked bundle.

Fix: write the Host half with zero `@deepseek-ai` imports.
- Only `node:` builtins, plus relative imports of files inside the bundle. Relative
  imports resolve fine.
- Tool definitions are plain canonical JSON Schema objects — the exact `ToolDefinition`
  shape: `{ name, description, parameters, output: { schema, render }, execute }`.
- Prompt injection needs no import: `ctx.systemPrompt.section` / `ctx.systemPrompt.context`
  are Cordis services reached through `ctx`.
- Messages that would have used `createUserMessage` can instead ride the dynamic
  runtime-context channel, which never enters the conversation log.

`@local/team-control` in this workspace is the working precedent: it states the rule at the
top of its `index.js` and builds its tools as raw JSON Schema.

Evidence: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/schemastery' imported from the repository root`
