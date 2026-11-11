/**
 * Behavioural tests for the memory notebook core.
 *
 * They run against the fixture notebook in `test/fixtures/notebook`, not against any real
 * notebook on the author's machine: a test that needs data outside the repository passes here and
 * fails in CI, which is exactly what happened before this fixture existed.
 *
 *   node test-core.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACK_PATTERN,
  auditEntries,
  buildIndex,
  ensurePolicyEntry,
  indexDrift,
  loadNotebook,
  pickHits,
  renderRecall,
  scanDir,
  scoreEntry,
  setStatus,
  tokenize,
  writeEntryFile,
} from './notebook-core.js'

const FIXTURE_ROOT = fileURLToPath(new URL('./test/fixtures', import.meta.url))

const config = {
  workspaceDir: 'notebook',
  machineDir: '',
  showIndex: true,
  indexBudgetChars: 1400,
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
check('the fixture notebook is discovered', entries.length === 5, `found ${entries.length}`)
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
check('index lists bare filenames', entries.every((entry) => index.includes(`- ${entry.file}`)))
check('index carries no descriptions', !index.includes(' — '), 'found an em-dash description')
check('index respects the char budget', index.length <= config.indexBudgetChars, `${index.length} chars`)
check('index stays cheap', index.length < 1000, `${index.length} chars`)
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

// ---------------------------------------------------------------------------
console.log('\n[7] evidence hygiene')
// ---------------------------------------------------------------------------
const audit = auditEntries(entries, { staleDays: 90 })
check(
  'an entry without an Evidence line is reported',
  audit.missingEvidence.length === 1 && audit.missingEvidence[0].key === 'usb-camera-arrival-facts',
  audit.missingEvidence.map((entry) => entry.key).join(',') || '(none)',
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
const noPolicyIndex = buildIndex(entries, config)
check(
  'the index does not advertise a policy that is absent',
  !noPolicyIndex.includes('notebook-policy.md'),
)

// The template is a package resource, not a file every user is assumed to have. If it stops
// shipping, a fresh install silently gets no policy and the index stops naming one.
const shippedTemplate = readFileSync(new URL('./templates/notebook-policy.md', import.meta.url), 'utf8')
check('the bundled policy template ships', shippedTemplate.length > 1000, `${shippedTemplate.length} chars`)
check('the shipped template has an Evidence line', shippedTemplate.includes('Evidence:'))

// ---------------------------------------------------------------------------
console.log('\n[10] safety')
// ---------------------------------------------------------------------------
const readOnlyDir = mkdtempSync(join(tmpdir(), 'mn-ro-'))
writeFileSync(join(readOnlyDir, 'broken.md'), '---\nstatus: candidate\n---\nno heading, no trouble\n', 'utf8')
const broken = scanDir(readOnlyDir)
check('an entry without a heading still loads', broken.length === 1 && broken[0].title === 'broken')

for (const dir of [emptyDir, writeDir, readOnlyDir, writtenDir, seedRoot, driftDir, keepDir]) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dirs; best effort */
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
