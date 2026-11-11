// Check that the documentation set stays consistent:
//
//   a) every ADR in docs/adr is referenced from docs/INDEX-en.md
//   b) README.md and README-zh.md each carry a language switch to the other file
//   c) every relative Markdown link in the READMEs and docs/*.md resolves to a file
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

function main() {
  const rules = [
    { label: 'a) ADR index', result: checkAdrIndex() },
    { label: 'b) language switch', result: checkLanguageSwitches() },
    { label: 'c) relative links', result: checkRelativeLinks() },
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
