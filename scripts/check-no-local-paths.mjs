#!/usr/bin/env node
// Fails if any tracked text file contains an absolute home-directory path (/Users/… or /home/…).
// Run: node scripts/check-no-local-paths.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const pattern = /\/(Users|home)\/[A-Za-z0-9._-]+/;

const hits = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(join(root, file));
  } catch {
    continue; // deleted in the working tree but still in the index
  }
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  buf.toString('utf8').split('\n').forEach((line, i) => {
    if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
}

if (hits.length) {
  console.error(`Absolute local paths found in ${hits.length} line(s):\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`check-no-local-paths: ${files.length} tracked files clean`);
