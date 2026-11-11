# Contributing

How we work in this repository. GitHub collaboration only — code style beyond what CI enforces is
between the author and the reviewer.

## 1. Branching

`main` is protected. All work happens on short-lived branches, then merges through a pull request and
the branch is deleted.

```
feat/recall-threshold    fix/index-order    docs/adr-0006
```

Branch names are lowercase, hyphen-separated, prefixed by type. No Chinese, no pinyin.

## 2. Commits

Conventional Commits, with the module as scope:

```
feat(recall): weight trigger words above filenames
fix(index): keep INDEX.md order when a file is missing
docs(adr): record why evidence is mandatory
chore(ci): run the document checks on every pull request
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
Modules: `index`, `recall`, `match`, `tools`, `notebook`, `docs`, `ci`.

One commit does one thing. If the message needs "and", split the commit. Subject in the imperative
mood, no trailing period, 72 characters or fewer.

**Never add a footer that credits a tool.** No `Co-authored-by:` naming an AI assistant or a code
generator, and do not leave one that an assistant wrote for you:

```
Co-authored-by: Claude Code <noreply@anthropic.com>     ← rejected
```

A squash merge copies the single commit's message onto `main` verbatim, and GitHub counts that
trailer as a contributor — so a one-line footer becomes a name on the repository's contributor list.
Removing it afterwards means rewriting `main`, which changes every hash and forces every clone to
reset. `scripts/check-commit-messages.mjs` fails the build when one appears.

Human co-authors are ordinary teamwork and are allowed: the rule is about crediting a tool.

**If one lands anyway**, and nobody has an open branch:

```sh
git fetch && git checkout main && git pull --ff-only
git branch backup/pre-trailer-rewrite && git branch tmp main

git checkout <bad-commit>
git commit --amend -m "<the same message, minus the footer>"
git rebase --onto HEAD <bad-commit> tmp

git diff <old-main-tip> tmp      # must be empty: content unchanged, only the message differs
git checkout main && git reset --hard tmp
git push --force-with-lease origin main
```

Force-pushing `main` needs branch protection relaxed for the minute it takes, and everyone else must
run `git fetch && git reset --hard origin/main` afterwards. That cost is why the check exists.

## 3. Pull requests

- Keep a PR under **400 changed lines**. Larger work is split.
- Fill in the template: what changed, how it was verified, what else is affected.
- **CI is the only gate.** When the `check` job is green the PR may merge.
- Review is welcome — leave a comment instead of blocking; fix it in a follow-up if it is not worth
  another round trip.
- Merge with **squash** — one feature, one commit on `main`.

## 4. What CI checks

Every job below blocks the merge. The list grows; the rule does not.

| Job | Command | Fix |
|---|---|---|
| Syntax | `node --check index.js && node --check notebook-core.js` | read the reported line |
| Tests | `node test-core.mjs` | write the failing case first |
| Paths | `node scripts/check-paths.mjs` | write it relative to the repository root |
| Docs | `node scripts/check-docs.mjs` | list the ADR, fix the switcher, fix the link |
| Co-author | `node scripts/check-commit-messages.mjs --range <base>..HEAD` | remove the trailer |

There is no linter and no formatter. The code is plain ES modules with no dependencies, and adding
a toolchain to check 600 lines would cost more than it prevents. Consistency is the reviewer's job.

## 5. Files and data

- **Filenames are English**, lowercase, hyphen-separated. Content may be Chinese.
- Never commit `node_modules`, logs, editor state, or any file containing a real credential.
  `.gitignore` covers the usual ones; check `git status` before staging.
- A memory notebook is **not** part of this repository. This repository ships the plugin; the notes
  it reads belong to whoever uses it.
- No build output. There is no build step.

## 6. Documents

`docs/INDEX-en.md` is the map: which document answers what, which one wins when two disagree, and
what has to change together. Read it before adding or moving anything.

| What | Where | Name |
|---|---|---|
| entry points and live state | repository root, uppercase | `README.md`, `README-zh.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` |
| a design document | `docs/`, lowercase | `name-en.md` |
| a decision | `docs/adr/` | `NN-short-title.md`, two digits, never renamed |

Root files change often; `docs/` files change rarely. If a file does not fit that split, the split is
wrong, not the file.

**Nothing machine-specific goes into a shared document.** No absolute paths, no user names, no local
folder names — they are dead links on every other machine. Write commands relative to the repository
root. `scripts/check-paths.mjs` enforces this across every markdown file.

Conventions that keep the set from drifting:

- **Every design document carries an owner line** under its title: `> Owner: @handle · Revisit when:
  <trigger>`. A trigger, not a date — dates rot, triggers do not.
- **A decision that is expensive to reverse becomes an ADR**, not a paragraph in the changelog. One
  decision, one ADR; do not write it twice.
- **An accepted ADR is closed.** To change a decision, write a new ADR that supersedes it and add
  `Superseded by NNNN` to the old one.

## 7. Definition of done

A change is done when:

- [ ] The `check` job is green on the PR
- [ ] The PR template is filled in with commands that were actually run
- [ ] Both READMEs are updated when behaviour or a default changed
- [ ] A new or changed decision has an ADR, and the table in `docs/INDEX-en.md` lists it
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
