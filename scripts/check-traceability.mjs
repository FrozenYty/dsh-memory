/**
 * Every test name quoted in the traceability table must exist.
 *
 * `docs/traceability-en.md` is the document that says which test holds which decision in place. It quotes
 * test names in backticks, and until now **nothing checked that those names exist** — a rename left the
 * row pointing at nothing, and a row that points at nothing reads exactly like a row that points at
 * something. That is the failure this file exists to make visible.
 *
 * It found 17 stale quotes the first time it ran. They were not hypothetical: names had been reworded in
 * the suite (`a memory needs evidence` → `the entry carries its evidence`) and in the mutation scan, and
 * the table was never updated. **A table of guarantees whose pointers are broken is worse than no table**,
 * because it is read as evidence.
 *
 *   node scripts/check-traceability.mjs
 *
 * Exit 1 when a quoted name does not exist, naming the row.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

/**
 * Both tables, because they quote the same names.
 *
 * The Chinese file is a translation of the same rows, so a rename breaks it in exactly the same way — and
 * checking only the English one would leave a second copy of the fact unguarded, which is the defect this
 * repository keeps producing. A name quoted in either file must exist.
 */
const TABLES = ['docs/traceability-en.md', 'docs/traceability-zh.md']

/** Where a test name can be declared. Both shapes are hand-rolled harnesses, not node:test. */
const SOURCES = [
  { file: 'tests/core.test.mjs', pattern: /^check\(\s*'((?:[^'\\]|\\.)*)'/gm },
  { file: 'scripts/mutation-scan.mjs', pattern: /^\s*\['((?:[^'\\]|\\.)*)',/gm },
]

function declared(file, pattern) {
  const full = path.join(root, file)
  if (!existsSync(full)) return null
  const source = readFileSync(full, 'utf8')
  return new Set([...source.matchAll(pattern)].map((m) => m[1].replace(/\\'/g, "'")))
}

/**
 * A backticked span is a quoted test name unless it is visibly something else.
 *
 * The table mixes four kinds of thing into one column, and the filters below are the three that are
 * **structural** rather than a guess: a path has a separator or a file extension, a command starts with a
 * program name, and a config reference reads `key: value`. Everything else is treated as a name and must
 * exist — so a span that is none of those and is not a test will be reported, which is the safe direction:
 * the fix is to word the row better, and the alternative is another silent gap.
 */
const notAName = [
  { why: 'a path or filename', test: (s) => /[/\\]/.test(s) || /\.(json|js|mjs|md|yml)$/.test(s) },
  { why: 'a shell command', test: (s) => /^(node|npm|pnpm|git|for|cmd|Select-String) /.test(s) },
  { why: 'a section reference', test: (s) => /^§/.test(s) },
  { why: 'a config reference', test: (s) => /^[\w.$]+: \S/.test(s) },
  { why: 'a single word or identifier', test: (s) => !/\s/.test(s) },
]

function main() {
  const absent = TABLES.filter((t) => !existsSync(path.join(root, t)))
  if (absent.length > 0) {
    console.error(`missing: ${absent.join(', ')}`)
    process.exit(1)
  }

  const declaredNames = new Map()
  const missingSources = []
  for (const { file, pattern } of SOURCES) {
    const names = declared(file, pattern)
    if (names === null) missingSources.push(file)
    else declaredNames.set(file, names)
  }
  if (missingSources.length > 0) {
    console.error(`missing source(s): ${missingSources.join(', ')}`)
    console.error('a source that has moved would make every name look stale, so this is fatal')
    process.exit(1)
  }

  const all = new Set([...declaredNames.values()].flatMap((s) => [...s]))

  const stale = []
  const ignored = new Map()
  let checked = 0

  for (const relative of TABLES) {
    const lines = readFileSync(path.join(root, relative), 'utf8').split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      for (const span of [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])) {
        const reason = notAName.find((f) => f.test(span))
        if (reason) {
          ignored.set(reason.why, (ignored.get(reason.why) ?? 0) + 1)
          continue
        }
        checked += 1
        if (!all.has(span)) {
          const row = line.match(/^\|\s*\[(\d{4})\]/)
          stale.push({ where: `${relative}:${index + 1}`, adr: row ? row[1] : '?', name: span })
        }
      }
    }
  }

  const total = [...declaredNames.values()].reduce((n, s) => n + s.size, 0)
  console.log(`${total} declared name(s) across ${declaredNames.size} source(s)`)
  console.log(`${checked} quoted name(s) checked across ${TABLES.length} table(s)`)
  for (const [why, count] of ignored) console.log(`  skipped ${count} that are ${why}`)

  if (stale.length === 0) {
    console.log('\nall quoted names exist')
    process.exit(0)
  }

  console.log(`\n${stale.length} quoted name(s) do not exist:`)
  for (const { where, adr, name } of stale) {
    console.log(`  ${where}  ADR ${adr}  "${name}"`)
  }
  console.log(
    '\nEither the test was renamed and this row was not, or the row was written from memory.\n' +
      'Fix the quote, or say in the row why the decision now has no test.',
  )
  process.exit(1)
}

main()
