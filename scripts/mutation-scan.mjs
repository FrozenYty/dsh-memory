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
  ['index budget back to 2800', INDEX, 'indexBudgetChars: 9000,', 'indexBudgetChars: 2800,'],
  ['summary length back to 20', INDEX, 'indexSummaryChars: 60,', 'indexSummaryChars: 20,'],
  ['the evidence limit drops back to 300', INDEX, 'const EVIDENCE_LIMIT = 1000', 'const EVIDENCE_LIMIT = 300'],
  ['truncation stops being reported', INDEX, 'evidenceTruncated: evidence.length > EVIDENCE_LIMIT,', 'evidenceTruncated: false,'],
  // --- the ranking: who the model can see without asking -------------------
  ['the use window disappears', CORE, 'const RECENT_USE_MS = 30 * 86_400_000', 'const RECENT_USE_MS = Number.MAX_SAFE_INTEGER'],
  ['a disputed entry stops ranking last', CORE, "if (entry.status === 'disputed') return 4", "if (entry.status === 'disputed') return 0"],
  ['ranking ignores how recently an entry was used', CORE, 'return base + (now - lastUsedMs(entry) <= RECENT_USE_MS ? 0 : 1)', 'return base'],
  ['a new entry no longer outranks a stale use', CORE, 'const sortKey = (entry) => Math.max(lastUsedMs(entry), entry.mtimeMs ?? 0)', 'const sortKey = (entry) => lastUsedMs(entry)'],
  ['the tie-break disappears, so the order is unstable', CORE, '|| (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),', ','],
  ['the index order stops being recomputed', CORE, 'const wanted = indexOrder(entries, readUsage(dir)).map((entry) => entry.file)', 'const wanted = entries.map((entry) => entry.file)'],
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

  // --- tokenising ----------------------------------------------------------
  ['a short Chinese run stops being kept whole', CORE, 'if (run.length <= 2) {', 'if (false) {'],
  ['Latin words of one character are kept', CORE, '} else if (run.length > 1) {', '} else if (run.length > 0) {'],
  ['the five-character prefix floor disappears', CORE, 'if (token.length < 5) return false', 'if (token.length < 1) return false'],
  ['prefix matching ignores the candidate length', CORE, 'if (candidate.length >= 5 &&', 'if (candidate.length >= 1 &&'],
  ['a single Chinese character counts as a whole word', CORE, 'if (text.length < 2) return false', 'if (text.length < 1) return false'],

  // --- scoring -------------------------------------------------------------
  ['a single-word trigger is worth less', CORE, '      score += 5\n      hits +=', '      score += 3\n      hits +='],
  ['a multi-word trigger is worth less', CORE, '      score += 7\n      hits += phraseTokens.size', '      score += 5\n      hits += phraseTokens.size'],
  ['a trigger loses its second hit', CORE, 'hits += identifies || chineseWord || unique ? 2 : 1', 'hits += 1'],
  ['rarity stops earning the second hit', CORE, 'const unique = rarity !== undefined && rarity.get(token) === 1', 'const unique = false'],
  ['a whole Chinese word stops earning the second hit', CORE, 'const chineseWord = isWholeChineseWord(phrase)', 'const chineseWord = false'],
  ['a name match is worth less', CORE, '      score += 4\n      hits += 1', '      score += 2\n      hits += 1'],
  ['a title match is worth less', CORE, '      score += 3\n      hits += 1', '      score += 1\n      hits += 1'],
  ['a body match is worth more than a title match', CORE, '      score += 1\n      hits += 1', '      score += 5\n      hits += 1'],
  ['trigger words tolerate prefixes', CORE, '      if (!queryTokens.has(token)) {', '      if (!tokenMatches(queryTokens, token)) {'],
  ['a token already covered by a trigger is scored again', CORE, 'if (STOPWORDS.has(token) || covered.has(token)) continue', 'if (STOPWORDS.has(token)) continue'],
  ['a body-only match counts as strong', CORE, '      score += 1\n      hits += 1\n    }\n  }', '      score += 1\n      hits += 1\n      strong = true\n    }\n  }'],
  ['rarity stops counting titles', CORE, "for (const token of tokenize(entry.title ?? '')) tokens.add(token)", ''],
  ['rarity stops counting triggers', CORE, 'for (const phrase of entry.triggers ?? []) for (const token of tokenize(phrase)) tokens.add(token)', ''],

  // --- selection -----------------------------------------------------------
  ['a disputed entry can be picked', CORE, "    if (entry.status === 'disputed') continue\n    const scored = scoreEntry", '    const scored = scoreEntry'],
  ['a weak match can be picked', CORE, '    if (!scored.strong) continue\n', ''],
  ['only one hit is ever returned', CORE, 'return hits.slice(0, Math.max(1, Math.floor(config.maxRecall)))', 'return hits.slice(0, 1)'],
  ['a hit needs no score floor', CORE, 'if (scored.score < config.minRecallScore) continue', ''],

  // --- messages ------------------------------------------------------------
  ['only the first block of a message is read', CORE, "if (block && block.type === 'text' && typeof block.text === 'string') text += block.text + ' '", "if (block && block.type === 'text' && typeof block.text === 'string') text = block.text + ' '"],
  ['the query stops looking at recent turns', CORE, 'const tail = messages.slice(-3)', 'const tail = messages.slice(-1)'],

  // --- rendering -----------------------------------------------------------
  ['a clamped entry loses its Evidence line', CORE, "const evidence = body.match(/\\nEvidence:[\\s\\S]{0,300}$/)", 'const evidence = null'],
  ['a clamped entry is not clamped at all', CORE, 'if (body.length <= room) return body', 'return body'],
  ['verified entries get a label too', CORE, "const label = hit.entry.status === 'verified' ? '' : ` (${hit.entry.status})`", 'const label = ` (${hit.entry.status})`'],
  ['the recall budget stops being enforced', CORE, 'if (room <= 80) break', 'if (room <= 0) break'],

  // --- audit ---------------------------------------------------------------
  ['entries age after one day', CORE, 'const staleDays = options.staleDays ?? 90', 'const staleDays = options.staleDays ?? 1'],
  ['Chinese prose stops being reported', CORE, 'if (cjkDensity(entry.body) > 0.15) chineseProse.push(entry)', ''],
  ['every entry counts as Chinese prose', CORE, 'if (cjkDensity(entry.body) > 0.15) chineseProse.push(entry)', 'chineseProse.push(entry)'],
  ['Chinese inside code stops being stripped before measuring', CORE, ".replace(/```[\\s\\S]*?```/g, '')\n    .replace(/`[^`]*`/g, '')", ''],

  // --- evidence lines ------------------------------------------------------
  ['a repeated evidence line is written twice', CORE, 'if (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].trim() === `Evidence: \\`${fields.evidence}\\``) paragraphs.pop()', ''],
  ['a trailing evidence line is always dropped', CORE, 'if (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].trim() === `Evidence: \\`${fields.evidence}\\``) paragraphs.pop()', 'if (paragraphs.length > 0) paragraphs.pop()'],
]

const run = () => {
  try {
    execFileSync('cmd', ['/c', `node tests/core.test.mjs > "${OUT}" 2>&1`], { cwd: ROOT })
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

// A mutation whose `find` text no longer exists tests nothing, and says so only in one line of output.
// It is the quietest way for this scan to start lying: the count looks healthy while the coverage
// shrinks. Fail loudly instead.
if (skipped > 0) {
  console.error(`\n${skipped} mutation(s) did not apply — their text is not in the source. Fix them; the scan is testing less than it claims.`)
  process.exit(1)
}
if (survivors.length > 0) {
  console.error(`\n${survivors.length} mutation(s) survived — nothing in the suite notices.`)
  process.exit(1)
}
