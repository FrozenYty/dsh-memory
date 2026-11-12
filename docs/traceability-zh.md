# 追溯矩阵

> 英文版：[traceability-en.md](traceability-en.md)。**英文版是权威**。

> 维护者：@FrozenYty · 何时重看：新增一条 ADR，或某个保证失去了它的测试

每一条已被接受的决定，以及**是什么把它固定住**。写在散文里的决定和能被某个会失败的东西强制执行的
决定，是两件事——直到这张表被填满。而最后一栏才是诚实的部分。

测试名按它们在测试集里的原样引用，所以一次改名漏改这里，会表现为一句过时的引用，而不是一个看不见的缺口。

## 1. 有强制执行的决定

| ADR | 由什么保证 | 层次 |
|---|---|---|
| [0001](adr/01-zero-dependency-host-half.md) 不 import `@deepseek-ai` | `package.json` 没有 `dependencies`；宿主侧只用 `node:` 内置模块。CI 的 `node --check` 抓不到新 import——**加载器会** | 结构性 |
| [0003](adr/03-match-only-recall-into-runtime-context.md) 召回走运行时上下文通道 | `a host without systemPrompt.section fails loudly`；§22 直接触发 section 回调 | 行为 |
| [0004](adr/04-bilingual-triggers.md) 触发词用作者自己的语言 | `triggers stop being split on separators`、`a short Chinese run stops being kept whole`、`a two-character Chinese trigger reaches the floor alone` | 行为 + 变异 |
| [0005](adr/05-trust-status-and-mandatory-evidence.md) 每次写入都带证据 | 空 `evidence` 直接抛错；`an entry without an Evidence line is reported` | 行为 |
| [0006](adr/06-evidence-audit-by-age.md) 按年龄审计，从不执行 | `age stops being reported`（变异）、`entries age after one day`（变异）。**没有任何东西会去跑记录下来的命令**——那就是这个决定本身，而它的执行方式正是**没有** `exec` 调用 | 变异 |
| [0008](adr/08-policy-template-and-seeding.md) 政策随插件发布并播种 | `the bundled policy template ships`、`a second seed is a no-op`、`an edited policy is never overwritten`、`an existing policy is overwritten`（变异）、`the policy template stops shipping`（变异） | 行为 + 变异 |
| [0009](adr/09-derived-index-and-write-refusal.md) 索引是派生的 | `index is derived, not hand-maintained`（§12）、`the notebook order stops following INDEX.md`（变异） | 行为 + 变异 |
| [0011](adr/11-judgement-set-for-recall.md) 对照写下来的判断集衡量 | `tests/qrels.json` 存在、被两个互不相关的套件读取，且 `scripts/eval-recall.mjs` 报告 52/52 与 24/24 | 判断集 |
| [0012](adr/12-health-check.md) 能力诊断与结果分开 | `broken is not the same as empty`（§15）；`absent is reported as broken`（变异） | 行为 + 变异 |
| [0013](adr/13-usage-counts.md) 按条目计数，不记录别的 | `the log records a day and an entry name and nothing else`、`no query text reaches the log`、`the usage count stops being per-entry`（变异） | 行为 + 变异 |
| [0014](adr/14-index-budget-is-residency.md) 预算限制常驻条数 | `the budget caps residency, not capacity`（§13）；`only one hit is ever returned`（变异） | 行为 + 变异 |
| [0015](adr/15-recall-is-model-driven-by-default.md) 默认不做自动召回 | `DEFAULTS` 里的 `recallEnabled: false`；`a read through the tool is counted as usage`（§20）让"模型主动读"这条路可测量；`tests/hostile.json` 是这个决定的证据 | 行为 |
| [0016](adr/16-index-carries-summaries.md) 索引携带摘要 | `the summary reaches the index`、`a summary in the frontmatter wins over the heading`、`a summary is not carried across an update`（变异）、`unknown frontmatter keys are dropped`（变异） | 行为 + 变异 |

## 2. 只是约定、没有机制的决定

这些不可能让构建失败，假装它们能比说出来更糟。

| ADR | 为什么没有测试 | 什么能改变这一点 |
|---|---|---|
| [0002](adr/02-filename-index-without-descriptions.md) —— **已被 0016 取代** | 决定已被推翻；取代标记就是记录 | — |
| [0007](adr/07-policy-in-the-notebook.md) —— **已被 0008 取代** | 同上 | — |
| [0010](adr/10-capture-hint.md) 压缩前给一次捕获提示 | 提示是 `index.js` 提示段里的一句话。测试断言工具存在、schema 可解析；**没有任何东西断言这句提示是好建议** | 只有真实会话能——这与 ADR 0015 是同一个未解问题 |

## 3. 有已知缺口的保证

| 保证 | 缺口 | 什么在替代它 |
|---|---|---|
| 宿主侧零依赖（0001） | 没有测试读取 `package.json` 并断言 `dependencies` 不存在 | CI 按没有依赖的 lockfile 安装；一旦 import 会在加载时失败 |
| **真实**笔记本上的召回质量 | 判断集跑在冻结的夹具上，不是作者的笔记本 | 读者自己的判断，以及 `memory_usage` 显示实际被读过什么 |
| 索引到达了模型 | `indexInjected` 由 section 回调记录，所以它证明**插件发出了文本**，不证明有模型读了 | 只有真实会话 |
| 笔记本语言规则 | `memory_audit` 会报告中文散文，但没有任何东西阻止写入中文——这个检查是事后的，且是有意的：因为语言而拒绝一次写入，会挡掉一条好条目 | 审计，加上如今写在 policy 和 `memory_write` 描述里的规则 |
| `memory_audit` 自身的正确性 | 它的输出在合成条目上被断言，从未在真实笔记本上被断言 | 去跑它——六条中文条目就是这样被发现的 |

## 4. 这张表是为什么而存在

三个用途，按它们实际起作用的顺序：

1. **找出没有被强制执行的决定**——写这张表的过程，才让"语言规则没有检查"这一点显现，也让 `summary:`
   什么都没做这件事事后被抓到。
2. **找出过时的引用**——测试改名了而这里没改，会留下一个已不存在的名字，`grep` 一条命令就能找到。
   ***这张表不是机器校验的；那是它的弱点，一行就能修：加一道闸门，把每个被引用的名字拿去测试集里 grep 一遍。***
3. **回答"这个决定真的被遵守了吗"**，而不用读 16 份 ADR 和 184 个测试。

## 5. 新增一行

一条被接受的 ADR 必须在 §1、§2 或 §3 里有一行——**没有第四个选项**，而选择 §2 或 §3 时，必须写一句话
说明为什么没有东西强制执行它。那句话才是重点：**它是阻止"我们决定过"被误当成"这确实发生了"的东西。**
