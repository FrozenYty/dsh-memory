/**
 * Does the plugin survive a host that removed one thing?
 *
 * The failure this prevents is not a wrong answer — it is a plugin that loads nothing at all. A single
 * unguarded call to a host member that a later release renamed throws inside `apply`, the whole bundle
 * stops activating, and the user sees its every tool disappear with no message. Measured on this machine:
 * `dsh-team` 0.43.35 against `@deepseek-ai/dsh` 0.2.2-rc.3 registers none of its twelve tools, because
 * `ctx.agentTeams.tryMembership` no longer exists.
 *
 * Two outcomes are acceptable and they are different on purpose:
 *
 *   - a **required** member is gone -> `apply` throws, naming what is missing. A memory plugin with no
 *     `tools.register` cannot do its job, and a silent no-op would be worse than a loud refusal.
 *   - an **optional** member is gone -> `apply` succeeds and every tool still registers, with that one
 *     feature degraded.
 *
 * What is never acceptable is `apply` throwing a `TypeError` about a property of `undefined`.
 *
 * This is a behavioural check, not a shape check: it calls `apply` with a fake context and asserts what
 * happens. A regex over the source would pass a file that guards the wrong thing.
 */
import { apply } from '../index.js'

const noop = () => () => {}

/** A context that records registrations and can hide any one member. */
function fakeContext({ hide = {} } = {}) {
  const registered = []
  /** Every `context`/`section` provider registered, so the callbacks can actually be run. */
  const providers = []
  const noop = () => () => {}
  const ctx = {
    systemPrompt: {
      section: hide.systemPromptSection ? undefined : (definition) => {
        providers.push(definition)
        return noop()
      },
      context: (definition) => {
        providers.push(definition)
        return noop()
      },
    },
    tools: {
      register: (tool) => {
        registered.push(tool.name)
        return noop()
      },
    },
    on: noop,
    // Three states, and they are genuinely different:
    //   member absent        -> `ctx.get` returns undefined, and the plugin returns early
    //   service present, its method missing -> the call throws, and only a guard catches it
    // The second is the shape that killed `dsh-team`, so it has to be reachable from a test.
    get: (name) => {
      if (name !== 'tokenMeter' || hide.tokenMeter) return undefined
      if (hide.tokenMeterMethod) return {}
      return { contextPressure: () => ({ pressureTokens: 9999, contextWindow: 10000 }) }
    },
  }
  return { ctx, registered, providers }
}

/** A context object shaped like the one a host passes to a prompt provider. */
const assemblyContext = {
  agent: { session: { id: 'host-surface-session', header: { cwd: '.' } } },
}

let failed = 0
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log('\n[1] a complete host loads every tool')
{
  const { ctx, registered } = fakeContext()
  let threw
  try {
    apply(ctx, {})
  } catch (error) {
    threw = error
  }
  check('apply does not throw', threw === undefined, threw?.message)
  check('registers seven tools', registered.length === 7, `got ${registered.length}: ${registered.join(', ')}`)
}

console.log('\n[2] an optional member removed is a degraded feature, not a dead plugin')
{
  // `tokenMeter` is the only optional service the plugin reads. Its absence must be survivable, and the
  // test has to hide it the way a real host would: `ctx.get` returns undefined.
  //
  // `apply` alone does not prove this — the read happens inside the hint provider's `text` callback, which
  // runs at prompt assembly. So the providers are run here, which is the only way to reach the guarded line.
  const { ctx, registered, providers } = fakeContext({ hide: { tokenMeter: true } })
  let threw
  try {
    apply(ctx, {})
  } catch (error) {
    threw = error
  }
  check('apply does not throw', threw === undefined, threw?.message)
  check('still registers seven tools', registered.length === 7, `got ${registered.length}`)

  let providerError
  const answers = []
  for (const provider of providers) {
    try {
      if (typeof provider.text === 'function') answers.push(provider.text(assemblyContext))
      else if (typeof provider.text === 'string') answers.push(provider.text)
    } catch (error) {
      providerError = error
    }
  }
  check('every prompt provider runs without throwing', providerError === undefined, providerError?.message)
  check('the providers actually ran', providers.length > 0, `${providers.length} registered`)
}

console.log('\n[2c] the service is present but its method was renamed — the shape that killed dsh-team')
{
  // `ctx.get('tokenMeter')` returns an object, so the early return at the top of the callback does not
  // fire; calling the member then throws. Only a guard catches this, which is why it is the case that
  // separates a plugin that survives a host rename from one that does not.
  const { ctx, registered, providers } = fakeContext({ hide: { tokenMeterMethod: true } })
  let threw
  try {
    apply(ctx, {})
  } catch (error) {
    threw = error
  }
  check('apply does not throw', threw === undefined, threw?.message)
  check('still registers seven tools', registered.length === 7, `got ${registered.length}`)

  let providerError
  for (const provider of providers) {
    try {
      if (typeof provider.text === 'function') provider.text(assemblyContext)
    } catch (error) {
      providerError = error
    }
  }
  check('a renamed method does not escape the provider', providerError === undefined, providerError?.message)
}

console.log('\n[2b] with the member present, the hint still fires')
{
  // The contrast case: hiding it returned nothing, and a present meter above the ratio must produce text.
  // Without this, "returns nothing when missing" would also pass a plugin that returns nothing always.
  const { ctx, providers } = fakeContext()
  apply(ctx, { captureHintRatio: 0.6 })
  const texts = providers.map((p) => (typeof p.text === 'function' ? p.text(assemblyContext) : p.text)).filter(Boolean)
  check('some provider produced text', texts.length > 0, `${providers.length} providers ran`)
}

console.log('\n[3] a required member removed refuses loudly, and names it')
{
  const { ctx } = fakeContext({ hide: { systemPromptSection: true } })
  let threw
  try {
    apply(ctx, {})
  } catch (error) {
    threw = error
  }
  check('apply throws', threw !== undefined)
  check('the message names the missing member', /systemPrompt\.section/.test(threw?.message ?? ''), threw?.message)
  check(
    'the message is not a bare TypeError about undefined',
    !/Cannot read propert|is not a function/i.test(threw?.message ?? ''),
    threw?.message,
  )
}

console.log(`\n  ${failed === 0 ? 'all host-surface checks passed' : `${failed} check(s) failed`}`)
process.exit(failed === 0 ? 0 : 1)
