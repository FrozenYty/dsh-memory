// Reject machine-specific paths in shared Markdown documents.
//
// Walks every *.md file under the repository root (skipping .git, node_modules and
// dist) and reports lines that name a local machine: a Windows drive, a UNC share,
// a POSIX home directory, or a conda installation.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);
const MAX_SHOWN = 80;

const RULES = [
  { label: 'Windows drive path', pattern: /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s]/ },
  // A UNC share names a host, and a host does not begin with a dot. Without that requirement the
  // device namespace `\\.\pipe\...` reads as a share called ".", and every quoted Windows error
  // message about a named pipe fails the check.
  { label: 'UNC share', pattern: /\\\\[A-Za-z0-9_-][A-Za-z0-9._-]*\\/ },
  { label: 'POSIX home path', pattern: /\/(?:Users|home)\/[^/\s]+\// },
  { label: 'conda install path', pattern: /anaconda3?[\\/]/i },
];

function collectMarkdown(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectMarkdown(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

function show(line) {
  const trimmed = line.trim();
  return trimmed.length <= MAX_SHOWN ? trimmed : `${trimmed.slice(0, MAX_SHOWN - 3)}...`;
}

function main() {
  const files = [];
  collectMarkdown(repoRoot, files);
  files.sort();

  let findings = 0;
  const affected = new Set();

  for (const file of files) {
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!RULES.some((rule) => rule.pattern.test(line))) return;
      findings += 1;
      affected.add(relative);
      console.log(`${relative}:${index + 1}: ${show(line)}`);
    });
  }

  console.log(`scanned ${files.length} Markdown document(s)`);
  if (findings > 0) {
    console.log(`found ${findings} machine-specific path(s) in ${affected.size} document(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('all documents are portable');
}

try {
  main();
} catch (error) {
  console.error(`check-paths: the check could not run: ${error.message}`);
  process.exitCode = 2;
}
