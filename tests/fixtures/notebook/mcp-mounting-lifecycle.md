---
triggers: mcp, 挂载, 工具消失, 转义, mcp 挂了, mcp 连不上, 工具 不见了, 挂不上
---

# Mounting an MCP server: the whole lifecycle

Applies when: a server will not mount, its tools vanish, or its binary was moved.

## Mount — the row must sit under `- insert:`

A bare row in the profile patch is read as an override of an existing id. When that
id does not exist the row is skipped with only a stderr warning: no tools appear and
nothing in the UI explains it.

    - insert:
        - id: mcp-github
          name: '@deepseek-ai/dsh-mcp-client'
          config:
            serverName: github
            transport: stdio

Validate with the profile's own `yaml` package before believing it loaded:
`NODE_PATH=~/.dsh/profiles/node_modules` and parse the file. Edits hot-reload, so no
restart is required.

Evidence: a bare row produced no tools and no visible error; wrapping it in `insert`
made the server appear without a restart.

## Run — tool results are text only

Embedded resources — file blobs, images — are never projected to the model. GitHub's
`get_file_contents` therefore returns nothing usable; read files through git or the
REST API. The GitHub server also has no `delete_branch`.

Evidence: `get_file_contents` answered "successfully downloaded text file" followed
by "embedded resource unsupported".

## Move — a relocated binary breaks the mount

The running process keeps the old file open while the config points at a path that is
gone; reconnect gives up after ten attempts and unregisters the tools. Fix the path,
then touch the config to force a reload.

The old copy cannot be deleted while the process lives: stop it, let the config
restart it from the new path, then delete.

Evidence: cross-volume `Move-Item` of a running binary reported success but left both
copies in place.
