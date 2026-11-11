// Check that the documentation set stays consistent:
//
//   a) every ADR in docs/adr is referenced from docs/INDEX-en.md
//   b) README.md and README-zh.md each carry a language switch to the other file
//   c) every relative Markdown link in the READMEs and docs/*.md resolves to a file
//   d) locale/*.json carry the same keys, and none of them is empty
//   e) the version in package.json has a matching CHANGELOG section
//   f) every key in index.js DEFAULTS is documented in both README tables
//   g) the fixture policy and the bundled template are the same document
//   h) README.md carries no Chinese outside its language switcher
//
// Rules are reported together so one run shows every problem.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const docsDir = path.join(repoRoot, 'docs');
const indexFile = path.join(docsDir, 'INDEX-en.md');
const adrDir = path.join(docsDir, 'adr');

const ADR_NAME = /^\d+-[a-z0-9-]+\.md$/i;

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

// Every inline Markdown link or image on a line, with the line number it came from.
function extractLinks(text) {
  const links = [];
  const pattern = /\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  text.split(/\r?\n/).forEach((line, index) => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      links.push({ line: index + 1, target: match[1] });
    }
  });
  return links;
}

function normalizeTarget(raw) {
  let target = raw.trim().replace(/^</, '').replace(/>$/, '');
  const hash = target.indexOf('#');
  if (hash !== -1) target = target.slice(0, hash);
  try {
    target = decodeURIComponent(target);
  } catch {
    // Leave malformed escapes as written; the link will simply not resolve.
  }
  return target.replace(/^\.\//, '').replace(/^\//, '');
}

function docsMarkdown() {
  if (!existsSync(docsDir)) return [];
  return readdirSync(docsDir)
    .filter((name) => /\.md$/i.test(name) && statSync(path.join(docsDir, name)).isFile())
    .sort()
    .map((name) => `docs/${name}`);
}

// a) ADRs on disk must be named in the index.
function checkAdrIndex() {
  if (!existsSync(docsDir)) {
    return {
      ok: true,
      summary: 'skipped, docs/ does not exist yet (the docs may not be written)',
      details: [],
    };
  }

  const adrFiles = existsSync(adrDir)
    ? readdirSync(adrDir).filter((name) => ADR_NAME.test(name)).sort()
    : [];
  if (adrFiles.length === 0) {
    return { ok: true, summary: 'no ADR files in docs/adr', details: [] };
  }

  const index = readText(indexFile);
  if (index === null) {
    return {
      ok: false,
      summary: `${adrFiles.length} ADR(s) cannot be referenced, docs/INDEX-en.md is missing`,
      details: adrFiles.map((name) => `docs/adr/${name} is not listed`),
    };
  }

  const missing = adrFiles.filter((name) => !index.includes(name));
  if (missing.length > 0) {
    return {
      ok: false,
      summary: `${missing.length} of ${adrFiles.length} ADR(s) not referenced from docs/INDEX-en.md`,
      details: missing.map((name) => `docs/adr/${name} is not listed in docs/INDEX-en.md`),
    };
  }
  return {
    ok: true,
    summary: `every ADR in docs/adr is referenced from docs/INDEX-en.md (${adrFiles.length} checked)`,
    details: [],
  };
}

// b) Each README must link to its translation.
function checkLanguageSwitches() {
  const pairs = [
    { file: 'README.md', other: 'README-zh.md' },
    { file: 'README-zh.md', other: 'README.md' },
  ];
  const details = [];

  for (const { file, other } of pairs) {
    const text = readText(path.join(repoRoot, file));
    if (text === null) {
      details.push(`${file} does not exist`);
      continue;
    }
    const links = extractLinks(text);
    const targets = links.map((link) => normalizeTarget(link.target));
    if (targets.includes(other)) continue;

    const readmeLink = links.find((link) => /(?:^|\/)README(?:-zh)?\.md$/i.test(normalizeTarget(link.target)));
    if (readmeLink) {
      details.push(`${file}:${readmeLink.line} links to ${readmeLink.target} instead of ${other}`);
    } else {
      details.push(`${file} has no language switch line linking to ${other}`);
    }
  }

  return {
    ok: details.length === 0,
    summary:
      details.length === 0
        ? 'README.md and README-zh.md link to each other'
        : `${details.length} language switch problem(s)`,
    details,
  };
}

// c) Relative links must point at something that exists.
function checkRelativeLinks() {
  const sources = ['README.md', 'README-zh.md', ...docsMarkdown()];
  const broken = [];
  let checked = 0;

  for (const source of sources) {
    const full = path.join(repoRoot, source);
    const text = readText(full);
    if (text === null) continue;

    for (const link of extractLinks(text)) {
      const raw = link.target.trim();
      if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
      if (/^(?:https?:|mailto:)/i.test(raw)) continue;

      let target = raw.replace(/^</, '').replace(/>$/, '');
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch {
        // Keep the raw target; it will fail to resolve and be reported.
      }

      const resolved = target.startsWith('/')
        ? path.join(repoRoot, target.slice(1))
        : path.resolve(path.dirname(full), target);
      checked += 1;
      if (!existsSync(resolved)) {
        broken.push(`${source}:${link.line} -> ${raw}`);
      }
    }
  }

  return {
    ok: broken.length === 0,
    summary:
      broken.length === 0
        ? `all ${checked} relative link(s) resolve`
        : `${broken.length} broken relative link(s)`,
    details: broken,
  };
}

// The locale files are what the plugin page shows, and nothing else reads them for consistency. A key
// added to one language and forgotten in the other degrades silently — the page falls back, or shows
// an empty string — so the shapes are compared here.
function flattenKeys(value, prefix = '') {
  const keys = [];
  for (const [key, child] of Object.entries(value ?? {})) {
    const here = prefix === '' ? key : `${prefix}.${key}`;
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) keys.push(...flattenKeys(child, here));
    else keys.push(here);
  }
  return keys.sort();
}

function checkLocales() {
  const dir = path.join(repoRoot, 'locale');
  if (!existsSync(dir)) return { ok: true, summary: 'no locale directory', details: [] };
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) return { ok: true, summary: 'no locale files', details: [] };

  const parsed = new Map();
  const details = [];
  for (const file of files) {
    try {
      parsed.set(file, JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    } catch (error) {
      details.push(`${file} is not valid JSON: ${error.message}`);
    }
  }
  if (details.length > 0) return { ok: false, summary: `${files.length} locale file(s)`, details };

  const reference = files[0];
  const expected = flattenKeys(parsed.get(reference));
  for (const file of files.slice(1)) {
    const keys = flattenKeys(parsed.get(file));
    const missing = expected.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !expected.includes(key));
    if (missing.length > 0) details.push(`${file} is missing ${missing.join(', ')}`);
    if (extra.length > 0) details.push(`${file} has no counterpart for ${extra.join(', ')}`);
  }

  // A present-but-empty string is worse than a missing key: it renders as blank rather than falling
  // back, so the plugin page says nothing at all.
  for (const file of files) {
    const walk = (value, prefix = '') => {
      for (const [key, child] of Object.entries(value ?? {})) {
        const here = prefix === '' ? key : `${prefix}.${key}`;
        if (child !== null && typeof child === 'object') walk(child, here);
        else if (typeof child === 'string' && child.trim().length === 0) details.push(`${file}: ${here} is empty`);
      }
    };
    walk(parsed.get(file));
  }

  return {
    ok: details.length === 0,
    summary: `${files.length} locale file(s), ${expected.length} key(s) each`,
    details,
  };
}

// A version bump and its changelog entry are one change, and neither is visible to any other check.
// This exists because they came apart once: a tag was pushed before either, so the release pointed at
// a commit whose package.json still carried the previous version. CI was green, the tests passed, and
// the mismatch surfaced only by accident afterwards.
function checkVersionRecorded() {
  const pkgFile = path.join(repoRoot, 'package.json');
  const changelogFile = path.join(repoRoot, 'CHANGELOG.md');
  if (!existsSync(pkgFile) || !existsSync(changelogFile)) {
    return { ok: true, summary: 'no package.json or CHANGELOG.md', details: [] };
  }
  let version;
  try {
    version = JSON.parse(readFileSync(pkgFile, 'utf8')).version;
  } catch (error) {
    return { ok: false, summary: 'package.json is not valid JSON', details: [error.message] };
  }
  if (typeof version !== 'string' || version.trim().length === 0) {
    return { ok: false, summary: 'package.json declares no version', details: [] };
  }
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const recorded = new RegExp(`^## \\[${escaped}\\]`, 'm').test(readFileSync(changelogFile, 'utf8'));
  return {
    ok: recorded,
    summary: `package.json declares ${version}`,
    details: recorded
      ? []
      : [`CHANGELOG.md has no "## [${version}]" section — a version bump and its entry are one change`],
  };
}

// Every configuration key has to appear in both READMEs. A key that exists in the code and not in the
// table is invisible until a user asks why their setting does nothing; one in the table and not the
// code is a lie. `DEFAULTS` is module-private, so the source is read rather than imported — which also
// keeps this check from executing the plugin.
function checkConfigTable() {
  const source = readText(path.join(repoRoot, 'index.js'));
  if (source === null) return { ok: true, summary: 'no index.js', details: [] };
  const block = source.match(/const DEFAULTS = \{([\s\S]*?)\n\}/);
  if (block === null) return { ok: false, summary: 'no DEFAULTS block in index.js', details: [] };
  const keys = [...block[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  if (keys.length === 0) return { ok: false, summary: 'DEFAULTS declares no keys', details: [] };

  const details = [];
  for (const name of ['README.md', 'README-zh.md']) {
    const text = readText(path.join(repoRoot, name));
    if (text === null) {
      details.push(`${name} is missing`);
      continue;
    }
    const listed = new Set([...text.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/gm)].map((m) => m[1]));
    const absent = keys.filter((key) => !listed.has(key));
    const invented = [...listed].filter((key) => !keys.includes(key));
    if (absent.length > 0) details.push(`${name} does not document: ${absent.join(', ')}`);
    if (invented.length > 0) details.push(`${name} documents keys that are not in DEFAULTS: ${invented.join(', ')}`);
  }

  return { ok: details.length === 0, summary: `${keys.length} configuration key(s)`, details };
}

// The fixture notebook ships a policy identical to the bundled template, because the tests exercise the
// seeding path against it. "They are the same document" is a claim a comment makes and nothing enforced:
// the rename to dsh-memory updated the template and left the fixture naming the old package.
function checkPolicyCopies() {
  const template = readText(path.join(repoRoot, 'templates', 'notebook-policy.md'));
  const fixture = readText(path.join(repoRoot, 'test', 'fixtures', 'notebook', 'notebook-policy.md'));
  if (template === null || fixture === null) {
    return { ok: true, summary: 'no pair of policy copies to compare', details: [] };
  }
  const normalize = (text) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if (normalize(template) === normalize(fixture)) {
    return { ok: true, summary: 'template and fixture policy agree', details: [] };
  }
  const left = new Set(normalize(template).split('\n'));
  const right = new Set(normalize(fixture).split('\n'));
  const onlyTemplate = [...left].filter((line) => !right.has(line) && line !== '').slice(0, 3);
  const onlyFixture = [...right].filter((line) => !left.has(line) && line !== '').slice(0, 3);
  return {
    ok: false,
    summary: 'template and fixture policy agree',
    details: [
      'templates/notebook-policy.md and test/fixtures/notebook/notebook-policy.md are one document kept in two places',
      ...onlyTemplate.map((line) => `only in template: ${line.slice(0, 80)}`),
      ...onlyFixture.map((line) => `only in fixture: ${line.slice(0, 80)}`),
    ],
  };
}

// The English README is the one document a reader may open without knowing Chinese, so it stays English.
// The language switcher is the single allowed exception. Tokeniser examples are the reason this is
// limited to README.md and not applied to docs/: `mcp挂了` cannot be explained in English.
function checkReadmeIsEnglish() {
  const text = readText(path.join(repoRoot, 'README.md'));
  if (text === null) return { ok: true, summary: 'no README.md', details: [] };
  const switcher = /^\s*English\s*\|\s*\[中文\]/;
  const offenders = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (switcher.test(line)) return;
    if (/[\u3400-\u9fff]/.test(line)) offenders.push(`line ${index + 1}: ${line.trim().slice(0, 70)}`);
  });
  return {
    ok: offenders.length === 0,
    summary: 'README.md carries no Chinese outside the language switcher',
    details: offenders,
  };
}

function main() {
  const rules = [
    { label: 'a) ADR index', result: checkAdrIndex() },
    { label: 'b) language switch', result: checkLanguageSwitches() },
    { label: 'c) relative links', result: checkRelativeLinks() },
    { label: 'd) locale files agree', result: checkLocales() },
    { label: 'e) version is recorded', result: checkVersionRecorded() },
    { label: 'f) configuration is documented', result: checkConfigTable() },
    { label: 'g) policy copies agree', result: checkPolicyCopies() },
    { label: 'h) README.md is English', result: checkReadmeIsEnglish() },
  ];

  let passed = 0;
  for (const { label, result } of rules) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${label}: ${result.summary}`);
    for (const detail of result.details) console.log(`  - ${detail}`);
    if (result.ok) passed += 1;
  }

  console.log('');
  console.log(`summary: ${passed} of ${rules.length} rules passed`);
  process.exitCode = passed === rules.length ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(`check-docs: the check could not run: ${error.message}`);
  process.exitCode = 2;
}
