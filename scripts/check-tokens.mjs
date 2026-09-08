#!/usr/bin/env node
// check-tokens: every var(--*) reference under the scanned CSS set must resolve to a definition
// (a DECLARATION, not merely a `--x:` occurring anywhere) somewhere in that same set, or be
// explicitly allowlisted with the file that assigns it at runtime named.
//
// An undefined custom property fails OPEN at runtime -- var(--nope) silently falls back to the
// inherited/initial value rather than erroring -- so nothing else in this repo (not ESLint, not
// tsc, not Prettier, not any unit test) can see this class. HEL-451: `var(--weight-normal)` where
// `theme.css` defines `--weight-regular` rendered per-column filter inputs at weight 600 instead
// of 400 and passed every existing gate. See openspec/changes/var-token-resolution-guard/design.md
// (HEL-1037).
//
// Usage: node check-tokens.mjs [scanRoot]   (scanRoot defaults to frontend/src; absolute or
// relative to the invoking cwd -- this is the seam the selftest's mkdtemp fixture uses to drive
// main() end to end without ever scanning or mutating a tracked file.)

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Comment stripping -- PORTED (not imported) from
// frontend/src/theme/motionTokenGuard.css.test.ts (HEL-441). That file has
// ZERO exports -- stripComments is file-local inside a TypeScript Jest test
// -- so a standalone check script cannot import it, and extracting a shared
// module would mean editing HEL-441's already-shipped guard for no
// behavioural gain (design.md D2). Replaces `/* ... */` with spaces while
// preserving newlines, so reported line numbers survive stripping.
//
// Without this the guard is red on `main` from its first run against a
// correctly-defined token: shared/chrome/MobileNavSheet.css:54-55 wraps a
// comment mid-token ("Repeating `top: var(--app-top-chrome-` / `-height)`
// here would be..."), and the real --app-top-chrome-height is defined and
// used correctly elsewhere.
// ---------------------------------------------------------------------------
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

// A definition is a DECLARATION -- a `--x:` at the start of a line, or
// immediately following `{` or `;` (whitespace, including newlines,
// permitted in between) -- NOT any `--x:` occurring anywhere in the text
// (design.md D3a, the fail-open hole). The naive matcher `(--[a-z0-9-]+)\s*:`
// anywhere in the text admits 16 BEM modifier selectors post-strip (17
// pre-strip) as if they were declarations -- `.foo__btn--primary:hover`,
// `.y--queued::before` -- and `--text-small` is one of this ticket's own
// three real defects, so a future `var(--text)` typo would resolve against
// the `.x--text` selector fragment and pass silently: the guard failing
// open on exactly the class it exists to catch. Anchoring to a declaration
// position closes this.
const DECLARATION_RE = /(^|[{;])[ \t\r\n]*(--[a-zA-Z0-9-]+)[ \t\r\n]*:/gm;

export function extractDefinitions(text) {
  const defs = new Set();
  let m;
  DECLARATION_RE.lastIndex = 0;
  while ((m = DECLARATION_RE.exec(text))) {
    defs.add(m[2]);
  }
  return defs;
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

// A fallback does NOT exempt a reference (design.md D3b) -- `var(--typo,
// 4px)` is still a typo, the intended design-system token still does not
// exist, and a literal has silently substituted for it. So the captured
// name is only up to the delimiter after the token name; any fallback text
// is deliberately not consumed here at all.
const REFERENCE_RE = /var\(\s*(--[a-zA-Z0-9-]+)/g;

export function extractReferences(text) {
  const refs = [];
  let m;
  REFERENCE_RE.lastIndex = 0;
  while ((m = REFERENCE_RE.exec(text))) {
    refs.push({ name: m[1], line: lineAt(text, m.index) });
  }
  return refs;
}

// Runtime-injected tokens -- each entry names the file that ASSIGNS the
// token at runtime, not merely a reason (design.md D4). A "sighting" is not
// a justification: --mobile-panel-height's only non-CSS hits are test
// files, and its real setter (MobilePanelStack.tsx:104, inline
// CSSProperties) had to be traced before it earned this entry.
export const ALLOWLIST = {
  "--dashboard-background-override": "app/App.tsx",
  "--dashboard-grid-background-override": "features/panels/ui/PanelList.tsx",
  "--panel-surface-override": "features/panels/ui/PanelCard.tsx",
  "--panel-text-override": "features/panels/ui/PanelCard.tsx",
  "--mobile-panel-height":
    "features/panels/ui/grid/MobilePanelStack.tsx:104 (inline CSSProperties)",
};

// files: Map<relPath, rawText>. The token source set is every `--x:`
// definition anywhere in the scanned CSS, not just theme.css (design.md
// D3) -- --toast-exit-duration and --toast-intent-color are legitimately
// defined in shared/ui/toast.css.
export function checkTokens(files, allowlist = ALLOWLIST) {
  const definitions = new Set();
  const stripped = new Map();
  for (const [relPath, rawText] of files) {
    const text = stripComments(rawText);
    stripped.set(relPath, text);
    for (const def of extractDefinitions(text)) definitions.add(def);
  }

  const errors = [];
  for (const [relPath, text] of stripped) {
    for (const ref of extractReferences(text)) {
      if (definitions.has(ref.name)) continue;
      if (Object.prototype.hasOwnProperty.call(allowlist, ref.name)) continue;
      errors.push(`${relPath}:${ref.line} references undefined token ${ref.name}`);
    }
  }
  return { errors, definitions };
}

// ---------------------------------------------------------------------------
// Filesystem walk -- no `git` commands, and no assumption that `.git` is a
// directory: every delivery run in this repo happens inside a LINKED
// WORKTREE, where `.git` is a FILE, not a directory. This walk never reads
// `.git` at all -- it only reads `*.css` under the given scan root.
// ---------------------------------------------------------------------------
function allCssFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...allCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const scanRoot = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : join(repoRoot, "frontend/src");

  const cssFiles = allCssFiles(scanRoot);
  const files = new Map();
  for (const absPath of cssFiles) {
    files.set(relative(scanRoot, absPath), readFileSync(absPath, "utf8"));
  }

  const { errors } = checkTokens(files);
  if (errors.length > 0) {
    console.error("check-tokens: FAILED\n");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      `\n${errors.length} unresolved var(--*) reference(s). An undefined custom property fails ` +
        "open at runtime (falls back silently) -- see " +
        "openspec/changes/var-token-resolution-guard/design.md.",
    );
    process.exit(1);
  }
  console.log(`check-tokens: OK -- every var(--*) reference under ${scanRoot} resolves.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
