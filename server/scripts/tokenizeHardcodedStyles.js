#!/usr/bin/env node
/**
 * Phase A — replace hardcoded box-shadow / border-radius / color literals
 * inside the <style> block of an HTML file with CSS custom-property
 * references, without changing any resolved value.
 *
 * Only touches text between the FIRST <style> ... </style> pair. Every
 * substitution below is an exact substring replacement so nothing outside
 * the intended declarations can be affected. Run
 * server/scripts/styleBaselineSnapshot.js before/after and `compare` the
 * two snapshots to prove the resolved CSS did not change.
 *
 * Usage: node tokenizeHardcodedStyles.js <file.html>
 */
'use strict';

const fs = require('fs');

// [exactFind, exactReplace, expectedCount|null]
// expectedCount === null means "replace all occurrences, count not asserted"
// (used only for the broad, provably-safe RGB-channel aliases below).
const REPLACEMENTS = [
  // --- border-radius scale ---
  ['border-radius: 2px;', 'border-radius: var(--radius-2);', 1],
  ['border-radius: 4px;', 'border-radius: var(--radius-4);', 3],
  ['border-radius: 5px;', 'border-radius: var(--radius-5);', 1],
  ['border-radius: 6px;', 'border-radius: var(--radius-6);', 4],
  ['border-radius: 7px;', 'border-radius: var(--radius-7);', 11],
  ['border-radius: 8px;', 'border-radius: var(--radius-8);', 11],
  ['border-radius: 9px;', 'border-radius: var(--radius-9);', 3],
  ['border-radius: 10px;', 'border-radius: var(--radius-10);', 6],
  ['border-radius: 12px;', 'border-radius: var(--radius-12);', 5],
  ['border-radius: 14px;', 'border-radius: var(--radius-14);', 2],
  ['border-radius: 50%;', 'border-radius: var(--radius-circle);', 3],
  ['border-radius: 999px;', 'border-radius: var(--radius-pill);', 3],
  ['border-radius: 9999px;', 'border-radius: var(--radius-pill-lg);', 2],
  ['border-radius: 0 0 7px 0;', 'border-radius: 0 0 var(--radius-7) 0;', 2],
  ['border-radius: 0 0 0 7px;', 'border-radius: 0 0 0 var(--radius-7);', 2],

  // --- one-off hex colors used outside the :root token blocks ---
  // (the single `border: 1px solid #E2E8F0;` case was already normalized
  // to var(--border) by hand — see Phase A notes — so it's not repeated here)
  ['#fff', 'var(--white)', 3],

  // --- RGB channel aliases (fixed values — see the comment above the
  //     token definitions in :root for why these are NOT theme-reactive) ---
  ['rgba(0, 0, 0, ', 'rgba(var(--shadow-rgb), ', null],
  ['rgba(255, 255, 255, ', 'rgba(var(--overlay-rgb), ', null],
  ['rgba(59, 130, 246, ', 'rgba(var(--primary-rgb-d), ', null],
  ['rgba(37, 99, 235, ', 'rgba(var(--primary-rgb-l), ', null],
  ['rgba(16, 185, 129, ', 'rgba(var(--glow-green-rgb), ', null],
  ['rgba(239, 68, 68, ', 'rgba(var(--glow-red-rgb), ', null],
];

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tokenizeHardcodedStyles.js <file.html>');
    process.exit(1);
  }

  const html = fs.readFileSync(file, 'utf8');
  const openTag = '<style>';
  const closeTag = '</style>';
  const openIdx = html.indexOf(openTag);
  const closeIdx = html.indexOf(closeTag, openIdx);
  if (openIdx === -1 || closeIdx === -1) {
    console.error('Could not locate a <style>...</style> block');
    process.exit(1);
  }

  const before = html.slice(0, openIdx + openTag.length);
  let style = html.slice(openIdx + openTag.length, closeIdx);
  const after = html.slice(closeIdx);

  const report = [];
  for (const [find, replace, expected] of REPLACEMENTS) {
    const actual = countOccurrences(style, find);
    if (expected !== null && actual !== expected) {
      console.error(`ABORT: expected ${expected} occurrence(s) of ${JSON.stringify(find)}, found ${actual}. No changes written.`);
      process.exit(1);
    }
    style = style.split(find).join(replace);
    report.push({ find, replace, count: actual });
  }

  fs.writeFileSync(file, before + style + after);
  for (const r of report) {
    console.log(`${String(r.count).padStart(3)}x  ${r.find}  ->  ${r.replace}`);
  }
  console.log(`\nDone. ${report.length} replacement rules applied to ${file}.`);
}

main();
