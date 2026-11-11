/**
 * Pure notebook logic for dsh-memory-notebook: filesystem scanning, index rendering and
 * message-to-entry matching. No harness imports live here, so this module is directly
 * testable and the plugin entry stays thin.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const INDEX_TAIL = '\n</memory-notebook>'

export const RECALL_HEAD =
  '<memory-recall>\n' +
  'Recalled from the memory notebook because this message matched. These are things ' +
  'learned the hard way once — check them before repeating the mistake:\n'
export const RECALL_TAIL = '\n</memory-recall>'

export const ACK_PATTERN =
  /^(?:好|好的|行|可以|嗯|恩|是|对|收到|明白|继续|谢谢|多谢|ok|okay|sure|yes|yep|thanks|continue|go on)\s*[。.!！~～]?$/i

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'and',
  'or', 'for', 'in', 'on', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'with',
  'as', 'by', 'from', 'we', 'you', 'i', 'do', 'does', 'did', 'can', 'could', 'should',
  'would', 'will', 'shall', 'not', 'no', 'but', 'if', 'then', 'than', 'so', 'my', 'me',
  'your', 'our', 'there', 'here', 'what', 'which', 'who', 'how', 'why', 'when', 'all',
  'any', 'some', 'just', 'have', 'has', 'had', 'get', 'got', 'let', 'make', 'use', 'used',
  'using', 'about', 'into', 'out', 'up', 'down', 'over', 'again', 'also', 'very', 'too',
])

const CJK_CHAR = /[\u3400-\u9fff]/

export function indexHead(where, hasPolicy = false) {
  const policy = hasPolicy ? " `notebook-policy.md` holds this notebook's own rules." : ''
  return (
    '<memory-notebook>\n' +
    `Notes live in \`${where}\`, one file per subject. Each name is a trigger: ` +
    'if a name matches what you are about to do, read it with `memory_read` before acting. ' +
    "Do not guess an entry's content from its name." +
    policy +
    '\n'
  )
}

// ---------------------------------------------------------------------------
// filesystem
// ---------------------------------------------------------------------------

export function expandHome(p) {
  if (!p) return ''
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function resolveDirs(config, cwd) {
  const dirs = []
  if (config.workspaceDir && cwd) dirs.push(resolve(cwd, config.workspaceDir))
  const machine = expandHome(config.machineDir)
  if (machine) dirs.push(machine)
  return dirs
}

export function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m === null) return { meta: {}, body: raw }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    if (kv !== null) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return { meta, body: raw.slice(m[0].length) }
}

export function normalizeStatus(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'verified') return 'verified'
  if (v === 'disputed' || v === 'deprecated' || v === 'superseded') return 'disputed'
  return 'candidate'
}

/** Read every entry in one directory. A missing directory is not an error. */
export function scanDir(dir) {
  if (!existsSync(dir)) return []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const file of names) {
    if (!file.toLowerCase().endsWith('.md') || file.toLowerCase() === 'index.md') continue
    const path = join(dir, file)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const { meta, body } = splitFrontmatter(raw)
    const heading = body.split(/\r?\n/).find((line) => line.startsWith('# '))
    const key = file.slice(0, -3)
    out.push({
      dir,
      file,
      key,
      title: heading !== undefined ? heading.slice(2).trim() : key,
      status: normalizeStatus(meta.status),
      // Optional `triggers:` line in the frontmatter carries synonyms, including
      // Chinese words for an English body — the author's own recall vocabulary.
      triggers: String(meta.triggers ?? '')
        .split(/[,;，、]/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0),
      body,
      mtimeMs: stat.mtimeMs,
    })
  }
  return out
}

/** Filenames named by INDEX.md, in order. Tolerates both `backticks` and [links](file.md). */
export function readIndexFiles(dir) {
  const indexPath = join(dir, 'INDEX.md')
  if (!existsSync(indexPath)) return []
  let text = ''
  try {
    text = readFileSync(indexPath, 'utf8')
  } catch {
    return []
  }
  const files = []
  for (const line of text.split(/\r?\n/)) {
    const hit = line.match(/`([^`]+\.md)`/) ?? line.match(/\[[^\]]*\]\(([^)]+\.md)\)/)
    if (hit !== null) files.push(hit[1].replace(/^\.\//, ''))
  }
  return files
}

/** Order entries the way INDEX.md lists them; anything unlisted sinks, newest first. */
export function orderByIndex(entries, dir) {
  const rank = new Map()
  for (const [position, file] of readIndexFiles(dir).entries()) rank.set(file, position)
  return entries.slice().sort((a, b) => {
    const ra = rank.has(a.file) ? rank.get(a.file) : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.file) ? rank.get(b.file) : Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return b.mtimeMs - a.mtimeMs
  })
}

/**
 * The two-way check between INDEX.md and the directory, which the policy asks for after every
 * add or retire. It is the failure this notebook keeps producing: a file nobody listed is
 * invisible from outside, and a listed file that is gone makes the index lie.
 */
export function indexDrift(dir, entries = scanDir(dir)) {
  const onDisk = new Set(entries.map((entry) => entry.file))
  const listed = [...new Set(readIndexFiles(dir))]
  return {
    listed,
    unlisted: [...onDisk].filter((file) => !listed.includes(file)).sort(),
    missing: listed.filter((file) => !onDisk.has(file)).sort(),
  }
}

/** Every entry across the configured tiers, workspace first, one name per key. */
export function loadNotebook(config, cwd) {
  const entries = []
  const seen = new Set()
  for (const dir of resolveDirs(config, cwd)) {
    for (const entry of orderByIndex(scanDir(dir), dir)) {
      if (seen.has(entry.key)) continue
      seen.add(entry.key)
      entries.push(entry)
    }
  }
  return entries
}

/** The injected index: bare filenames only, capped, empty string for an empty notebook. */
export function buildIndex(entries, config) {
  const visible = entries.filter((entry) => entry.status !== 'disputed')
  if (visible.length === 0) return ''
  const hasPolicy = visible.some((entry) => entry.key === 'notebook-policy')
  const head = indexHead(
    config.workspaceDir.length > 0 ? config.workspaceDir : config.machineDir,
    hasPolicy,
  )
  const lines = []
  let used = head.length + INDEX_TAIL.length
  for (const entry of visible) {
    const line = `- ${entry.file}\n`
    if (used + line.length > config.indexBudgetChars) {
      lines.push('- …\n')
      break
    }
    lines.push(line)
    used += line.length
  }
  return head + lines.join('') + INDEX_TAIL
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

/**
 * Latin words plus CJK bigrams — the standard cheap approach for mixed text.
 *
 * The two scripts are extracted separately rather than split on punctuation, because a CJK run
 * adjacent to a Latin run has no separator: splitting on non-word characters left `mcp挂了` as one
 * token, which was then treated as CJK and shredded into bigrams (`mc`, `cp`, `p挂`, `挂了`) — the
 * word `mcp` disappeared entirely. Mixed script without spaces is the normal way a Chinese user
 * types, so `platformio编译` has to yield `platformio` and `编译`.
 */
export function tokenize(text) {
  const out = new Set()
  for (const run of String(text).toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? []) {
    if (CJK_CHAR.test(run)) {
      if (run.length <= 2) {
        out.add(run)
      } else {
        for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2))
      }
    } else if (run.length > 1) {
      out.add(run)
    }
  }
  return out
}

/**
 * A query word matches a field word exactly, or by a shared prefix once both sides reach five
 * characters (`configure` ~ `configuration`, `install` ~ `installation`). The five-character floor
 * keeps short words from matching everything that starts with them: `env` does not match
 * `environment`, which is why `env` has to be written as a trigger.
 */
function tokenMatches(tokens, token) {
  if (tokens.has(token)) return true
  if (token.length < 5) return false
  for (const candidate of tokens) {
    if (candidate.length >= 5 && (candidate.startsWith(token) || token.startsWith(candidate))) {
      return true
    }
  }
  return false
}

/**
 * A phrase that is a Chinese word of two or more characters is a complete word, not a fragment.
 *
 * Bigrams make this uneven: a two-character word is one bigram and so counts one hit, while a
 * three-character word is two bigrams and counts two — `贡献者` recalled alone but `相机` did not,
 * though both are equally specific. A Chinese word also can never become an identifier, because
 * filenames are kebab-case ASCII, so it can never earn the identifier's second hit.
 *
 * The fix grants the second hit to any trigger that is wholly Chinese and at least two characters,
 * which is what makes `相机那次` and `证书的问题` recall. A single Chinese character is excluded on
 * purpose — those are exactly the fragments bigrams produce from ordinary sentences.
 */
function isWholeChineseWord(phrase) {
  const text = String(phrase).trim()
  if (text.length < 2) return false
  return /^[\u3400-\u9fff]+$/.test(text)
}

/**
 * A trigger is a phrase from the author's own vocabulary. It counts only when **every** word of
 * the phrase is present in the query, so a generic word such as "denied" cannot carry the whole
 * phrase "dotnet pipe denied" into an unrelated message.
 *
 * Three sources of evidence, and the hit count is what separates a real match from a mention:
 *  - a whole multi-word phrase counts one hit per word, so `mcp 挂了` clears the two-hit floor;
 *  - a single-word trigger that is **also part of the entry's name** counts two, because a word
 *    that names the entry and triggers it is that entry's identifier (`tls`, `mcp`, `platformio`);
 *  - a trigger that is a whole Chinese word of two or more characters counts two, because bigram
 *    splitting gives a two-character word only one token while a three-character word gets two.
 *
 * The cap matters: `tls` appears in the trigger, the name, the title and the body. Counting all
 * four would let one common word clear any floor.
 */
export function scoreEntry(entry, queryTokens) {
  const nameTokens = tokenize(entry.key.replace(/-/g, ' '))
  const titleTokens = tokenize(entry.title)
  const bodyTokens = tokenize(entry.body.slice(0, 4000))

  let score = 0
  let hits = 0
  let strong = false
  const covered = new Set()

  for (const phrase of entry.triggers ?? []) {
    const phraseTokens = tokenize(phrase)
    if (phraseTokens.size === 0) continue
    let whole = true
    for (const token of phraseTokens) {
      // Phrase words must be present outright; prefix tolerance here would let a phrase drift.
      if (!queryTokens.has(token)) {
        whole = false
        break
      }
    }
    if (!whole) continue
    strong = true
    if (phraseTokens.size === 1) {
      const [token] = phraseTokens
      const identifies = tokenMatches(nameTokens, token)
      const chineseWord = isWholeChineseWord(phrase)
      score += 5
      hits += identifies || chineseWord ? 2 : 1
    } else {
      score += 7
      hits += phraseTokens.size
    }
    for (const token of phraseTokens) covered.add(token)
  }

  for (const token of queryTokens) {
    if (STOPWORDS.has(token) || covered.has(token)) continue
    if (tokenMatches(nameTokens, token)) {
      score += 4
      hits += 1
      strong = true
    } else if (tokenMatches(titleTokens, token)) {
      score += 3
      hits += 1
      strong = true
    } else if (bodyTokens.has(token)) {
      // Body matching stays exact: it is the largest set, and prefix scanning it would cost more
      // than the recall it buys.
      score += 1
      hits += 1
    }
  }
  return { score, hits, strong }
}

export function textOfMessage(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') text += block.text + ' '
  }
  return text
}

export function extractQuery(messages) {
  const tail = messages.slice(-3)
  return tail.map(textOfMessage).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200)
}

/**
 * Rank entries against one query; returns the selected hits, highest score first.
 *
 * A hit needs a **strong** match — a trigger, the filename, or the title — not just body words.
 * Body text is the largest set and the weakest evidence, and it accumulates: a long entry that
 * happens to quote a sentence collected six body hits from that sentence alone and recalled on
 * nothing but coincidence. An entry's subject is what its name, title and triggers say it is; the
 * body explains, it does not identify.
 */
export function pickHits(entries, query, config) {
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return []
  const hits = []
  for (const entry of entries) {
    if (entry.status === 'disputed') continue
    const scored = scoreEntry(entry, queryTokens)
    if (!scored.strong) continue
    if (scored.hits < config.minRecallHits) continue
    if (scored.score < config.minRecallScore) continue
    hits.push({ entry, score: scored.score })
  }
  hits.sort((a, b) => b.score - a.score || b.entry.mtimeMs - a.entry.mtimeMs)
  return hits.slice(0, Math.max(1, Math.floor(config.maxRecall)))
}

/**
 * Clamp an entry body to a character budget without destroying its value: keep the
 * opening conclusion and, when present, the trailing `Evidence:` line — dropping the
 * evidence would make a recalled entry look like an unverifiable claim.
 */
function clampBody(body, room) {
  if (body.length <= room) return body
  if (room <= 80) return body.slice(0, Math.max(0, room - 2)).trimEnd() + '\n…'
  const evidence = body.match(/\nEvidence:[\s\S]{0,300}$/)
  const keepTail = evidence === null ? '' : evidence[0]
  const headRoom = Math.max(0, room - keepTail.length - 3)
  return body.slice(0, headRoom).trimEnd() + '\n…' + keepTail
}

export function renderRecall(hits, budget) {
  const parts = []
  let used = RECALL_HEAD.length + RECALL_TAIL.length
  for (const hit of hits) {
    const label = hit.entry.status === 'verified' ? '' : ` (${hit.entry.status})`
    const header = `\n## ${hit.entry.key}.md${label}\n`
    const room = budget - used - header.length
    if (room <= 80) break
    const body = clampBody(hit.entry.body.trim(), room)
    parts.push(header + body)
    used += header.length + body.length
  }
  if (parts.length === 0) return ''
  return RECALL_HEAD + parts.join('') + RECALL_TAIL
}

// ---------------------------------------------------------------------------
// hygiene
// ---------------------------------------------------------------------------

/**
 * Audit entries for the two things a script can check without executing arbitrary notebook
 * commands: whether a claim carries evidence at all, and whether the entry has been touched
 * recently. Age is the honest proxy for "the command in Evidence may no longer hold" —
 * running whatever a markdown file says is not a safe default, so the signal is staleness plus
 * a human re-check, not automatic re-execution.
 */
export function auditEntries(entries, options = {}) {
  const staleDays = options.staleDays ?? 90
  const now = options.now ?? Date.now()
  const staleMs = staleDays * 86_400_000
  const missingEvidence = []
  const stale = []
  for (const entry of entries) {
    if (!/Evidence:/.test(entry.body)) missingEvidence.push(entry)
    if (now - entry.mtimeMs > staleMs) stale.push(entry)
  }
  return { total: entries.length, missingEvidence, stale, staleDays }
}

// ---------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------

/**
 * Seed the policy into a notebook that exists but carries none.
 *
 * The policy ships with the plugin as `templates/notebook-policy.md`, not as a file every user is
 * expected to have. Seeding is exclusive-create: an existing entry is never overwritten, because a
 * policy the user edited is theirs and an upgrade must not silently replace it.
 *
 * A directory that does not exist is left alone — installing a memory plugin should not create
 * `.agents/memory/` in every project the agent opens.
 */
export function ensurePolicyEntry(dir, template) {
  if (typeof template !== 'string' || template.length === 0) return false
  if (!existsSync(dir)) return false
  const path = join(dir, 'notebook-policy.md')
  if (existsSync(path)) return false
  writeFileSync(path, template, 'utf8')
  ensureIndexed(dir, 'notebook-policy.md')
  return true
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

export function normalizeKey(raw) {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (key.length === 0) throw new Error('a memory name must contain at least one letter or digit')
  if (key === 'index') throw new Error('"index" is reserved for INDEX.md')
  if (key.length > 80) throw new Error('a memory name must be 80 characters or fewer')
  return key
}

export function ensureIndexed(dir, file) {
  const indexPath = join(dir, 'INDEX.md')
  let text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  if (text.includes(`\`${file}\``)) return
  if (text.trim().length === 0) {
    text = '# Memory index\n\nMost likely first. The filename is the trigger.\n\n'
  }
  if (!text.endsWith('\n')) text += '\n'
  text += `- \`${file}\`\n`
  writeFileSync(indexPath, text, 'utf8')
}

export function writeEntryFile(dir, fields) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, fields.key + '.md')
  const created = !existsSync(path)
  const today = new Date().toISOString().slice(0, 10)

  // Keep the existing triggers when the caller does not supply new ones. An update that omits them
  // would otherwise silently erase the entry's recall vocabulary — the entry stays, but stops being
  // findable, and nothing reports it.
  let triggers = String(fields.triggers ?? '').trim()
  if (!created && triggers.length === 0) {
    const { meta } = splitFrontmatter(readFileSync(path, 'utf8'))
    triggers = String(meta.triggers ?? '').trim()
  }

  const lines = ['---', `status: ${fields.status}`, `updated: ${today}`]
  if (triggers.length > 0) lines.push(`triggers: ${triggers}`)
  lines.push('---', '')
  lines.push(`# ${fields.title}`, '')
  if (fields.body.trim().length > 0) lines.push(fields.body.trim(), '')
  lines.push(`Evidence: \`${fields.evidence}\``, '')
  writeFileSync(path, lines.join('\n'), 'utf8')
  ensureIndexed(dir, fields.key + '.md')
  return created
}

export function setStatus(dir, key, status) {
  const path = join(dir, key + '.md')
  if (!existsSync(path)) throw new Error(`no memory named "${key}"`)
  const raw = readFileSync(path, 'utf8')
  const { meta, body } = splitFrontmatter(raw)
  meta.status = status
  // Reviewing an entry is the moment its evidence was last confirmed, so the timestamp moves.
  // Age is what the audit reports on; a status change that did not move it would mask staleness.
  meta.updated = new Date().toISOString().slice(0, 10)
  const rebuilt = ['---', `status: ${status}`]
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'status') continue
    rebuilt.push(`${k}: ${v}`)
  }
  rebuilt.push('---', '')
  writeFileSync(path, rebuilt.join('\n') + body.replace(/^\r?\n/, ''), 'utf8')
  return status
}
