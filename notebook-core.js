/**
 * Pure notebook logic for dsh-memory: filesystem scanning, index rendering and
 * message-to-entry matching. No harness imports live here, so this module is directly
 * testable and the plugin entry stays thin.
 */
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const INDEX_TAIL = '\n</memory>'

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
    '<memory>\n' +
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
      // Carried onto the entry, not left in `meta`, because the index reads it. Until this existed the
      // index fell back to the heading for every entry and the `summary:` field did nothing at all —
      // silently, since a fallback that always succeeds looks like success.
      summary: typeof meta.summary === 'string' ? meta.summary.trim() : '',
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
    // Only list items count. Prose above the list may name a file in backticks — the index header
    // does exactly that for the policy — and counting it duplicated that entry in the order.
    if (!/^\s*[-*]\s/.test(line)) continue
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

/**
 * How the index names the entries it could not fit. The count is the load-bearing part: a model that
 * cannot see that something was omitted has no reason to look further, and an entry it never sees may
 * as well not exist. Returning a bare ellipsis, as this did, hid both the size of the gap and the way
 * to close it.
 */
function overflowLine(hidden) {
  return `- … and ${hidden} more, all listed by \`memory_list\`\n`
}

/**
 * The injected index, and the count of what it left out.
 *
 * `indexBudgetChars` caps what is **resident**, not what the notebook can hold. Every entry stays
 * reachable: recall matches against all of them, and `memory_list` names them. So the budget is a
 * token decision, and the capacity is unbounded — which is the point of separating them, because a
 * single cap cannot serve both.
 *
 * Entries are taken in notebook order, which is "most likely first" as the user arranged it, with
 * newly written entries placed at the top by `syncIndexFile`.
 */
/**
 * One index line: the filename `memory_read` needs, then a summary short enough to scan.
 *
 * A name alone was not enough. Asked about commit steps, the model read `github-repo-operations` —
 * reasonable, since the name says "GitHub" and the question was about GitHub — and found an entry
 * about the contributors sidebar cache. Nothing in the name could have said otherwise. A summary can.
 *
 * The summary comes from `summary:` frontmatter when the author wrote one, otherwise from the entry's
 * own heading, which the policy already requires to be usable on its own. There is no third source: a
 * hand-written field nobody fills in would leave most lines as bare filenames again.
 */
function indexLine(entry, summaryChars) {
  // Zero means filenames only. Without this the clipping below would run with a budget of 0 and
  // `slice(0, -1)` would drop one character instead of all of them.
  if (!(summaryChars > 0)) return `- ${entry.file}\n`
  const source = String(entry.summary || entry.title || '').replace(/\s+/g, ' ').trim()
  // A trailing date is provenance, not content — it costs characters in every session and tells the
  // model nothing about whether to read.
  const summary = source.replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim()
  if (summary.length === 0) return `- ${entry.file}\n`
  // Clip on a word boundary. Cutting mid-word ("request.agentO…") makes every line look broken and
  // costs a character to the ellipsis for nothing; falling back to a hard cut handles a single word
  // longer than the budget.
  const clipped =
    summary.length > summaryChars
      ? `${(summary.slice(0, summaryChars - 1).replace(/\s+\S*$/, '') || summary.slice(0, summaryChars - 1)).trimEnd()}…`
      : summary
  return `- ${entry.file} — ${clipped}\n`
}

export function buildIndexDetail(entries, config) {
  const visible = entries.filter((entry) => entry.status !== 'disputed')
  if (visible.length === 0) return { text: '', shown: 0, hidden: 0 }

  const where = config.workspaceDir.length > 0 ? config.workspaceDir : config.machineDir
  const hasPolicy = visible.some((entry) => entry.key === 'notebook-policy')
  const head = indexHead(where, hasPolicy)

  const summaryChars = Number.isInteger(config.indexSummaryChars) ? config.indexSummaryChars : 0
  const chosen = []
  let used = head.length + INDEX_TAIL.length
  for (const entry of visible) {
    const line = indexLine(entry, summaryChars)
    if (used + line.length > config.indexBudgetChars) break
    chosen.push({ line })
    used += line.length
  }

  // One name is worth more than none. With a budget near or below the header's own length the index
  // would otherwise list no entries at all — telling the model a notebook exists without telling it
  // anything that is in it. Overshooting by one line is the better failure.
  let hidden = visible.length - chosen.length
  if (chosen.length === 0) {
    chosen.push({ line: `- ${visible[0].file}\n` })
    used += visible[0].file.length + 3
    hidden = visible.length - 1
  }

  // The overflow line costs characters too, so it may have to displace the last entry to fit. Without
  // this the index could exceed its budget by exactly the length of the notice.
  while (hidden > 0 && chosen.length > 1 && used + overflowLine(hidden).length > config.indexBudgetChars) {
    used -= chosen.pop().line.length
    hidden += 1
  }

  const overflow = hidden > 0 ? overflowLine(hidden) : ''
  return { text: head + chosen.map((c) => c.line).join('') + overflow + INDEX_TAIL, shown: chosen.length, hidden }
}

/** The injected index as text. Empty for an empty notebook. */
export function buildIndex(entries, config) {
  return buildIndexDetail(entries, config).text
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
/**
 * How many entries claim each token as a strong signal — filename, title, or trigger.
 *
 * A word only one entry claims identifies that entry, exactly as a filename does, and earns the
 * second hit. A word three entries claim does not. This is deliberately not IDF: the question is
 * whether a term *distinguishes*, not how rare it is, and the answer converges on "no" by itself as
 * a notebook grows, so no weight needs maintaining.
 */
export function strongSignalRarity(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const tokens = new Set()
    for (const token of tokenize(entry.key.replace(/-/g, ' '))) tokens.add(token)
    for (const token of tokenize(entry.title ?? '')) tokens.add(token)
    for (const phrase of entry.triggers ?? []) for (const token of tokenize(phrase)) tokens.add(token)
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

export function scoreEntry(entry, queryTokens, rarity) {
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
      // A word only this entry claims identifies it just as a filename does, so it also earns the
      // second hit. Without this, "需要设置 proxy 吗" matched `proxy` — its only signal, and one that
      // points at exactly one entry — and stopped one hit short of the floor.
      const unique = rarity !== undefined && rarity.get(token) === 1
      score += 5
      hits += identifies || chineseWord || unique ? 2 : 1
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
  const rarity = strongSignalRarity(entries)
  const hits = []
  for (const entry of entries) {
    if (entry.status === 'disputed') continue
    const scored = scoreEntry(entry, queryTokens, rarity)
    if (!scored.strong) continue
    if (scored.hits < config.minRecallHits) continue
    if (scored.score < config.minRecallScore) continue
    hits.push({ entry, score: scored.score, hits: scored.hits })
  }
  // More matched evidence wins a tie. Two entries can reach the same score by different routes —
  // a query about a camera failure scored the camera entry and the sandbox-pipe entry equally,
  // because "access denied" appears in both; the camera entry matched six terms to its four, and
  // recency was deciding which one the model saw.
  hits.sort((a, b) => b.score - a.score || b.hits - a.hits || b.entry.mtimeMs - a.entry.mtimeMs)
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

/** Seed the policy into a notebook that exists but carries none.
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
  syncIndexFile(dir)
  return true
}

const INDEX_PREAMBLE =
  '# Memory index\n\n' +
  'Most likely first. The filename is the trigger.\n\n' +
  'This list is maintained by the plugin. Entries are added and removed automatically; ' +
  'reorder the lines freely, that order is kept.\n\n'

/**
 * Rewrite `INDEX.md` so it matches the directory exactly, keeping the order the file already had.
 *
 * The index is derived data, not a hand-maintained document: a line for a file that no longer
 * exists makes it lie, and a file with no line is invisible — the injected index never names it.
 * Both have happened in this notebook. The plugin owns the lines; the human owns the order, because
 * "most likely first" is a judgement no script can make.
 *
 * Only writes when the result differs, so a read-mostly turn never touches the filesystem.
 */
export function syncIndexFile(dir, entries = scanDir(dir)) {
  const indexPath = join(dir, 'INDEX.md')
  if (!existsSync(dir)) return false
  const onDisk = new Set(entries.map((entry) => entry.file))
  const listed = [...new Set(readIndexFiles(dir))].filter((file) => onDisk.has(file))
  const listedSet = new Set(listed)
  const added = entries
    .filter((entry) => !listedSet.has(entry.file))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.file)
  // New entries go to the top, not the bottom. Residency in the injected index is finite, and what
  // was just learned is the most likely thing to be needed next — appending put it last, so a notebook
  // at its budget would hide a fact the moment it was written. Existing order is never reshuffled, so
  // a hand-arranged "most likely first" survives.
  const wanted = [...added, ...listed]
  if (wanted.length === 0) return false

  const text = INDEX_PREAMBLE + wanted.map((file) => `- \`${file}\`\n`).join('')
  let current = ''
  try {
    current = readFileSync(indexPath, 'utf8')
  } catch {
    current = ''
  }
  // Compare only the ordered filenames: a comment or a heading change is the human's business.
  if (readIndexFiles(dir).join('\n') === wanted.join('\n') && current.length > 0) return false
  writeFileSync(indexPath, text, 'utf8')
  return true
}

/**
 * Where a newly written entry lands: on the resident index, or past the cut.
 *
 * The budget no longer refuses a write, because it no longer protects anything. A write always lands
 * on disk; recall matches every entry; `memory_list` names them all. Refusing only pushed the model
 * toward not recording something worth keeping, which is the worse failure — a fact never written is
 * gone, while a fact past the cut is one `memory_list` away.
 *
 * What is worth reporting is the cost: how many entries became non-resident because this one took a
 * line. The new entry itself goes to the top, so it is resident whenever anything is.
 */
export function indexResidency(entries, config, newEntry) {
  const detail = buildIndexDetail([{ ...newEntry, mtimeMs: Date.now() }, ...entries], config)
  return { resident: detail.shown > 0, shown: detail.shown, hidden: detail.hidden }
}

// ---------------------------------------------------------------------------
// diagnosis
// ---------------------------------------------------------------------------

/**
 * Report what is wrong with a notebook, distinguishing "broken" from "empty".
 *
 * The failure this exists to prevent is the quiet one: memory stops working, nothing says so, and the
 * user concludes the feature is useless rather than broken. That happens most easily when a working
 * notebook returns no hits — which is indistinguishable from a notebook that cannot be read at all,
 * unless something checks the capability separately from the result.
 *
 * Every check here is about capability: can it read, can it write, will entries disappear. None is
 * about whether recall *should* have fired.
 */
export function diagnoseNotebook(config, cwd) {
  const problems = []
  const dirs = resolveDirs(config, cwd)

  // Flat, and every field always present. A tool output schema has to describe exactly what is
  // returned, and a nested nullable object needs a union type the host may not accept — this shape
  // needs nothing but strings, numbers, booleans and arrays of strings.
  const shape = (status, dir, entries) => ({
    status,
    dir,
    entries,
    indexAgrees: false,
    indexChars: 0,
    indexBudget: config.indexBudgetChars,
    indexResident: 0,
    indexOverflow: 0,
    disputed: 0,
    withoutTriggers: [],
    withoutEvidence: [],
    policy: false,
    problems: [],
  })

  if (dirs.length === 0) {
    const report = shape('unconfigured', '', 0)
    report.problems = ['no memory directory is configured: set workspaceDir or machineDir']
    return report
  }

  const dir = dirs[0]
  if (!existsSync(dir)) {
    // Not an error. A plugin that has never been written to has no directory, and creating one in
    // every project the agent opens would be worse than an empty notebook.
    return shape('absent', dir, 0)
  }

  let entries
  try {
    entries = scanDir(dir)
  } catch (error) {
    const report = shape('broken', dir, 0)
    report.problems = [`cannot read the notebook: ${error.message}`]
    return report
  }

  let writable = true
  try {
    accessSync(dir, constants.W_OK)
  } catch {
    writable = false
    problems.push('the notebook is not writable: memories written this session will not persist')
  }

  const visible = entries.filter((entry) => entry.status !== 'disputed')
  const drift = indexDrift(dir)
  if (drift.unlisted.length > 0) {
    problems.push(`${drift.unlisted.length} file(s) are not in INDEX.md, so the injected index cannot name them`)
  }
  if (drift.missing.length > 0) {
    problems.push(`${drift.missing.length} line(s) in INDEX.md name files that no longer exist`)
  }

  const detail = buildIndexDetail(entries, config)
  const chars = detail.text.length
  const budget = config.indexBudgetChars
  if (detail.hidden > 0) {
    // Degraded, not broken: recall still matches every entry and `memory_list` names them all. But the
    // model cannot see them, so it will not read them on its own — which is worth saying out loud.
    problems.push(
      `${detail.hidden} entry(ies) are past the index budget: recall still matches them and memory_list names them, ` +
        `but the model cannot see them unprompted`,
    )
  }

  const withoutTriggers = entries.filter((entry) => entry.status !== 'disputed' && (entry.triggers ?? []).length === 0)
  if (withoutTriggers.length > 0) {
    // Not fatal — the title and name still match — but the entry is far harder to reach.
    problems.push(`${withoutTriggers.length} entry(ies) carry no triggers and can only be reached by name or title`)
  }

  const withoutEvidence = entries.filter((entry) => entry.status !== 'disputed' && !/Evidence:/.test(entry.body))
  if (withoutEvidence.length > 0) {
    problems.push(`${withoutEvidence.length} entry(ies) carry no Evidence line, so their claims cannot be re-checked`)
  }

  const policy = entries.some((entry) => entry.key === 'notebook-policy')
  if (!policy) problems.push('no notebook-policy entry: the rules for this notebook are missing')

  // The budget is no longer part of this: it caps what is resident, and overflow is a `degraded`
  // problem recorded above rather than a broken notebook.
  const status =
    writable && drift.unlisted.length === 0 && drift.missing.length === 0
      ? problems.length === 0
        ? 'ok'
        : 'degraded'
      : 'broken'

  return {
    status,
    dir,
    entries: entries.length,
    indexAgrees: drift.unlisted.length === 0 && drift.missing.length === 0,
    indexChars: chars,
    indexBudget: budget,
    indexResident: detail.shown,
    indexOverflow: detail.hidden,
    disputed: entries.length - visible.length,
    withoutTriggers: withoutTriggers.map((entry) => entry.key),
    withoutEvidence: withoutEvidence.map((entry) => entry.key),
    policy,
    problems,
  }
}

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

/** Append-only file beside the entries. `.jsonl` so the entry scan never mistakes it for an entry. */
export const USAGE_FILE = 'usage.jsonl'

/**
 * Record that an entry was published by recall.
 *
 * What is written is a date and an entry name, and nothing else — no query text, no session id, no
 * path. That is enough to answer the only question worth asking of this data ("which entries have
 * never been used") without turning the notebook's neighbour into a transcript of the user's work.
 *
 * Failure is swallowed: telemetry is never worth breaking a recall over.
 */
export function recordUsage(dir, entryKey) {
  try {
    appendFileSync(join(dir, USAGE_FILE), `${JSON.stringify({ d: new Date().toISOString().slice(0, 10), e: entryKey })}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** Read the usage log, tolerating a truncated or hand-edited line. */
export function readUsage(dir) {
  const path = join(dir, USAGE_FILE)
  if (!existsSync(path)) return []
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue
    try {
      const row = JSON.parse(line)
      if (typeof row?.e === 'string') rows.push({ day: String(row.d ?? ''), entry: row.e })
    } catch {
      // A half-written last line is the expected damage; skip it rather than losing the file.
    }
  }
  return rows
}

/**
 * Which entries have never been recalled, and how often the rest have.
 *
 * "Never recalled" is the finding worth having: an entry that has been injected a hundred times and
 * opened once is doing nothing, and nothing else in the plugin notices. Counted per entry rather
 * than in aggregate, because a total hides the one entry nobody uses.
 */
export function usageReport(entries, usage) {
  const counts = new Map()
  const lastDay = new Map()
  for (const row of usage) {
    counts.set(row.entry, (counts.get(row.entry) ?? 0) + 1)
    if (row.day > (lastDay.get(row.entry) ?? '')) lastDay.set(row.entry, row.day)
  }
  const live = entries.filter((entry) => entry.status !== 'disputed')
  return {
    recorded: usage.length,
    never: live.filter((entry) => !counts.has(entry.key)).map((entry) => entry.key),
    used: live
      .filter((entry) => counts.has(entry.key))
      .map((entry) => ({ key: entry.key, recalls: counts.get(entry.key), last: lastDay.get(entry.key) ?? '' }))
      .sort((a, b) => b.recalls - a.recalls),
  }
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
  // The index is derived from the directory, so it is rebuilt rather than appended to. Appending
  // was how a line for a deleted file survived and a renamed one was listed twice.
  syncIndexFile(dir)
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
  // A disputed entry stays in `INDEX.md` — the file exists — but is filtered out of the injected
  // index, so the two views must be rebuilt from the same scan to stay honest.
  syncIndexFile(dir)
  return status
}
