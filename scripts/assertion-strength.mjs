/**
 * Assertion strength: which checks could pass without the code being right?
 *
 * Mutation scanning answers "does the suite notice a broken line". This answers a different question:
 * is the *assertion* capable of failing at all. A check that asserts a literal, or a truthy return
 * value, or that its subject is merely not-undefined, survives mutations for the wrong reason.
 *
 * Reports candidates for a human to read. It cannot judge intent — `x === true` is a fine assertion
 * when x is a boolean and a weak one when x is a string.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(here, 'tests', 'core.test.mjs'), 'utf8')

/** Split a call's argument list at top-level commas. */
function argsOf(text, openIndex) {
  const args = []
  let depth = 0
  let start = openIndex + 1
  let quote = null
  for (let i = openIndex + 1; i < text.length; i++) {
    const ch = text[i]
    if (quote !== null) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        args.push(text.slice(start, i))
        return args
      }
      depth -= 1
    } else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i))
      start = i + 1
    }
  }
  args.push(text.slice(start))
  return args
}

const checks = []
let cursor = 0
while (true) {
  const at = src.indexOf('check(', cursor)
  if (at === -1) break
  const args = argsOf(src, at + 'check'.length)
  if (args.length >= 2) {
    const name = args[0].trim().replace(/^'|'$/g, '')
    checks.push({ name, condition: args[1].trim(), line: src.slice(0, at).split('\n').length })
  }
  cursor = at + 6
}

const suspicious = []
for (const c of checks) {
  const k = c.condition
  const flags = []
  if (/^(true|false)$/.test(k)) flags.push('a literal — can never fail')
  else if (/^\d+$/.test(k)) flags.push('a numeric literal')
  else if (/!==\s*undefined/.test(k) && k.length < 40) flags.push('only asserts not-undefined')
  else if (/^typeof\s/.test(k) && k.length < 40) flags.push('only asserts a type')
  else if (/\.length\s*>\s*0/.test(k) && k.length < 40) flags.push('only asserts non-empty')
  else if (/===?\s*true\s*$/.test(k) && k.length < 24) flags.push('asserts === true')
  if (flags.length) suspicious.push({ ...c, flags })
}

console.log(`checks parsed: ${checks.length}`)
console.log(`suspicious:    ${suspicious.length}`)
if (suspicious.length > 0) {
  console.log('')
  for (const s of suspicious) {
    console.log(`  tests/core.test.mjs:${s.line}  [${s.flags.join('; ')}]`)
    console.log(`    ${s.name}`)
    console.log(`    ${s.condition.replace(/\s+/g, ' ').slice(0, 110)}`)
  }
}
