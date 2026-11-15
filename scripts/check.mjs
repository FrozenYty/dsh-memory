#!/usr/bin/env node
// The local gate: one command, every check this repository has, in the order that gets you to a failure
// fastest.
//
// **This file contains no checks.** It runs the existing scripts and reports what they said. Every rule
// about documents, locales, paths, evidence, index agreement and commit messages lives in the script that
// owns it — a second copy here would be a second thing to keep in step, which is how this repository
// acquired four separate copies of other facts.
//
//   node scripts/check.mjs          the set CI runs, plus the syntax pass
//   node scripts/check.mjs --full   adds the slow, local-only instruments
//   node scripts/check.mjs --list   print the plan and exit
//
// Read-only against the tree with one exception, stated where it happens: `mutation-scan` edits the
// source it is mutating and restores it. `cache-probe` is deliberately *not* in `--full` — it calls a
// paid API over the network, which a local gate must not do, and it reports a measurement rather than a
// pass or a fail.

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * Where a step's output goes. `process.env.TEMP` rather than `os.tmpdir()`: both resolve to the same
 * place on this machine, but the environment variable is what `check-commit-messages.mjs` uses and there
 * is no reason for this file to choose a different one.
 */
function temporaryRoot() {
  const dir = process.env.TEMP || process.env.TMPDIR || process.env.TMP
  if (!dir) throw new Error('no temporary directory available (TEMP, TMPDIR and TMP are unset)')
  return dir
}

const scratch = mkdtempSync(join(temporaryRoot(), 'dsh-memory-check-'))
let stepCounter = 0
process.on('exit', () => {
  try {
    rmSync(scratch, { recursive: true, force: true })
  } catch {
    /* a scratch directory that will not delete is not worth failing a gate over */
  }
})

/**
 * Run node and return its exit status, with the output kept out of the terminal unless asked for it.
 *
 * **The child is handed a file descriptor, not a pipe** — `stdio: ['ignore', out, err]`, which is the
 * same shape `check-commit-messages.mjs` uses for git. This sandbox denies the named pipe a captured
 * child needs, and three attempts before this one all failed for that reason and nothing to do with the
 * checks:
 *
 *   - `spawnSync(node, args, { encoding: 'utf8' })` → `stdout: undefined`; every step read as failed
 *   - `stdio: 'pipe'` → `error: EPERM spawnSync D:\nodejs\node.exe EPERM`
 *   - `spawnSync('cmd', ['/c', `… > "${file}"`])` → `cmd` rejects the redirected path
 *
 * Quiet on success is the point of a gate: a wall of passing test names buries the one line that failed.
 * The tail is printed when a step fails, and `--verbose` streams everything for the times that matters.
 */
function runNode(args, { verbose }) {
  if (verbose) return spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })

  const outPath = join(scratch, `step-${(stepCounter += 1)}.log`)
  const out = openSync(outPath, 'w')
  try {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: ['ignore', out, out] })
    return { status: result.status ?? 1, text: read(outPath) }
  } finally {
    closeSync(out)
  }
}

function read(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * One step. `args` is what gets passed after the script path; `note` is printed before it runs and is
 * where a step warns that it is slow or that it touches the tree.
 */
const steps = [
  { name: 'syntax · bundle entries and every script', run: ['--check'], targets: ['index.js', 'notebook-core.js'] },
  { name: 'syntax · scripts/ (every .mjs)', sweep: 'scripts/*.mjs' },
  { name: 'behaviour · the test suite', script: 'tests/core.test.mjs' },
  { name: 'recall · judgements over tests/qrels.json', script: 'scripts/eval-recall.mjs' },
  { name: 'documents · no machine-specific paths', script: 'scripts/check-paths.mjs' },
  { name: 'documents · ADRs, links, locales, version, policy copies', script: 'scripts/check-docs.mjs' },
  { name: 'notebook · evidence completeness and age', script: 'scripts/check-evidence.mjs', args: ['--dir', 'tests/fixtures/notebook'] },
  { name: 'notebook · INDEX.md agrees with its directory', script: 'scripts/check-index.mjs', args: ['--dir', 'tests/fixtures/notebook'] },
  {
    name: 'history · no tool co-author in the commits',
    script: 'scripts/check-commit-messages.mjs',
    dynamicRange: true,
  },
]

/**
 * Gates with a real cost. Present because a gate that hides a check is worse than a slow one.
 *
 * Both exit non-zero only when something is wrong, which is what makes them gates.
 */
const extraSteps = [
  {
    name: 'mutations · every load-bearing line must be killed',
    script: 'scripts/mutation-scan.mjs',
    note: 'edits the source it mutates and restores it — do not interrupt',
  },
  { name: 'assertions · how many checks would notice a change', script: 'scripts/assertion-strength.mjs' },
]

/**
 * Instruments, not gates: each prints a number and a non-zero exit is a **finding**, not a failure.
 *
 * `eval-hostile` exits 1 whenever any case marked "silent" fires, and it currently reports 6 of 18 —
 * which is the measurement that keeps `recallEnabled` false, not a defect to fix. `cache-probe` reports
 * what a prompt change costs and needs a paid API. Running either in a gate would report a working system
 * as broken.
 */
const instrumentSteps = [
  {
    name: 'recall · the hostile phrasing set (reports a rate; exit 1 is a finding)',
    script: 'scripts/eval-hostile.mjs',
    // Its own header says why: every query targets an entry only the author's notebook contains, so the
    // fixture would measure nothing. It needs a real notebook, which only the caller can name.
    needsDir: true,
    findingIsNotFailure: true,
  },
  {
    name: 'cache · what a prompt change costs (needs DO_API_KEY and the network)',
    script: 'scripts/cache-probe.mjs',
    findingIsNotFailure: true,
  },
]

const argv = process.argv.slice(2)
const verbose = argv.includes('--verbose')
const full = argv.includes('--full')
const instruments = argv.includes('--instruments') || argv.includes('--probe')
const listOnly = argv.includes('--list')

function argAfter(list, flag) {
  const at = list.indexOf(flag)
  return at === -1 ? undefined : list[at + 1]
}

// The range CI uses for the commit check. Locally there is no base_ref, so the merge base against
// origin/main is the equivalent, and a repository with no origin falls back to the last commit only.
function commitRange() {
  const base = spawnSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (base.status === 0 && base.stdout.trim()) return `${base.stdout.trim()}..HEAD`
  return 'HEAD~1..HEAD'
}

const plan = [...steps, ...(full || instruments ? extraSteps : []), ...(instruments ? instrumentSteps : [])]

if (listOnly) {
  console.log('check.mjs runs, in order:')
  for (const [index, step] of plan.entries()) console.log(`  ${index + 1}. ${step.name}`)
  if (!full && !instruments) {
    // Say which flag reaches which, because this listing is the only place a reader learns how.
    console.log('\nnot in this run:')
    console.log('  pass --full for:')
    for (const step of extraSteps) console.log(`    - ${step.name}`)
    console.log('  pass --instruments for (numbers, not verdicts):')
    for (const step of instrumentSteps) console.log(`    - ${step.name}`)
  }
  process.exit(0)
}

const results = []

function record(name, status, detail) {
  results.push({ name, status, detail })
}


console.log(`check.mjs — ${plan.length} step(s)${full ? ' (--full)' : ''}${instruments ? ' (--instruments: numbers, not verdicts)' : ''}\n`)

for (const [index, step] of plan.entries()) {
  const label = `[${String(index + 1).padStart(2)}/${plan.length}] ${step.name}`
  console.log(label)
  if (step.note) console.log(`        note: ${step.note}`)

  if (step.sweep) {
    // One `node --check` per file, so a failure names the file rather than the directory.
    const files = readdirSync(join(root, dirname(step.sweep)))
      .filter((file) => file.endsWith('.mjs'))
      .map((file) => `scripts/${file}`)
    const failed = files.filter((file) => runNode(['--check', file], { verbose }).status !== 0)
    if (failed.length === 0) {
      console.log(`        ok — ${files.length} file(s) parse`)
      record(step.name, 'pass')
    } else {
      console.log(`        FAIL — does not parse: ${failed.join(', ')}`)
      record(step.name, 'fail', failed.join(', '))
    }
    console.log('')
    continue
  }

  if (step.run) {
    const failed = step.targets.filter((target) => runNode([...step.run, target], { verbose }).status !== 0)
    if (failed.length === 0) {
      console.log(`        ok — ${step.targets.join(', ')}`)
      record(step.name, 'pass')
    } else {
      console.log(`        FAIL — ${failed.join(', ')}`)
      record(step.name, 'fail', failed.join(', '))
    }
    console.log('')
    continue
  }

  if (step.needsDir) {
    const dir = argAfter(argv, '--dir')
    if (!dir) {
      console.log(`        skipped — needs --dir <a real notebook>; the fixture would measure nothing`)
      record(step.name, 'skip', 'no --dir')
      console.log('')
      continue
    }
    const result = runNode([step.script, '--dir', dir], { verbose })
    if (result.status === 0) {
      console.log(`        ok — ${step.script} --dir ${dir}`)
      record(step.name, 'pass')
    } else {
      console.log(`        FAIL — ${step.script} exited ${result.status}`)
      record(step.name, 'fail', `${step.script} exited ${result.status}`)
    }
    console.log('')
    continue
  }

  if (!existsSync(join(root, step.script))) {
    console.log(`        FAIL — missing: ${step.script}`)
    record(step.name, 'fail', `missing ${step.script}`)
    console.log('')
    continue
  }

  const args = [step.script, ...(step.args ?? [])]
  if (step.dynamicRange) args.push('--range', commitRange())

  const started = Date.now()
  const result = runNode(args, { verbose })
  const took = ((Date.now() - started) / 1000).toFixed(1)

  // The child's output already went to this terminal, so a failure is visible where it happened; all
  // that is left to record is the verdict.
  if (result.status === 0) {
    console.log(`        ok — ${step.script} (${took}s)`)
    record(step.name, 'pass')
  } else {
    console.log(`        FAIL — ${step.script} exited ${result.status} (${took}s)`)
    record(step.name, 'fail', `${step.script} exited ${result.status}`)
    // The script's own message is the useful part, and it is the reason the output was kept at all.
    const lines = (result.text ?? '').trimEnd().split('\n')
    const tail = lines.slice(-20)
    if (tail.length > 0 && tail[0] !== '') {
      if (lines.length > tail.length) console.log(`        | … ${lines.length - tail.length} earlier line(s) omitted; --verbose shows all`)
      for (const line of tail) console.log(`        | ${line}`)
    }
  }
  console.log('')
}

const failed = results.filter((r) => r.status === 'fail')
const skipped = results.filter((r) => r.status === 'skip')
const mark = (status) => (status === 'pass' ? 'pass' : status === 'skip' ? 'skip' : 'FAIL')

console.log('─'.repeat(72))
for (const result of results) console.log(`  ${mark(result.status)}  ${result.name}`)
console.log('─'.repeat(72))

if (failed.length === 0) {
  const tail = skipped.length > 0 ? `, ${skipped.length} skipped` : ''
  console.log(`\n${results.length - skipped.length} of ${results.length} passed${tail}.`)
  if (skipped.length > 0) {
    console.log('\nskipped:')
    for (const result of skipped) console.log(`  - ${result.name}${result.detail ? ` (${result.detail})` : ''}`)
  }
  process.exit(0)
}

console.log(`\n${results.length - failed.length} of ${results.length} passed; ${failed.length} failed:`)
for (const result of failed) console.log(`  - ${result.name}${result.detail ? ` (${result.detail})` : ''}`)
process.exit(1)
