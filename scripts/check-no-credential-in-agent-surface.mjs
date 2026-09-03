#!/usr/bin/env node
// HEL-829 tasks.md 3.1/3.2 (design.md Decision 4a) — the mechanical,
// "demonstrated red" enforcement that the credential-carrying components/
// values can never structurally reach the agent/chat surface.
//
// HEL-927 added a third, independent check (see below) after HEL-904's
// delivery committed a real `pg_dump` fixture
// (`backend/src/test/resources/db/fixtures/hel904-real-dump.sql`) carrying
// 594 real bcrypt password hashes and real email addresses — this script
// was scoped only to the frontend assistant surface and reported green
// throughout. HEL-927 is deliberately scoped to bcrypt-hash-shaped and
// bulk-PII-shaped (real-looking email) content in fixture/dump directories;
// generic token-shaped secret strings (`helio_pat_`, `sk-ant-`,
// `*_KEY`/`*_SECRET`/`*_TOKEN` assignments) anywhere agents write files
// during delivery are HEL-846's guard, not this one — see that ticket for
// the complementary scope.
//
// Three independent checks:
//
//   1. Import-graph walk (frontend/src/features/assistant/**, excluding its
//      own test files): fails if any assistant-surface module transitively
//      imports `ConnectorCredentialField`/`ConnectorCredentialFieldValue`/
//      `InlineConnectorSetup` (the credential-carrying components).
//   2. Text-pattern scan (same scope as #1): fails if any assistant-surface
//      module declares an object-literal/type/interface property literally
//      named `credential` (case-insensitive; exact-word match only —
//      `apiCredential`, `credentialId` etc. do not match) outside
//      `ALLOWED_CREDENTIAL_PROPS`.
//   3. Fixture scan (`FIXTURE_ROOTS`, currently
//      `backend/src/test/resources/**`): fails if any fixture file contains
//      a real-shaped bcrypt hash (`\$2[aby]\$NN\$...`) other than the
//      repo's established dummy value, or an email address whose domain
//      isn't in `ALLOWED_EMAIL_DOMAINS`. This is the check HEL-927 added.
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
//   - The fixture scan (#3) only walks `FIXTURE_ROOTS` — a credential-shaped
//     value committed outside those directories is not caught by this
//     script at all (HEL-846's generic scanner is the intended backstop for
//     that).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendSrc = join(repoRoot, "frontend/src");
const assistantRoot = join(frontendSrc, "features/assistant");

// Directories scanned by the fixture check (#3). Currently just the one
// fixture/dump location that exists in this repo today; add more paths here
// if/when other fixture directories accumulate credential-shaped content.
const FIXTURE_ROOTS = [join(repoRoot, "backend/src/test/resources")];

// The repo's established dummy bcrypt value (see HEL-904's scrub of
// `hel904-real-dump.sql`) — a fixed, obviously-synthetic all-zero hash that
// a legitimately-scrubbed fixture is allowed to carry.
const ALLOWED_BCRYPT_HASHES = new Set([
  "$2a$12$0000000000000000000000000000000000000000000000000000",
]);

// Email domains a fixture is allowed to use for placeholder addresses (see
// HEL-904's scrub, which standardized on `example.invalid`).
const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.invalid",
]);

const BCRYPT_HASH_REGEX = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}/g;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

// File extensions the fixture scan skips outright — binary formats where a
// naive utf8 read would either throw or produce false-positive garbage
// matches.
const BINARY_FIXTURE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".zip",
  ".gz",
  ".jar",
  ".class",
]);

/** @type {string[]} */
const fixtureErrors = [];

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

/** Recursively collects every non-binary file under `dir` (unlike `walk`,
 *  not restricted to `.ts`/`.tsx` — fixture directories hold `.sql`, `.json`,
 *  `.csv`, etc). Missing directories are tolerated (returns `[]`) so
 *  `FIXTURE_ROOTS` can list a path that doesn't exist in every checkout. */
function walkAllFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkAllFiles(full, out);
    } else if (!BINARY_FIXTURE_EXTENSIONS.has(extname(full).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** Scans one fixture file's text for a real-shaped bcrypt hash (outside the
 *  allow-listed dummy value) or an email address on a non-placeholder
 *  domain, appending any findings to `fixtureErrors`. */
function checkFixtureFile(file, text) {
  BCRYPT_HASH_REGEX.lastIndex = 0;
  let bcryptMatch;
  while ((bcryptMatch = BCRYPT_HASH_REGEX.exec(text)) !== null) {
    if (ALLOWED_BCRYPT_HASHES.has(bcryptMatch[0])) continue;
    const line = text.slice(0, bcryptMatch.index).split("\n").length;
    fixtureErrors.push(
      `${relative(repoRoot, file)}:${line}: contains a real-shaped bcrypt hash — ` +
        "fixture data must use the repo's dummy bcrypt value, not a real-looking hash",
    );
  }

  EMAIL_REGEX.lastIndex = 0;
  let emailMatch;
  while ((emailMatch = EMAIL_REGEX.exec(text)) !== null) {
    const domain = emailMatch[1].toLowerCase();
    if (ALLOWED_EMAIL_DOMAINS.has(domain)) continue;
    const line = text.slice(0, emailMatch.index).split("\n").length;
    fixtureErrors.push(
      `${relative(repoRoot, file)}:${line}: contains an email address on a non-placeholder domain ` +
        `("${domain}") — fixture data must use an allow-listed placeholder domain ` +
        `(${[...ALLOWED_EMAIL_DOMAINS].join(", ")})`,
    );
  }
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

const fixtureFiles = FIXTURE_ROOTS.flatMap((root) => walkAllFiles(root));

for (const file of fixtureFiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  checkFixtureFile(file, text);
}

const allErrors = [...importGraphErrors, ...textPatternErrors, ...fixtureErrors];
const totalFilesScanned = assistantFiles.length + fixtureFiles.length;

if (allErrors.length > 0) {
  console.error("check-no-credential-in-agent-surface: FAIL\n");
  for (const err of allErrors) console.error(`  - ${err}`);
  console.error(
    `\n${allErrors.length} violation(s). The agent/chat surface (frontend/src/features/assistant/**) ` +
      "must never import a credential-carrying component or declare a field literally named " +
      '"credential" (HEL-829 design.md Decision 4), and fixture/dump directories ' +
      `(${FIXTURE_ROOTS.map((r) => relative(repoRoot, r)).join(", ")}) ` +
      "must never carry a real-shaped bcrypt hash or a non-placeholder-domain email address (HEL-927).",
  );
  process.exit(1);
} else {
  console.log(
    `check-no-credential-in-agent-surface: OK (${totalFilesScanned} files scanned: ` +
      `${assistantFiles.length} assistant-surface, ${fixtureFiles.length} fixture, 0 violations)`,
  );
}
