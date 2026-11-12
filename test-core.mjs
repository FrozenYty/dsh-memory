/**
 * Behavioural tests for the memory notebook core.
 *
 * They run against the fixture notebook in `test/fixtures/notebook`, not against any real
 * notebook on the author's machine: a test that needs data outside the repository passes here and
 * fails in CI, which is exactly what happened before this fixture existed.
 *
 *   node test-core.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, appendFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as pluginApply } from './index.js'
import {
  ACK_PATTERN,
  auditEntries,
  buildIndex,
  buildIndexDetail,
  diagnoseNotebook,
  ensurePolicyEntry,
  expandHome,
  indexDrift,
  indexResidency,
  loadNotebook,
  normalizeKey,
  pickHits,
  readIndexFiles,
  resolveDirs,
  readUsage,
  recordUsage,
  renderRecall,
  scanDir,
  scoreEntry,
  setStatus,
  strongSignalRarity,
  syncIndexFile,
  tokenize,
  usageReport,
  USAGE_FILE,
  writeEntryFile,
} from './notebook-core.js'

const FIXTURE_ROOT = fileURLToPath(new URL('./test/fixtures', import.meta.url))

const config = {
  workspaceDir: 'notebook',
  machineDir: '',
  showIndex: true,
  indexBudgetChars: 2800,
  indexSummaryChars: 60,
  recallEnabled: true,
  recallBudgetChars: 1400,
  maxRecall: 2,
  minRecallScore: 4,
  minRecallHits: 2,
  minQueryChars: 6,
  skipAcknowledgements: true,
}

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `\n        ${detail}`}`)
  }
}

function names(hits) {
  return hits.map((hit) => hit.entry.key).join(', ') || '(none)'
}

// ---------------------------------------------------------------------------
console.log('\n[1] notebook discovery and index')
// ---------------------------------------------------------------------------
const entries = loadNotebook(config, FIXTURE_ROOT)
// Asserted against the directory rather than a literal, so widening the fixture does not need this
// line edited — and so a file that stops being discovered is still caught.
const fixtureFiles = readdirSync(FIXTURE_ROOT + '/notebook').filter(
  (name) => name.endsWith('.md') && name !== 'INDEX.md',
)
check(
  'the fixture notebook is discovered',
  entries.length === fixtureFiles.length && entries.length >= 10,
  `found ${entries.length} of ${fixtureFiles.length}`,
)
check(
  'all fixture entries are present',
  entries.some((entry) => entry.key === 'mcp-mounting-lifecycle'),
  entries.map((entry) => entry.key).join(','),
)
check('no entry is INDEX.md', entries.every((entry) => entry.key !== 'index'))
check(
  'order follows INDEX.md',
  entries.length > 1 && entries[0].key === 'github-blocked-context7-direct',
  `first = ${entries[0]?.key}`,
)
check('every fixture entry carries triggers', entries.every((entry) => entry.triggers.length > 0))

const index = buildIndex(entries, config)
check('index names every entry', entries.every((entry) => index.includes(`- ${entry.file}`)))
// The summary is what lets the model decide whether reading is worth a call. A bare filename could not:
// asked about commit steps it read `github-repo-operations` — reasonable, and wrong.
check('index lines carry a summary after the filename', /\.md — \S/.test(index), index.split('\n').find((l) => l.includes(' — ')) ?? '(no summary line)')
check('a summary is clipped to the configured length', (() => {
  const line = buildIndex(entries.slice(0, 1), { ...config, indexSummaryChars: 20 })
  const summary = line.match(/\.md — (.+)/)?.[1] ?? ''
  return summary.length > 0 && summary.length <= 21
})(), buildIndex(entries.slice(0, 1), { ...config, indexSummaryChars: 20 }).match(/\.md — (.+)/)?.[1])
check('zero means filenames only', !buildIndex(entries, { ...config, indexSummaryChars: 0 }).includes(' — '))
// A `summary:` in the frontmatter wins over the heading. Without a test for this the field did nothing
// at all: the entry never carried it, every line fell back to the heading, and a fallback that always
// succeeds looks exactly like success.
const summaryProbe = mkdtempSync(join(tmpdir(), 'mn-summary-'))
writeFileSync(
  join(summaryProbe, 'with-summary.md'),
  '---\nstatus: candidate\nsummary: The summary field wins\n---\n\n# A heading that must not appear\n\nEvidence: n/a\n',
  'utf8',
)
const probeIndex = buildIndex(loadNotebook({ ...config, workspaceDir: summaryProbe }, '.'), config)
check(
  'a summary in the frontmatter wins over the heading',
  probeIndex.includes('The summary field wins') && !probeIndex.includes('A heading that must not appear'),
  probeIndex.split('\n').find((l) => l.startsWith('- ')) ?? '(no line)',
)
check('index respects the char budget', index.length <= config.indexBudgetChars, `${index.length} chars`)
check('the summary line costs more than a bare name', index.length > 1000, `${index.length} chars`)
check('empty notebook injects nothing', buildIndex([], config) === '')

const emptyDir = mkdtempSync(join(tmpdir(), 'mn-empty-'))
check('a missing directory yields no entries', loadNotebook({ ...config, workspaceDir: 'nope' }, emptyDir).length === 0)

// ---------------------------------------------------------------------------
console.log('\n[2] tokenising and the acknowledgement gate')
// ---------------------------------------------------------------------------
const mixed = tokenize('PlatformIO 编译失败 openSSL')
check('latin tokens survive', mixed.has('platformio') && mixed.has('openssl'))
check('single letters are dropped', !mixed.has('a'))
check('cjk becomes bigrams', tokenize('相机打不开').has('相机') && tokenize('相机打不开').has('不开'))

// Mixed script with no separator is how a Chinese user actually types. Splitting on non-word
// characters left `mcp挂了` as one token, treated as CJK and shredded into bigrams, so `mcp`
// vanished from the query entirely.
const glued = tokenize('mcp挂了')
check('a glued latin word survives', glued.has('mcp'), [...glued].join(','))
check('its cjk half still bigrams', glued.has('挂了'), [...glued].join(','))
check('a glued long word is not shredded', tokenize('platformio编译').has('platformio'), [...tokenize('platformio编译')].join(','))
check('glued and spaced forms agree', [...tokenize('mcp挂了')].sort().join() === [...tokenize('mcp 挂了')].sort().join())
for (const ack of ['好', '好的。', 'continue', 'OK', '收到！']) {
  check(`"${ack}" is an acknowledgement`, ACK_PATTERN.test(ack))
}
for (const real of ['为什么 platformio 装不上', '看一下这个报错']) {
  check(`"${real}" is a real request`, !ACK_PATTERN.test(real))
}

// Prefix tolerance: a query word matches a field word when one is the other's prefix and both
// reach five characters. Below that floor it must be an exact match, or "env" would match every
// "environment" and the field would stop discriminating.
const stemEntry = {
  key: 'toolchain-notes',
  file: 'toolchain-notes.md',
  dir: '',
  title: 'Installation of the toolchain',
  status: 'candidate',
  triggers: [],
  body: 'environment details',
  mtimeMs: 0,
}
const prefixHit = scoreEntry(stemEntry, tokenize('install toolchain'))
check('a five-character prefix matches a title word', prefixHit.score > 0 && prefixHit.hits === 2, JSON.stringify(prefixHit))
const shortMiss = scoreEntry(stemEntry, tokenize('env'))
check('a three-character word does not prefix-match', shortMiss.score === 0, JSON.stringify(shortMiss))

// ---------------------------------------------------------------------------
console.log('\n[3] recall (English / technical queries)')
// ---------------------------------------------------------------------------
const englishCases = [
  ['github api times out but ssh works', 'github-blocked-context7-direct'],
  ['my skill disappeared from the catalog', 'skill-frontmatter-yaml'],
  ['the mcp server will not mount, no tools appear', 'mcp-mounting-lifecycle'],
  ['camera capture fails with access denied', 'usb-camera-arrival-facts'],
  ['writes need a low integrity label on the target', 'low-integrity-label-writes'],
]
for (const [query, expected] of englishCases) {
  const hits = pickHits(entries, query, config)
  check(`"${query.slice(0, 46)}…" -> ${expected}`, hits.length > 0 && hits[0].entry.key === expected, names(hits))
}

// ---------------------------------------------------------------------------
console.log('\n[4] recall (plain Chinese queries)')
// ---------------------------------------------------------------------------
const chineseCases = [
  ['github 连不上，要用代理吗', 'github-blocked-context7-direct'],
  ['技能从目录里消失了', 'skill-frontmatter-yaml'],
  ['mcp 服务器挂不上，工具都不见了', 'mcp-mounting-lifecycle'],
  ['相机打不开，权限被拒绝', 'usb-camera-arrival-facts'],
  ['写入被拒绝访问，目录权限', 'low-integrity-label-writes'],
]
for (const [query, expected] of chineseCases) {
  const hits = pickHits(entries, query, config)
  check(`"${query}" -> ${expected}`, hits.length > 0 && hits[0].entry.key === expected, names(hits))
}

// A phrase trigger counts only whole. Tested on a synthetic entry so the rule is pinned even if
// no fixture entry happens to carry a multi-word trigger.
const phraseEntry = {
  key: 'phrase-check',
  file: 'phrase-check.md',
  dir: '',
  title: 'Phrase check',
  status: 'candidate',
  triggers: ['dotnet pipe denied'],
  body: 'The word denied appears here alone, with no phrase around it.',
  mtimeMs: 0,
}
const brokenPhrase = scoreEntry(phraseEntry, tokenize('something was denied'))
check('a broken phrase does not score', brokenPhrase.score === 1, `score ${brokenPhrase.score}`)
const wholePhrase = scoreEntry(phraseEntry, tokenize('dotnet pipe denied on startup'))
check('a whole phrase scores above any single field', wholePhrase.score >= 7, `score ${wholePhrase.score}`)
check(
  'a whole phrase counts one hit per word',
  wholePhrase.hits === 3,
  `hits ${wholePhrase.hits}`,
)

// ---------------------------------------------------------------------------
console.log('\n[5] rendering holds its budget without losing the evidence')
// ---------------------------------------------------------------------------
const rendered = renderRecall(pickHits(entries, 'mcp 服务器挂不上，工具都不见了', config), 1400)
check('rendered recall is bounded', rendered.length <= 1400, `${rendered.length} chars`)
check('a clamped entry keeps its evidence line', rendered.includes('Evidence:'), rendered.slice(-160))
check('candidate status is labelled', rendered.includes('(candidate)'), rendered.slice(0, 160))

// ---------------------------------------------------------------------------
console.log('\n[6] trust status and writing')
// ---------------------------------------------------------------------------
const writeDir = mkdtempSync(join(tmpdir(), 'mn-write-'))
const created = writeEntryFile(writeDir, {
  key: 'pwsh-quoting-traps',
  title: 'PowerShell here-strings eat backticks',
  status: 'candidate',
  triggers: 'pwsh, here-string, backtick',
  body: 'A backtick inside a here-string is treated as an escape character.',
  evidence: 'unexpected end of string',
})
check('a new entry is created', created === true)
const after = scanDir(writeDir)
check('the new entry is readable', after.length === 1 && after[0].key === 'pwsh-quoting-traps')
check('it defaults to candidate', after[0]?.status === 'candidate')
check('its triggers are stored', (after[0]?.triggers ?? []).includes('pwsh'))
check('INDEX.md is updated', readFileSync(join(writeDir, 'INDEX.md'), 'utf8').includes('`pwsh-quoting-traps.md`'))
check('the entry carries its evidence', after[0]?.body.includes('Evidence:'))

setStatus(writeDir, 'pwsh-quoting-traps', 'verified')
check('status can be promoted', scanDir(writeDir)[0]?.status === 'verified')
setStatus(writeDir, 'pwsh-quoting-traps', 'disputed')
check('a disputed entry leaves the index', buildIndex(scanDir(writeDir), { ...config, workspaceDir: writeDir }) === '')
check(
  'a disputed entry is never recalled',
  pickHits(scanDir(writeDir), 'pwsh here-string backtick quoting', config).length === 0,
)

// An update that omits triggers must not erase them: the entry would survive but stop being
// findable, and nothing else reports that.
const keepDir = mkdtempSync(join(tmpdir(), 'mn-keep-'))
writeEntryFile(keepDir, {
  key: 'keep-triggers',
  title: 'Keep triggers',
  status: 'candidate',
  triggers: 'alpha, beta',
  body: 'first',
  evidence: 'one',
})
writeEntryFile(keepDir, {
  key: 'keep-triggers',
  title: 'Keep triggers, revised',
  status: 'candidate',
  body: 'second',
  evidence: 'two',
})
const kept = scanDir(keepDir)[0]
check(
  'an update without triggers keeps the old ones',
  kept.triggers.includes('alpha') && kept.triggers.includes('beta'),
  kept.triggers.join(',') || '(none)',
)
writeEntryFile(keepDir, {
  key: 'keep-triggers',
  title: 'Keep triggers, third',
  status: 'candidate',
  triggers: 'gamma',
  body: 'third',
  evidence: 'three',
})
check(
  'an update with triggers replaces them',
  scanDir(keepDir)[0].triggers.join(',') === 'gamma',
  scanDir(keepDir)[0].triggers.join(','),
)

// An update rewrites the frontmatter, so every key this function does not know about is a chance to
// lose data. `summary` was lost exactly this way: it is what the index shows, so dropping it turned an
// entry back into a bare filename while the body survived and nothing reported the loss.
const keptPath = join(keepDir, 'keep-triggers.md')
writeFileSync(
  keptPath,
  '---\nstatus: candidate\nsummary: A summary that must survive\ncustom: a key this plugin does not own\ntriggers: gamma\n---\n\n# Kept\n\nEvidence: n/a\n',
  'utf8',
)
writeEntryFile(keepDir, { key: 'keep-triggers', title: 'Kept', status: 'candidate', body: 'body v2', evidence: 'e2' })
const keptRaw = readFileSync(keptPath, 'utf8')
check('an update keeps an existing summary', keptRaw.includes('summary: A summary that must survive'), keptRaw.split('\n').slice(0, 7).join(' / '))
check('an update keeps a frontmatter key it does not own', keptRaw.includes('custom: a key this plugin does not own'))
writeEntryFile(keepDir, {
  key: 'keep-triggers',
  title: 'Kept',
  status: 'candidate',
  body: 'body v3',
  evidence: 'e3',
  summary: 'A new summary',
})
const replacedRaw = readFileSync(keptPath, 'utf8')
check(
  'an update can set a summary, and it replaces the old one',
  replacedRaw.includes('summary: A new summary') && !replacedRaw.includes('A summary that must survive'),
  replacedRaw.split('\n').slice(0, 7).join(' / '),
)
check(
  'the summary reaches the index',
  buildIndex(loadNotebook({ ...config, workspaceDir: keepDir }, '.'), config).includes('— A new summary'),
)

// ---------------------------------------------------------------------------
console.log('\n[7] evidence hygiene')
// ---------------------------------------------------------------------------
// Built here rather than borrowed from the fixture: the check must work because the code works, not
// because the fixture happens to contain a bad entry.
const auditDir = mkdtempSync(join(tmpdir(), 'mn-audit-'))
writeFileSync(join(auditDir, 'no-evidence.md'), '# No evidence\n\nA claim with no proof.\n', 'utf8')
writeFileSync(join(auditDir, 'has-evidence.md'), '# Has evidence\n\nA claim.\n\nEvidence: `a command`\n', 'utf8')
const auditList = loadNotebook({ ...config, workspaceDir: auditDir }, '.')
const audit = auditEntries(auditList, { staleDays: 90 })
check(
  'an entry without an Evidence line is reported',
  audit.missingEvidence.length === 1 && audit.missingEvidence[0].key === 'no-evidence',
  audit.missingEvidence.map((entry) => entry.key).join(',') || '(none)',
)
check(
  'the fixture notebook carries evidence everywhere',
  auditEntries(entries, { staleDays: 90 }).missingEvidence.length === 0,
  auditEntries(entries, { staleDays: 90 }).missingEvidence.map((entry) => entry.key).join(','),
)
check('fresh fixtures are not stale', audit.stale.length === 0, `${audit.stale.length} stale`)

const aged = auditEntries(entries, { staleDays: 1, now: Date.now() + 10 * 86_400_000 })
check('aging is reported against the clock it is given', aged.stale.length === entries.length, `${aged.stale.length}`)
const writtenDir = mkdtempSync(join(tmpdir(), 'mn-audit-'))
writeEntryFile(writtenDir, {
  key: 'has-evidence',
  title: 'Has evidence',
  status: 'candidate',
  body: 'A claim.',
  evidence: 'a command',
})
const cleanAudit = auditEntries(scanDir(writtenDir), { staleDays: 90 })
check(
  'a freshly written entry passes both checks',
  cleanAudit.missingEvidence.length === 0 && cleanAudit.stale.length === 0,
)

// The notebook is written in English whatever language the conversation is in — a convention that
// eroded silently: five entries were found in Chinese, three of them written by the assistant that
// knew the rule. The distinction that makes it checkable is code versus prose: a quoted Chinese error
// message is evidence and must not be flagged.
const langDir = mkdtempSync(join(tmpdir(), 'mn-lang-'))
writeFileSync(join(langDir, 'english.md'), '# A conclusion in English\n\nBody also in English.\n\nEvidence: `a command`\n', 'utf8')
writeFileSync(
  join(langDir, 'chinese.md'),
  '# 中文标题\n\n这一段正文完全是用中文写的，因为它违反了笔记本的语言约定，应该被审计报告出来。\n\nEvidence: `a command`\n',
  'utf8',
)
writeFileSync(
  join(langDir, 'quoting.md'),
  '# Only code quotes Chinese\n\nThe error was:\n\n```\n程序运行失败：访问被拒绝\n```\n\nEvidence: `程序运行失败`\n',
  'utf8',
)
const langFlagged = auditEntries(loadNotebook({ ...config, workspaceDir: langDir }, '.'), { staleDays: 90 }).chineseProse.map(
  (entry) => entry.key,
)
check('an entry written in Chinese is reported', langFlagged.includes('chinese'), langFlagged.join(',') || '(none)')
check('an English entry is not reported', !langFlagged.includes('english'))
check('Chinese inside a code block or span is not prose', !langFlagged.includes('quoting'), langFlagged.join(',') || '(none)')
rmSync(langDir, { recursive: true, force: true })

// A body whose last paragraph repeats the `evidence` argument would otherwise carry the claim twice —
// the live notebook had an entry with two lines, the second a truncated leftover. A *different*
// trailing line is kept: it may be a lifecycle entry's last phase evidence, and the text alone cannot
// tell the two apart, so the safe rule removes only the duplicate.
const dupDir = mkdtempSync(join(tmpdir(), 'mn-dup-evidence-'))
writeEntryFile(dupDir, {
  key: 'dup',
  title: 'Dup',
  status: 'candidate',
  body: 'Prose here.\n\nEvidence: `the same command`',
  evidence: 'the same command',
})
const dupRaw = readFileSync(join(dupDir, 'dup.md'), 'utf8')
const dupCount = (dupRaw.match(/^Evidence:/gm) ?? []).length
check('an evidence line repeated in the body is not written twice', dupCount === 1, `${dupCount} line(s)`)

writeEntryFile(dupDir, {
  key: 'phases',
  title: 'Phases',
  status: 'candidate',
  body: '## Phase one\n\nEvidence: `first`\n\n## Phase two\n\nEvidence: `second`',
  evidence: 'the whole thing',
})
const phaseRaw = readFileSync(join(dupDir, 'phases.md'), 'utf8')
const phaseCount = (phaseRaw.match(/^Evidence:/gm) ?? []).length
check(
  'per-phase Evidence survives, including the last phase',
  phaseCount === 3 && phaseRaw.includes('`first`') && phaseRaw.includes('`second`') && phaseRaw.includes('the whole thing'),
  `${phaseCount} line(s)`,
)

writeEntryFile(dupDir, {
  key: 'stale',
  title: 'Stale',
  status: 'candidate',
  body: 'Prose.\n\nEvidence: `the old command`',
  evidence: 'the new command',
})
const staleRaw = readFileSync(join(dupDir, 'stale.md'), 'utf8')
check(
  'a different trailing evidence line is kept rather than silently replaced',
  staleRaw.includes('the old command') && staleRaw.includes('the new command'),
)
rmSync(dupDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
console.log('\n[8] index drift')
// ---------------------------------------------------------------------------
// Both directions: a file nobody listed is invisible, a listed file that is gone makes the index
// lie. The fixture is consistent, so drift there must be empty.
const fixtureDrift = indexDrift(FIXTURE_ROOT + '/notebook')
check(
  'the fixture index agrees with its directory',
  fixtureDrift.unlisted.length === 0 && fixtureDrift.missing.length === 0,
  JSON.stringify(fixtureDrift),
)

const driftDir = mkdtempSync(join(tmpdir(), 'mn-drift-'))
writeFileSync(join(driftDir, 'listed.md'), '# listed\n', 'utf8')
writeFileSync(join(driftDir, 'forgotten.md'), '# forgotten\n', 'utf8')
writeFileSync(join(driftDir, 'INDEX.md'), '- `listed.md`\n- `deleted.md`\n', 'utf8')
const drifted = indexDrift(driftDir)
check('an unlisted file is reported', drifted.unlisted.length === 1 && drifted.unlisted[0] === 'forgotten.md', JSON.stringify(drifted.unlisted))
check('a missing listed file is reported', drifted.missing.length === 1 && drifted.missing[0] === 'deleted.md', JSON.stringify(drifted.missing))
check('the listed file is not reported', !drifted.unlisted.includes('listed.md') && !drifted.missing.includes('listed.md'))

// ---------------------------------------------------------------------------
console.log('\n[9] policy seeding')
// ---------------------------------------------------------------------------
// The policy ships with the plugin. A fresh install has no notebook entry for it, so the plugin
// must be able to seed one — and must never overwrite a policy the user has edited.
const seedRoot = mkdtempSync(join(tmpdir(), 'mn-seed-'))
const seedDir = join(seedRoot, 'notebook')
mkdirSync(seedDir, { recursive: true })
const TEMPLATE = '# Policy\n\nEvidence: policy, not a fact.\n'

check('a notebook without a policy gets one', ensurePolicyEntry(seedDir, TEMPLATE) === true)
check('the seeded policy is on disk', existsSync(join(seedDir, 'notebook-policy.md')))
check(
  'INDEX.md lists the seeded policy',
  readFileSync(join(seedDir, 'INDEX.md'), 'utf8').includes('`notebook-policy.md`'),
)
check('a second seed is a no-op', ensurePolicyEntry(seedDir, TEMPLATE) === false)

writeFileSync(join(seedDir, 'notebook-policy.md'), '# Edited by the user\n', 'utf8')
ensurePolicyEntry(seedDir, TEMPLATE)
check(
  'an edited policy is never overwritten',
  readFileSync(join(seedDir, 'notebook-policy.md'), 'utf8') === '# Edited by the user\n',
)

const absentDir = join(seedRoot, 'does-not-exist')
check(
  'a missing notebook directory is left alone',
  ensurePolicyEntry(absentDir, TEMPLATE) === false && !existsSync(absentDir),
)
check('an empty template writes nothing', ensurePolicyEntry(join(seedRoot, 'empty'), '') === false)

const seededIndex = buildIndex(scanDir(seedDir), { ...config, workspaceDir: 'notebook' })
check(
  'the index names the policy when one exists',
  seededIndex.includes("`notebook-policy.md` holds this notebook"),
  seededIndex.slice(0, 260),
)
// Asked of a notebook that genuinely has no policy, not of whatever the fixture happens to hold.
const withoutPolicy = entries.filter((entry) => entry.key !== 'notebook-policy')
const noPolicyIndex = buildIndex(withoutPolicy, config)
check(
  'the index does not advertise a policy that is absent',
  !noPolicyIndex.includes('notebook-policy.md'),
  noPolicyIndex.slice(0, 260),
)

// The template is a package resource, not a file every user is assumed to have. If it stops
// shipping, a fresh install silently gets no policy and the index stops naming one.
const shippedTemplate = readFileSync(new URL('./templates/notebook-policy.md', import.meta.url), 'utf8')
check('the bundled policy template ships', shippedTemplate.length > 1000, `${shippedTemplate.length} chars`)
check('the shipped template has an Evidence line', shippedTemplate.includes('Evidence:'))

// ---------------------------------------------------------------------------
console.log('\n[10] recall quality: false-positive budget')
// ---------------------------------------------------------------------------
// Ordinary work talk that shares vocabulary with the fixtures but is not about any of them. This is
// the budget that matters: recall improvements must not be paid for here. The list lives in
// test/qrels.json, shared with scripts/eval-recall.mjs, so the two suites cannot drift apart.
const qrels = JSON.parse(readFileSync(FIXTURE_ROOT + '/../qrels.json', 'utf8'))
const offTopic = qrels.offTopic
let falsePositives = 0
for (const query of offTopic) {
  const hits = pickHits(entries, query, config)
  if (hits.length > 0) {
    falsePositives += 1
    console.log(`  FP    "${query}" -> ${names(hits)}`)
  }
}
check(
  `no false positive across ${offTopic.length} off-topic queries`,
  falsePositives === 0,
  `${falsePositives} false positive(s)`,
)

// ---------------------------------------------------------------------------
console.log('\n[11] recall quality: glued mixed-script input')
// ---------------------------------------------------------------------------
// A Chinese user types `mcp挂了` and `platformio编译` without spaces. Before the tokenizer fix
// these recalled nothing: the Latin word was shredded into CJK bigrams.
const gluedCases = [
  ['github连不上', 'github-blocked-context7-direct'],
  ['技能消失了', 'skill-frontmatter-yaml'],
  ['mcp挂了', 'mcp-mounting-lifecycle'],
  ['相机打不开', 'usb-camera-arrival-facts'],
  ['写入被拒绝访问', 'low-integrity-label-writes'],
]
for (const [query, expected] of gluedCases) {
  const hits = pickHits(entries, query, config)
  check(`glued "${query}" -> ${expected}`, hits.length > 0 && hits[0].entry.key === expected, names(hits))
}

// A word that names an entry and triggers it is that entry's identifier: one is enough.
const identifierOnly = pickHits(entries, 'mcp', config)
check(
  'a single identifier word recalls on its own',
  identifierOnly.length > 0 && identifierOnly[0].entry.key === 'mcp-mounting-lifecycle',
  names(identifierOnly),
)
const bodyOnlyWord = pickHits(entries, 'sandbox', config)
check(
  'a word that only appears in a body does not recall alone',
  bodyOnlyWord.length === 0 || bodyOnlyWord[0].entry.key === 'git-push-piped-fails-in-sandbox',
  names(bodyOnlyWord),
)

// A whole Chinese word of two characters is one bigram, while a three-character word is two — so
// `相机` scored one hit and `贡献者` scored two, though both are equally specific. A Chinese word
// also cannot become an identifier, because filenames are ASCII. It must reach the floor alone.
const chineseWordEntry = {
  key: 'ascii-name-only',
  file: 'ascii-name-only.md',
  dir: '',
  title: 'An entry whose name carries no Chinese',
  status: 'candidate',
  triggers: ['相机'],
  body: 'nothing relevant here',
  mtimeMs: 0,
}
const twoChar = scoreEntry(chineseWordEntry, tokenize('相机那次'))
check('a two-character Chinese trigger reaches the floor alone', twoChar.hits >= 2, JSON.stringify(twoChar))
const singleChar = { ...chineseWordEntry, triggers: ['好'] }
const oneChar = scoreEntry(singleChar, tokenize('好的'))
check('a single Chinese character does not', oneChar.hits < 2, JSON.stringify(oneChar))

// A word only one entry claims identifies that entry, so it earns the second hit a filename would.
// A word several entries share does not — which is what keeps the floor meaningful as the notebook
// grows, since any term stops being unique once a second entry wants it.
const soleClaim = { ...chineseWordEntry, key: 'only-one', file: 'only-one.md', title: 'Only one', triggers: ['solo'] }
const sharedA = { ...chineseWordEntry, key: 'shared-a', file: 'shared-a.md', title: 'A', triggers: ['common'] }
const sharedB = { ...chineseWordEntry, key: 'shared-b', file: 'shared-b.md', title: 'B', triggers: ['common'] }
const pairRarity = strongSignalRarity([soleClaim, sharedA, sharedB])
check(
  'a word only one entry claims counts two hits',
  scoreEntry(soleClaim, tokenize('solo'), pairRarity).hits >= 2,
  JSON.stringify(scoreEntry(soleClaim, tokenize('solo'), pairRarity)),
)
check(
  'a word two entries claim counts one',
  scoreEntry(sharedA, tokenize('common'), pairRarity).hits === 1,
  JSON.stringify(scoreEntry(sharedA, tokenize('common'), pairRarity)),
)
check(
  'the rule needs the notebook to decide',
  scoreEntry(soleClaim, tokenize('solo')).hits === 1,
  'without rarity a lone word must not reach the floor',
)
check('rarity is counted across a real notebook', strongSignalRarity(entries).size > 0)

// Body words alone never qualify. A long entry that quotes a sentence collected six body hits from
// that sentence and recalled on nothing but coincidence; body text explains, it does not identify.
const bodyOnly = { ...chineseWordEntry, triggers: [], body: '今天天气怎么样 服务器重启一下 路径怎么拼' }
const bodyScored = scoreEntry(bodyOnly, tokenize('今天天气怎么样'))
check('body words accumulate but do not qualify', bodyScored.strong === false && bodyScored.hits > 2, JSON.stringify(bodyScored))
check('such an entry is never recalled', pickHits([bodyOnly], '今天天气怎么样', config).length === 0)

// ---------------------------------------------------------------------------
console.log('\n[12] index is derived, not hand-maintained')
// ---------------------------------------------------------------------------
// The index must describe the directory exactly. A line for a file that is gone makes it lie; a
// file with no line is invisible, because the injected index never names it. Both have happened.
const derived = mkdtempSync(join(tmpdir(), 'mn-derived-'))
writeFileSync(join(derived, 'first.md'), '# first\n', 'utf8')
writeFileSync(join(derived, 'second.md'), '# second\n', 'utf8')
writeFileSync(join(derived, 'INDEX.md'), '- `first.md`\n- `second.md`\n', 'utf8')

rmSync(join(derived, 'first.md'))
syncIndexFile(derived)
let listed = readFileSync(join(derived, 'INDEX.md'), 'utf8')
check('a deleted entry leaves the index', !listed.includes('first.md'), listed)
check('the surviving entry stays', listed.includes('`second.md`'), listed)

writeFileSync(join(derived, 'third.md'), '# third\n', 'utf8')
syncIndexFile(derived)
listed = readFileSync(join(derived, 'INDEX.md'), 'utf8')
check('a file written outside the plugin is indexed', listed.includes('`third.md`'), listed)
// New entries take the top, because residency is finite and what was just learned is the most likely
// thing to be needed next. Existing entries keep their relative order.
check(
  'a new entry is placed above the older one, not below it',
  listed.indexOf('third.md') < listed.indexOf('second.md'),
  listed,
)
check('the derived index has no stale lines', indexDrift(derived).missing.length === 0)

// ---------------------------------------------------------------------------
console.log('\n[13] the budget caps residency, not capacity')
// ---------------------------------------------------------------------------
// The budget is a token decision. It cannot lose a fact — the entry lands on disk, recall matches it,
// and memory_list names it — so refusing the write would protect nothing. What it decides is whether
// the model can *see* the entry, and an invisible omission must at least be counted.
const roomy = buildIndexDetail(entries, { ...config, indexBudgetChars: 100000 })
check('a roomy budget shows everything', roomy.shown === entries.length && roomy.hidden === 0, JSON.stringify({ shown: roomy.shown, hidden: roomy.hidden }))
check('and adds no overflow notice', !roomy.text.includes('more,'), roomy.text.slice(-120))

const tight = buildIndexDetail(entries, { ...config, indexBudgetChars: 400 })
check('a tight budget hides entries', tight.hidden > 0, JSON.stringify({ shown: tight.shown, hidden: tight.hidden }))
check('the omission is counted', tight.text.includes(`${tight.hidden} more`), tight.text.slice(-160))
check('the notice names the way to see them', tight.text.includes('memory_list'), tight.text.slice(-160))
check('the rendered index still fits its budget', tight.text.length <= 400, `${tight.text.length} chars`)
check('something is shown when anything fits', tight.shown >= 1, `${tight.shown}`)
check('nothing is dropped from the notebook', loadNotebook(config, FIXTURE_ROOT).length === entries.length)
check('the text is the detail text', buildIndex(entries, { ...config, indexBudgetChars: 400 }) === tight.text)

// The new entry goes to the top, so it is resident whenever anything is; what it can cost is other
// entries' visibility, and that is what the write reports.
const residency = indexResidency(entries, { ...config, indexBudgetChars: 400 }, { file: 'brand-new.md', status: 'candidate' })
check('a new entry is resident', residency.resident === true, JSON.stringify(residency))
check('it reports what it displaced', residency.hidden >= tight.hidden, `${residency.hidden} vs ${tight.hidden}`)
check(
  'an update never displaces anything',
  indexResidency(entries, { ...config, indexBudgetChars: 100000 }, { file: entries[0].file, status: 'candidate' }).hidden === 0,
)

// A fact just written is the most likely thing to be needed next, so it must not be the first thing
// the budget hides.
const orderDir = mkdtempSync(join(tmpdir(), 'mn-order-'))
writeFileSync(join(orderDir, 'older.md'), '# older\n', 'utf8')
writeFileSync(join(orderDir, 'INDEX.md'), '- `older.md`\n', 'utf8')
writeFileSync(join(orderDir, 'newer.md'), '# newer\n', 'utf8')
syncIndexFile(orderDir)
const ordered = readIndexFiles(orderDir)
check('a new entry goes to the top of the index', ordered[0] === 'newer.md', ordered.join(','))
check('the existing order is kept', ordered[1] === 'older.md', ordered.join(','))

// ---------------------------------------------------------------------------
console.log('\n[15] health: broken is not the same as empty')
// ---------------------------------------------------------------------------
// The failure this catches is the quiet one. A notebook that cannot be read and a notebook with
// nothing to say both return no hits, and the user concludes the feature is useless rather than
// broken — so capability is checked separately from the result.
const unconfigured = diagnoseNotebook({ workspaceDir: '', machineDir: '' }, '.')
check('an unconfigured notebook says so', unconfigured.status === 'unconfigured', JSON.stringify(unconfigured))

const absent = diagnoseNotebook({ ...config, workspaceDir: 'definitely-not-here' }, emptyDir)
check('a notebook that was never created is absent, not broken', absent.status === 'absent', JSON.stringify(absent))
check('and it has nothing to complain about', absent.problems.length === 0)

const healthy = diagnoseNotebook(config, FIXTURE_ROOT)
check('a healthy notebook reports ok', healthy.status === 'ok', JSON.stringify(healthy.problems))
check('it counts the entries', healthy.entries === entries.length, `${healthy.entries}`)
check('it reports remaining index room', healthy.indexResident > 0 && healthy.indexOverflow === 0, JSON.stringify({ resident: healthy.indexResident, overflow: healthy.indexOverflow }))
check('it confirms the index agrees', healthy.indexAgrees === true)
check('the fixture policy is found', healthy.policy === true)

const driftHealthDir = mkdtempSync(join(tmpdir(), 'mn-health-'))
writeFileSync(join(driftHealthDir, 'invisible.md'), '# invisible\n\nEvidence: none\n', 'utf8')
writeFileSync(join(driftHealthDir, 'INDEX.md'), '# Memory index\n\n', 'utf8')
const drifting = diagnoseNotebook({ ...config, workspaceDir: driftHealthDir }, '.')
check('an index that does not agree is not ok', drifting.status !== 'ok', JSON.stringify(drifting))
check(
  'and the missing line is named as the problem',
  drifting.problems.some((problem) => /not in INDEX/.test(problem)),
  JSON.stringify(drifting.problems),
)

const tightHealth = diagnoseNotebook({ ...config, indexBudgetChars: 200 }, FIXTURE_ROOT)
check(
  'entries past the budget are degraded, not broken',
  tightHealth.status === 'degraded',
  JSON.stringify({ status: tightHealth.status, problems: tightHealth.problems }),
)
check('and the overflow is counted', tightHealth.indexOverflow === entries.length - tightHealth.indexResident, JSON.stringify({ resident: tightHealth.indexResident, overflow: tightHealth.indexOverflow }))
check(
  'and the reason is named',
  tightHealth.problems.some((problem) => /past the index budget/.test(problem)),
  JSON.stringify(tightHealth.problems),
)
check('an index still names one entry rather than none', tightHealth.indexResident >= 1, `${tightHealth.indexResident}`)

const noTriggerDir = mkdtempSync(join(tmpdir(), 'mn-health2-'))
writeFileSync(join(noTriggerDir, 'bare.md'), '# A bare entry\n\nEvidence: none\n', 'utf8')
writeFileSync(join(noTriggerDir, 'INDEX.md'), '- `bare.md`\n', 'utf8')
const bare = diagnoseNotebook({ ...config, workspaceDir: noTriggerDir }, '.')
check('an entry with no triggers is degraded, not broken', bare.status === 'degraded', JSON.stringify(bare))
check('and the entry is named', bare.withoutTriggers.includes('bare'), JSON.stringify(bare.withoutTriggers))

// Every status must return exactly the declared shape: a tool output schema has to describe what is
// actually returned, and a field that vanishes for one status cannot be described at all.
const SHAPE = ['status', 'dir', 'entries', 'indexAgrees', 'indexChars', 'indexBudget', 'indexResident', 'indexOverflow', 'disputed', 'withoutTriggers', 'withoutEvidence', 'policy', 'problems']
for (const [label, report] of [['unconfigured', unconfigured], ['absent', absent], ['ok', healthy], ['degraded', bare], ['broken', drifting]]) {
  check(`the ${label} report has every field`, SHAPE.every((field) => field in report), Object.keys(report).join(','))
}

// ---------------------------------------------------------------------------
console.log('\n[16] usage: which entries are actually used')
// ---------------------------------------------------------------------------
// "Never recalled" is the finding worth having: an entry injected a hundred times and opened once is
// doing nothing, and nothing else in the plugin notices. A total would hide the one entry nobody uses.
const usageDir = mkdtempSync(join(tmpdir(), 'mn-usage-'))
const usedKey = entries[0].key
const unusedKey = entries[1].key
check('recording usage succeeds', recordUsage(usageDir, usedKey) === true && recordUsage(usageDir, usedKey) === true)
check('usage on a missing directory fails quietly', recordUsage(join(usageDir, 'nope'), usedKey) === false)
check('an empty log reads as empty', readUsage(emptyDir).length === 0)

const usageRows = readUsage(usageDir)
check('usage reads back', usageRows.length === 2, `${usageRows.length}`)
const firstRow = JSON.parse(readFileSync(join(usageDir, USAGE_FILE), 'utf8').split('\n')[0])
check(
  'the log records a day and an entry name and nothing else',
  Object.keys(firstRow).sort().join(',') === 'd,e',
  JSON.stringify(firstRow),
)
check(
  'no query text reaches the log',
  readFileSync(join(usageDir, USAGE_FILE), 'utf8')
    .trim()
    .split('\n')
    .every((line) => Object.keys(JSON.parse(line)).length === 2),
)

const usage = usageReport(entries, usageRows)
check('a recalled entry is counted', usage.used.some((row) => row.key === usedKey && row.recalls === 2), JSON.stringify(usage.used))
check('an entry never recalled is named', usage.never.includes(unusedKey), JSON.stringify(usage.never))
check('the entry that was recalled is not in never', !usage.never.includes(usedKey))
check('disputed entries are not reported as unused', usageReport([{ ...entries[0], status: 'disputed' }], []).never.length === 0)

appendFileSync(join(usageDir, USAGE_FILE), '{"d":"2026-01-01","e":"tru', 'utf8')
check('a half-written line is skipped, not fatal', readUsage(usageDir).length === 2, `${readUsage(usageDir).length}`)

// A log whose last line has no terminator swallows the next record: append puts it on the same line,
// and one line holding two objects parses as neither. This happened — a tool rewrote the file without
// newlines and 183 records became one 10KB line, which read as **empty**. The file was intact, the size
// was intact, and every entry silently looked unused.
const noNewlineDir = mkdtempSync(join(tmpdir(), 'mn-nonl-'))
writeFileSync(join(noNewlineDir, USAGE_FILE), '{"d":"2026-01-01","e":"first"}', 'utf8')
recordUsage(noNewlineDir, 'second')
check(
  'a record appended to an unterminated log stays on its own line',
  readUsage(noNewlineDir).length === 2,
  `${readUsage(noNewlineDir).length} row(s) from ${JSON.stringify(readFileSync(join(noNewlineDir, USAGE_FILE), 'utf8'))}`,
)

const gluedDir = mkdtempSync(join(tmpdir(), 'mn-glued-'))
writeFileSync(
  join(gluedDir, USAGE_FILE),
  '{"d":"2026-01-01","e":"first"}{"d":"2026-01-01","e":"second"}{"d":"2026-01-02","e":"third"}',
  'utf8',
)
check(
  'a line holding several records is split, not discarded',
  readUsage(gluedDir).length === 3,
  `${readUsage(gluedDir).length} row(s)`,
)

// ---------------------------------------------------------------------------
console.log('\n[17] every tool schema stays inside the host subset')
// ---------------------------------------------------------------------------
// The host rejects a schema it cannot describe, and it does so while the plugin is loading — so the
// whole plugin goes inactive and every tool disappears. That happened: `type: ['object','null']` in
// one output schema removed memory_write, memory_list and the rest, and the only visible symptom was
// "unknown tool". These rules are copied from the host's own validator so the same mistake cannot
// reach it again.
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

function schemaViolations(node, path, out) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    out.push(`${path} is not a schema object`)
    return out
  }
  const type = node.type
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
    out.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join('/')}`)
    return out
  }
  const allowedFor = { properties: ['object'], required: ['object'], additionalProperties: ['object'], items: ['array'] }
  for (const [key, types] of Object.entries(allowedFor)) {
    if (key in node && !types.includes(type)) out.push(`${path}.${key} is not supported on type "${type}"`)
  }
  if (node.properties !== undefined) {
    for (const [key, value] of Object.entries(node.properties)) schemaViolations(value, `${path}.properties.${key}`, out)
  }
  if (node.items !== undefined) schemaViolations(node.items, `${path}.items`, out)
  if (node.oneOf !== undefined) node.oneOf.forEach((branch, index) => schemaViolations(branch, `${path}.oneOf[${index}]`, out))
  return out
}

const registered = []
pluginApply(
  {
    systemPrompt: { section: () => {}, context: () => {} },
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
    on: () => () => {},
    get: () => undefined,
  },
  { workspaceDir: 'notebook' },
)

check('every tool registers', registered.length >= 6, `${registered.length}`)
check(
  'the six memory tools are present',
  ['memory_list', 'memory_read', 'memory_write', 'memory_verify', 'memory_health', 'memory_audit', 'memory_usage'].every((name) =>
    registered.some((tool) => tool.name === name),
  ),
  registered.map((tool) => tool.name).join(','),
)

let schemaProblems = []
for (const tool of registered) {
  for (const [label, schema] of [['parameters', tool.parameters], ['output', tool.output?.schema]]) {
    if (schema === undefined) continue
    const violations = schemaViolations(schema, `${tool.name}.${label}`, [])
    if (schema.type !== 'object') violations.push(`${tool.name}.${label}.type must be "object" (structured output is object-rooted)`)
    schemaProblems = schemaProblems.concat(violations)
  }
}
check('no schema uses a feature the host rejects', schemaProblems.length === 0, schemaProblems.join('; '))

// The failure this guards was invisible: a rejected schema unloads the plugin, and an unloaded plugin
// looks exactly like a notebook with nothing to say.
check(
  'a type array is caught by these rules',
  schemaViolations({ type: ['object', 'null'] }, 'probe', []).some((v) => /single type string/.test(v)),
)

// ---------------------------------------------------------------------------
console.log('\n[18] the host API guard')
// ---------------------------------------------------------------------------
// A plugin that silently does nothing is worse than one that fails to load, because nothing tells the
// user which happened.
let guarded = ''
try {
  pluginApply({ systemPrompt: { section: () => {}, context: () => {} }, tools: {} }, {})
} catch (error) {
  guarded = error.message
}
check('a host without tools.register fails loudly', /tools\.register/.test(guarded), guarded)
check('the failure says it is a load failure', /not active/.test(guarded), guarded)

let missingPrompt = ''
try {
  pluginApply({ systemPrompt: {}, tools: { register: () => {} } }, {})
} catch (error) {
  missingPrompt = error.message
}
check('a host without systemPrompt.section fails loudly', /systemPrompt\.section/.test(missingPrompt), missingPrompt)

// ---------------------------------------------------------------------------
console.log('\n[19] safety')
// ---------------------------------------------------------------------------
const readOnlyDir = mkdtempSync(join(tmpdir(), 'mn-ro-'))
writeFileSync(join(readOnlyDir, 'broken.md'), '---\nstatus: candidate\n---\nno heading, no trouble\n', 'utf8')
const broken = scanDir(readOnlyDir)
check('an entry without a heading still loads', broken.length === 1 && broken[0].title === 'broken')

// ---------------------------------------------------------------------------
console.log('\n[20] a read through the tool is counted as usage')
// ---------------------------------------------------------------------------
// Recall is off by default, so `memory_read` is the only usage signal that still exists — and the
// better one: the model chose the entry because it needed it, where an automatic publication only means
// a matcher fired. Without this, memory_usage stops moving the day recall is turned off, and every
// entry looks unused forever.
const readTraceDir = mkdtempSync(join(tmpdir(), 'mn-readtrace-'))
writeFileSync(
  join(readTraceDir, 'demo.md'),
  '---\nstatus: candidate\ntriggers: demo\n---\n\n# Demo entry\n\nEvidence: none needed\n',
  'utf8',
)
const readTools = []
pluginApply(
  {
    systemPrompt: { section: () => {}, context: () => {} },
    tools: { register: (tool) => { readTools.push(tool); return () => {} } },
    on: () => () => {},
    get: () => undefined,
  },
  { workspaceDir: readTraceDir },
)
const readTool = readTools.find((tool) => tool.name === 'memory_read')
const traceExec = { agent: { session: { header: { cwd: readTraceDir } } } }
const readResult = await readTool.execute({ name: 'demo' }, traceExec)
check('memory_read returns the entry', readResult?.name === 'demo' && readResult.content.includes('Demo entry'))
const readRows = readUsage(readTraceDir)
check(
  'the read is recorded in the usage log',
  readRows.length === 1 && readRows[0].entry === 'demo',
  JSON.stringify(readRows),
)
check(
  'a read of a missing entry records nothing',
  await readTool
    .execute({ name: 'nope' }, traceExec)
    .then(() => false)
    .catch(() => readUsage(readTraceDir).length === 1),
)

// ---------------------------------------------------------------------------
console.log('\n[21] path resolution, and the same directory named twice')
// ---------------------------------------------------------------------------
// Found by auditing every place that takes a directory: several took only the first, so a configured
// machine-wide tier was never seeded, never index-synced, and its reads were logged against the
// workspace. And when both settings name the same directory, memory_usage read that log twice and
// doubled every count.
const resolvedBoth = resolveDirs({ workspaceDir: '.agents/memory', machineDir: '~/tier' }, '/cwd')
check('two configured directories both appear', resolvedBoth.length === 2, JSON.stringify(resolvedBoth))
const resolvedSame = resolveDirs({ workspaceDir: '/abs/m', machineDir: '/abs/m' }, '/cwd')
check('the same directory named twice appears once', resolvedSame.length === 1, JSON.stringify(resolvedSame))
check(
  'the workspace tier comes first, so it wins a name collision',
  resolveDirs({ workspaceDir: 'ws', machineDir: '~/m' }, '/cwd')[0].includes('ws'),
  JSON.stringify(resolveDirs({ workspaceDir: 'ws', machineDir: '~/m' }, '/cwd')),
)
check('nothing configured yields nothing', resolveDirs({ workspaceDir: '', machineDir: '' }, '/cwd').length === 0)
check('a workspace tier needs a cwd', resolveDirs({ workspaceDir: '.agents/memory', machineDir: '' }, undefined).length === 0)
check('a bare tilde expands to the home directory', expandHome('~').length > 1 && !expandHome('~').startsWith('~'))
check('a tilde path expands and joins', expandHome('~/notes').endsWith(join('', 'notes')))
check('an absolute path is left alone', expandHome('/abs/path') === '/abs/path')
check('an empty setting expands to an empty string', expandHome('') === '')

// ---------------------------------------------------------------------------
console.log('\n[22] every configured directory is seeded and index-synced, and dates are local')
// ---------------------------------------------------------------------------
// Mutation testing found these two had no protection: reverting the fixes left every test passing.
// The write path's date and the multi-directory wiring are both invisible to a suite that only ever
// configures one directory and only ever runs in whatever timezone CI happens to use.
const multiWs = mkdtempSync(join(tmpdir(), 'mn-multi-ws-'))
const multiMachine = mkdtempSync(join(tmpdir(), 'mn-multi-machine-'))
writeFileSync(join(multiWs, 'ws-entry.md'), '# Workspace entry\n\nEvidence: n/a\n', 'utf8')
writeFileSync(join(multiMachine, 'machine-entry.md'), '# Machine entry\n\nEvidence: n/a\n', 'utf8')

let multiSection
pluginApply(
  {
    systemPrompt: { section: (section) => { multiSection = section }, context: () => {} },
    tools: { register: () => () => {} },
    on: () => () => {},
    get: () => undefined,
  },
  {
    showIndex: true,
    workspaceDir: multiWs,
    machineDir: multiMachine,
    indexBudgetChars: config.indexBudgetChars,
    indexSummaryChars: config.indexSummaryChars,
  },
)
// Rendering the section is what seeds and syncs; the callback is the wiring under test.
const multiText = multiSection.text({ agent: { session: { header: { cwd: '/' } } } })
check('the workspace tier is seeded with the policy', existsSync(join(multiWs, 'notebook-policy.md')))
check('the machine tier is seeded too', existsSync(join(multiMachine, 'notebook-policy.md')))
check('the workspace tier gets its index', existsSync(join(multiWs, 'INDEX.md')))
check('the machine tier gets its index too', existsSync(join(multiMachine, 'INDEX.md')))
check(
  'the rendered index names entries from both tiers',
  multiText.includes('ws-entry') && multiText.includes('machine-entry'),
  multiText.split('\n').filter((l) => l.startsWith('- ')).join(' | '),
)

// The date must be the author's calendar day. A suite running in UTC cannot tell the difference, which
// is exactly how three toISOString() call sites survived: the bug only bites east or west of Greenwich.
const dateDir = mkdtempSync(join(tmpdir(), 'mn-date-'))
writeEntryFile(dateDir, { key: 'dated', title: 'Dated', status: 'candidate', body: 'b', evidence: 'e' })
const now = new Date()
const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const datedRaw = readFileSync(join(dateDir, 'dated.md'), 'utf8')
check('the date written is the local calendar day', datedRaw.includes(`updated: ${localDay}`), datedRaw.split('\n')[2])
check(
  'the usage log records the local calendar day too',
  (() => {
    recordUsage(dateDir, 'dated')
    return readUsage(dateDir)[0]?.day === localDay
  })(),
  JSON.stringify(readUsage(dateDir)[0]),
)
rmSync(dateDir, { recursive: true, force: true })

// The runtime assertion above can only catch a UTC regression between 00:00 and 07:59 local time — for
// the other sixteen hours the two calendars agree and it passes either way. Mutation testing proved
// that: reverting the fix left it green. This is the version that cannot be dodged by the clock.
// Comments are stripped first, because the fix's own explanation names the function it replaced.
const coreSource = readFileSync(new URL('./notebook-core.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
check(
  'no date in the source comes from toISOString',
  !coreSource.includes('toISOString'),
  'notebook-core.js still formats a date with toISOString, which is UTC',
)

for (const dir of [emptyDir, writeDir, readOnlyDir, readTraceDir, writtenDir, seedRoot, driftDir, keepDir, derived, multiWs, multiMachine]) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dirs; best effort */
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
