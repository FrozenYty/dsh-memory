/**
 * dsh-memory-notebook — low-token persistent memory for DeepSeek Harness.
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
import {
  buildIndex,
  loadNotebook,
  normalizeKey,
  pickHits,
  renderRecall,
  resolveDirs,
  setStatus,
  writeEntryFile,
} from './notebook-core.js'

export const name = 'memory-notebook'

export const inject = ['systemPrompt', 'tools']

const SECTION_NAME = 'memory-notebook:index'
const SECTION_ORDER = 4100
const CONTEXT_NAME = 'memory-notebook:recall'
const CONTEXT_ORDER = 4101

const DEFAULTS = {
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
  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  const cwdOf = (context) => context?.agent?.session?.header?.cwd
  const sessionIdOf = (context) => context?.agent?.session?.id

  /** Latest user utterance per session, captured when the inbox claim opens a turn. */
  const queryBySession = new Map()
  /** Per-session recall memory: the last query and the text published for it. */
  const recallBySession = new Map()
  /** Entries already injected in a session; re-injecting them only spends tokens. */
  const seenBySession = new Map()

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
    queryBySession.delete(sessionId)
    recallBySession.delete(sessionId)
    seenBySession.delete(sessionId)
  })

  // --- the resident index: absent entirely when the notebook is empty ---------
  if (cfg.showIndex) {
    ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: (context) => buildIndex(loadNotebook(cfg, cwdOf(context)), cfg),
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
        recallBySession.set(sessionId, { query, text })
        return text
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
        'Read one memory entry in full. Read before acting on a name from the index — a name states the trigger, not the lesson.',
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
        return { name: entry.key, status: entry.status, content: entry.body.trim() }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_write',
      description:
        'Write or update one memory entry. Use only for something learned the hard way that would change a future decision — not for a fact one command reveals, and not for what AGENTS.md already states. Reuse the same name to update instead of creating a near-duplicate. Pass `triggers` with synonyms, including Chinese words, so a later message can recall an English entry. `evidence` is required: the exact command or error text that proves the claim.',
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
          required: ['name', 'operation', 'status'],
          properties: {
            name: { type: 'string' },
            operation: { type: 'string' },
            status: { type: 'string' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: `Memory ${value.operation}: ${value.name}.md [${value.status}]` },
        ],
      },
      async execute(args, exec) {
        const dirs = resolveDirs(cfg, exec?.agent?.session?.header?.cwd)
        if (dirs.length === 0) throw new Error('no memory directory configured: set workspaceDir or machineDir')
        const key = normalizeKey(args.name)
        const title = String(args.title ?? '').trim().slice(0, 120)
        const evidence = String(args.evidence ?? '').trim()
        if (title.length === 0) throw new Error('a memory needs a title')
        if (evidence.length === 0) throw new Error('a memory needs evidence: the command or error that proves it')
        const status = args.status === 'verified' ? 'verified' : 'candidate'
        const created = writeEntryFile(dirs[0], {
          key,
          title,
          status,
          triggers: String(args.triggers ?? ''),
          body: String(args.body ?? '').slice(0, 4000),
          evidence: evidence.slice(0, 300),
        })
        return { name: key, operation: created ? 'created' : 'updated', status }
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
        setStatus(entry.dir, entry.key, status)
        return { name: entry.key, status }
      },
    }),
  )
}
