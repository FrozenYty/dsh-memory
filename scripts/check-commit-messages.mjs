// Reject commits that credit a tool as a co-author.
//
// A squash merge copies a Co-authored-by trailer onto the base branch, where GitHub
// counts the tool as a second contributor even though it authored nothing. Human
// co-authors are fine; only tool names are rejected.
//
// Usage:
//   node scripts/check-commit-messages.mjs [--range <a..b>] [--all]
//     --range   commit range to check (default: origin/main..HEAD)
//     --all     every commit reachable from HEAD

import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DEFAULT_RANGE = 'origin/main..HEAD';
const USAGE = 'usage: node scripts/check-commit-messages.mjs [--range <a..b>] [--all]';

// One line must contain a Co-authored-by trailer AND a tool name to be rejected.
const CO_AUTHOR = /co-authored-by:/i;
const TOOL_NAME = /(?:claude|anthropic|copilot|chatgpt|openai|gpt-\d|cursor|codeium|windsurf)/i;
// "Generated with [Claude Code](...)" credits a tool even without a co-author trailer.
const GENERATED_WITH = /^[^A-Za-z0-9]*generated with\b/i;

function parseArgs(argv) {
  let all = false;
  let range = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--range') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return { error: '--range needs a value such as origin/main..HEAD' };
      }
      range = value;
      index += 1;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }

  if (all && range !== null) {
    return { error: 'use either --all or --range, not both' };
  }
  return { all, range: range === null ? DEFAULT_RANGE : range };
}

// Some sandboxes deny the anonymous pipes that child_process uses to capture a
// child's stdio. In that case the same command runs with its output written to
// files in the temporary directory, which needs no pipe.
function temporaryRoot() {
  const dir = process.env.TEMP || process.env.TMPDIR || process.env.TMP;
  if (!dir) {
    throw new Error('no temporary directory available (TEMP, TMPDIR and TMP are unset)');
  }
  return dir;
}

function gitThroughFiles(args) {
  const dir = mkdtempSync(path.join(temporaryRoot(), 'check-commit-messages-'));
  try {
    const outPath = path.join(dir, 'stdout');
    const errPath = path.join(dir, 'stderr');
    const out = openSync(outPath, 'w');
    const err = openSync(errPath, 'w');
    let result;
    try {
      result = spawnSync('git', args, { cwd: repoRoot, stdio: ['ignore', out, err] });
    } finally {
      closeSync(out);
      closeSync(err);
    }
    if (result.error) {
      throw new Error(`cannot run git: ${result.error.code || result.error.message}`);
    }
    return {
      status: result.status,
      stdout: readFileSync(outPath, 'utf8'),
      stderr: readFileSync(errPath, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!result.error) return result;
  if (result.error.code === 'ENOENT') {
    throw new Error('git was not found on PATH');
  }
  if (result.error.code !== 'EPERM') {
    throw new Error(`cannot run git: ${result.error.code || result.error.message}`);
  }
  return gitThroughFiles(args);
}

function fail(message) {
  console.error(`check-commit-messages: ${message}`);
  console.error(USAGE);
  process.exitCode = 2;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    fail(parsed.error);
    return;
  }

  const listArgs = parsed.all ? ['rev-list', 'HEAD'] : ['rev-list', parsed.range];
  const listed = git(listArgs);
  if (listed.status !== 0) {
    const detail = listed.stderr.trim() || `exit code ${listed.status}`;
    console.error(`check-commit-messages: git ${listArgs.join(' ')} failed: ${detail}`);
    process.exitCode = 2;
    return;
  }

  const hashes = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const offenders = [];
  for (const hash of hashes) {
    // One commit at a time: %B is UTF-8 and may contain any character, so batching
    // commits behind a separator would corrupt or lose the message.
    const message = git(['log', '-1', '--format=%B', hash]);
    if (message.status !== 0) {
      const detail = message.stderr.trim() || `exit code ${message.status}`;
      console.error(`check-commit-messages: git log failed for ${hash.slice(0, 7)}: ${detail}`);
      process.exitCode = 2;
      return;
    }
    for (const rawLine of message.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const toolCoAuthor = CO_AUTHOR.test(line) && TOOL_NAME.test(line);
      if (toolCoAuthor || GENERATED_WITH.test(line)) {
        offenders.push({ hash, line });
      }
    }
  }

  const scope = parsed.all ? 'all commits reachable from HEAD' : parsed.range;
  if (offenders.length === 0) {
    console.log(`checked ${hashes.length} commit message(s) in ${scope}`);
    console.log('no tool co-author credits found');
    process.exitCode = 0;
    return;
  }

  for (const { hash, line } of offenders) {
    console.log(`${hash.slice(0, 7)}: ${line}`);
  }
  console.log('');
  console.log(`found ${offenders.length} line(s) crediting a tool as a co-author`);
  console.log('A squash merge copies these lines onto the base branch, where GitHub counts the tool as a contributor.');
  console.log('Remove them by amending or rewriting the commits before merging.');
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`check-commit-messages: the check could not run: ${error.message}`);
  process.exitCode = 2;
}
