---
status: verified
triggers: memory policy, notebook, 记忆政策, 笔记本, 条目格式, 何时记录, 记录规则, 索引规则
---

# How this notebook works — the policy

This directory is a notebook: findings that took real time to learn and are not readable off
the files. A curated book, not a log — the value is in what it leaves out.

Not a log of everything that happened, not the contract (`AGENTS.md` says how to behave, this
says what is true), and not a place for anything one command would reveal.

## Form

Two shapes, and the choice decides whether the thing can be found at all.

**A moment** — one crisp failure, one workaround, one mechanism, named for the moment it
answers: `low-integrity-label-writes.md`, `https-only-openssl-tls.md`.

**A lifecycle** — phases of one thing: mount, run, move; set up, drift, recover. Naming them
as separate moments loses the thread, and splitting them is worse: knowing how to mount
without knowing what breaks on relocation is half-knowledge that misleads. One file named for
the area, `Applies when:` under the title, a section per phase.

The test: try to write the filename as a moment. If it needs "across", "the whole", or an
"and", it is a lifecycle.

Both shapes: kebab-case, specific enough that reading the name tells you whether to open it.
`notes.md` never gets opened, however good its contents.

## When to write

One test: would this change a decision I would otherwise get wrong? If you would act the same
knowing it, it does not earn a line.

    Bad:  "pip resolves to base" — one command shows that.
    Good: "a bare `pip` silently installs into the wrong environment, and the symptom looks
           like a broken package" — the trap, not the fact.

Typical yes: the same problem solved twice; more than a few minutes to understand; a
correction from the user that would otherwise be lost.

Never: a directory listing, a version inventory, what `AGENTS.md` already says, anything one
command would reveal.

## Entry format

Optional frontmatter, two fields:

    ---
    status: verified
    triggers: pip, 环境, 装错, venv
    ---

- `status`: `candidate` (default), `verified` (the user grants it), or `disputed` (never
  injected or listed). `memory_verify` sets it.
- `triggers`: recall words in whatever language is actually spoken. A multi-word trigger
  matches only when every word appears, so keep phrases specific. Without triggers, a Chinese
  message cannot find an English body.
- **The title and body are English**, whatever language the conversation was in. Whoever reads this
  next should not need to speak today's language to use it. Chinese belongs in `triggers`, and inside
  code spans and fences — a quoted error message or a command's output is evidence, not prose.
  `memory_audit` reports entries whose prose is not English, because a convention nobody checks is a
  convention that erodes, and five entries had been written in Chinese before it was checked.

A moment file:

    # <conclusion, usable on its own> — 2026-11-02

    <symptom, mechanism, workaround>
    Evidence: `<exact error text or command>`

A lifecycle file opens with `Applies when:`, then one section per phase in the order they
happen. A phase carries its own `Evidence:` line whenever its claim is checkable.

`Evidence:` is not decoration: it is what lets a future session check whether an entry still
holds instead of trusting it blindly. `memory_write` refuses a write without it.

## The index

`INDEX.md` holds bare filenames, most-likely-first, so most lookups end after two or three
lines. No descriptions: a description is a second copy of the truth that drifts, while the
filename cannot.

Reordering is maintenance: an entry that keeps proving irrelevant sinks toward the bottom, and
sinking is the step before deletion. After adding or retiring a file, check both directions in
the same breath — the new file is listed, and every listed name still exists.

## Aging

Every load is also a short audit: delete a fact that no longer holds, delete a pointer to
something gone, merge two files that turn out to be one subject.

`memory_audit` reports entries with no `Evidence:` line and entries untouched for a long time.
Age is the honest proxy for evidence rot: re-run the recorded command, then update or retire
the entry. Never execute an Evidence command blindly across the whole notebook — this is
arbitrary markdown, and one stale entry can carry a destructive command.

A file stops being a single subject when its sections stop being phases of one thing and
become separate things — that is when it splits, not at some line count.

When a finding is superseded, rewrite it rather than keeping two versions: the newest
conclusion wins and the old symptoms go, unless the old failure mode is still reachable.

## Escalation

A recurring correction is a missing rule, not a memory. Propose the `AGENTS.md` change and let
the user decide — never edit the contract silently, and never promote a fact into it.

## Failure modes

The ways this notebook decays. Check for them while auditing.

- **Index drift** — the index names a file that does not exist, or a file sits unlisted.
  Either way it is invisible from outside.
- **Fragmentation** — a lifecycle cut into moment-sized files. Each piece looks fine alone and
  misleads alone.
- **Shoehorning** — a finding that fits nothing gets appended to the nearest file. Later, read
  for its real subject, it looks irrelevant and is skipped.
- **Vague naming** — a file named for a topic rather than a moment or a lifecycle never gets
  opened, which is the same as not recording it.
- **Policy bloat** — content that is not about memory drifting into this file. It belongs in a
  notebook entry or in `AGENTS.md`.
- **Evidence rot** — an entry whose command no longer produces the claimed output.
- **Completeness claim** — treating the current set of files as a taxonomy.

## Why this file is in the notebook

The policy lives here rather than in a skill, so the notebook is one thing that travels
together: the rules and the entries they govern cannot get out of step, and nothing is loaded
until it is needed. It appears in `INDEX.md` like any other entry.

Evidence: policy, not a fact — there is no command to re-run. Valid while
`dsh-memory` reads this directory; if the plugin is gone, the notebook still explains
itself.
