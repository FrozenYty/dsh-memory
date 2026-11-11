---
triggers: github, 代理, proxy, 超时, 连不上, 墙, 443
---

# GitHub is blocked; Context7 is not — 2026-11-02

Direct TCP to `github.com:443` and `api.github.com:443` times out. `ssh.github.com:443`
answers directly, which is why SSH git needs no proxy. The system proxy is
`127.0.0.1:7897`, normally off; git ignores it unless told.

- git over HTTPS: `git -c http.proxy=http://127.0.0.1:7897 ...`
- `mcp.context7.com` answers directly — no proxy needed
- DSH's MCP HTTP transport has no proxy support at all

Evidence: `Test-NetConnection github.com -Port 443` -> False; `ssh.github.com` -> True