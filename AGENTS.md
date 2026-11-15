# AGENTS.md

Instructions for AI assistants working in this repository. Read this before your first task.

> This file holds only what is not written elsewhere. If a rule already lives in `CONTRIBUTING.md`
> or `docs/`, delete the copy here instead of maintaining two versions.

## 1. Before you start

Read, in this order:

```
CONTRIBUTING.md  ->  docs/architecture-en.md  ->  the ADR that touches your change
```

- **This repository lives at `DSH_PLUGINS\dsh-memory`, not under `DSH_FILES\`.** The workspace contract
  puts code that is linked into a profile and runs in every session here, on the grounds that it is
  infrastructure rather than output. Moving it back would break four junctions and a profile nobody asked
  you to touch.
- **Where the work stands is `PLAN.md`; how it got here is `PROGRESS.md`; what an installer gets is
  `CHANGELOG.md`.** If you were asked to "continue development", read `PLAN.md` first — it is the only
  place a checkbox lives, and every item there carries a "Done when".
- **The files beat your memory.** This repository changes between your sessions; anything you remember
  may already be wrong. Two things it has been wrong about in the past, both now corrected, are worth
  knowing so they are not re-derived: the cache cost of a prompt change is **not** "everything after it";
  it is everything after it, measured, and position decides how much. And the reason `recallEnabled`
  defaults to false is **two** reasons, not one — false positives at 6 in 18, and the cache churn of a
  per-step re-evaluated context. Both are in ADR 0018 and ADR 0015.
- When something is unclear, say what is unclear and what would make it clear. Do not guess.
- For any question about behaviour, the code in `index.js` and `notebook-core.js` is the authority,
  then `README.md`, then `docs/`.
- **Two git traps have each cost a round.** A branch cut from a branch after a squash merge cannot merge,
  and GitHub then runs **no CI and reports no error** — an empty check-run list means
  `mergeable_state: dirty`, not an outage. And `git cherry` reports squash-merged commits as unmerged,
  because a squash gives them a different patch-id; judge by content instead.

## 2. The project

A DeepSeek Harness plugin that gives an agent persistent memory over a directory of markdown notes.
The notes are the user's; the plugin only decides when to look and when to write.

The load-bearing constraint: **this is a profile-linked bundle, so it cannot import any
`@deepseek-ai` package.** Every design choice downstream of that is recorded in
[ADR 0001](docs/adr/01-zero-dependency-host-half.md). Read it before proposing an import.

## 3. Working principles

1. **Look before you move.** Read the file, run the tests, check the branch. Never edit from memory.
2. **Smallest change that works.** If you write 200 lines and it could be 50, rewrite it.
3. **Simple beats clever.** No abstraction for single-use code, no configurability nobody asked for.
4. **Define done before coding.** The acceptance is a command that can fail, not a feeling.
5. **Change one thing, search the whole repository.** A renamed field or a moved default appears in
   the READMEs, the docs, and the tests. `grep` for it; the table in
   [docs/INDEX-en.md](docs/INDEX-en.md) § What changes together lists the usual suspects.
6. **Read the error.** A non-zero exit is information. Do not retry the identical command and hope.
7. **A blocked operation is a request for permission.** Say what was refused and ask, with the exact
   command. Do not route around a sandbox.
8. **Do not add a dependency.** `package.json` has no `dependencies` and that is the design, not an
   oversight. Use `node:` builtins.

## 4. Repository rules

- Branch names, commit format and PR rules live in `CONTRIBUTING.md`. Follow them; they are not
  repeated here.
- **Never force-push `main`.** Never push directly to it.
- **An accepted ADR is closed.** To change a decision, write a new ADR that supersedes it and mark
  the old one `Superseded by NNNN`.
- **Never add a `Co-authored-by:` naming a tool.** CI rejects it; a squash merge would make it
  permanent history.
- **Do not silently change a default.** A default is documented in both READMEs and in
  `docs/architecture-en.md`; change all three or none.
- **Three records, three different questions — put a sentence in the one whose question it answers.**
  `PLAN.md` answers *what is still owed, and how each item is proved*: the task board, and the only place
  a checkbox lives. `PROGRESS.md` answers *what changed, why, and how it was checked that day*: an
  append-only log, one dated entry per day, written for whoever has to understand the decision later.
  `CHANGELOG.md` answers *what a person who installs this bundle gets*: the release note, per version. So
  a change with a user-visible effect adds a release note; a change whose **reason** or **evidence** would
  otherwise be lost adds a log entry; a change to the remaining work edits the task board — and nothing is
  written in two of them for the same reason. Both `PROGRESS.md` and a released `CHANGELOG.md` section are
  append-only.

## 5. Verify before reporting

```sh
node scripts/check.mjs                      # everything CI runs, in order, one exit code
```

That is the gate. It runs the commands below and names the one that failed; reach for a single command
only to investigate a failure it reported.

```sh
node tests/core.test.mjs                    # behavioural checks
node scripts/eval-recall.mjs          # recall judgements over tests/qrels.json
node scripts/check-paths.mjs          # no machine-specific paths in any document
node scripts/check-docs.mjs           # ADRs, links, locales, version, config, policy copies, README language
node scripts/check-evidence.mjs --dir tests/fixtures/notebook   # evidence completeness and age
node scripts/check-index.mjs --dir tests/fixtures/notebook      # INDEX.md agrees with the directory
node --check index.js                 # syntax
node scripts/check-commit-messages.mjs --range origin/main..HEAD   # no tool co-author
```

`node scripts/check.mjs --full` adds the two gates that are too slow to run every time — the mutation
scan (which edits the source it mutates and restores it) and the assertion-strength check.

`node scripts/check.mjs --instruments` adds the two **instruments**, which print a number rather than a
verdict: the hostile-phrasing set (it exits 1 whenever any "silent" case fires, and currently reports 6 of
18 — that is the measurement keeping `recallEnabled` false, not a defect) and the cache probe, which needs
`DO_API_KEY` and the network. **Running either inside a gate would report a working system as broken.**
The hostile set also needs `--dir <a real notebook>`, since every query targets an entry only the author's
notebook contains; without it the step is skipped and says so.

All of these run in CI and block a merge. A passing local run proves less than it looks: `node
--check` is not a type check, and the document checks never look at JavaScript.

Report in three parts:

1. **What changed** — files and behaviour, not intentions.
2. **How it was verified** — commands run and their result.
3. **What is left undone** — be explicit; "it works" is not a report.

## 6. Language

Talk to your user in Chinese. Write everything to disk in English: code, comments, commit messages,
documents, PR descriptions. Chinese prose uses full-width punctuation — “”、，。；：（） — never
ASCII quotes or commas wedged into a Chinese sentence.

The two README files are an intentional exception: they are a bilingual pair, and the Chinese one is
written as Chinese prose, not translated word for word.
