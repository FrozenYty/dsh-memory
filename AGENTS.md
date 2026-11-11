# AGENTS.md

Instructions for AI assistants working in this repository. Read this before your first task.

> This file holds only what is not written elsewhere. If a rule already lives in `CONTRIBUTING.md`
> or `docs/`, delete the copy here instead of maintaining two versions.

## 1. Before you start

Read, in this order:

```
CONTRIBUTING.md  ->  docs/architecture-en.md  ->  the ADR that touches your change
```

- The files beat your memory. This repository changes between your sessions; anything you remember
  may already be wrong.
- When something is unclear, say what is unclear and what would make it clear. Do not guess.
- For any question about behaviour, the code in `index.js` and `notebook-core.js` is the authority,
  then `README.md`, then `docs/`.

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

## 5. Verify before reporting

```sh
node test-core.mjs                    # behavioural checks
node scripts/eval-recall.mjs          # recall judgements over test/qrels.json
node scripts/check-paths.mjs          # no machine-specific paths in any document
node scripts/check-docs.mjs           # ADRs, switchers, links, locales, version, config documented
node scripts/check-evidence.mjs --dir test/fixtures/notebook   # evidence completeness and age
node scripts/check-index.mjs --dir test/fixtures/notebook      # INDEX.md agrees with the directory
node --check index.js                 # syntax
node scripts/check-commit-messages.mjs --range origin/main..HEAD   # no tool co-author
```

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
