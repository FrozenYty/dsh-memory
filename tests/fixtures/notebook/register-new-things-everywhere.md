---
triggers: 索引, 登记, 漏更新, readme, 更新 索引, 漏了, 忘了 更新, 清单 漏, 表格 计数, derived registry, 派生, 新增 文件
---

# Adding a first-class thing means updating every list that enumerates it — 2026-11-07

Applies when: adding an ADR, a contract route, a table, a page, a script, or a document to this repo.

## The failure

The thing works. It is committed. And a list somewhere else still shows the old count, or omits it
entirely — the architecture decision table stopped at 07 while three more records existed; the README
said nine tables while the data model and the Chinese README said thirteen. It reads as carelessness,
and it costs trust every time, because the user finds it before I do.

**Three times in one day for ADRs alone.** That is not attention; it is a step with nothing checking
it.

## Why it keeps happening

This repository keeps **derived registries**: hand-maintained copies of a fact that lives somewhere
else. Every one of them is a place to forget.

| Adding | Also update |
|---|---|
| An ADR | `architecture-en.md` §10 table **and** `architecture-zh.md` 第十节, `INDEX-en/zh` `adr/01-NN` |
| A contract route | the table in `api-contract-en/zh` (the coverage test derives from it) |
| A table | data-model summary **and** field dictionary, `EXPECTED_COLUMNS`, SRS §4.1 |
| A page | `layout.js` menu, SRS §5.2 |
| A check script | the CI workflow |
| Any document | `INDEX-en/zh` §2 |
| A memory entry | `INDEX.md`, both directions |

## The habit that replaces remembering

"Be careful" is not a mechanism. Two things are:

1. **Grep the old number before pushing.** `grep -rn "9 tables\|v1.5\|seven"` — the stale value is
   almost always a literal that was true last week.
2. **Ask what enumerates this**, not what references it. A reference breaks loudly; an enumeration
   goes quietly stale.

## What is covered now, and what is not

Checked by script: the ADR index (`scripts/check-adr-index.py`), the contract route set (a test that
parses the contract and asserts the count).

**Not checked:** README counts and versions, INDEX entries for new documents, the data-model summary
against `EXPECTED_COLUMNS` beyond the column counts themselves. Those still rely on the habit.

Evidence: `python scripts/check-adr-index.py` exits 1 when a record is missing from the table; the
contract test asserts 42 routes.
