# Documentation map

What answers which question, which document wins when two disagree, and what has to change
together. Read this before adding, moving or renaming a document.

## Which document answers what

| Question | Read |
|---|---|
| What does this plugin do, and how do I install and configure it? | [README.md](../README.md) |
| How is it built, and what are the tradeoffs? | [architecture-en.md](architecture-en.md) |
| Why was a decision made the way it is? | [adr/](adr/) — one file per decision |
| How do I branch, commit, and pass CI? | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| I am an AI assistant starting work here | [AGENTS.md](../AGENTS.md) |
| What changed between versions? | [CHANGELOG.md](../CHANGELOG.md) |

## Which one wins

- **A decision record beats a design document.** `docs/adr/` holds decisions that were
  expensive to reverse. `architecture-en.md` describes the current shape; where they disagree,
  the ADR is the authority and the design document is stale.
- **An accepted ADR is closed.** To change a decision, write a new ADR that supersedes it and mark
  the old one `Superseded by NNNN`. Never edit the decision itself to match the present.
- **The code beats both.** If the code and a document disagree, the code is what runs; fix the
  document in the same change.

## What changes together

| Changing | Also change |
|---|---|
| A default in `index.js` | the configuration table in `README.md` **and** `README-zh.md` |
| A tool name, argument or required field | the tools table in both READMEs, and `docs/architecture-en.md` |
| The index or recall budget model | `docs/architecture-en.md` and the cost table in both READMEs |
| Adding a behaviour with a non-obvious tradeoff | a new ADR, and its row in [adr/](#decision-records) below |
| Any user-visible behaviour | `CHANGELOG.md` |
| An entry format field (`triggers`, `status`, `Evidence:`) | both READMEs, `architecture-en.md`, the `memory_write` description |

## Decision records

| # | Decision | Status |
|---|---|---|
| [0001](adr/01-zero-dependency-host-half.md) | The Host half imports no `@deepseek-ai` package | Accepted |
| [0002](adr/02-filename-index-without-descriptions.md) | The injected index is bare filenames, with no descriptions | Accepted |
| [0003](adr/03-match-only-recall-into-runtime-context.md) | Recall is match-only and rides the runtime context channel | Accepted |
| [0004](adr/04-bilingual-triggers.md) | Entries carry explicit recall words, in the author's own language | Accepted |
| [0005](adr/05-trust-status-and-mandatory-evidence.md) | Every write carries evidence; trust is a three-state field | Accepted |

Add a row here whenever an ADR is added. `scripts/check-docs.mjs` fails the build when an ADR
exists on disk but is not listed in this table.

## Conventions

- **English is the language of `docs/`.** The two READMEs are bilingual because they are the entry
  point; design documents and ADRs are English only, so there is never a pair to keep in sync.
- **Nothing machine-specific.** No absolute paths, no user names, no local folder names. Commands are
  written relative to the repository root. `scripts/check-paths.mjs` enforces this across every
  markdown file.
- **A decision expensive to reverse becomes an ADR**, not a paragraph in a changelog. One decision,
  one file; never write it twice.
