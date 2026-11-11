#!/usr/bin/env node
/**
 * Evidence hygiene for a memory notebook.
 *
 * Two checks, both of which a script can make honestly:
 *   1. every entry carries an `Evidence:` line at all;
 *   2. every entry was touched within `--stale-days`.
 *
 * It does **not** execute the commands written in `Evidence:`. A notebook is arbitrary
 * markdown, and running whatever it says is not a safe default — a stale entry could carry a
 * destructive command as easily as a harmless one. Age is the proxy: an entry nobody has
 * revisited in a long time is the one whose evidence is most likely wrong, so it is reported
 * for a human re-check rather than silently trusted.
 *
 *   node scripts/check-evidence.mjs --dir .agents/memory
 *   node scripts/check-evidence.mjs --dir .agents/memory --stale-days 60 --strict
 *
 * Exit 0 when the report is clean, 1 under --strict when an entry lacks evidence, 2 when the
 * directory cannot be read.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { auditEntries, scanDir } from './../notebook-core.js'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.agents/memory' },
    'stale-days': { type: 'string', default: '90' },
    strict: { type: 'boolean', default: false },
  },
  allowPositionals: false,
})

const dir = resolve(values.dir)
const staleDays = Number.parseInt(values['stale-days'], 10)

if (!Number.isFinite(staleDays) || staleDays < 0) {
  console.error(`--stale-days must be a non-negative integer, got "${values['stale-days']}"`)
  process.exit(2)
}

if (!existsSync(dir)) {
  console.error(`no notebook at ${dir}`)
  console.error('pass --dir with the directory that holds the entries')
  process.exit(2)
}

const entries = scanDir(dir)
const report = auditEntries(entries, { staleDays })

console.log(`scanned ${report.total} entr${report.total === 1 ? 'y' : 'ies'} in ${dir}`)

if (report.missingEvidence.length > 0) {
  console.log(`\n${report.missingEvidence.length} without an Evidence line:`)
  for (const entry of report.missingEvidence) console.log(`  ${entry.file}`)
  console.log('  A claim with no evidence reads as an assertion. Add the command or error text')
  console.log('  that would let a later session check whether it still holds.')
}

if (report.stale.length > 0) {
  console.log(`\n${report.stale.length} untouched for more than ${report.staleDays} days:`)
  const byAge = [...report.stale].sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const entry of byAge) {
    const days = Math.floor((Date.now() - entry.mtimeMs) / 86_400_000)
    console.log(`  ${entry.file} (${days}d)`)
  }
  console.log('  Re-run the command in each Evidence line, then update the entry or retire it.')
}

const clean = report.missingEvidence.length === 0 && report.stale.length === 0
if (clean) {
  console.log('\nall entries carry evidence and none is stale')
  process.exit(0)
}

if (values.strict) {
  console.log('\n--strict: failing because the report is not clean')
  process.exit(1)
}

console.log('\nreport only; pass --strict to fail the run')
process.exit(0)
