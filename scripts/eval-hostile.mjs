// Evaluate automatic recall against ordinary talk that shares vocabulary with the notebook.
//
// This is a LOCAL tool, not a CI check, and the reason matters: every query here targets an entry that
// only the author's notebook contains. Running it against the fixture notebook would measure nothing.
// It is the script that found why recallEnabled defaults to false, so it is kept to re-measure after
// any trigger change — but it needs `--dir` pointing at a real notebook.
//
//   node scripts/eval-hostile.mjs --dir <notebook>
//
// Exit code is 1 when any case marked "silent" fires, so it can gate a recallEnabled: true profile.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { loadNotebook, pickHits } from '../notebook-core.js'

const repoRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const dir = argValue('--dir', '')
if (dir === '' || !existsSync(dir)) {
  console.error('usage: node scripts/eval-hostile.mjs --dir <notebook-with-entries>')
  console.error(`  ${dir === '' ? 'no --dir given' : `${dir} does not exist`}`)
  process.exitCode = 2
  process.exit()
}

const cfg = {
  workspaceDir: dir,
  machineDir: '',
  indexBudgetChars: 1400,
  maxRecall: 2,
  minQueryChars: 6,
  skipAcknowledgements: true,
  minRecallScore: 4,
  minRecallHits: 2,
}

const suite = JSON.parse(readFileSync(path.join(repoRoot, 'tests', 'hostile.json'), 'utf8'))
const entries = loadNotebook(cfg, '.')
console.log(`notebook: ${entries.length} entries in ${dir}`)
console.log(`${suite.cases.length} cases, ${suite.cases.filter((c) => c.expect === 'silent').length} expected silent\n`)

let failures = 0
let fired = 0
for (const testCase of suite.cases) {
  const picked = pickHits(entries, testCase.query, cfg)
  const names = picked.map((hit) => hit.entry?.key).filter(Boolean)
  const label = names.length === 0 ? '(silent)' : names.join(', ')

  if (testCase.expect === 'silent') {
    if (names.length === 0) {
      console.log(`  CLEAN ${JSON.stringify(testCase.query)}`)
    } else {
      failures += 1
      fired += 1
      console.log(`  FIRED ${JSON.stringify(testCase.query)}  -> ${label}`)
      if (testCase.note !== undefined) console.log(`        note: ${testCase.note}`)
    }
    continue
  }

  const top = names[0] ?? null
  if (top === testCase.want) {
    console.log(`  OK    ${JSON.stringify(testCase.query)}  -> ${label}`)
  } else {
    failures += 1
    console.log(`  MISS  ${JSON.stringify(testCase.query)}  -> ${label}  (wanted ${testCase.want})`)
  }
}

console.log(`\n${fired} false positive(s), ${failures} failure(s) across ${suite.cases.length} cases`)
console.log('A sustained rate above ~1 in 18 is why recallEnabled is false by default; see docs/adr/15.')
process.exitCode = failures === 0 ? 0 : 1
