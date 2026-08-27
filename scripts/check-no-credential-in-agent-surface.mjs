#!/usr/bin/env node
// HEL-829 tasks.md 3.1/3.2 (design.md Decision 4a) — the mechanical,
// "demonstrated red" enforcement that the credential-carrying components/
// values can never structurally reach the agent/chat surface.
//
// Two independent checks, both scoped to every module under
// `frontend/src/features/assistant/**` (excluding its own test files, which
// intentionally exercise fixtures and are not agent-facing runtime code):
//
//   1. Import-graph walk: fails if any assistant-surface module transitively
//      imports `ConnectorCredentialField`/`ConnectorCredentialFieldValue`/
//      `InlineConnectorSetup` (the credential-carrying components).
//   2. Text-pattern scan: fails if any assistant-surface module declares an
//      object-literal/type/interface property literally named `credential`
//      (case-insensitive; exact-word match only — `apiCredential`,
//      `credentialId` etc. do not match) outside `ALLOWED_CREDENTIAL_PROPS`.
//
// Run standalone first against the pre-existing tree (before wiring into
// Husky) to confirm zero false positives — design.md's Gate-Chain
// Implications Checklist "first run" answer for this script.
//
// Known residual limits (skeptic-final-1.md CR1, kept honestly documented
// rather than silently widening the check's scope beyond this ticket):
//   - The `credential` text-pattern scan is an exact-word match on the
//     literal name `credential` only — a renamed carrier (`apiKey`, `secret`,
//     `token`, etc.) is NOT caught by this check.
//   - `extractRelativeImports` only walks RELATIVE import specifiers
//     (`./x`/`../y/z`); a non-relative (bare package / alias) specifier is
//     never resolved or followed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendSrc = join(repoRoot, "frontend/src");
const assistantRoot = join(frontendSrc, "features/assistant");

// Module basenames (no extension) that must never be transitively imported
// by anything under `frontend/src/features/assistant/**`.
const BANNED_MODULES = new Set(["ConnectorCredentialField", "InlineConnectorSetup"]);

// Exact-word (case-insensitive) property names that would fail the
// text-pattern scan if found — explicitly none allow-listed today. A future
// legitimate use (if one is ever needed) must be added here with a comment
// explaining why it's safe, never worked around by renaming the pattern.
const ALLOWED_CREDENTIAL_PROPS = new Set();

const CREDENTIAL_PROP_REGEX = /\bcredential\b\s*\??\s*:/gi;

/** @type {string[]} */
const importGraphErrors = [];
/** @type {string[]} */
const textPatternErrors = [];

function isSourceFile(path) {
  return (path.endsWith(".ts") || path.endsWith(".tsx")) && !path.endsWith(".d.ts");
}

function isTestFile(path) {
  return path.includes(".test.") || path.includes(".spec.") || path.includes("/test/");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (isSourceFile(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Extracts every relative-import specifier from a source file's text —
 *  both the static forms (`from "./x"`/`import "../y/z"`) AND the call
 *  forms (`await import("./x")`, `require("./x")`), so a component pulled
 *  in via `React.lazy(() => import("./x"))` or a dynamic `import()` is
 *  walked exactly like a static import (skeptic-final-1.md CR1 — the
 *  original `from|import\s+` regex required whitespace immediately after
 *  `import`, which a call-form `import(` never has, so it silently never
 *  matched the call form at all). Deliberately regex-based (mirrors
 *  `check-scala-quality.mjs`'s own text-pattern approach) — no TS compiler
 *  dependency needed for this scope. */
function extractRelativeImports(text) {
  const specifiers = [];
  const importRegex = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(text)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith(".")) specifiers.push(specifier);
  }
  return specifiers;
}

/** Resolves a relative import specifier from `fromFile` to an actual file on
 *  disk, trying the extensions/`index` conventions this repo's Vite/TS setup
 *  supports. Returns `null` for a specifier that can't be resolved to a real
 *  file (e.g. a CSS import) — never thrown, since this is a best-effort
 *  structural walk, not a full module resolver. */
function resolveImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not a file at this candidate path — try the next one
    }
  }
  return null;
}

function moduleBasename(filePath) {
  const name = filePath.split("/").pop() ?? filePath;
  return name.replace(/\.(tsx|ts)$/, "").replace(/\/index$/, "");
}

/** BFS over the relative-import graph rooted at `rootFile`, restricted to
 *  files under `frontend/src` (never follows into node_modules — those
 *  specifiers are never relative). Returns the first banned module reached,
 *  along with the import chain that reached it, or `null` if none. */
function findBannedImport(rootFile) {
  const visited = new Set([rootFile]);
  const queue = [{ file: rootFile, chain: [rootFile] }];

  while (queue.length > 0) {
    const { file, chain } = queue.shift();
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const specifier of extractRelativeImports(text)) {
      const resolved = resolveImport(file, specifier);
      if (!resolved) continue;
      if (BANNED_MODULES.has(moduleBasename(resolved))) {
        return { bannedModule: relative(repoRoot, resolved), chain: [...chain, resolved] };
      }
      if (!resolved.startsWith(frontendSrc)) continue;
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      queue.push({ file: resolved, chain: [...chain, resolved] });
    }
  }
  return null;
}

function checkTextPatterns(file, text) {
  CREDENTIAL_PROP_REGEX.lastIndex = 0;
  let match;
  while ((match = CREDENTIAL_PROP_REGEX.exec(text)) !== null) {
    const key = `${relative(repoRoot, file)}:${match.index}`;
    if (ALLOWED_CREDENTIAL_PROPS.has(key)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    textPatternErrors.push(
      `${relative(repoRoot, file)}:${line}: declares a property literally named "credential" — ` +
        "the agent/chat surface must never carry a credential-shaped field",
    );
  }
}

const assistantFiles = walk(assistantRoot).filter((f) => !isTestFile(f));

for (const file of assistantFiles) {
  const found = findBannedImport(file);
  if (found) {
    const chainStr = found.chain.map((f) => relative(repoRoot, f)).join(" -> ");
    importGraphErrors.push(
      `${relative(repoRoot, file)}: transitively imports banned module "${found.bannedModule}" (${chainStr})`,
    );
  }

  const text = readFileSync(file, "utf8");
  checkTextPatterns(file, text);
}

const allErrors = [...importGraphErrors, ...textPatternErrors];

if (allErrors.length > 0) {
  console.error("check-no-credential-in-agent-surface: FAIL\n");
  for (const err of allErrors) console.error(`  - ${err}`);
  console.error(
    `\n${allErrors.length} violation(s). The agent/chat surface (frontend/src/features/assistant/**) ` +
      "must never import a credential-carrying component or declare a field literally named " +
      '"credential" — see HEL-829 design.md Decision 4.',
  );
  process.exit(1);
} else {
  console.log(
    `check-no-credential-in-agent-surface: OK (${assistantFiles.length} files scanned, 0 violations)`,
  );
}
