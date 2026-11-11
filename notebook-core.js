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

export function indexHead(where) {
  return (
    '<memory-notebook>\n' +
    `Notes live in \`${where}\`, one file per subject. Each name is a trigger: ` +
    'if a name matches what you are about to do, read it with `memory_read` before acting. ' +
    "Do not guess an entry's content from its name.\n"
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

/** Order entries the way INDEX.md lists them; anything unlisted sinks, newest first. */
export function orderByIndex(entries, dir) {
  const indexPath = join(dir, 'INDEX.md')
  const rank = new Map()
  if (existsSync(indexPath)) {
    let text = ''
    try {
      text = readFileSync(indexPath, 'utf8')
    } catch {
      text = ''
    }
    let i = 0
    for (const line of text.split(/\r?\n/)) {
      const backtick = line.match(/`([^`]+\.md)`/)
      const link = line.match(/\[[^\]]*\]\(([^)]+\.md)\)/)
      const hit = backtick ?? link
      if (hit !== null) rank.set(hit[1].replace(/^\.\//, ''), i++)
    }
  }
  return entries.slice().sort((a, b) => {
    const ra = rank.has(a.file) ? rank.get(a.file) : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.file) ? rank.get(b.file) : Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return b.mtimeMs - a.mtimeMs
  })
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
  const head = indexHead(config.workspaceDir.length > 0 ? config.workspaceDir : config.machineDir)
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

/** Latin words plus CJK bigrams — the cheap standard for mixed text. */
export function tokenize(text) {
  const out = new Set()
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9\u3400-\u9fff]+/)) {
    if (raw.length === 0) continue
    if (CJK_CHAR.test(raw)) {
      if (raw.length <= 2) {
        out.add(raw)
      } else {
        for (let i = 0; i + 1 < raw.length; i++) out.add(raw.slice(i, i + 2))
      }
    } else if (raw.length > 1) {
      out.add(raw)
    }
  }
  return out
}

/**
 * A trigger is a phrase from the author's own vocabulary. It counts only when **every**
 * word of the phrase is present in the query, so a generic word such as "denied" cannot
 * carry the whole phrase "dotnet pipe denied" into an unrelated message. Phrase weight is
 * higher than any single field because a phrase is the most specific signal available.
 * Name 4, title 3, body 1; each query token contributes once, at its strongest match.
 */
export function scoreEntry(entry, queryTokens) {
  const nameTokens = tokenize(entry.key.replace(/-/g, ' '))
  const titleTokens = tokenize(entry.title)
  const bodyTokens = tokenize(entry.body.slice(0, 4000))

  let score = 0
  let hits = 0
  const covered = new Set()

  for (const phrase of entry.triggers ?? []) {
    const phraseTokens = tokenize(phrase)
    if (phraseTokens.size === 0) continue
    let whole = true
    for (const token of phraseTokens) {
      if (!queryTokens.has(token)) {
        whole = false
        break
      }
    }
    if (!whole) continue
    score += phraseTokens.size === 1 ? 5 : 7
    hits += 1
    for (const token of phraseTokens) covered.add(token)
  }

  for (const token of queryTokens) {
    if (STOPWORDS.has(token) || covered.has(token)) continue
    let weight = 0
    if (nameTokens.has(token)) weight = 4
    else if (titleTokens.has(token)) weight = 3
    else if (bodyTokens.has(token)) weight = 1
    if (weight > 0) {
      score += weight
      hits += 1
    }
  }
  return { score, hits }
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

/** Rank entries against one query; returns the selected hits, highest score first. */
export function pickHits(entries, query, config) {
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return []
  const hits = []
  for (const entry of entries) {
    if (entry.status === 'disputed') continue
    const scored = scoreEntry(entry, queryTokens)
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
  const lines = ['---', `status: ${fields.status}`, `updated: ${today}`]
  const triggers = String(fields.triggers ?? '').trim()
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
  const rebuilt = ['---', `status: ${status}`]
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'status') continue
    rebuilt.push(`${k}: ${v}`)
  }
  rebuilt.push('---', '')
  writeFileSync(path, rebuilt.join('\n') + body.replace(/^\r?\n/, ''), 'utf8')
  return status
}
