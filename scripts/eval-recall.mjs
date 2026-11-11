/**
 * Evaluate recall against a hand-written judgement set.
 *
 * Usage: node scripts/eval-recall.mjs [--dir <notebook>] [--qrels <file>] [--json]
 *
 * This is an assertion set, not a benchmark. Every case is a claim about what the notebook should
 * do, so a single flip is a result to look at rather than a number to average away. The confidence
 * interval is printed because it is the honest answer to "how much do these totals tell us" — at
 * this corpus size it is wide, and that is the point: it says how large a change would have to be
 * before the totals alone could distinguish it from noise.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNotebook, pickHits } from '../notebook-core.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}

const dir = flag('--dir', join(repo, 'test', 'fixtures', 'notebook'))
const qrelsPath = flag('--qrels', join(repo, 'test', 'qrels.json'))
const asJson = argv.includes('--json')

const config = {
  workspaceDir: dir,
  machineDir: '',
  indexBudgetChars: 1400,
  maxRecall: 2,
  minRecallScore: 4,
  minRecallHits: 2,
}

/** Wilson score interval: the range of true rates consistent with k of n at 95%. */
function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1]
  const p = k / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const spread = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)]
}

const pct = (value) => `${(value * 100).toFixed(1)}%`
const interval = (k, n) => {
  const [lo, hi] = wilson(k, n)
  return `[${pct(lo)}, ${pct(hi)}]`
}

const qrels = JSON.parse(readFileSync(qrelsPath, 'utf8'))
// `resolveDirs` requires a cwd even though an absolute workspaceDir overrides it.
const entries = loadNotebook(config, repo)
if (entries.length === 0) {
  console.error(`no entries under ${dir}`)
  process.exit(2)
}

const onTopic = qrels.onTopic ?? []
const offTopic = qrels.offTopic ?? []
const failures = []

let hit = 0
for (const item of onTopic) {
  const picked = pickHits(entries, item.query, config)
  const first = picked[0]?.entry?.key
  if (first === item.expect) hit += 1
  else failures.push({ kind: 'miss', query: item.query, expected: item.expect, got: first ?? '(none)' })
}

let quiet = 0
for (const query of offTopic) {
  const picked = pickHits(entries, query, config)
  if (picked.length === 0) quiet += 1
  else failures.push({ kind: 'false-positive', query, got: picked.map((h) => h.entry.key).join(', ') })
}

// Reachability, counted per entry: an aggregate hit rate hides an entry nothing can reach.
const reachable = new Set()
for (const item of onTopic) {
  const picked = pickHits(entries, item.query, config)
  if (picked[0]?.entry?.key === item.expect) reachable.add(item.expect)
}
const unreachable = [...new Set(onTopic.map((i) => i.expect))].filter((key) => !reachable.has(key))

if (asJson) {
  console.log(
    JSON.stringify(
      {
        entries: entries.length,
        onTopic: { hit, total: onTopic.length, ci: wilson(hit, onTopic.length) },
        offTopic: { quiet, total: offTopic.length, ci: wilson(quiet, offTopic.length) },
        unreachable,
        failures,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`notebook: ${dir}`)
  console.log(`entries:  ${entries.length}`)
  console.log('')
  console.log(`on-topic recalled first:   ${hit}/${onTopic.length}  ${pct(hit / onTopic.length)} 95% CI ${interval(hit, onTopic.length)}`)
  console.log(`off-topic stayed silent:   ${quiet}/${offTopic.length}  ${pct(quiet / offTopic.length)} 95% CI ${interval(quiet, offTopic.length)}`)
  console.log(`entries reachable:         ${entries.length - unreachable.length}/${entries.length}`)
  if (unreachable.length > 0) console.log(`  unreachable: ${unreachable.join(', ')}`)
  if (failures.length > 0) {
    console.log('')
    for (const failure of failures) {
      if (failure.kind === 'miss') console.log(`  MISS  ${JSON.stringify(failure.query)} -> ${failure.got} (expected ${failure.expected})`)
      else console.log(`  FP    ${JSON.stringify(failure.query)} -> ${failure.got}`)
    }
  }
  console.log('')
  console.log(`${failures.length === 0 ? 'all cases hold' : `${failures.length} case(s) changed`}`)
}

process.exit(failures.length === 0 ? 0 : 1)
