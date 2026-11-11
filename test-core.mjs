/**
 * Behavioural tests for the memory notebook core. Runs against the real notebook in this
 * workspace, so a regression in matching shows up as a real recall failure.
 *
 *   node test-core.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACK_PATTERN,
  buildIndex,
  loadNotebook,
  pickHits,
  renderRecall,
  scanDir,
  setStatus,
  tokenize,
  writeEntryFile,
} from './notebook-core.js'

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url))

const config = {
  workspaceDir: '.agents/memory',
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
const entries = loadNotebook(config, WORKSPACE)
check('the notebook is discovered', entries.length >= 10, `found ${entries.length}`)
check(
  'a known entry is present',
  entries.some((entry) => entry.key === 'platformio-esp32-toolchain'),
  entries.map((entry) => entry.key).join(','),
)
check('no entry is INDEX.md', entries.every((entry) => entry.key !== 'index'))
check(
  'order follows INDEX.md',
  entries.length > 1 && entries[0].key === 'github-blocked-context7-direct',
  `first = ${entries[0]?.key}`,
)
check('every entry carries triggers', entries.every((entry) => entry.triggers.length > 0))

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

// ---------------------------------------------------------------------------
console.log('\n[3] recall (English / technical queries)')
// ---------------------------------------------------------------------------
const englishCases = [
  ['why does platformio fail to build under the sandbox', 'platformio-esp32-toolchain'],
  ['curl fails with SEC_E_NO_CREDENTIALS through the proxy', 'https-only-openssl-tls'],
  ['github api times out but ssh works', 'github-blocked-context7-direct'],
  ['the mcp server will not mount, no tools appear', 'mcp-mounting-lifecycle'],
  ['my skill disappeared from the catalog', 'skill-frontmatter-yaml'],
  ['camera capture fails with access denied', 'usb-camera-arrival-facts'],
]
for (const [query, expected] of englishCases) {
  const hits = pickHits(entries, query, config)
  check(`"${query.slice(0, 46)}…" -> ${expected}`, hits.length > 0 && hits[0].entry.key === expected, names(hits))
}

// ---------------------------------------------------------------------------
console.log('\n[4] recall (plain Chinese queries)')
// ---------------------------------------------------------------------------
const chineseCases = [
  ['相机打不开，权限被拒绝', 'usb-camera-arrival-facts'],
  ['烧录固件的时候路径太长了，编译失败', 'platformio-esp32-toolchain'],
  ['mcp 服务器挂不上，工具都不见了', 'mcp-mounting-lifecycle'],
  ['github 连不上，要用代理吗', 'github-blocked-context7-direct'],
  ['技能从目录里消失了', 'skill-frontmatter-yaml'],
  ['写入被拒绝访问，目录权限', 'low-integrity-label-writes'],
]
for (const [query, expected] of chineseCases) {
  const hits = pickHits(entries, query, config)
  check(`"${query}" -> ${expected}`, hits.length > 0 && hits[0].entry.key === expected, names(hits))
}

// ---------------------------------------------------------------------------
console.log('\n[5] rendering holds its budget without losing the evidence')
// ---------------------------------------------------------------------------
const rendered = renderRecall(pickHits(entries, '烧录固件的时候路径太长了，编译失败', config), 1400)
check('rendered recall is bounded', rendered.length <= 1400, `${rendered.length} chars`)
check('a clamped entry keeps its evidence line', rendered.includes('Evidence:'), rendered.slice(-160))
check('recall output is smaller than the entry set', rendered.length < 1400)
check('candidate status is labelled', rendered.includes('(candidate)'), rendered.slice(0, 160))

// ---------------------------------------------------------------------------
console.log('\n[6] trust status and writing')
// ---------------------------------------------------------------------------
const writeDir = mkdtempSync(join(tmpdir(), 'mn-write-'))
const created = writeEntryFile(writeDir, {
  key: 'pwsh-quoting-traps',
  title: 'PowerShell here-strings eat backticks',
  status: 'candidate',
  body: 'A backtick inside `@" "@` is treated as an escape character.',
  evidence: 'unexpected end of string',
})
check('a new entry is created', created === true)
const after = scanDir(writeDir)
check('the new entry is readable', after.length === 1 && after[0].key === 'pwsh-quoting-traps')
check('it defaults to candidate', after[0]?.status === 'candidate')
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

// ---------------------------------------------------------------------------
console.log('\n[7] safety')
// ---------------------------------------------------------------------------
const readOnlyDir = mkdtempSync(join(tmpdir(), 'mn-ro-'))
writeFileSync(join(readOnlyDir, 'broken.md'), '---\nstatus: candidate\n---\nno heading, no trouble\n', 'utf8')
const broken = scanDir(readOnlyDir)
check('an entry without a heading still loads', broken.length === 1 && broken[0].title === 'broken')

for (const dir of [emptyDir, writeDir, readOnlyDir]) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dirs; best effort */
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
