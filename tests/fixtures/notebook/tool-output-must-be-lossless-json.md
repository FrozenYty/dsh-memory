---
status: candidate
updated: 2026-11-11
triggers: lossless JSON, invalid output, tool returns undefined, defined tool, 工具返回 undefined, spawn_member, contextPressure, 工具 返回, 返回 报错
---

# A DSH tool result with an undefined field is rejected as non-lossless JSON

## Symptom

A tool whose `execute` returns an object with a field set to `undefined` fails with:

```
tool "<name>" returned invalid output: value is not lossless JSON
```

## Cause

`ctx.tools.register` validates the declared output as lossless JSON. An own property whose value is
`undefined` is not lossless, so the whole call errors **after** the side effect already happened.

## Where it bites

Reading a value that does not exist yet. Example: `ctx.tokenMeter.contextPressure(session)` on a child
Agent that has issued no model request returns no `contextWindow`, and assigning it produced the error on
`spawn_member` — the member was created and ran, yet the tool reported failure.

## Fix

Attach optional numeric fields only when they are real:

```js
if (Number.isFinite(value)) result.field = value
// or
...Number.isFinite(value) ? { field: value } : {}
```

Never assign `undefined` to a field the output schema declares. Optional keys must be absent, not present
with an undefined value.

Evidence: `Error: tool "spawn_member" returned invalid output: value is not lossless JSON` — reproduced
on 2026-11-11 while returning a member row for a just-created child.

Evidence: `Error: tool "spawn_member" returned invalid output: value is not lossless JSON`
