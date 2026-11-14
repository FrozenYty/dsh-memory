#!/usr/bin/env node
// What does a prompt change actually cost? Measured, not inferred.
//
// This plugin injects two things into a prompt: a `systemPrompt.section` at the head (the index) and a
// runtime-context message inside the history (recall). Prefix caching makes the position of a change
// matter, and ADR 0018 rests on how much. Until this script existed the ADR said it could not be
// measured at all.
//
//   node scripts/cache-probe.mjs                 # the index, at the head of the prompt
//   node scripts/cache-probe.mjs recall-head     # recall, as the first history message
//   node scripts/cache-probe.mjs recall-tail     # recall, as the last history message
//
// **One scenario per run, deliberately.** An earlier version measured all three in sequence, giving each
// a unique nonce so they could not contaminate one another. That produced nonsense — `warm cached: 0` in
// two scenarios and a negative "lost" — because the cache has finite room: three live prefixes in quick
// succession evict each other, so the warm request never hits and there is no baseline to compare
// against. **Isolating the scenarios broke the measurement.** One prefix, reused three times, is what
// makes the numbers mean anything.
//
// **The baseline check below is not defensive padding.** A probe that subtracts from a warm reading of
// zero will happily print a difference, and that difference is an artefact — it happened here, and a
// number derived that way reached an ADR before anyone noticed. `INCONCLUSIVE` and a non-zero exit are
// the correct answers when the warm request misses; re-run rather than reason about it.
//
// What replicates on this deployment: an identical prompt sent twice reports its full length as cached,
// and an unrelated prompt of the same length reports zero. What does **not** replicate reliably: the cost
// of a one-line change. Four attempts produced three different-looking answers, so treat a single run's
// "lost" figure as a hypothesis.
//
// The relay reports `usage.prompt_tokens_details.cached_tokens` — NOT `prompt_cache_hit_tokens`, which is
// DeepSeek's own documented name and is not what this deployment sends. A probe that checks the
// documented key alone concludes, wrongly, that caching is unobservable here.
//
// Skips cleanly (exit 0) without a key: it calls a paid API, so CI must never run it. It is a manual
// check, run after a change to prompt injection — the one thing the test suite cannot cover.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ENDPOINT = process.env.MEMORY_PROBE_ENDPOINT ?? 'https://api.do.top/v1/chat/completions'
const MODEL = process.env.MEMORY_PROBE_MODEL ?? 'DeepSeek-V4.1-Flash'

/** The key is not in the environment: DSH injects it into plugin processes only. */
function readKey() {
  if (process.env.DO_API_KEY) return process.env.DO_API_KEY
  try {
    const creds = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    return creds.match(/^\s*DO_API_KEY:\s*(\S+)\s*$/m)?.[1]
  } catch {
    return undefined
  }
}

const key = readKey()
if (!key) {
  console.log('cache-probe: no DO_API_KEY in the environment or in ~/.dsh/.credentials.yaml — skipping.')
  console.log('             This probe calls a paid API; it is never part of CI.')
  process.exit(0)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Send the same prompt until one of the requests reports it as cached.
 *
 * **This loop is the whole reason the probe works.** Six runs failed because the second request came back
 * `cached 0` — no baseline, no measurement — and none of the obvious causes explained it: not the wait
 * (18 seconds did not help), not the message role (system and user both cache), not the payload. The
 * deployment's cache becomes usable on its own schedule, and a probe that sends its warm request once and
 * hopes is measuring that schedule rather than the thing it claims to measure.
 *
 * So it keeps sending the identical prompt until one reports a hit, up to a cap. The requests are free of
 * each other: each is byte-identical, so whichever one hits is the baseline, and the number of attempts it
 * took is reported rather than hidden.
 */
async function stabilise(build, cap = 6, pauseMs = 8000) {
  const attempts = []
  for (let attempt = 1; attempt <= cap; attempt += 1) {
    const result = await ask(build('A'))
    attempts.push(result.cached)
    if (result.cached > 0) return { baseline: result, attempts, stabilised: true }
    if (attempt < cap) await wait(pauseMs)
  }
  return { baseline: attempts.length > 0 ? { cached: 0 } : undefined, attempts, stabilised: false }
}

async function ask(messages) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 4, stream: false }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json).slice(0, 200)}`)
  const details = json.usage?.prompt_tokens_details ?? {}
  return { prompt: json.usage?.prompt_tokens, cached: details.cached_tokens ?? 0, created: details.created_cache_tokens ?? 0 }
}

/** A stand-in for the resident index. Long enough to dominate; the marked line is what gets varied. */
const section = (marker) =>
  Array.from({ length: 180 }, (_, i) => `- \`entry-${i}.md\` — what entry ${i} is about, in one line`)
    .join('\n')
    .concat(`\n- memory_index_variant: ${marker}`)

/** The same section with the varied line at the *front* — what prepending a new entry does. */
const sectionHead = (marker) =>
  `- memory_index_variant: ${marker}\n`.concat(
    Array.from({ length: 180 }, (_, i) => `- \`entry-${i}.md\` — what entry ${i} is about, in one line`).join('\n'),
  )

const turn = (i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `Turn ${i}: discussing the toolchain, the driver and the installer at length.`,
})
const history = Array.from({ length: 30 }, (_, i) => turn(i))
const ASK = { role: 'user', content: 'Reply with one word: ok' }
const recall = (marker) => ({
  role: 'user',
  content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n- recalled: entry-${marker}.md`,
})

const SCENARIOS = {
  index: {
    what: 'the index section, one character changed on its last line (prompt head)',
    build: (marker) => [{ role: 'system', content: section(marker) }, ...history, ASK],
  },
  'index-top': {
    what: 'the index section, one character changed on its FIRST line — what prepending an entry does',
    build: (marker) => [{ role: 'system', content: sectionHead(marker) }, ...history, ASK],
  },
  'recall-head': {
    what: 'a recall message, one entry name changed (first history message)',
    build: (marker) => [{ role: 'system', content: section('A') }, recall(marker), ...history, ASK],
  },
  'recall-tail': {
    what: 'a recall message, one entry name changed (last history message)',
    build: (marker) => [{ role: 'system', content: section('A') }, ...history, recall(marker), ASK],
  },
}

const name = process.argv[2] ?? 'index'
const scenario = SCENARIOS[name]
if (!scenario) {
  console.log(`cache-probe: unknown scenario "${name}". Try: ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(2)
}

console.log(`cache-probe: ${MODEL} at ${ENDPOINT}`)
console.log(`scenario:    ${scenario.what}\n`)

const cold = await ask(scenario.build('A'))
console.log(`  cold, index A   prompt ${cold.prompt}, cached ${cold.cached}, created ${cold.created}`)

const { baseline, attempts, stabilised } = await stabilise(scenario.build)
if (!stabilised) {
  console.log(`  warm, index A   never cached across ${attempts.length} identical requests`)
  console.log('')
  console.log('INCONCLUSIVE: no request reported a cache hit, so there is no baseline to subtract from.')
  console.log(`              attempts: ${attempts.join(', ')} cached tokens`)
  console.log('              Do not reason about a number derived from a zero baseline; re-run later.')
  process.exit(1)
}
console.log(`  warm, index A   prompt ${baseline.prompt}, cached ${baseline.cached}, created ${baseline.created}`)
if (attempts.length > 1) {
  console.log(`                  (took ${attempts.length} identical requests — ${attempts.join(', ')} —`)
  console.log('                   the deployment decides when a cache becomes usable, not the clock)')
}

await wait(6000)

// **The changed marker must be unique per run.** Reusing one literal makes the second and every later
// run measure nothing: the first run caches "B", so from then on the "change" hits an existing cache and
// reports zero. That is exactly what happened here — every scenario read its full prefix as lost on run
// one and zero on runs two and three, and the pattern looked like cache behaviour rather than a bug in
// the probe.
const variant = `B${Date.now().toString(36)}`
const changed = await ask(scenario.build(variant))
console.log(`  changed, ${variant.slice(0, 8)}…  prompt ${changed.prompt}, cached ${changed.cached}, created ${changed.created}`)
console.log('')

const lost = baseline.cached - changed.cached
console.log(`RESULT: changing ${scenario.what.split(',')[0]} cost ${lost} tokens.`)
console.log(`        ${changed.cached} of ${baseline.cached} cached tokens survived the change.`)
console.log('')
if (lost > baseline.cached * 0.5) {
  console.log('        The change invalidated most of the prefix. This is what ADR 0018 assumes.')
} else if (lost <= 64) {
  console.log('        The change cost about one cache block. Position, not the edit, is what matters')
  console.log('        here — see the other scenarios before drawing a conclusion from one.')
} else {
  console.log('        The change invalidated part of the prefix: everything after it, and no more.')
}
console.log('')
console.log('        One run is a hypothesis, not a result. ADR 0018 carries a withdrawn figure that')
console.log('        came from exactly one run whose baseline was zero. Repeat before believing it.')
