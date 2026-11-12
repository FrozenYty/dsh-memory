# 文档地图

> 英文版：[INDEX-en.md](INDEX-en.md)。**英文版是权威**，两份冲突时以它为准。

> 维护者：@FrozenYty · 何时重看：新增、改名或删除文档时

一页回答三个问题：哪份文档回答什么、两份冲突时谁赢、改一处还要动哪些文件。打开别的文档之前先读它。

## 1. 从哪里开始

| 问题 | 读 |
|---|---|
| 这个插件做什么，怎么安装和配置？ | [README-zh.md](../README-zh.md) |
| 它是怎么搭起来的，代价是什么？ | [architecture-zh.md](architecture-zh.md) |
| 某个决定为什么是现在这样？ | [adr/](adr/)——一个决定一个文件 |
| 怎么开分支、写提交、过 CI？ | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| 我是刚接手这个仓库的 AI 助手 | [AGENTS.md](../AGENTS.md) |
| 版本之间改了什么？ | [CHANGELOG.md](../CHANGELOG.md) |
| 某个词在这里是什么意思？ | [glossary-en-zh.md](glossary-en-zh.md) |
| 测试覆盖了什么、怎么证明的？ | [test-plan-zh.md](test-plan-zh.md) |
| 某条 ADR 由什么保证它成立？ | [traceability-zh.md](traceability-zh.md) |

## 2. 谁赢

- **决定记录胜过设计文档。** `docs/adr/` 保存的是推翻代价很高的决定。`architecture-zh.md` 描述当前形状；两者冲突时以 ADR 为准，设计文档是过时的那个。
- **已接受的 ADR 是封存的。** 要改变一个决定，写一份新的 ADR 取代它，并把旧的标为 `Superseded by NNNN`。永远不要直接改决定本身去迎合现状。
- **代码胜过两者。** 代码和文档冲突时，运行的是代码；在同一次改动里修文档。
- **英文版胜过中文版。** 两份是同一份文档的两个语言版本，任何不一致都是翻译滞后，以 `-en` 为准并修 `-zh`。

## 3. 改一处要一起动哪些

| 改动 | 同时要改 |
|---|---|
| `index.js` 里的一个默认值 | `README.md` **和** `README-zh.md` 的配置表；`scripts/check-docs.mjs` 会在任一缺失时报错 |
| 工具名、参数或必填字段 | 两个 README 的工具表，以及 `docs/architecture-en.md` / `architecture-zh.md` |
| 索引或召回预算模型 | `docs/architecture-*.md` 和两个 README 的代价表 |
| 一个带非显然取舍的新行为 | 一份新 ADR，以及 [adr/](#5-决定记录) 里的一行 |
| 任何用户可见的行为 | `CHANGELOG.md` |
| 条目格式字段（`triggers`、`status`、`Evidence:`） | 两个 README、`architecture-*.md`、`memory_write` 的描述 |
| 新增或改动 `scripts/*.mjs` 闸门 | CI 的 `check` job，以及 `AGENTS.md` **和** `CONTRIBUTING.md` 里的表 |
| 触发匹配规则（权重、短语、前缀） | `docs/architecture-*.md`，以及两个 README 里的触发词说明 |
| 一条召回判断（什么该匹配什么） | `tests/qrels.json`——翻转一个用例会让 CI 变红，所以那是一次被审阅的决定，不是副作用 |
| 插件页面上的字符串（`locale/*.json`） | 两种语言；`scripts/check-docs.mjs` 在键集不一致时报错 |
| `package.json` 里的版本号 | `CHANGELOG.md` 里的一节 `## [x.y.z]`——一次改动，`check-docs` 强制 |
| 新增一份 `docs/*-en.md` | **同一名字的 `-zh.md`**；`scripts/check-docs.mjs` 在缺少对应中文版时报错 |

## 4. 约定

- **`docs/` 里的每一份文档都是 `-en` / `-zh` 成对的**，由 `scripts/check-docs.mjs` 强制。英文版是权威；中文版按中文行文写，不做逐字翻译。
- **`README.md` 是英文，`README-zh.md` 是中文**，互为语言切换入口。
- **`CHANGELOG.md` 只有英文**：它按时间追加，翻译它等于每次发布维护两份历史；它是记录，不是文档。
- **`docs/adr/` 只有英文**：ADR 是决定记录，读者是未来的实现者，与当前对话用什么语言无关。
- **`AGENTS.md` 和 `CONTRIBUTING.md` 只有英文**：它们是给助手和贡献者的指令，不是面向读者的文档；产生它们的
  对话是中文，翻译它们只会在别处多放一份会漂移的规则。
- **不出现任何机器相关信息。** 没有绝对路径、没有用户名、没有本机目录名。命令一律相对仓库根书写。`scripts/check-paths.mjs` 对每个 markdown 文件强制这一条。
- **推翻代价高的决定才写成 ADR**，不是 changelog 里的一段话。一个决定一个文件；永远不要写两遍。

## 5. 决定记录

| # | 决定 | 状态 |
|---|---|---|
| [0001](adr/01-zero-dependency-host-half.md) | 宿主侧不 import 任何 `@deepseek-ai` 包 | Accepted |
| [0002](adr/02-filename-index-without-descriptions.md) | 注入的索引只有文件名，不带描述 | Superseded by 0016 |
| [0003](adr/03-match-only-recall-into-runtime-context.md) | 召回只在匹配时发生，走运行时上下文通道 | Accepted |
| [0004](adr/04-bilingual-triggers.md) | 条目携带显式召回词，用作者自己的语言 | Accepted |
| [0005](adr/05-trust-status-and-mandatory-evidence.md) | 每次写入都带证据；信任是三态字段 | Accepted |
| [0006](adr/06-evidence-audit-by-age.md) | 证据按年龄和完整性审计，从不执行 | Accepted |
| [0007](adr/07-policy-in-the-notebook.md) | 笔记本的政策放在笔记本里，不放进 skill | Superseded by 0008 |
| [0008](adr/08-policy-template-and-seeding.md) | 政策随插件发布，并在缺少它的笔记本里播种 | Accepted |
| [0009](adr/09-derived-index-and-write-refusal.md) | 索引是派生数据；会截断它的写入被拒绝 | Partially superseded by 0014 |
| [0010](adr/10-capture-hint.md) | 压缩前给一次捕获提示，而不是自动捕获 | Accepted |
| [0011](adr/11-judgement-set-for-recall.md) | 召回对照写下来的判断集衡量，不用基准测试 | Accepted |
| [0012](adr/12-health-check.md) | 能力诊断与结果分开报告 | Accepted |
| [0013](adr/13-usage-counts.md) | 召回使用按条目计数，且不记录别的 | Accepted |
| [0014](adr/14-index-budget-is-residency.md) | 索引预算限制的是常驻条数，不是容量 | Accepted |
| [0015](adr/15-recall-is-model-driven-by-default.md) | 默认由模型主动读取，不做自动召回 | Accepted |
| [0016](adr/16-index-carries-summaries.md) | 索引每行携带一句摘要 | Accepted |

新增 ADR 时在这里加一行。硬盘上存在但没列进这张表的 ADR 会让 `scripts/check-docs.mjs` 失败。
