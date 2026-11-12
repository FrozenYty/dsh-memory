/**
 * Mutation scan: does the suite actually notice when the code is wrong?
 *
 * Each mutation breaks one small thing that a test claims to cover. A mutation that leaves the suite
 * green is either an uncovered line or an equivalent change — the scan cannot tell those apart, so a
 * survivor is a question to answer, not a verdict.
 *
 * Restores both sources after every mutation, and verifies the restore, so one broken run cannot
 * cascade into the rest.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = here
const CORE = join(ROOT, 'notebook-core.js')
const INDEX = join(ROOT, 'index.js')
const OUT = join(ROOT, '_mutation-out.txt')

const mutations = [
  // --- the index: what the model sees -------------------------------------
  ['index budget back to 1400', INDEX, 'indexBudgetChars: 2800,', 'indexBudgetChars: 1400,'],
  ['summary length back to 20', INDEX, 'indexSummaryChars: 60,', 'indexSummaryChars: 20,'],
  ['a trailing date is no longer stripped', CORE, "const summary = source.replace(/\\s*[—–-]\\s*\\d{4}-\\d{2}-\\d{2}\\s*$/, '').trim()", 'const summary = source.trim()'],
  ['the summary cut ignores word boundaries', CORE, "? `${(summary.slice(0, summaryChars - 1).replace(/\\s+\\S*$/, '') || summary.slice(0, summaryChars - 1)).trimEnd()}…`", "? `${summary.slice(0, summaryChars - 1).trimEnd()}…`"],
  ['the overflow line loses its count', CORE, "return `- … and ${hidden} more, all listed by \\`memory_list\\`\\n`", "return `- …\\n`"],
  ['disputed entries reach the index', CORE, "const visible = entries.filter((entry) => entry.status !== 'disputed')\n  if (visible.length === 0) return { text: '', shown: 0, hidden: 0 }\n\n  const where = config.workspaceDir", "const visible = entries\n  if (visible.length === 0) return { text: '', shown: 0, hidden: 0 }\n\n  const where = config.workspaceDir"],

  // --- matching: which entry is chosen ------------------------------------
  ['the hit floor drops to 1', INDEX, 'minRecallHits: 2,', 'minRecallHits: 1,'],
  ['the score floor drops to 1', INDEX, 'minRecallScore: 4,', 'minRecallScore: 1,'],
  ['the summary no longer feeds the index line', CORE, "const source = String(entry.summary || entry.title || '')", "const source = String(entry.title || '')"],

  // --- writing: what lands on disk ----------------------------------------
  ['triggers are not carried across an update', CORE, "if (triggers.length === 0) triggers = String(meta.triggers ?? '').trim()", ''],
  ['a summary is not carried across an update', CORE, "if (summary.length === 0) summary = String(meta.summary ?? '').trim()", ''],
  ['unknown frontmatter keys are dropped', CORE, "if (['status', 'updated', 'triggers', 'summary'].includes(key)) continue\n      carried[key] = value", ''],
  ['the date goes back to UTC', CORE, 'return `${now.getFullYear()}-${month}-${day}`', 'return new Date().toISOString().slice(0, 10)'],
  ['a status change stops moving the date', CORE, 'meta.updated = localToday()', ''],
  ['"index" stops being reserved', CORE, "if (key === 'index') throw new Error('\"index\" is reserved for INDEX.md')", ''],
  ['a name may be any length', CORE, 'if (key.length > 80)', 'if (key.length > 8000)'],

  // --- usage telemetry -----------------------------------------------------
  ['an unterminated log is appended to anyway', CORE, "if (existsSync(path) && !readFileSync(path, 'utf8').endsWith('\\n')) appendFileSync(path, '\\n', 'utf8')", ''],
  ['records sharing a line are dropped again', CORE, ".replace(/\\}\\s*\\{/g, '}\\n{')", ''],
  ['disputed entries are reported as unused', CORE, '.filter((entry) => entry.status !== \'disputed\')', ''],

  // --- health and diagnosis ------------------------------------------------
  ['absent is reported as broken', CORE, "return shape('absent', dir, 0)", "return shape('broken', dir, 0)"],
  ['an unlisted file is no longer a problem', CORE, 'if (drift.unlisted.length > 0) {', 'if (false) {'],
  ['index overflow is no longer a problem', CORE, 'if (detail.hidden > 0) {', 'if (false) {'],
  ['an entry with no triggers is no longer degraded', CORE, 'if (withoutTriggers.length > 0) {', 'if (false) {'],

  // --- paths and directories ----------------------------------------------
  ['a bare tilde stops expanding', CORE, "if (p === '~') return homedir()", "if (false) return homedir()"],
  ['resolveDirs stops deduplicating', CORE, 'if (!dirs.some((existing) => resolve(existing) === normalized)) dirs.push(path)', 'dirs.push(path)'],
  ['only the first directory is seeded', INDEX, 'for (const dir of resolveDirs(cfg, cwd)) {\n      if (seededDirs.has(dir)) continue', 'for (const dir of resolveDirs(cfg, cwd).slice(0, 1)) {\n      if (seededDirs.has(dir)) continue'],
  ['only the first directory is index-synced', INDEX, 'for (const dir of resolveDirs(cfg, cwd)) {\n      if (syncedDirs.has(dir)) continue', 'for (const dir of resolveDirs(cfg, cwd).slice(0, 1)) {\n      if (syncedDirs.has(dir)) continue'],

  // --- policy seeding ------------------------------------------------------
  ['an existing policy is overwritten', CORE, 'if (existsSync(path)) return false', ''],
  ['the policy template stops shipping', INDEX, "return readFileSync(new URL('./templates/notebook-policy.md', import.meta.url), 'utf8')", "return ''"],

  // --- evidence and trust --------------------------------------------------
  ['an entry with no Evidence line passes the audit', CORE, 'if (!/Evidence:/.test(entry.body)) missingEvidence.push(entry)', ''],
  ['age stops being reported', CORE, 'if (now - entry.mtimeMs > staleMs) stale.push(entry)', ''],
  ['an entry with no Evidence is no longer degraded', CORE, 'if (withoutEvidence.length > 0) {', 'if (false) {'],
  ['an entry without evidence loses its Evidence tail when rendered', CORE, "const evidence = body.match(/\\nEvidence:[\\s\\S]{0,300}$/)", 'const evidence = null'],
  ['the notebook order stops following INDEX.md', CORE, 'orderByIndex(', 'noOrderByIndex('],
  ['the policy stops being named by the index', CORE, 'const hasPolicy = visible.some((entry) => entry.key === \'notebook-policy\')', 'const hasPolicy = false'],
  ['the usage count stops being per-entry', CORE, 'counts.set(row.entry, (counts.get(row.entry) ?? 0) + 1)', 'counts.set(row.entry, 1)'],
  ['the last-used day stops being tracked', CORE, "if (row.day > (lastDay.get(row.entry) ?? '')) lastDay.set(row.entry, row.day)", ''],
  ['frontmatter stops being parsed', CORE, "const m = raw.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?/)", 'const m = null'],
  ['triggers stop being split on separators', CORE, '.split(/[,;，、]/)', '.split(/\\n/)'],
]

const run = () => {
  try {
    execFileSync('cmd', ['/c', `node test-core.mjs > "${OUT}" 2>&1`], { cwd: ROOT })
    return { ok: true, output: readFileSync(OUT, 'utf8') }
  } catch {
    return { ok: false, output: existsSync(OUT) ? readFileSync(OUT, 'utf8') : '' }
  }
}

const failuresIn = (output) => {
  const summary = output.match(/(\d+) passed, (\d+) failed/)
  return summary ? Number(summary[2]) : null
}

const original = { [CORE]: readFileSync(CORE, 'utf8'), [INDEX]: readFileSync(INDEX, 'utf8') }
const results = []
let skipped = 0

for (const [label, file, find, replace] of mutations) {
  const source = original[file]
  if (!source.includes(find)) {
    results.push({ label, verdict: 'DID NOT APPLY', failures: null })
    skipped += 1
    continue
  }
  writeFileSync(file, source.replace(find, replace), 'utf8')
  try {
    const { output } = run()
    const failures = failuresIn(output)
    results.push({ label, verdict: failures === 0 ? 'SURVIVED' : 'killed', failures })
  } finally {
    writeFileSync(file, original[file], 'utf8')
  }
}

// The restore is the one thing that must be true, whatever the scan found.
for (const file of [CORE, INDEX]) {
  if (readFileSync(file, 'utf8') !== original[file]) {
    writeFileSync(file, original[file], 'utf8')
    console.log(`RESTORED (was dirty): ${file}`)
  }
}

const survivors = results.filter((r) => r.verdict === 'SURVIVED')
const killed = results.filter((r) => r.verdict === 'killed')

console.log(`\nmutations: ${mutations.length} | killed: ${killed.length} | survived: ${survivors.length} | did not apply: ${skipped}\n`)
for (const r of results) {
  const mark = r.verdict === 'killed' ? 'killed  ' : r.verdict === 'SURVIVED' ? 'SURVIVED' : 'N/A     '
  const count = r.failures === null ? '' : ` (${r.failures} failed)`
  console.log(`  ${mark}  ${r.label}${count}`)
}
rmSync(OUT, { force: true })
