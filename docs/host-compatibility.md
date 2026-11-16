# Surviving a host that changes under you

A DeepSeek Harness bundle is linked into a profile and runs in every session, against a host that is
replaced without asking the bundle. When the host renames or removes something a bundle calls, the bundle
does not get a warning and does not get a deprecation period: it either degrades one feature or it stops
existing. **This document is about making that second outcome impossible.**

It is written to be forwarded. Nothing here depends on the plugin it came from.

## What actually happened

On 2026-11-16, `dsh-team` 0.43.35 was measured against `@deepseek-ai/dsh` 0.2.2-rc.3. **None of its twelve
tools were callable.** The cause was one line:

```js
const membership = ctx.agentTeams.tryMembership(agent)
```

The `agentTeams` service, as registered by `@deepseek-ai/dsh-agent-team` (`super(ctx, "agentTeams")`),
declares six members — `isEnabled`, `setEnabled`, `createTask`, `getTask`, `listTasks`, `updateTask` — and
**`tryMembership` is not one of them.** That call sits in a loop inside `apply`, with no guard, so it
throws `TypeError: ctx.agentTeams.tryMembership is not a function`, `apply` fails, and **the whole bundle
stops activating.**

The user-visible result is the worst kind: every tool the plugin owns disappears, and the only message is a
load failure somewhere in a log. Nothing says "one call was renamed"; it looks like the plugin is broken.

**The same code already knew better.** It shape-probes other host members and reports a graceful downgrade
in prose — *"the host published no `agentTeams.listMembers`"* — and it tells the user *"this plugin's own
tools are unaffected."* That sentence was false, because two other call sites of the same service were
unguarded. **A downgrade vocabulary applied to some calls and not others is the same as having none.**

## The rule

**No host member may be the reason a bundle stops loading.** Three cases, three shapes, and they are not
interchangeable:

### 1. A member the bundle cannot work without

Probe it at the top of `apply` and refuse loudly, naming what is missing:

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

This still fails — but it fails **readably**, and the failure names the host contract rather than a
property of `undefined`. That difference is a five-minute diagnosis instead of an afternoon.

### 2. A member that serves one feature

Guard at the point of use, not at load. Two separate states have to be handled, and they are different:

```js
const meter = ctx.get('tokenMeter')      // service absent: `get` returns undefined
if (meter === undefined) return DEGRADED
try {
  value = meter.contextPressure(session) // service present, member renamed: this throws
} catch {
  return DEGRADED
}
```

**The second state is the one that killed `dsh-team`** — the service resolved, so no `undefined` check
could help, and the call threw. A guard that only checks the service exists does not cover a renamed
member, and that is the change a host is most likely to make.

### 3. A listener

Never assume the payload shape. Read through optional chaining and return when the field you need is gone:

```js
ctx.on('some/event', (payload) => {
  const id = payload?.agent?.session?.id
  if (id === undefined) return
})
```

A listener that throws is not contained by `apply`; it fails at whatever later moment the event fires,
which is harder to connect to its cause.

## The check

**A test that calls `apply` with a fake host that is missing one member, and asserts what happens.** Not a
regex over the source: a regex passes a file that guards the wrong thing, and the two states in case 2 are
indistinguishable without executing the code.

Three states have to be exercised, because a test covering only the first cannot see the bug that started
this:

| fake host | acceptable outcome |
|---|---|
| every member present | `apply` succeeds and **every tool registers** |
| an optional **service** absent | `apply` succeeds, tools register, that feature degrades |
| an optional service present with a **renamed member** | `apply` succeeds, tools register, the call does not escape |

Plus a contrast case: the feature must still **work** when the member is present, or "returns nothing when
missing" also passes a plugin that returns nothing always.

And assert the required path too: `apply` throws, **the message names the missing member**, and the message
is not a bare `TypeError`.

### Proving the check can fail

Write it, then break the guard and watch it go red. From this work, removing one `try`/`catch` produced:

```
FAIL a renamed method does not escape the provider — meter.contextPressure is not a function
```

**That is the exact message `dsh-team` produced in production**, which is how you know the test reaches the
line that matters. **A check that has never failed is not a check** — and the first two versions of this
one could not fail, because they exercised the early-return path and never reached the guarded call.

## Migration checklist

For each bundle in the profile:

1. **List every host member it calls.** `ctx.<service>.<member>(`, `ctx.get('<service>')`, and every event
   name it listens to.
2. **Classify each one**: needed to work at all, or serves one feature?
3. **Required ones**: probe at the top of `apply`, throw an error that names the member.
4. **Feature ones**: guard the *call*, including the renamed-member case.
5. **Listeners**: optional-chain the payload and return on a missing field.
6. **Write the fake-host test**, in all three states, with a contrast case.
7. **Break a guard and confirm the test fails.** If it does not, the test is not reaching the code.

## Two things that make this worse than it looks

**A bundle cannot see the host contract it was written against.** The profile links a checkout; CI has no
Harness. So a rename is invisible until someone runs it in a real session — which is why the fake-host test
is the only place the contract is checked at all, and why it must be **behavioural**. A snapshot of the
host API in the repository is a second copy of a fact that goes stale the moment the host moves.

**The failure is silent by construction.** `apply` throwing is a load failure; the model simply sees fewer
tools. Nothing routes that to the user as *"your plugin needs an update"*. Until something does, the
fake-host test is the only warning anyone gets.

## What this does not fix

Guarding every call keeps a bundle **loading**, not **correct**. A renamed member that a guard swallows is
a feature that quietly stopped working, and a `catch` that returns a default can hide a real bug as easily
as a host change. Every degraded path should be **reportable** — count it, expose it in a diagnostic tool,
say it in prose — so that "still loading" does not become "silently worse".
