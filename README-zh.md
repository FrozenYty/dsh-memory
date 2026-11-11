# dsh-memory-notebook

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的低开销持久记忆插件。
把一个装满 markdown 笔记的目录，变成 agent 真正会用上的记忆——不用向量、不起服务、不额外调模型。

[English](README.md) | 中文

## 要解决的问题

每个会话都是空白的开始。那些当初费了大力气才搞明白的东西——路径太深导致工具链解包失败、驱动
谎报自己的设置、安装器悄悄装进了错误的环境——下次还得用同样的代价再学一遍。

现成的方案都在换问题：

- **向量库和服务端记忆**排得准，但多了一个服务、一个要同步的索引，以及一份 agent 没法 `git diff`
  的存储。
- **笔记加指令文件**依然可读，但没有任何东西能让 agent 在真正需要的那一刻去翻它们。一本没人
  打开的笔记本，是一份整理得很好的损失。

这个插件取第二种形态，只补触发这一环。笔记仍然是你仓库里的普通 markdown，插件只负责决定
**什么时候去查**和**什么时候该记**。

## 它做三件事

1. **索引常驻。** 把 notebook 的裸文件名作为一个小段落追加进系统提示。没有描述，所以这个列表
   不会退化成被截断的散文。notebook 为空时注入 **0 字节**——整段消失。
2. **只在命中时召回。** 用户的话匹配到某一条，就把那一条通过动态运行时上下文通道发布给这一轮。
   同一条在一个会话里只注入一次，不是每条消息都来一遍。
3. **四个工具**，让 agent 有意识地读和写；每次写入都必须带证据。

notebook 本身不被改动：一个主题一个 markdown 文件、可选的 `INDEX.md` 定顺序、可选 frontmatter，
外加一条 `notebook-policy.md` 说明「写进这里」的规则。这份政策**随插件分发**，以模板形式在
notebook 缺少它时播种进去，且永远不会覆盖你改过的副本。为什么这样切分，见
[docs/architecture-en.md](docs/architecture-en.md)。

## 安装

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

首次安装靠热重载就能生效。替换已安装的旧副本需要重启。

## 配置

在 profile 的 `cordis.patch.yml` 里 `memory-notebook` 这一行下设置。这个包不声明 `Config`
schema，配置值原样接收；下表默认值写在代码里。

| 键 | 默认 | 含义 |
|---|---|---|
| `workspaceDir` | `.agents/memory` | notebook 目录，相对会话工作目录。`''` 关闭这一层。 |
| `machineDir` | `''` | 可选的机器级层，绝对路径或 `~` 开头。工作区层优先，同名条目以工作区为准。 |
| `showIndex` | `true` | 注入文件名索引。 |
| `indexBudgetChars` | `1400` | 索引段的字符上限。 |
| `recallEnabled` | `true` | 本轮发布命中的条目。 |
| `recallBudgetChars` | `1400` | 单次召回发布的字符上限。 |
| `maxRecall` | `2` | 一条消息最多发布几条。 |
| `minRecallScore` | `4` | 加权分数下限（触发短语 5–7、文件名 4、标题 3、正文 1）。 |
| `minRecallHits` | `2` | 至少几个不同的查询词命中。 |
| `minQueryChars` | `6` | 短于此长度的消息不触发召回。 |
| `skipAcknowledgements` | `true` | 只表示“收到/好的”的消息不触发召回。 |

## 怎么写一条

一个主题一个文件。frontmatter 可选，`INDEX.md` 可选且只用来定顺序。

```markdown
---
status: verified
triggers: platformio, 固件, 烧录, 编译, 路径太长
---

# 一句结论，单独看也能用 — 2026-11-02

现象、机制、绕过办法。

Evidence: `能证明这句话的原始命令或报错`
```

- **`triggers`** 是召回词表。**用你日常说话的语言写，哪怕正文是英文**——匹配跑在这些词上。
  用逗号分隔；**多个词的一条按短语处理，只有整句的词都出现才算命中**，所以短语要写得具体
  （写 `dotnet pipe denied`，别写 `denied`）。**别写通用的单个词**（如 `配置`、`权限`）：
  它一旦配上第二个命中，就会把条目拉进无关对话——把它写成短语的一部分。
  没有 triggers 的条目仍能靠文件名、标题、正文命中，但中文消息找不到英文正文。
- **`status`** 取 `candidate`（默认）、`verified`、`disputed`。`disputed` 既不进索引也不召回。
- **`Evidence:`** 在 `memory_write` 写入时必填。被预算截断的召回会保留这一行，而不是把它丢掉——
  一条没有证据的结论读起来就是一句无从核实的断言。

## 工具

| 工具 | 用途 |
|---|---|
| `memory_list` | 名字、信任状态、标题。 |
| `memory_read` | 完整读一条。 |
| `memory_write` | 新建或更新一条；`evidence` 必填。 |
| `memory_verify` | 标为 `verified`，或退役为 `disputed`。 |
| `memory_audit` | 没有 `Evidence:` 的条目、长期未被触碰的条目，以及 `INDEX.md` 两个方向的漂移。 |

## 为什么省

在本项目自己的 notebook 上实测，11 条：

| 成本 | 数值 |
|---|---|
| 索引段，每次请求 | 620 字符（约 172 token） |
| 单次召回发布 | 最多 1400 字符（约 390 token） |
| notebook 为空 | 0 字节 |
| 读路径上的向量 / 模型调用 | 无 |
| 后台整理 | 无 |

索引每条只有一行且不带描述，所以不需要会真的砍掉内容的预算。召回被两重限制：条数上限
`maxRecall` 和字符上限 `recallBudgetChars`；同一条在一个会话里不会注入第二次。

## 验证

```sh
node test-core.mjs        # 67 项检查，零依赖
node scripts/check-evidence.mjs --dir .agents/memory   # 证据完整性与老化
node scripts/check-index.mjs --dir .agents/memory      # INDEX.md 与目录是否一致
```

这套测试跑在随仓库提交的一份五条目 fixture notebook 上，所以本地和 CI 的行为一致。覆盖：条目
发现与 `INDEX.md` 排序、索引形状与预算、空 notebook 行为、拉丁与 CJK 分词、确认语闸门、中英文
召回、短语触发词的整句匹配、保留 `Evidence:` 行的预算截断、信任状态迁移、`disputed` 同时从索引
和召回消失、以及畸形条目的容错。

## 接受的设计限制

- **词法匹配。** 除 `triggers` 外没有同义词扩展，除五字符共同前缀外没有词干化。这是刻意的：
  一次错误的召回同时损失 token 和信任。
- **没有界面上可见的“上下文注入”行。** 按路径安装的本地插件无法 import `@deepseek-ai/*` 包
  （见 [ADR 0001](docs/adr/01-zero-dependency-host-half.md)），所以召回走运行时上下文通道，
  而不是伪造一条用户消息。好处是注入不进会话日志，并且天然活过上下文压缩。
- **默认没有跨工作区层。** `machineDir` 就是为这个留的，不配置就不开启；同名条目以工作区为准。
- **没有向量检索。** 几十条规模下，文件名加触发词够用，且命中失败是可见、可修的。
  重新评估的条件：条目多到装不下索引预算。

## 文档

- [docs/INDEX-en.md](docs/INDEX-en.md) —— 文档地图：哪个问题该看哪一篇。
- [docs/architecture-en.md](docs/architecture-en.md) —— 设计与取舍。
- [docs/adr/](docs/adr/) —— 难以回退的决定，一个决定一个文件。
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 分支、提交、CI 检查什么。
- [AGENTS.md](AGENTS.md) —— 在这个仓库里工作的 AI 助手规则。

## 许可证

MIT，见 [LICENSE](LICENSE)。
