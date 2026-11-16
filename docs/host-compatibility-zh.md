# 宿主变了，插件还得活着

[English](host-compatibility-en.md) | 中文

**一句话：** 一个 DeepSeek Harness bundle 被链接进 profile，在每个会话里对着一个**不会征求它同意**就更换的宿主运行。宿主改名或移除 bundle 调用的东西时，没有警告，也没有过渡期 —— bundle 要么降级一个功能，要么**直接不存在**。这份文档讲的是怎么让第二种结果不可能发生。

写它就是为了转发。**里面没有一句依赖它出自哪个插件。**

## 实际发生了什么

2026-11-16 实测：`dsh-team` 0.43.35 对着 `@deepseek-ai/dsh` 0.2.2-rc.3，**十二个工具一个都调不动**。原因是一行：

```js
const membership = ctx.agentTeams.tryMembership(agent)
```

`agentTeams` 服务由 `@deepseek-ai/dsh-agent-team` 以 `super(ctx, "agentTeams")` 注册，声明六个成员 —— `isEnabled`、`setEnabled`、`createTask`、`getTask`、`listTasks`、`updateTask` —— **`tryMembership` 不在其中。** 而那行调用在 `apply` 里的一个循环中，没有任何守卫，于是抛 `TypeError: ctx.agentTeams.tryMembership is not a function`，`apply` 失败，**整个 bundle 不再激活。**

用户看到的是最糟的那种：**插件所有的工具都消失了，而唯一的线索是日志里某处一条加载失败。** 没有任何东西说"有一个调用被改名了"；看起来就像插件坏了。

**同一份代码其实已经懂这个道理。** 它对别的宿主成员做了 shape-probe，并会用散文报告优雅的降级 —— *"宿主没有发布 `agentTeams.listMembers`"* —— 还对用户说过 *"这个插件自己的工具不受影响"*。**那句话是假的**，因为同一个服务还有两处调用没守卫。**把降级的词汇用在一些调用上、却不用在另一些上，等于没有。**

## 规则

**任何宿主成员都不该成为 bundle 停止加载的原因。** 三种情况，三种形状，**它们不能互换**：

### 一、没有它就没法工作的成员

在 `apply` 开头 probe，然后**响亮地**拒绝，并点名缺什么：

```js
const required = [
  ['systemPrompt.section', typeof ctx.systemPrompt?.section === 'function'],
  ['tools.register', typeof ctx.tools?.register === 'function'],
]
const missing = required.filter(([, present]) => !present).map(([name]) => name)
if (missing.length > 0) {
  throw new Error(`${NAME} requires host APIs this DSH version does not provide: ${missing.join(', ')}`)
}
```

这仍然会失败 —— 但它失败得**可读**，而且报出的是宿主契约，不是一个 `undefined` 的属性。**那是一个五分钟的诊断，而不是一下午。**

### 二、只服务一个功能的成员

**在调用点守卫，不要在加载时守卫。** 有两种状态必须分开处理，而它们不一样：

```js
const meter = ctx.get('tokenMeter')      // 服务缺失：get 返回 undefined
if (meter === undefined) return DEGRADED
try {
  value = meter.contextPressure(session) // 服务在、成员被改名：这行会抛
} catch {
  return DEGRADED
}
```

**杀死 `dsh-team` 的是第二种状态** —— 服务解析到了，所以 `undefined` 检查帮不上忙，而调用抛错。**只检查"服务在不在"的守卫覆盖不了"成员被改名"，而那恰恰是宿主最可能做的改动。**

### 三、监听器

**永远不要假设 payload 的形状。** 用可选链读，需要的字段没了就返回：

```js
ctx.on('some/event', (payload) => {
  const id = payload?.agent?.session?.id
  if (id === undefined) return
})
```

**监听器抛错不由 `apply` 兜住**；它在事件触发的某个更晚时刻失败，而那更难联系到原因。

## 检查

**一个测试：用缺了一个成员的假宿主调 `apply`，断言发生了什么。** 不是对源码跑正则 —— 正则会让一个守错东西的文件通过，而情况二里那两种状态不执行代码根本分不开。

三种状态都必须跑到，因为**只覆盖第一种的测试看不见引发这一切的那个 bug**：

| 假宿主 | 可接受的结果 |
|---|---|
| 成员齐全 | `apply` 成功，**每个工具都注册** |
| 可选**服务**缺失 | `apply` 成功，工具注册，该功能降级 |
| 可选服务在、成员**被改名** | `apply` 成功，工具注册，调用不外泄 |

再加一个**对照**：成员在的时候功能必须仍然**工作**，否则"缺失时返回空"对"永远返回空"的插件也会通过。

必需那条也要断言：`apply` 抛错、**错误信息点名缺失的成员**、而且不是一句赤裸的 `TypeError`。

### 证明检查能红

写完它，然后**拆掉守卫，看它变红**。这次工作里，删掉一个 `try`/`catch` 得到的是：

```
FAIL a renamed method does not escape the provider — meter.contextPressure is not a function
```

**那正是 `dsh-team` 在生产里报的同一句**，这就是你确认测试走到了要紧那行的方式。**从没红过的检查不是检查** —— 而这个检查的头两版都红不了，因为它们走的是提前返回那条路，从没到达被守卫的调用。

## 迁移清单

对 profile 里每个 bundle：

1. **列出它调用的每一个宿主成员。** `ctx.<service>.<member>(`、`ctx.get('<service>')`，以及它监听的每一个事件名。
2. **逐个分类**：没有它就没法工作，还是只服务一个功能？
3. **必需的**：在 `apply` 开头 probe，抛一个点名成员的错误。
4. **功能的**：守卫**调用**，包含成员被改名那种情况。
5. **监听器**：payload 用可选链读，缺字段就返回。
6. **写假宿主测试**，三种状态都要，加对照。
7. **拆掉一个守卫，确认测试变红。** 没红，说明测试没走到那段代码。

## 两件让这件事比看上去更糟的事

**bundle 看不见它被写就时对应的宿主契约。** profile 链接的是一个 checkout，CI 里没有 Harness。所以改名在有人真的在会话里跑起来之前是**不可见的** —— 这就是为什么假宿主测试是这份契约唯一被检查的地方，也是为什么它必须是**行为级**的。在仓库里存一份宿主 API 快照，不过是又一份宿主一动就过期的事实副本。

**这个失败在构造上就是静默的。** `apply` 抛错是一次加载失败；模型只是看到工具变少了。**没有任何东西把它作为"你的插件需要更新"传达给用户。** 在有东西做到之前，假宿主测试是唯一的预警。

## 这不能修好的部分

**给每个调用加守卫，只保证 bundle 还能加载，不保证它正确。** 被守卫吞掉的一次改名，就是一个悄悄停止工作的功能；而一个返回默认值的 `catch`，掩盖真 bug 和掩盖宿主变更同样容易。**每一条降级路径都该是能报告出来的** —— 计数、在诊断工具里暴露、用散文说出来 —— 这样"仍然能加载"才不会悄悄变成"悄悄变差"。
