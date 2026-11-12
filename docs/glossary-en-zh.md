# Glossary / 术语表

Every term this repository uses in a specific way, with the word it is **not** a synonym for. The
"not" column exists because most of the confusion in this project came from two words sounding alike:
"the index" and "INDEX.md" are different things, and "recall" was once used for two mechanisms that are
now separate.

按本项目特有含义列出每个词，并注明它**不是**什么。"不是"那一列存在的理由：这个项目里大部分混乱都来自
两个词听起来一样——"注入索引"和"INDEX.md"是两回事，"召回"曾经被用来指两个现在已经分开的机制。

## The notebook / 笔记本

| English | 中文 | Means | Is **not** |
|---|---|---|---|
| **notebook** | 笔记本 | The directory of markdown notes. Its contents are the user's. | A database, a log, or the plugin's own state |
| **entry** | 条目 | One `.md` file in the notebook, one subject. | A line in a file, a row, or a changelog item |
| **policy** | 政策 | `notebook-policy.md`: what belongs in *this* notebook and how to write it. Seeded from `templates/`, never overwritten. | The repository's `AGENTS.md`, which governs behaviour rather than content |
| **moment** | 一次性条目 | An entry about one failure, workaround or mechanism. | A "small" entry — a three-line trap can be a moment |
| **lifecycle** | 生命周期条目 | An entry about phases of one thing (mount, run, move), with `Applies when:` and per-phase `Evidence:`. | A long moment. The test is whether the filename needs "across" or "and" |
| **evidence** | 证据 | The `Evidence:` line: the command or error text that proves the claim. | Any citation, link or recollection |
| **trigger** | 触发词 | A recall phrase in `triggers:`, in whatever language the author actually speaks. | A keyword field, a tag, or a synonym list copied from a thesaurus |
| **trust status** | 信任状态 | `candidate` (default), `verified` (the user granted it), `disputed` (wrong now, never injected). | A confidence score, a priority, or a rating |

## The index / 索引

| English | 中文 | Means | Is **not** |
|---|---|---|---|
| **injected index** | 注入索引 | The few hundred tokens of `- filename — summary` lines placed in the system prompt every session. | `INDEX.md` |
| **`INDEX.md`** | 索引文件 | A file in the notebook recording the order entries should be read in. Derived from the directory on every write. | The injected index; nothing reads it as prose |
| **resident** | 常驻 | Named in the injected index, so the model can see it without asking. | Stored, reachable, or important — an entry past the budget is still all three |
| **budget** | 预算 | `indexBudgetChars`: how many entries are *resident*, in characters. | Capacity. Nothing is ever dropped from the notebook |
| **overflow** | 溢出 | The count of entries past the budget, shown in the index so the gap is visible. | An error, or data loss |
| **summary** | 摘要 | The text after the em dash in an index line: `summary:` frontmatter, else the heading. | A description of the file. It is the sentence that lets the model decide whether to read |

## Recall / 召回

| English | 中文 | Means | Is **not** |
|---|---|---|---|
| **recall** | 召回 | Selecting an entry for the current turn. Since ADR 0015 this is **model-driven**: the model reads the index and calls `memory_read`. | Automatic injection of matching entries — that is `recallEnabled: true`, off by default |
| **match** | 匹配 | The scoring rule that decides whether a query and an entry are related at all. Still used when `recallEnabled` is on, and by the judgement set. | Semantic search, embeddings, or an LLM call |
| **hit** | 命中 | One entry selected for one query. Also, one point in the score. | A file read; a read is recorded separately |
| **strong signal** | 强信号 | A match on a trigger, the filename, or the title — as opposed to body text. | A high score. A long body can score high on weak evidence |
| **rarity** | 稀有度 | How many entries claim a token as a strong signal. One claims it → it identifies that entry. | IDF, a weight, or anything needing maintenance |
| **acknowledgement** | 确认 | A message like "好"/"OK"/"continue" that is not a request, so recall stays silent. | A short message |

## Usage and audit / 使用与审计

| English | 中文 | Means | Is **not** |
|---|---|---|---|
| **usage** | 使用记录 | `usage.jsonl`: one line per entry read, with a date. Nothing else. | Analytics. No query text is ever recorded |
| **audit** | 审计 | Checking entries for missing evidence, age, language and index drift. | Executing the commands in `Evidence:` — that is deliberately never done |
| **stale** | 过期 | Older than `staleDays` (default 90). A prompt to re-check, not a verdict. | Wrong. An old entry can be perfectly true |
| **drift** | 漂移 | `INDEX.md` and the directory disagreeing. | Data corruption; the index is regenerated from the directory |
| **health** | 健康 | A capability diagnosis: can the plugin read, write, inject, agree with its index. | A result. An empty notebook is healthy |

## Testing / 测试

| English | 中文 | Means | Is **not** |
|---|---|---|---|
| **judgement set** | 判断集 | `tests/qrels.json`: 52 on-topic queries and 24 off-topic ones, each with the entry it must (or must not) reach. | A benchmark; nothing is scored against other implementations |
| **mutation** | 变异 | One deliberate break in the source, run against the whole suite to see whether any test notices. | A fuzz case or a random edit — each targets a specific line |
| **survivor** | 存活变异 | A mutation the suite did not catch. | Proof of a missing test. It may be an equivalent change |
| **assertion strength** | 断言强度 | Whether an assertion *can* fail at all. | Coverage. A covered line can be asserted tautologically |
| **fixture notebook** | 夹具笔记本 | `tests/fixtures/notebook`: frozen test input, deliberately not a copy of the real notebook. | A sample or a demo |

## Plugin structure / 插件结构

| English | 中文 | Means | Is **not** |
|---|---|---|---|
| **Host half** | 宿主侧 | `index.js` + `notebook-core.js`, running in the DSH host. | A separate server, a daemon, or a subprocess |
| **section** | 段落 | `ctx.systemPrompt.section` — stable text in the prompt prefix. | Runtime context, which is re-evaluated per step |
| **context** | 上下文 | `ctx.systemPrompt.context` — dynamic text, never entered into the conversation log. | The conversation history |
| **bundle** | 捆绑包 | A Cordis package composing plugins; here, the profile-linked install unit. | An npm package. It cannot import `@deepseek-ai` (ADR 0001) |
| **gate** | 闸门 | A `scripts/*.mjs` check that can fail the build. | A test; gates inspect documents and history, tests inspect behaviour |
