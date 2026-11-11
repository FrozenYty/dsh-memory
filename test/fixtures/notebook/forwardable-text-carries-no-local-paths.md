---
triggers: 转发, 发给别人, 绝对路径, 本地路径, 盘符, 相对路径, 路径 规则, 路径 怎么写
---

# Forwardable text obeys the path rule too — 2026-11-10

When composing anything another person will read — a task brief, a message to paste into a group chat,
an answer that will be forwarded — **write paths relative to the repository root, never as an absolute
path on this machine.**

The repository enforces the rule for its own documents (`scripts/check-paths.py` walks `*.md` at the
root and everything under `docs/`). That check cannot see a chat message, so the rule was applied to
files and forgotten for the thing that travels furthest: the text I hand to someone to send onward.

It has now been pointed out twice. The failure mode is quiet — the message looks fine to me, because the
path resolves on my machine — and it is obvious to the recipient, who sees a path that does not exist
for them.

Practical checks before sending:

- `grep` the draft for a drive letter (`[A-Z]:\`) or a leading `/Users/`; both mean a local path.
- Say "the repository root" instead of where the repository is.
- Commands are `python scripts/check-...`, not the interpreter's full path.

Evidence: `scripts/check-paths.py` reports "Write commands relative to the repository root" — the same
sentence, applied to prose that leaves the repository.
