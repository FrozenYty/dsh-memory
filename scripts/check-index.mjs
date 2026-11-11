#!/usr/bin/env node
/**
 * Two-way check between `INDEX.md` and the entries on disk.
 *
 * The policy asks for this after every add or retire, and it is the failure this kind of notebook
 * keeps producing: a file nobody listed is invisible from outside, and a listed file that is gone
 * makes the index lie. Neither shows up as an error anywhere else.
 *
 *   node scripts/check-index.mjs --dir .agents/memory
 *
 * Exit 0 when both directions agree, 1 when they do not, 2 when the directory cannot be read.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { indexDrift, scanDir } from './../notebook-core.js'

const { values } = parseArgs({
  options: { dir: { type: 'string', default: '.agents/memory' } },
  allowPositionals: false,
})

const dir = resolve(values.dir)
if (!existsSync(dir)) {
  console.error(`no notebook at ${dir}`)
  console.error('pass --dir with the directory that holds the entries')
  process.exit(2)
}

const entries = scanDir(dir)
const drift = indexDrift(dir, entries)
console.log(`scanned ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${dir}`)

if (drift.unlisted.length > 0) {
  console.log(`\n${drift.unlisted.length} on disk but missing from INDEX.md:`)
  for (const file of drift.unlisted) console.log(`  ${file}`)
  console.log('  An unlisted entry is invisible from outside: the injected index never names it.')
}

if (drift.missing.length > 0) {
  console.log(`\n${drift.missing.length} listed in INDEX.md but not on disk:`)
  for (const file of drift.missing) console.log(`  ${file}`)
  console.log('  A listed file that is gone makes the index lie to whoever reads it next.')
}

if (drift.unlisted.length === 0 && drift.missing.length === 0) {
  console.log('\nINDEX.md and the directory agree')
  process.exit(0)
}

process.exit(1)
