#!/usr/bin/env node
/**
 * Phase A tooling — snapshot every resolved box-shadow / border-radius /
 * color-ish declaration inside the <style> block of an HTML file, for both
 * the dark (:root) and light (:root[data-theme="light"]) themes.
 *
 * Purpose: let us tokenize hardcoded values into CSS custom properties
 * (see design-system/tks-dashboard/MASTER.md) while proving the *resolved*
 * value seen by the browser did not change — i.e. no "lệch giao diện".
 *
 * Usage:
 *   node styleBaselineSnapshot.js capture <file.html> <out.json>
 *   node styleBaselineSnapshot.js compare <before.json> <after.json>
 */
'use strict';

const fs = require('fs');

const TARGET_PROPS = new Set([
  'box-shadow', 'border-radius', 'color', 'background', 'background-color',
  'border', 'border-color', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'outline', 'outline-color', 'fill', 'stroke',
  'text-shadow', 'text-decoration-color', 'caret-color',
]);

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

function extractStyleBlock(html) {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('No <style> block found');
  // Strip CSS comments first — the naive declaration regex below has no
  // notion of comment syntax, so a stray ':' + ';' inside a /* ... */ block
  // (e.g. a prose note) would otherwise be parsed as a bogus declaration.
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

// Find `selector { ... }` and return the inner text, respecting brace nesting.
function extractBlock(css, selectorRe) {
  const m = selectorRe.exec(css);
  if (!m) return null;
  let i = m.index + m[0].length; // position right after the opening `{`
  let depth = 1;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

// Matches `prop: value;` (value cannot itself contain `{`/`}`), across newlines.
const DECL_RE = /([a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;

function parseDeclarations(css) {
  const out = [];
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(css))) {
    out.push({ prop: m[1].trim(), value: m[2].trim(), index: m.index });
  }
  return out;
}

// Same as parseDeclarations, but also tags each declaration with which
// theme(s) it can actually apply to, based on brace nesting: anything
// nested under a `:root[data-theme="light"] ...` selector is light-only —
// it can never render in the dark theme, no matter what its resolved value
// says. Without this, a declaration whose resolved value legitimately
// differs per theme (e.g. it now uses a themed var()) looks like a false
// "value changed" diff even though the selector gates it to one theme.
function parseDeclarationsWithScope(css) {
  const out = [];
  const stack = []; // true = current nesting is under a light-only selector
  let buf = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const isLight = /\[data-theme=["']light["']\]/.test(buf) ||
        (stack.length > 0 && stack[stack.length - 1]);
      stack.push(isLight);
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      const m = /^\s*([a-zA-Z0-9-]+)\s*:\s*([^;{}]+)\s*$/.exec(buf);
      if (m) {
        const scope = stack.length > 0 && stack[stack.length - 1] ? 'light' : 'both';
        out.push({ prop: m[1].trim(), value: m[2].trim(), scope });
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

function buildVarMap(css) {
  const map = {};
  for (const { prop, value } of parseDeclarations(css)) {
    if (prop.startsWith('--')) map[prop] = value;
  }
  return map;
}

function resolveVars(value, varMap, depth = 0) {
  if (depth > 8) return value;
  return value.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]+))?\)/g, (whole, name, fallback) => {
    if (Object.prototype.hasOwnProperty.call(varMap, name)) {
      return resolveVars(varMap[name], varMap, depth + 1);
    }
    if (fallback !== undefined) return resolveVars(fallback, varMap, depth + 1);
    return whole; // leave unresolved, will show up as a diff-worthy oddity
  });
}

function snapshot(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const style = extractStyleBlock(html);

  const darkBlock = extractBlock(style, /:root\s*\{/);
  const lightBlock = extractBlock(style, /:root\[data-theme=["']light["']\]\s*\{/);
  if (darkBlock === null) throw new Error('Could not locate base :root block');

  const darkVars = buildVarMap(darkBlock);
  const lightVars = Object.assign({}, darkVars, lightBlock ? buildVarMap(lightBlock) : {});

  const decls = parseDeclarationsWithScope(style).filter(({ prop, value }) => {
    if (prop.startsWith('--')) return false;
    return TARGET_PROPS.has(prop) || COLOR_RE.test(value) || value.includes('var(');
  });

  const dark = decls
    .filter((d) => d.scope !== 'light')
    .map((d, i) => ({ i, prop: d.prop, resolved: resolveVars(d.value, darkVars) }));
  const light = decls
    .map((d, i) => ({ i, prop: d.prop, resolved: resolveVars(d.value, lightVars) }));

  return { count: decls.length, dark, light };
}

function compare(beforePath, afterPath) {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
  const diffs = [];

  for (const theme of ['dark', 'light']) {
    const b = before[theme];
    const a = after[theme];
    const max = Math.max(b.length, a.length);
    for (let i = 0; i < max; i++) {
      const bd = b[i];
      const ad = a[i];
      if (!bd || !ad) {
        diffs.push({ theme, i, before: bd || null, after: ad || null, reason: 'count-mismatch' });
        continue;
      }
      if (bd.resolved !== ad.resolved) {
        diffs.push({ theme, i, prop: bd.prop, before: bd.resolved, after: ad.resolved, reason: 'value-changed' });
      }
    }
  }

  return diffs;
}

function main() {
  const [, , cmd, a, b] = process.argv;
  if (cmd === 'capture') {
    if (!a || !b) { console.error('Usage: capture <file.html> <out.json>'); process.exit(1); }
    const snap = snapshot(a);
    fs.writeFileSync(b, JSON.stringify(snap, null, 2));
    console.log(`Captured ${snap.count} declarations -> ${b}`);
  } else if (cmd === 'compare') {
    if (!a || !b) { console.error('Usage: compare <before.json> <after.json>'); process.exit(1); }
    const diffs = compare(a, b);
    if (diffs.length === 0) {
      console.log('OK: no resolved-value differences between baseline and current file (dark + light).');
      process.exit(0);
    }
    console.error(`MISMATCH: ${diffs.length} resolved-value difference(s):`);
    console.error(JSON.stringify(diffs, null, 2));
    process.exit(1);
  } else {
    console.error('Usage:\n  node styleBaselineSnapshot.js capture <file.html> <out.json>\n  node styleBaselineSnapshot.js compare <before.json> <after.json>');
    process.exit(1);
  }
}

main();
