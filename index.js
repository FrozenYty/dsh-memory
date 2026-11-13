/**
 * dsh-memory — low-token persistent memory for DeepSeek Harness.
 *
 * The notebook is a directory of markdown files, one per subject, with an optional
 * INDEX.md fixing their order. This plugin never owns the content. It only:
 *   1. puts the bare file list into the system prompt, so the model knows the names;
 *   2. when a user message actually matches an entry, publishes that one entry through
 *      the dynamic runtime-context channel for that turn.
 * The index carries no descriptions, so it never degrades into truncated prose; recall
 * quality comes from matching. An empty notebook costs zero bytes.
 *
 * WHY THIS FILE IMPORTS NO dsh PACKAGE
 * A profile-installed bundle is linked from its workspace directory, so a bare import
 * such as `@deepseek-ai/dsh-llm` resolves from the bundle path and fails with
 * ERR_MODULE_NOT_FOUND (the profile sets `autoInstallPeers: false` and `nodeLinker:
 * hoisted`). Tool definitions are therefore plain canonical JSON Schema objects — the
 * exact `ToolDefinition` shape the registry consumes — and memory injection goes through
 * `ctx.systemPrompt.section` / `ctx.systemPrompt.context`, which need no import.
 *
 * Harness rules followed (plugin-development practices): no custom session events (state
 * lives in files and in memory), prompt text only through `systemPrompt`, and the plugin
 * is inert in profiles without the services it injects.
 */
import { readFileSync } from 'node:fs'
import {
  auditEntries,
  buildIndex,
  diagnoseNotebook,
  ensurePolicyEntry,
  indexDrift,
  indexResidency,
  loadNotebook,
  normalizeKey,
  pickHits,
  readUsage,
  recordUsage,
  renderRecall,
  resolveDirs,
  setStatus,
  syncIndexFile,
  usageReport,
  writeEntryFile,
} from './notebook-core.js'

export const name = 'memory'

/** `systemPrompt` and `tools` are required; `tokenMeter` is optional and used only for the hint. */
export const inject = ['systemPrompt', 'tools']

const SECTION_NAME = 'memory:index'
const SECTION_ORDER = 4100
const CONTEXT_NAME = 'memory:recall'
const CONTEXT_ORDER = 4101
const HINT_NAME = 'memory:capture-hint'
const HINT_ORDER = 4102

// How much evidence is stored. This was 300, which is less than a command plus its result needs — so the
// one field whose entire job is to prove a claim was the one being cut, silently, and two entries in the
// author's own notebook ended mid-word before anyone noticed. 1000 fits a command and its output; a
// longer one is truncated and *reported*, because an evidence line that has lost its conclusion still
// reads as complete.
const EVIDENCE_LIMIT = 1000

// The other two fields with a cap. Both are silent slices today, and both lose the end: a long title is
// a style problem, but a long body loses whatever was written last — usually the fix.
const TITLE_LIMIT = 120
const BODY_LIMIT = 4000

const CAPTURE_HINT =
  '<memory-capture-hint>\n' +
  'This conversation is close to being compacted, and a summary will not keep everything. ' +
  'If this session produced something that was hard to work out and would be needed again — ' +
  'a trap, a correction, a mechanism that only became clear after a failure — write it to the ' +
  'notebook with `memory_write` now. One entry, with the evidence that proves it. If nothing ' +
  'qualifies, ignore this.\n' +
  '</memory-capture-hint>'

/**
 * The policy ships with the plugin. It is seeded into a notebook that exists but carries none —
 * never as a file every user is assumed to already have, which is how a bundled skill would have
 * worked and what a fresh install can never satisfy.
 */
const POLICY_TEMPLATE = (() => {
  try {
    return readFileSync(new URL('./templates/notebook-policy.md', import.meta.url), 'utf8')
  } catch {
    return ''
  }
})()

const DEFAULTS = {
  workspaceDir: '.agents/memory',
  machineDir: '',
  showIndex: true,
  /**
   * 2800, not 1400. The index now carries a one-line summary per entry, which is what lets the model
   * decide whether reading is worth a call — the thing a bare filename cannot support. Roughly 29
   * entries at 60 characters of summary each, up from 15 with names only. Cost is ~700 tokens of
   * stable prompt prefix instead of ~350. See docs/adr/16-index-carries-summaries.md.
   */
  indexBudgetChars: 9000,
  /** Characters of summary per index line. 0 falls back to bare filenames. */
  indexSummaryChars: 60,
  /**
   * Automatic recall is OFF by default. The index names every entry and its header tells the model to
   * read one with `memory_read` when a name matches, so the model decides — which is how a lexical
   * matcher's false positives are avoided rather than tuned down. See
   * docs/adr/15-recall-is-model-driven-by-default.md.
   */
  recallEnabled: false,
  recallBudgetChars: 1400,
  maxRecall: 2,
  minRecallScore: 4,
  minRecallHits: 2,
  minQueryChars: 6,
  skipAcknowledgements: true,
  /** Fraction of the context window at which the capture hint appears. 0 disables the hint. */
  captureHintRatio: 0.6,
}

/** Build a registry-ready definition from canonical JSON Schemas. */
function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: {
      schema: options.output.schema,
      render: options.output.render ?? ((_args, value) => [{ type: 'text', text: JSON.stringify(value) }]),
    },
    execute: options.execute,
  }
}

/** Text of one user message, tolerating any block shape the harness sends. */
function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text + ' '
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

export function apply(ctx, config) {
  // --- host API guard ---------------------------------------------------------
  // A plugin that silently does nothing is worse than one that fails to load, because nothing tells
  // the user which happened. `inject` already covers the services; this covers their shape, which a
  // host release can change without removing the service.
  const required = [
    ['systemPrompt.section', typeof ctx.systemPrompt?.section === 'function'],
    ['systemPrompt.context', typeof ctx.systemPrompt?.context === 'function'],
    ['tools.register', typeof ctx.tools?.register === 'function'],
  ]
  const missing = required.filter(([, present]) => !present).map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `dsh-memory requires host APIs this DSH version does not provide: ${missing.join(', ')}. ` +
        'Memory is not active, and it was never active — this is a load failure, not an empty notebook.',
    )
  }

  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  const cwdOf = (context) => context?.agent?.session?.header?.cwd
  const sessionIdOf = (context) => context?.agent?.session?.id

  /** Latest user utterance per session, captured when the inbox claim opens a turn. */
  const queryBySession = new Map()
  /** Per-session recall memory: the last query and the text published for it. */
  const recallBySession = new Map()
  /** Entries already injected in a session; re-injecting them only spends tokens. */
  const seenBySession = new Map()
  /** Sessions that already received the capture hint; it is once per session by design. */
  const hintedSessions = new Set()
  /** Sessions where the index actually reached the prompt; the health tool reports this. */
  const indexInjected = new Set()
  /**
   * The index text each session was given, computed once when the session first assembled a prompt.
   *
   * Held here rather than inside the section callback so `session/disposed` can release it: without that
   * this map keeps a full index string per session for the life of the process.
   */
  const indexBySession = new Map()
  /** Entries published by recall per session; the health tool reports this. */
  const recallsBySession = new Map()

  const seenFor = (sessionId) => {
    let seen = seenBySession.get(sessionId)
    if (seen === undefined) {
      seen = new Set()
      seenBySession.set(sessionId, seen)
    }
    return seen
  }

  ctx.on('agent/inbox/claimed', (payload) => {
    const sessionId = payload?.agent?.session?.id
    const text = messageText(payload?.message)
    if (sessionId === undefined || text.length === 0) return
    queryBySession.set(sessionId, text.slice(0, 1200))
    // A new claim starts a new turn: the previous recall answer is stale.
    recallBySession.delete(sessionId)
  })

  ctx.on('session/disposed', (session) => {
    const sessionId = session?.id
    if (sessionId === undefined) return
    hintedSessions.delete(sessionId)
    indexInjected.delete(sessionId)
    indexBySession.delete(sessionId)
    recallsBySession.delete(sessionId)
    queryBySession.delete(sessionId)
    recallBySession.delete(sessionId)
    seenBySession.delete(sessionId)
  })

  // --- seed the bundled policy into a notebook that has none ------------------
  // Once per directory per process: an existing policy is never overwritten, so a user edit
  // survives an upgrade, and a read-only notebook is silently left alone. Every configured
  // directory, not only the first — a machine-wide tier without its policy is a notebook whose
  // rules nothing states.
  const seededDirs = new Set()
  const seedPolicyOnce = (cwd) => {
    for (const dir of resolveDirs(cfg, cwd)) {
      if (seededDirs.has(dir)) continue
      seededDirs.add(dir)
      try {
        ensurePolicyEntry(dir, POLICY_TEMPLATE, cfg)
      } catch {
        /* a read-only notebook is not an error */
      }
    }
  }

  // --- rebuild the index from the directory, once per directory per process ---
  // The index is derived data. A file deleted outside the plugin, or one written by another tool,
  // leaves it describing a directory that no longer exists — and an entry with no line is invisible,
  // because the injected index never names it. Once is enough: every plugin write keeps it in step.
  const syncedDirs = new Set()
  const syncIndexOnce = (cwd) => {
    for (const dir of resolveDirs(cfg, cwd)) {
      if (syncedDirs.has(dir)) continue
      syncedDirs.add(dir)
      try {
        syncIndexFile(dir, undefined, cfg)
      } catch {
        /* a read-only notebook is not an error */
      }
    }
  }

  // --- the resident index: absent entirely when the notebook is empty ---------
  if (cfg.showIndex) {
    // The index is computed **once per session**, not once per assembly.
    //
    // It is a `systemPrompt.section`, so it sits in the prompt prefix: changing one line of it invalidates
    // the cache for everything after that line, and the conversation behind it is recomputed. A write
    // changes the index, and no design avoids that — but *where* the change lands is a choice, and the
    // start of a session is the one place it costs nothing, because a new session has no cache yet.
    //
    // So a session's index is a snapshot of the notebook as it was when the session began. An entry
    // written during the session is absent from it, and that is affordable: the model just wrote it and
    // has it in the conversation, `recall` matches every entry regardless of the index, `memory_list`
    // names them all, and `INDEX.md` on disk is updated immediately. What the index is *for* is reminding
    // a session that has not seen the notebook — the next one.
    ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: (context) => {
        const sessionId = sessionIdOf(context)
        const cached = sessionId === undefined ? undefined : indexBySession.get(sessionId)
        if (cached !== undefined) return cached
        const cwd = cwdOf(context)
        seedPolicyOnce(cwd)
        syncIndexOnce(cwd)
        const text = buildIndex(loadNotebook(cfg, cwd), cfg)
        // Recorded, not assumed: the health tool's job is to say whether the index actually reached
        // a prompt, which a configured-but-empty notebook does not.
        if (text.length > 0 && sessionId !== undefined) indexInjected.add(sessionId)
        if (sessionId !== undefined) indexBySession.set(sessionId, text)
        return text
      },
    })
  }

  // --- recall: only the entry this turn actually matches ----------------------
  // Published as dynamic runtime context rather than a synthetic user message: the
  // injected text then never enters the conversation log, and it is re-evaluated per
  // step so it survives compaction. It is byte-identical for every step of one turn,
  // which keeps the reusable prefix stable.
  if (cfg.recallEnabled) {
    ctx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: (context) => {
        const sessionId = sessionIdOf(context)
        if (sessionId === undefined) return ''
        // Seed here too, not only from the index section: a profile that turns the index off but
        // keeps recall on would otherwise never seed the policy.
        seedPolicyOnce(cwdOf(context))
        const query = queryBySession.get(sessionId)
        if (query === undefined || query.length < cfg.minQueryChars) return ''
        const cached = recallBySession.get(sessionId)
        if (cached !== undefined && cached.query === query) return cached.text

        const entries = loadNotebook(cfg, cwdOf(context))
        const seen = seenFor(sessionId)
        const candidates = entries.filter((entry) => !seen.has(entry.key))
        const picked = pickHits(candidates, query, cfg)
        const text = picked.length === 0 ? '' : renderRecall(picked, cfg.recallBudgetChars)
        for (const hit of picked) seen.add(hit.entry.key)
        if (picked.length > 0) {
          recallsBySession.set(sessionId, (recallsBySession.get(sessionId) ?? 0) + picked.length)
          // Which entries recall has ever published, so "never used" is answerable. Swallowed on
          // failure: telemetry is never worth breaking a recall over.
          const dir = resolveDirs(cfg, cwdOf(context))[0]
          if (dir !== undefined) for (const hit of picked) recordUsage(dir, hit.entry.key)
        }
        recallBySession.set(sessionId, { query, text })
        return text
      },
    })
  }

  // --- capture hint: once per session, as compaction approaches ---------------
  // Capture and extraction are one act here: the model must decide, mid-conversation, that
  // something is worth keeping. That is the most expensive possible moment to ask, so the plugin
  // asks once, at the last moment where it still matters — before the summary eats the session.
  // It is a hint, not a capture: nothing is written on the model's behalf.
  if (cfg.captureHintRatio > 0) {
    ctx.systemPrompt.context({
      name: HINT_NAME,
      order: HINT_ORDER,
      text: (context) => {
        const sessionId = sessionIdOf(context)
        if (sessionId === undefined || hintedSessions.has(sessionId)) return ''
        const meter = ctx.get('tokenMeter')
        const session = context?.agent?.session
        if (meter === undefined || session === undefined) return ''
        let pressure
        try {
          pressure = meter.contextPressure(session)
        } catch {
          return ''
        }
        const used = pressure?.pressureTokens
        const window = pressure?.contextWindow
        if (typeof used !== 'number' || typeof window !== 'number' || window <= 0) return ''
        if (used / window < cfg.captureHintRatio) return ''
        hintedSessions.add(sessionId)
        return CAPTURE_HINT
      },
    })
  }

  // --- tools -----------------------------------------------------------------
  const entriesFor = (exec) => loadNotebook(cfg, exec?.agent?.session?.header?.cwd)

  ctx.tools.register(
    defineTool({
      name: 'memory_list',
      description:
        'List the memory notebook: one line per entry with its name, trust status and title. Use when the injected index is not enough to choose an entry.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'entries'],
          properties: {
            count: { type: 'number' },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'status', 'title'],
                properties: {
                  name: { type: 'string' },
                  status: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.count === 0
                ? 'The memory notebook is empty.'
                : value.entries.map((entry) => `${entry.name}.md [${entry.status}] ${entry.title}`).join('\n'),
          },
        ],
      },
      async execute(_args, exec) {
        const entries = entriesFor(exec)
        return {
          count: entries.length,
          entries: entries.map((entry) => ({ name: entry.key, status: entry.status, title: entry.title })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_read',
      description:
        'Read one memory entry in full. Read before acting on a name from the index — a name states the trigger, not the lesson. Each read is counted, so memory_usage can tell which entries are actually used.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Entry name from the index, without .md' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'status', 'content'],
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            content: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `# ${value.name}.md [${value.status}]\n\n${value.content}` }],
      },
      async execute(args, exec) {
        const key = String(args.name ?? '').trim().replace(/\.md$/, '')
        const entry = entriesFor(exec).find((candidate) => candidate.key === key)
        if (entry === undefined) {
          throw new Error(`no memory named "${key}"; call memory_list to see the available names`)
        }
        // A read is the honest usage signal once recall is off by default: the model chose this entry
        // because it needed it, where an automatic publication only means a matcher fired. Swallowed on
        // failure — telemetry is never worth breaking a read over. Recorded against the directory the
        // entry came from: a machine-wide entry counted in the workspace log would show as never read
        // in the log its own directory is judged by.
        recordUsage(entry.dir, entry.key)
        return { name: entry.key, status: entry.status, content: entry.body.trim() }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_write',
      description:
        'Write or update one memory entry. Use only for something learned the hard way that would change a future decision — not for a fact one command reveals, and not for what AGENTS.md already states. Reuse the same name to update instead of creating a near-duplicate. Write the title and body in English whatever language the conversation is in, and pass `triggers` with synonyms including Chinese words, so a later message can recall an English entry. `evidence` is required: the exact command or error text that proves the claim.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'title', 'body', 'evidence'],
        properties: {
          name: { type: 'string', description: 'kebab-case name; the storage key, so reuse it to update' },
          title: { type: 'string', description: 'One-line conclusion, usable on its own' },
          body: { type: 'string', description: 'Symptom, mechanism, workaround — in markdown' },
          evidence: {
            type: 'string',
            description: 'Exact command or error text that lets a later session check whether the claim still holds',
          },
          triggers: {
            type: 'string',
            description: 'Comma-separated recall words, including Chinese synonyms for an English body',
          },
          summary: {
            type: 'string',
            description:
              'Optional one-line note shown in the index after the filename. Falls back to the title when omitted; an update preserves the existing summary.',
          },
          status: {
            type: 'string',
            enum: ['candidate', 'verified'],
            description: 'Defaults to candidate. Use verified only when the user confirmed it this session.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'operation', 'status', 'indexResident', 'indexOverflow', 'truncated'],
          properties: {
            name: { type: 'string' },
            operation: { type: 'string' },
            status: { type: 'string' },
            indexResident: {
              type: 'boolean',
              description: 'Whether this entry appears in the injected index',
            },
            indexOverflow: {
              type: 'number',
              description:
                'Entries now past the index budget because this one took a line. They stay recallable and memory_list names them, but the model cannot see them unprompted.',
            },
            truncated: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Field names that were longer than the stored limit and were cut, e.g. ["body"]. A cut field keeps its beginning and loses its end, which is usually the conclusion or the fix — so a non-empty list means the entry is stored incomplete.',
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `Memory ${value.operation}: ${value.name}.md [${value.status}]` +
              (value.indexOverflow > 0
                ? ` — ${value.indexOverflow} other entry(ies) are now past the index budget; memory_health lists them`
                : '') +
              (value.truncated.length > 0
                ? ` — stored incomplete: ${value.truncated.join(', ')} exceeded the limit and the end was cut`
                : ''),
          },
        ],
      },
      async execute(args, exec) {
        const dirs = resolveDirs(cfg, exec?.agent?.session?.header?.cwd)
        if (dirs.length === 0) throw new Error('no memory directory configured: set workspaceDir or machineDir')
        const key = normalizeKey(args.name)
        // Measured before the slice, not after: `title` is already cut by the time it is stored, so
        // asking whether the stored value is over the limit can never be true. The first version of this
        // did exactly that, and the test for it failed on the spot.
        const rawTitle = String(args.title ?? '').trim()
        const title = rawTitle.slice(0, TITLE_LIMIT)
        const evidence = String(args.evidence ?? '').trim()
        const body = String(args.body ?? '')
        if (title.length === 0) throw new Error('a memory needs a title')
        if (evidence.length === 0) throw new Error('a memory needs evidence: the command or error that proves it')
        const status = args.status === 'verified' ? 'verified' : 'candidate'

        // The index budget caps what is resident, not what can be stored. A write always lands; what
        // is worth reporting is whether this entry will be visible in the injected index, and how many
        // others stopped being visible to make room. Refusing the write, as this once did, protected
        // nothing and discouraged recording a fact at all.
        const existing = entriesFor(exec)
        const file = `${key}.md`
        const isNew = !existing.some((entry) => entry.file === file)
        const residency = isNew
          ? indexResidency(existing, cfg, { file, status })
          : { resident: true, shown: 0, hidden: 0 }

        const created = writeEntryFile(dirs[0], {
          key,
          title,
          status,
          triggers: String(args.triggers ?? ''),
          summary: String(args.summary ?? ''),
          body: body.slice(0, BODY_LIMIT),
          evidence: evidence.slice(0, EVIDENCE_LIMIT),
        }, cfg)
        // Every field that gets cut is named in one place. A silent slice at a boundary was the defect
        // twice already — the evidence line lost its conclusion and the query lost the request — and both
        // read as complete afterwards. The list is built from the same constants the slices use, so a
        // limit and its report cannot drift apart.
        const truncated = []
        if (rawTitle.length > TITLE_LIMIT) truncated.push('title')
        if (body.length > BODY_LIMIT) truncated.push('body')
        if (evidence.length > EVIDENCE_LIMIT) truncated.push('evidence')
        return {
          name: key,
          operation: created ? 'created' : 'updated',
          status,
          indexResident: residency.resident,
          indexOverflow: residency.hidden,
          truncated,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_verify',
      description:
        'Set the trust status of a memory entry. `verified` means the user confirmed it; `disputed` means it is wrong or no longer applies, and it must stop being injected or listed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'status'],
        properties: {
          name: { type: 'string', description: 'Entry name, without .md' },
          status: { type: 'string', enum: ['verified', 'disputed', 'candidate'] },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'status'],
          properties: { name: { type: 'string' }, status: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.name}.md is now ${value.status}` }],
      },
      async execute(args, exec) {
        const key = normalizeKey(args.name)
        const entry = entriesFor(exec).find((candidate) => candidate.key === key)
        if (entry === undefined) throw new Error(`no memory named "${key}"`)
        const status = args.status === 'verified' ? 'verified' : args.status === 'disputed' ? 'disputed' : 'candidate'
        setStatus(entry.dir, entry.key, status, cfg)
        return { name: entry.key, status }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_usage',
      description:
        'Report which entries have been used, and which never have — counting both a read through memory_read and, when recallEnabled is on, an automatic publication. An entry used often but opened once is doing nothing, and nothing else in the plugin notices; a total would hide the entry nobody uses. Counted per entry, and at most once per session, because a second read of the same entry in one session is not new information — so the count is sessions reached, not calls made. Records entry names and dates only, never the query. Use when deciding what to retire.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['recorded', 'never', 'used'],
          properties: {
            recorded: { type: 'number', description: 'Total recall events on disk' },
            never: {
              type: 'array',
              items: { type: 'string' },
              description: 'Entries recall has never published — candidates for retirement',
            },
            used: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'recalls'],
                properties: {
                  key: { type: 'string' },
                  recalls: {
                    type: 'number',
                    description: 'Sessions this entry was published to; suppressed within a session once injected',
                  },
                  last: { type: 'string', description: 'Most recent day this entry was recalled' },
                },
              },
            },
          },
        },
      },
      async execute(_args, exec) {
        // Every configured directory's log. A read is recorded against the directory its entry came
        // from, so reporting only the first directory's log would show machine-wide entries as never
        // used no matter how often they are read.
        const rows = resolveDirs(cfg, exec?.agent?.session?.header?.cwd).flatMap((dir) => readUsage(dir))
        return usageReport(entriesFor(exec), rows)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_health',
      description:
        'Diagnose the memory notebook. Separates "memory is broken" from "nothing matched", which look identical from a query that returned no hits and are the reason a working plugin gets uninstalled. Reports whether the notebook can be read and written, whether the injected index agrees with the directory, how many more entries fit, and whether this session actually injected and recalled anything. Use when the user asks whether memory works, or when recall seems to have stopped.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'status',
            'dir',
            'entries',
            'indexAgrees',
            'indexChars',
            'indexBudget',
            'indexResident',
            'indexOverflow',
            'disputed',
            'withoutTriggers',
            'withoutEvidence',
            'policy',
            'problems',
            'session',
          ],
          properties: {
            status: {
              type: 'string',
              description:
                'ok | degraded (works, with something to fix) | broken (cannot persist or read) | absent (no notebook yet) | unconfigured',
            },
            dir: { type: 'string', description: 'Notebook directory, or empty when unconfigured' },
            entries: { type: 'number' },
            indexAgrees: { type: 'boolean', description: 'INDEX.md matches the directory in both directions' },
            indexChars: { type: 'number' },
            indexBudget: { type: 'number' },
            indexResident: { type: 'number', description: 'Entries named in the injected index' },
            indexOverflow: {
              type: 'number',
              description:
                'Entries past the budget: recall still matches them and memory_list names them, but the model cannot see them unprompted',
            },
            disputed: { type: 'number' },
            withoutTriggers: { type: 'array', items: { type: 'string' } },
            withoutEvidence: { type: 'array', items: { type: 'string' } },
            policy: { type: 'boolean', description: 'A notebook-policy entry exists' },
            problems: { type: 'array', items: { type: 'string' } },
            session: {
              type: 'object',
              additionalProperties: false,
              required: ['indexInjected', 'recalls'],
              properties: {
                indexInjected: { type: 'boolean', description: 'Whether the index reached this session' },
                recalls: { type: 'number', description: 'Entries published by recall this session' },
              },
            },
          },
        },
      },
      async execute(_args, exec) {
        const report = diagnoseNotebook(cfg, exec?.agent?.session?.header?.cwd)
        const sessionId = exec?.agent?.session?.id
        return {
          ...report,
          session: {
            indexInjected: sessionId !== undefined && indexInjected.has(sessionId),
            recalls: sessionId === undefined ? 0 : (recallsBySession.get(sessionId) ?? 0),
          },
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_audit',
      description:
        'Report notebook entries that need a human re-check: those with no Evidence line, those not touched in a long time, and those whose prose is not in the notebook\'s language. Age is a proxy for evidence rot — the command recorded in an old entry is the one most likely to no longer hold. Use when the user asks what is stale, or before trusting an entry that looks old.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stale_days: {
            type: 'number',
            description: 'Age in days after which an entry counts as stale (default 90)',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['total', 'missing_evidence', 'stale', 'wrong_language', 'index'],
          properties: {
            total: { type: 'number' },
            missing_evidence: { type: 'array', items: { type: 'string' } },
            stale: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'days'],
                properties: {
                  name: { type: 'string' },
                  days: { type: 'number' },
                },
              },
            },
            wrong_language: {
              type: 'array',
              items: { type: 'string' },
              description: 'Entries whose prose is Chinese where the notebook is written in English',
            },
            index: {
              type: 'object',
              additionalProperties: false,
              required: ['unlisted', 'missing'],
              properties: {
                unlisted: { type: 'array', items: { type: 'string' } },
                missing: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        render: (_args, value) => {
          const lines = [
            `${value.total} entries; ${value.missing_evidence.length} without evidence, ${value.stale.length} stale`,
          ]
          if (value.missing_evidence.length > 0) {
            lines.push('', 'No Evidence line:')
            for (const name of value.missing_evidence) lines.push(`  ${name}`)
          }
          if (value.stale.length > 0) {
            lines.push('', 'Not touched recently:')
            for (const row of value.stale) lines.push(`  ${row.name} (${row.days}d)`)
          }
          if (value.wrong_language.length > 0) {
            lines.push('', 'Written in Chinese, where this notebook is written in English:')
            for (const name of value.wrong_language) lines.push(`  ${name}`)
          }
          if (value.index.unlisted.length > 0) {
            lines.push('', 'On disk but missing from INDEX.md:')
            for (const file of value.index.unlisted) lines.push(`  ${file}`)
          }
          if (value.index.missing.length > 0) {
            lines.push('', 'Listed in INDEX.md but not on disk:')
            for (const file of value.index.missing) lines.push(`  ${file}`)
          }
          const clean =
            value.missing_evidence.length === 0 &&
            value.stale.length === 0 &&
            value.wrong_language.length === 0 &&
            value.index.unlisted.length === 0 &&
            value.index.missing.length === 0
          if (clean) lines.push('', 'Nothing needs a re-check.')
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        const entries = entriesFor(exec)
        const staleDays = typeof args.stale_days === 'number' && args.stale_days >= 0 ? args.stale_days : 90
        const report = auditEntries(entries, { staleDays })
        const dirs = resolveDirs(cfg, exec?.agent?.session?.header?.cwd)
        const drift = dirs.length > 0 ? indexDrift(dirs[0], entries.filter((entry) => entry.dir === dirs[0])) : { unlisted: [], missing: [] }
        const now = Date.now()
        return {
          total: report.total,
          missing_evidence: report.missingEvidence.map((entry) => entry.key),
          stale: report.stale.map((entry) => ({
            name: entry.key,
            days: Math.floor((now - entry.mtimeMs) / 86_400_000),
          })),
          wrong_language: report.chineseProse.map((entry) => entry.key),
          index: { unlisted: drift.unlisted, missing: drift.missing },
        }
      },
    }),
  )
}
