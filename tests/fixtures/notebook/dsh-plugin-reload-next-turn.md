---
status: candidate
updated: 2026-11-11
triggers: dsh, plugin, 插件, 热重载, HMR, reload, plugin restart, 改动生效, 不生效, 没生效, 没反应, 插件 重启, 改了 没生效
---

# A linked plugin's file edits go live on the next turn, not the one that made them

Changing a profile-linked plugin's files takes effect on the **next turn**, not the turn that
changed them. The prompt section a turn is assembling was generated at that turn's start, so it
still shows the old text — that is not evidence the reload failed.

Observed path: edit `notebook-core.js` (a relative dependency of the plugin entry) → the same
turn's injected section still carried the old header → `touch` on `index.js` → the next turn's
header carried the new sentence. No DSH restart at any point.

Rules that follow:

- Do not conclude "a restart is required" from one turn's stale output. Check the next turn first.
- If it still is not live after a turn, touch the entry file (`index.js`); HMR tracks the module
  graph, and the entry is the cheapest thing to poke.
- A restart *is* required when replacing an installed package with a different version, not when
  editing files under the same linked path.
- The header text is a convenient canary: `notebook-policy.md holds this notebook's own rules.` is
  emitted only by the 0.4.0+ path, so its presence proves which generation is running.

Verify a UI-level change separately: HMR reloads Host code, but client bundles need the dev watcher
(note: `pnpm run dev:web`) or a rebuild.

Evidence: `After editing notebook-core.js and touching index.js, the injected section changed on the following turn to include "`notebook-policy.md` holds this notebook's own rules." without any DSH restart.`
