# dsh-memory

[English](README.md) | 中文

[![ci](https://github.com/FrozenYty/dsh-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/FrozenYty/dsh-memory/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![build step](https://img.shields.io/badge/build-none-brightgreen)
![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)

> 一本索引良好的笔记本，agent 看得见——不是一个替你记忆的服务。

一个 DeepSeek Harness 的 profile bundle：把一个 markdown 目录变成 agent 的记忆——system prompt 里一份索引、
一个主题一个文件、七个用来读写和审计的工具。不用向量、不起服务、读路径上一次模型调用都没有。空笔记本零字节。

[github.com/FrozenYty/dsh-memory](https://github.com/FrozenYty/dsh-memory)

## 现状

- 当前版本：v0.23.2。
- **正在日常使用，用的就是它为之而写的那个笔记本。** 2026-11-11 到 2026-11-13 之间，48 条条目、236 次读取记录。
  两个数字都来自插件自己的 `usage.jsonl`，所以是记录，不是声称。
- **三个静默缺陷是它自己的闸门在一次会话里找出来并修掉的**：每一次证据行都被切到 300 字符、一条粘贴的长
  消息会把当前请求挤出召回查询、以及索引顺序永远不让新条目爬到旧条目之前。现在每一个都是一条测试和一个变异。
  见 [CHANGELOG.md](CHANGELOG.md)。
- **没有覆盖的**：大到溢出索引的笔记本（计数溢出那条路只有夹具测试，没有在真实数据上跑过），以及除本机已安装
  版本之外的任何 Harness 构建。
- 版本记录：[CHANGELOG.md](CHANGELOG.md)。设计与取舍：[docs/architecture-zh.md](docs/architecture-zh.md)。
  决定：[ADR](docs/adr/)。召回测量：[`tests/qrels.json`](tests/qrels.json)。

## 它遵守的约定

agent 的会话从空白开始。所有费劲学到的东西——长路径上失败的 toolchain、对自己设置撒谎的驱动、静默写进错误
环境的安装器——下次都要用同样的代价再学一遍。

现有的答案都在用一个问题换另一个问题。**向量库和记忆服务**排序好，但多了一个服务、一份要同步的索引、以及
一个你没法 `git diff` 的存储。**笔记加一份说明文件**保持可读，但没有任何东西让 agent 在需要它的那一刻去读。

这个插件取第二种形状，修两件事：**什么时候看**，和**什么时候写**。

1. **一份常驻索引。** 每条以文件名加一句摘要出现，摘要长度固定。摘要才是让模型判断"值不值得读一次"的东西——
   文件名能促成一次读取，但阻止不了一次。空笔记本注入**零字节**。
2. **模型自己读它需要的。** 索引头告诉它，当一个名字和它正要干的事对得上时去调 `memory_read`。**没有任何
   东西被自动注入**——下面的测量就是原因，`recallEnabled` 可以改成自动匹配。
3. **七个工具**，读、写、验证、审计、诊断、计量，每次写入都强制要求证据。

笔记本本身就是普通 markdown：一个主题一个文件，可选的 `INDEX.md` 固定顺序，可选 frontmatter，以及一条写明
写入规则的条目。那份政策**随插件发布**，并播种进任何还没有它的笔记本，永不覆盖已被编辑的副本。

## 它有多准

这里测两件事，第二件就是自动召回默认关闭的原因。

**匹配质量**，在一个 29 条的笔记本上双向实测，判断集提交在 [`tests/qrels.json`](tests/qrels.json)：

| 提问集 | 结果 |
|---|---|
| 用笔记本自己词汇写的相关问题 | 52/52 |
| 照着处境新写的说法 | 6/18 |
| `tests/qrels.json` 里的无关问题 | 24 条里触发 0 次 |

**然后是没人会为自己写的那一组**——只是碰巧共享词汇的日常闲聊：

| 你打的字 | 它拉进来的 |
|---|---|
| 证书考试过了 | TLS 那条——一个词覆盖两种意思 |
| 笔记本有点烫 | 笔记本政策——"笔记本"也是笔记本电脑 |
| 插件挺多的 | 两条插件条目，来自一句什么都没说的评论 |
| **共享词汇的日常闲聊** | **18 条里触发 5 次** |

实测集是中文写的，上表是等价的英文说法。这个失败与语言无关——一个词覆盖两种意思就够了——但分词器会给
两个汉字的孤立词两个命中的权重，那才是它在中文里这么容易触发的原因。

`qrels.json` 里那 24 条干净提问，是写触发词的同一个人的产物，所以它们干净是应该的。敌意那组不是。

**抬高门槛分不开它们。** 正确召回和误报都落在 4–5 分，把下限提到 6，代价是六个正确召回里的四个，换掉五个
误报里的四个：

```
分数 | 召回 | 误报
  4  | 6/18 | 5/18
  5  | 6/18 | 5/18
  6  | 2/18 | 1/18
  8  | 1/18 | 0/18
```

所以默认做法和 Claude Code 一样：**索引列出每一条，模型在名字对得上时去读。** 没有匹配器，就没有误报。

它确实匹配时，是词法的：比的是词。用条目里已有的说法描述问题，它触发；用**症状**描述而条目记的是**机制**——
你说"照片拍出来是黑的"，条目写的是"黑帧"——它就不触发。这就是 `recallEnabled: true` 继承的限度。

**真想让它找到东西，就用你抱怨时的说法写触发词，不要用手册的说法。** 这是你能做的杠杆最大的一件事。

## 安装

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

首次安装会通过热重载生效。替换一份已安装的副本需要重启。

## 配置

在 profile 的 `cordis.patch.yml` 里 `memory` 那一行下面设值。这个 bundle 不声明 `Config` schema，所以值被
按原样接受；下面的默认值在代码里生效。

| 键 | 默认 | 含义 |
|---|---|---|
| `workspaceDir` | `.agents/memory` | 笔记本目录，相对会话工作目录。`''` 关闭这一层。 |
| `machineDir` | `''` | 可选的机器级层，绝对路径或以 `~` 开头。同名冲突时工作区层优先。 |
| `showIndex` | `true` | 是否注入文件名索引。 |
| `indexBudgetChars` | `9000` | 索引里**列出多少条**的上限，不是笔记本能存多少条。超出的部分被计数，仍然可被召回。 |
| `indexSummaryChars` | `60` | 索引每行摘要的字符数。`0` 退回纯文件名——条目更多，每条信息更少。 |
| `recallEnabled` | `false` | 是否为这一轮发布匹配到的条目。默认关闭：词法匹配分不清"证书错误"和"证书考试"。 |
| `recallBudgetChars` | `1400` | 单次召回发布的字符上限。 |
| `maxRecall` | `2` | 一条消息最多发布几条。 |
| `minRecallScore` | `4` | 加权分下限（触发短语 5–7、文件名 4、标题 3、正文 1）。 |
| `minRecallHits` | `2` | 必须匹配的不同查询词数。 |
| `minQueryChars` | `6` | 更短的消息永不触发召回。 |
| `skipAcknowledgements` | `true` | 忽略只表示确认的消息。 |
| `captureHintRatio` | `0.6` | 上下文窗口用到这个比例时出现一次性的"把要紧的写下来"提示。`0` 关闭。 |

**预算是旋钮，不是天花板。** 它限制的是**常驻**——模型不问就能看见多少条——从不限制笔记本能装多少。超出的
条目在索引里被计数，仍然可以调取，`memory_list` 会点名它们。见 [ADR 0014](docs/adr/14-index-budget-is-residency.md)。

它还决定**索引什么时候重排**，而那是缓存问题，不是记忆问题。索引是 system prompt 的一段，所以它一变，从第一
个变化的行开始，整个 prompt 的缓存就失效。每次写入都要付一次，无法避免；但**一次读取不该付**——所以顺序**只在
笔记本已经装不下的时候**才重算。预算之下，每条都会被列出，位置决定不了任何事情，那时重排只是让"某个会话读了
一条"去改变"下个会话"的索引，没有任何好处。

**索引是会话开始时拍下的快照。** 所以会话中途写入的条目不在**那个**会话的索引里——就是刚写它的那个——而下个
会话能看到。变化落在这里是免费的：还没发出去的会话本来就没有缓存可失。条目并没有被藏起来：它就在写下它的那段
对话里，`recall` 能匹配到它，`memory_list` 会点名它，磁盘上的 `INDEX.md` 也立刻更新。

**每次请求的代价**，不是每个笔记本的：

| 代价 | 值 |
|---|---|
| 索引一行 | 约 89 字符、约 24 token |
| 默认预算下的索引 | 约 9000 字符、约 2500 token、约 100 条 |
| 空笔记本 | 0 字节 |
| 向量、读路径上的模型调用、后台归并 | 无 |

## 怎么写一条

一个主题一个文件。frontmatter 可选；`INDEX.md` 只固定顺序。

```markdown
---
status: verified
triggers: platformio, firmware, flash, compile, path too long, will not install
---

# 结论，单独拿出来就能用 — 2026-11-02

症状、机制、绕法。

Evidence: `证明它的确切命令或错误文本`
```

- **`triggers`** 是召回词汇，它决定这条会不会被找到。写**你真会打出来的词**：

  | 你会打的 | 不要只列 |
  |---|---|
  | 换台电脑就不对了 | 转发、绝对路径、盘符 |
  | 浏览器能开但命令不行 | curl、tls、schannel |
  | 照片拍出来是黑的 | 黑帧、白平衡 |

  多词短语只在每个词都出现时才匹配——保持具体（`dotnet pipe denied`，不是 `denied`）。避免**单个泛词**
  （`configuration`、`permission`、`restart`）：它一旦配上任何第二个命中，就会把条目拖进无关消息。永远不要用
  单个汉字——它挣不到构成匹配所需的第二个命中。
- **`status`** 是 `candidate`（默认）、`verified` 或 `disputed`。disputed 条目永不进索引、永不召回。
- **`Evidence:`** 通过 `memory_write` 写入时必填。它必须**自己就能证明**这个结论：命令、输入了什么、返回了什么
  都要在这行里，这样下一个打开这个文件的人不需要另一个文件还存在。"见 `probe.py`"不是证据——输出才是。

## 工具

| 工具 | 用途 |
|---|---|
| `memory_list` | 名字、信任状态和标题——包括超出索引预算的条目。 |
| `memory_read` | 完整读一条。 |
| `memory_write` | 创建或更新；`evidence` 必填。报告这条是否常驻，以及它切掉了哪个字段。 |
| `memory_verify` | 提升为 `verified`，或退役为 `disputed`。 |
| `memory_audit` | 缺 `Evidence:`、长期未动、正文不是英文、`INDEX.md` 任一方向的漂移。 |
| `memory_health` | 记忆是坏了还是只是无话可说：`ok`、`degraded`、`broken`、`absent`、`unconfigured`。 |
| `memory_usage` | 哪些条目被读过、哪些从未被读。只有条目名和日期——永远没有查询内容。 |

## 它从不做什么

- **读路径上从不调用模型或服务。** 索引由文件系统算出；召回是一次词比较；两者都是磁盘内容的纯函数。
- **从不无证据写入。** `memory_write` 拒绝空的证据，而被裁剪的召回会保留 `Evidence:` 行而不是丢掉它——
  没有证据的条目读起来就是一个无法核实的断言。
- **从不执行记录下来的命令。** `memory_audit` 只查年龄和完整性，从不运行任何东西：笔记本是任意 markdown，
  一个见到什么就跑什么的校验器就是一个任意代码执行面。
- **从不覆盖被编辑过的政策。** 它只向还没有政策的笔记本播种一份，独占创建，然后不碰被编辑过的副本。
- **从不记录你搜过什么。** `usage.jsonl` 里只有一个日期和一个条目名。没有查询文本、没有会话 id、没有路径。
- **从不因为预算丢掉条目。** 超出预算的条目在索引里被计数，并且每个工具都够得到。

## 常见问题

**每个 `memory_*` 工具都报 `unknown tool`。**
插件加载失败了。几乎总是宿主拒绝的某个 schema——宿主在加载时校验工具 schema，拒绝的是整个插件而不是某一个工具。
查宿主日志；它强制的规则被抄进了 `tests/core.test.mjs` 的 *every tool schema stays inside the host subset* 一节。

**记忆从来不触发。**
先调 `memory_health`。它把"坏了"和"没匹配上"分开——这两个状态在一次没返回结果的查询里看起来一模一样。如果它
说 `ok`，笔记本是好的，问题在词汇。

**写进去了但索引里没有。**
它超出了 `indexBudgetChars`。`memory_write` 已经在 `indexOverflow` 里说了；`memory_usage` 会显示有没有东西
读过它。

**记忆不再被保存。**
笔记本目录不可写。`memory_health` 会专门报告这一点——它就是那个看起来像一切正常的失败。

**它会替我记住吗？**
不会。它让一本整理过的笔记本对 agent 可见，并且能写回去；上面的测量说明了自动召回为什么默认关闭。有用的
心智模型是一本索引良好的笔记本，不是一个助手。

**为什么索引顺序自己会变？**
每次同步都会按信任状态和最近被读过的时间重排，所以挣到位置的条目留在前面，而新条目仍然有机会。手工编辑
`INDEX.md` 按设计是没用的——见 [ADR 0017](docs/adr/17-index-order-from-use.md)。

## 这个设计接受的限度

- **词法匹配，而这就是硬限度。** 用笔记本里没有的说法提问，大约五次里有一次能找到对的条目。这是有意的：
  替代方案是每一轮付一个服务或一次模型调用，而"它们能买到答案质量"这件事的公开证据经不起检查。解法是词汇，
  不是算法。
- **没有任何东西被自动捕获。** 闭环是模型决定去调 `memory_write`。压缩前的一次性提示会推它一把；那和捕获原始
  事件不是一回事，也没有被声称是。
- **没有可见的"上下文已注入"行。** 链接进 profile 的 bundle 不能 import `@deepseek-ai/*`
  （[ADR 0001](docs/adr/01-zero-dependency-host-half.md)），所以召回走运行时上下文通道。好处：没有东西进入
  会话日志，且注入在压缩后仍然有效。
- **`verified` 不是强制执行的。** 模型写的一切都是 `candidate`，直到有东西提升它，而模型可以提升自己的条目。
  它是一个信号，不是人工复核的证明。
- **默认没有跨工作区层。** `machineDir` 就是为它存在的；不配置就是关闭的。

## 验证

```sh
node tests/core.test.mjs                    # 行为检查，零依赖
node scripts/mutation-scan.mjs              # 88 个变异，每一个都必须被杀死
node scripts/eval-recall.mjs                # 基于 tests/qrels.json 的召回判断
node scripts/check-docs.mjs                 # ADR 是否列出、链接、语言对、locale 键、版本
node scripts/check-paths.mjs                # 任何文档里都没有机器相关路径
node scripts/check-evidence.mjs --dir tests/fixtures/notebook
node scripts/check-index.mjs --dir tests/fixtures/notebook
```

CI 跑全部这些并阻止合并。**变异扫描不是装饰**：它逐条破坏承载功能的代码行并要求有测试失败，而且在某个变异
不再适用时以非零退出——*一个测的比它声称的少的扫描器，是最安静的撒谎方式。*

本地跑通证明的比看起来少：`node --check` 不是类型检查，而文档闸门从不看 JavaScript。

## 文档

| 问题 | 文档 |
|---|---|
| 它承诺什么，怎么安装？ | 这份 README |
| 它是怎么搭起来的，代价是什么？ | [docs/architecture-zh.md](docs/architecture-zh.md) |
| 某个决定为什么是现在这样？ | [docs/adr/](docs/adr/)——一个决定一个文件 |
| 哪条测试固定住了哪个决定？ | [docs/traceability-zh.md](docs/traceability-zh.md) |
| 测试覆盖了什么，又证明不了什么？ | [docs/test-plan-zh.md](docs/test-plan-zh.md) |
| 某个词在这里是什么意思？ | [docs/glossary-en-zh.md](docs/glossary-en-zh.md) |
| 版本之间改了什么？ | [CHANGELOG.md](CHANGELOG.md) |
| 怎么开分支、写提交、过 CI？ | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 我是 AI 助手，这里的规则是什么？ | [AGENTS.md](AGENTS.md) |

## 许可

MIT。见 [LICENSE](LICENSE)。
