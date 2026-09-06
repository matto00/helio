#!/usr/bin/env node
// HEL-829 tasks.md 3.1/3.2 (design.md Decision 4a) — the mechanical,
// "demonstrated red" enforcement that the credential-carrying components/
// values can never structurally reach the agent/chat surface.
//
// HEL-927 added a second surface (fixture/dump directories) after HEL-904's
// delivery committed a real `pg_dump` fixture carrying 594 real bcrypt
// password hashes and real email addresses — this script was scoped only to
// the frontend assistant surface and reported green throughout.
//
// HEL-956 restructured the script around a declared `SURFACES` table (see
// below) after the gate scanned ZERO files of a change (HEL-886) whose
// entire premise was credential containment on the `helio-mcp/**` surface —
// a green result over code the gate never examined. That table is now the
// single source of truth for what this gate covers; do not add a check that
// scans a path outside it. HEL-956 also added a coverage-drift guard (a new
// top-level repo directory must be explicitly classified) and made a
// zero-file surface a hard failure, so "scanned nothing" can never again be
// indistinguishable from "found nothing".
//
// **The table is load-bearing, not decorative.** Every entry's `include`
// and `checks` are dispatched from a single loop (`collectFiles` +
// `runChecksForSurface`), and the per-surface/total counts are derived from
// that SAME loop's file lists, paired positionally (`{ surface, files }`
// records, not a lookup keyed by the hand-written `id` string) — so there
// is no second, hand-keyed place that repeats an id string ANYWHERE in this
// file, including the file-list lookup itself. This closes three siblings
// of the same defect class, found across two review rounds:
//   1. (f17e9781) A `surfaceCounts` object literal keyed by hand-written id
//      strings let a `SURFACES` entry with no matching key silently
//      contribute `undefined` (not `0`) to the vacuity check.
//   2. (skeptic-final-1.md CR1) `runChecksForSurface` dispatched on
//      `surface.checks.includes(name)` with no validation that `name` was a
//      real check — a typo'd or renamed check name (or an empty `checks`
//      array) silently ran zero checks over a surface that still counted
//      toward the OK line.
//   3. (skeptic-final-1.md CR2) The per-surface file lists were held in a
//      `Map` keyed by `surface.id` — a second `SURFACES` entry reusing an
//      existing id silently overwrote (dropped) that surface's real file
//      list while still reporting a plausible-looking breakdown line.
// `assertSurfacesValid` (below) closes 2 and 3 by validating `SURFACES`
// itself — unique ids, and every `checks` entry drawn from `KNOWN_CHECKS` —
// before any scan runs, mirroring what `collectFiles` already does for an
// unrecognized `include` value (throws). The positional `{ surface, files }`
// pairing closes 3 structurally as well, independent of the assertion.
// Any future surface MUST go through `SURFACES` alone — do not add a
// parallel count, file list, or check-dispatch table anywhere else in this
// file.
//
// Generic token-shaped secret strings (`helio_pat_`, `sk-ant-`,
// `*_KEY`/`*_SECRET`/`*_TOKEN` assignments) on the `delivery-evidence`/
// `docs`/`notes` surfaces are caught by the `deliverySecret` check (HEL-846,
// see below). This script's `mcp`-surface secret-literal check (added for
// the `mcp` surface, see Decision 4a below) stays narrower and permanent —
// scoped to `helio-mcp/**` only, where a real PAT client credential would
// actually leak — and is a separate, unmodified check from `deliverySecret`.
//
// ── Surface table (coverage source of truth) ──────────────────────────────
//
// Every file this gate scans is reached through exactly one entry below.
// Each surface: `{ id, root, include, checks }`.
//   - `include` selects the file-inclusion rule: `"sourceNonTest"` (non-test
//     `.ts`/`.tsx` only) or `"allNonBinary"` (every file except the binary
//     extensions in `BINARY_FIXTURE_EXTENSIONS`).
//   - `checks` lists which of the independent checks below apply to this
//     surface's files: `importGraph`, `credentialProp`, `bcrypt`, `email`,
//     `secretLiteral`, `deliverySecret`.
//
//   assistant-surface  — frontend/src/features/assistant/**
//                        include: sourceNonTest
//                        checks: importGraph, credentialProp
//   fixture            — backend/src/test/resources/**
//                        include: allNonBinary
//                        checks: bcrypt, email
//   mcp                — helio-mcp/**, excluding node_modules/ and dist/
//                        include: allNonBinary
//                        checks: secretLiteral, bcrypt, email
//   delivery-evidence  — openspec/** (HEL-846)
//                        include: allNonBinary
//                        checks: deliverySecret
//   docs               — docs/** (HEL-846)
//                        include: allNonBinary
//                        checks: deliverySecret
//   notes              — notes/** (HEL-846)
//                        include: allNonBinary
//                        checks: deliverySecret
//
// The `mcp` surface deliberately does NOT get `importGraph` or
// `credentialProp` (design.md Decision 3): `helio-mcp` declares fields
// literally named `credential` in order to REJECT them (see
// `restDataSourceSchema.ts`/`connectorSchema.ts`), and the import-graph walk
// hunts for banned React components that cannot exist in an MCP server.
//
// HEL-846 added the `delivery-evidence`/`docs`/`notes` surfaces and the
// `deliverySecret` check — the generic, token-shaped-secret backstop that
// this file's earlier surfaces' own comments and the `scripts`/`backend`
// coverage-table entries used to point at as a FUTURE ticket. It is
// implemented here now, not elsewhere: no sibling script, one more
// `SURFACES` entry per tree, dispatched through the same
// `collectFiles`/`runChecksForSurface` loop as everything else.
//
// ── Coverage-drift guard ───────────────────────────────────────────────────
//
// Every top-level directory in the repo must classify into exactly one of:
//   - COVERED   — a declared surface root is at/inside/beneath it and covers
//                 the whole directory (today: `helio-mcp`, `openspec`,
//                 `docs`, `notes`).
//   - PARTIAL   — a declared surface root is beneath it but the rest is
//                 deliberately not scanned; requires a `PARTIAL_COVERAGE`
//                 entry naming the scanned subtree and why the rest isn't
//                 (today: `frontend`, `backend`).
//   - UNSCANNED — requires an `ACKNOWLEDGED_UNSCANNED` entry with a one-line
//                 reason (today: `e2e`, `infra`, `schemas`, `scripts`).
// A directory in none of the three fails the gate loudly. This is what
// keeps a newly-added top-level directory from silently escaping coverage.
//
// Two categories are skipped before classification (never require an
// entry): dot-prefixed directories, and a hardcoded `IGNORED_TOP_LEVEL` set
// of names that are never committed. `IGNORED_TOP_LEVEL` is a hand-derived
// duplicate of the UNANCHORED (root-matching) directory patterns in
// `.gitignore` — deliberately hardcoded rather than parsed from
// `.gitignore` or resolved via `git check-ignore`, because both of those
// require either fragile ad-hoc gitignore-semantics parsing (anchoring,
// negation, globs) or a git invocation this gate otherwise has no need for.
// That is an accepted trade-off: a *committed* directory sharing one of
// these six names would be skipped, but since each is an unanchored
// `.gitignore` entry, that can't happen without someone first
// force-committing a directory the repo already ignores.
//
//   name                | .gitignore line
//   --------------------|----------------
//   node_modules        | 6  (node_modules/)
//   dist                | 8  (dist/)
//   build               | 10 (build/)
//   coverage            | 17 (coverage/)
//   playwright-report   | 18 (playwright-report/)
//   test-results        | 19 (test-results/)
//
// `target` and `out` are deliberately EXCLUDED from this set: `.gitignore`
// line 11 is the ANCHORED `backend/target/` (does not ignore a root-level
// `target/`), and `out` does not appear in `.gitignore` at all — a
// root-level `target/` or `out/` SHOULD trip the drift guard.
//
// Whenever a new unanchored root-directory pattern is added to `.gitignore`,
// add it to `IGNORED_TOP_LEVEL` in the same commit, or the drift guard will
// (correctly) start failing on that directory's presence.
//
// Known residual limits of the drift guard (deliberately out of scope, not
// silently missing): it classifies DIRECTORIES only — top-level FILES
// (`.env.example`, `Dockerfile`, `package-lock.json`, `README.md`, etc.) are
// never classified. Dot-prefixed directories (`.github`, `.husky`,
// `.claude`, `.concertino`, etc.) are always skipped, never classified
// either way.
//
// Other known residual limits (skeptic-final-1.md CR1, kept honestly
// documented rather than silently widening scope beyond each check's
// stated ticket):
//   - The `credential` text-pattern scan is an exact-word match on the
//     literal name `credential` only — a renamed carrier (`apiKey`, `secret`,
//     `token`, etc.) is NOT caught by this check.
//   - `extractRelativeImports` only walks RELATIVE import specifiers
//     (`./x`/`../y/z`); a non-relative (bare package / alias) specifier is
//     never resolved or followed.
//   - The secret-literal check (added for `mcp`) is entropy/length-gated,
//     not a general secret scanner; see Decision 4a below for its bound and
//     why a bare-prefix rule was rejected.
//   - The `deliverySecret` check (HEL-846) is likewise not a general secret
//     scanner: it does not catch a low-entropy real password (the vendor
//     rule requires the `helio_pat_`/`sk-ant-` prefix; the high-entropy rule
//     requires >= 32 alphabet-pure characters), and it does not catch a
//     credential written with neither a known vendor prefix nor a
//     credential-named identifier — concretely, a `helio_session` cookie
//     value pasted inside a `curl` transcript has no vendor prefix and no
//     `KEY`/`SECRET`/`TOKEN`/`PASSWORD`-suffixed identifier next to it, and
//     is not caught by either rule.
//
// Run standalone first against the pre-existing tree (before wiring into
// Husky) to confirm zero false positives — design.md's Gate-Chain
// Implications Checklist "first run" answer for this script.
//
// ── HEL-993: paths closed (all mutation-verified; see tasks.md 3.1) ───────
//
// HEL-956's own review found three residual "silence reads as green" paths
// left for HEL-993 (recorded on that ticket, NOT in this header — the
// entry-guard comment used to incorrectly claim otherwise). HEL-993 closed
// all three, plus a fourth found by its own design gate:
//   1. A file `readFileSync` cannot read is now a hard failure
//      (`readSurfaceFiles`), excluded from the reported count, instead of a
//      silent `continue` that still counted it as scanned.
//   2. A file reached through the import-graph BFS that cannot be read is
//      likewise a hard failure (`findBannedImport`), not a silent `continue`
//      that let "no banned import found" go unproven.
//   3. A directory `readdirSync` cannot list is likewise a hard failure
//      (`collectFiles`) — the missing-surface-root case (`ENOENT` at the
//      root only) stays tolerated and still routes to the vacuity check.
//   4. The entry guard is now fail-closed in shape: an independent basename
//      backstop (see the bottom of this file) fires if this module was the
//      process entry but `main()` never ran.
// These are DIFFERENT from, and do not replace, the three unrelated,
// still-true limits in "Other known residual limits" below.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendSrc = join(repoRoot, "frontend/src");
const assistantRoot = join(frontendSrc, "features/assistant");
const mcpRoot = join(repoRoot, "helio-mcp");
const fixtureRoot = join(repoRoot, "backend/src/test/resources");
const openspecRoot = join(repoRoot, "openspec");
const docsRoot = join(repoRoot, "docs");
const notesRoot = join(repoRoot, "notes");

// ── Surface table (coverage source of truth — see header comment) ─────────
const SURFACES = [
  {
    id: "assistant-surface",
    root: assistantRoot,
    include: "sourceNonTest",
    checks: ["importGraph", "credentialProp"],
  },
  { id: "fixture", root: fixtureRoot, include: "allNonBinary", checks: ["bcrypt", "email"] },
  {
    id: "mcp",
    root: mcpRoot,
    include: "allNonBinary",
    checks: ["secretLiteral", "bcrypt", "email"],
  },
  {
    id: "delivery-evidence",
    root: openspecRoot,
    include: "allNonBinary",
    checks: ["deliverySecret"],
  },
  { id: "docs", root: docsRoot, include: "allNonBinary", checks: ["deliverySecret"] },
  { id: "notes", root: notesRoot, include: "allNonBinary", checks: ["deliverySecret"] },
];

// Every valid value a `SURFACES` entry's `checks` array may contain — see
// `runChecksForSurface` for what each name dispatches to. `assertSurfacesValid`
// (below `collectFiles`) rejects any `checks` entry outside this set, and
// rejects an empty `checks` array, mirroring `collectFiles`'s existing
// unrecognized-`include` throw (skeptic-final-1.md CR1).
const KNOWN_CHECKS = new Set([
  "importGraph",
  "credentialProp",
  "bcrypt",
  "email",
  "secretLiteral",
  "deliverySecret",
]);

// The repo's established dummy bcrypt value (see HEL-904's scrub of
// `hel904-real-dump.sql`) — a fixed, obviously-synthetic all-zero hash that
// a legitimately-scrubbed fixture is allowed to carry.
const ALLOWED_BCRYPT_HASHES = new Set([
  "$2a$12$0000000000000000000000000000000000000000000000000000",
]);

// Email domains a fixture/mcp file is allowed to use for placeholder
// addresses (see HEL-904's scrub, which standardized on `example.invalid`).
// Any `.test` TLD is also reserved (RFC 2606) and accepted structurally
// below without needing an entry here (design.md Decision 4.1).
const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.invalid",
]);

const BCRYPT_HASH_REGEX = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}/g;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

// File extensions the `allNonBinary` walk skips outright — binary formats
// where a naive utf8 read would either throw or produce false-positive
// garbage matches.
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

// Directory names pruned while walking ANY surface (currently only `mcp`
// has such subdirectories, but this applies uniformly).
const PRUNED_SUBDIR_NAMES = new Set(["node_modules", "dist"]);

// Module basenames (no extension) that must never be transitively imported
// by anything under `frontend/src/features/assistant/**`.
const BANNED_MODULES = new Set(["ConnectorCredentialField", "InlineConnectorSetup"]);

// Exact-word (case-insensitive) property names that would fail the
// text-pattern scan if found — explicitly none allow-listed today. A future
// legitimate use (if one is ever needed) must be added here with a comment
// explaining why it's safe, never worked around by renaming the pattern.
const ALLOWED_CREDENTIAL_PROPS = new Set();

const CREDENTIAL_PROP_REGEX = /\bcredential\b\s*\??\s*:/gi;

// ── Secret-literal check (mcp surface only) — design.md Decision 4a ────────
//
// Entropy-gated, NOT prefix-gated. A bare-prefix rule was measured to be
// wrong: it would fire on `helio-mcp/src/config.ts`'s `PAT_PREFIX` constant,
// on a short test value (`"helio_pat_test"`), and on README/e2e
// documentation placeholders (`helio_pat_xxxxxxxx`, `helio_pat_…`) — forcing
// a rename of production code to appease the gate, which is the exact
// failure mode this ticket exists to eliminate.
//
// A vendor-prefixed literal matches only when the prefix is followed by AT
// LEAST 20 characters of [A-Za-z0-9_-]. Ground truth for the bound:
// `ApiTokenService.scala` documents the real credential as `helio_pat_` +
// a 64-character hex string; Anthropic `sk-ant-` keys are longer still. So a
// real credential always matches, while every measured legitimate value is
// structurally excluded:
//   "helio_pat_"                (config.ts PAT_PREFIX, 0 suffix chars) - no
//   "helio_pat_test"                            (4 suffix chars)       - no
//   "helio_pat_xxxxxxxx"                (README placeholder, 8 chars)  - no
//   "helio_pat_…"                    (README, ellipsis not in class)   - no
//   real helio_pat_ + 64 hex                                          - YES
const VENDOR_PREFIX_SECRET_REGEX = /\b(helio_pat_|sk-ant-)[A-Za-z0-9_-]{20,}/g;

// ── Delivery-secret check (delivery-evidence/docs/notes surfaces) —
//    HEL-846 design.md Decision 2/4 ────────────────────────────────────────
//
// High-entropy named-literal rule: an identifier ending KEY/SECRET/TOKEN/
// PASSWORD (case-insensitive), followed by `:`/`=`, an OPTIONAL quote, then
// a run of >= 32 characters from the base64/hex alphabet
// (`[A-Za-z0-9+/=_-]`). The quote is deliberately OPTIONAL here — unlike
// `NAMED_SECRET_LITERAL_REGEX` below, which requires one — because these
// three surfaces are markdown delivery transcripts, where a leaked value
// overwhelmingly appears as pasted shell/CI output (`TOKEN=abc...`,
// `export API_KEY=abc...`) rather than as a quoted source-code literal;
// requiring a quote here would silently miss exactly the shape this check
// exists to catch.
//
// Bound, measured against ground truth (design.md Decision 2): a 32-byte
// base64 key is 44 characters; the real PAT shape (`helio_pat_` + 64 hex) is
// 74. >= 32 sits below both while structurally excluding every measured
// legitimate value on these surfaces, none of which is both alphabet-pure
// AND that long: `bindingKey = "outputId"`, `key = "dashboard"`,
// `password: "correct horse battery staple 1!"` (spaces/punctuation outside
// the class), `apiKey = "YOUR_NVD_API_KEY"`, `idempotencyKey:
// "skeptic-live-key-1"`, `token = "sekret-token"`.
const HIGH_ENTROPY_NAMED_SECRET_REGEX =
  /\b(\w*(?:key|secret|token|password))\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{32,})["']?/gi;

// Identifier-name rule: a string literal of at least 8 characters assigned
// to (or used as an object-literal value for) an identifier/key whose name
// ends in KEY/SECRET/TOKEN/PASSWORD (case-insensitive). Matches both
// `const FOO_KEY = "..."` / `this.apiToken = "..."` style assignment and
// object-literal property shorthand (`token: "...", secret: "..."`).
// Anything shorter than 8 characters is not a credential worth leaking.
const NAMED_SECRET_LITERAL_REGEX =
  /\b(\w*(?:key|secret|token|password))\s*[:=]\s*["']([^"']{8,})["']/gi;

// Synthetic-marker convention (design.md Decision 4, widened by HEL-846
// Decision 2) — the SOLE exemption path for the secret-literal and
// delivery-secret checks. A credential-shaped literal passes when it is the
// empty string, is all zeros, or contains one of these markers
// (case-insensitively), AFTER normalizing `_` to `-` first. Normalization
// matters: it's what makes `re_test_key_should_never_be_logged`-style
// underscore-separated fixture names recognized identically to their
// hyphenated form (measured live against `CONNECTOR_MASTER_KEY =
// REPLACE_WITH_OUTPUT_OF_openssl_rand_dash_base64_32` in
// docs/cloud-dev-setup.md — see design.md Decision 2). This is what lets
// `"sk-should-never-be-accepted"`-style test fixtures pass unchanged: "make
// your fake secret look fake" is a rule a future author can follow without
// ever touching this script.
const SYNTHETIC_SECRET_MARKERS = [
  "not-a-real",
  "should-never",
  "should-not",
  "dummy",
  "placeholder",
  "fake",
  "example",
  "redacted",
  "replace-with",
  "synthetic",
  "xxxx",
];

function isSyntheticSecretLiteral(value) {
  if (value === "") return true;
  if (/^0+$/.test(value)) return true;
  const normalized = value.toLowerCase().replaceAll("_", "-");
  return SYNTHETIC_SECRET_MARKERS.some((marker) => normalized.includes(marker));
}

function isSourceFile(path) {
  return (path.endsWith(".ts") || path.endsWith(".tsx")) && !path.endsWith(".d.ts");
}

function isTestFile(path) {
  return path.includes(".test.") || path.includes(".spec.") || path.includes("/test/");
}

/** Recursively collects every file under `dir` matching `include`
 *  (`"sourceNonTest"` — non-test `.ts`/`.tsx` only; `"allNonBinary"` — every
 *  file except `BINARY_FIXTURE_EXTENSIONS`), pruning `PRUNED_SUBDIR_NAMES`.
 *  Tolerates a MISSING `dir` at the surface ROOT only (`ENOENT` when
 *  `isRoot`) — a surface root that doesn't exist in every checkout, or one
 *  that's been moved/renamed/deleted, doesn't crash the gate; it fails the
 *  vacuity check instead (see below), which is the loud failure this ticket
 *  wants in that case. Any OTHER `readdirSync` failure — a directory that
 *  exists but can't be listed (permission denial, `ENOTDIR`), or an `ENOENT`
 *  below the root from a directory that vanished mid-walk — is a hard
 *  failure appended to `accessErrors` (HEL-993 design.md Decision 0 /
 *  skeptic-design-2.md non-blocking note): that directory's files were never
 *  collected, so the reported count would otherwise silently undercount
 *  without tripping the vacuity check (the surface is usually still
 *  non-empty from its OTHER files). This is the single file-collection path
 *  for every surface (see the header's "the table is load-bearing" note) —
 *  there is no second walker with different error behavior. */
function collectFiles(dir, include, out, accessErrors, isRoot = true) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (!(isRoot && err.code === "ENOENT")) {
      accessErrors.push(
        `${relative(repoRoot, dir)}: cannot list directory (${err.code ?? err.message})`,
      );
    }
    return out;
  }
  for (const entry of entries) {
    if (PRUNED_SUBDIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, include, out, accessErrors, false);
    } else if (include === "sourceNonTest") {
      if (isSourceFile(full) && !isTestFile(full)) out.push(full);
    } else if (include === "allNonBinary") {
      if (!BINARY_FIXTURE_EXTENSIONS.has(extname(full).toLowerCase())) out.push(full);
    } else {
      throw new Error(`collectFiles: unknown include rule "${include}"`);
    }
  }
  return out;
}

/** Reads every collected file's text exactly once, up front (HEL-993
 *  design.md Decision 1). A file that fails to read is appended to
 *  `accessErrors` naming the file and `err.code`/`err.message`, and is
 *  EXCLUDED from the returned `readable` list — so the reported scan count
 *  and per-surface breakdown (both derived from `surfaceRecords[].files`,
 *  never from a separate read-call tally) mean "examined", not merely
 *  "collected". `findBannedImport` below independently re-reads a file
 *  reached through the import-graph walk (including, for the root file,
 *  the SAME file already read here) — that is a harmless second read of
 *  code already covered by this surface's file list, not a double count:
 *  the count comes from `surfaceRecords[].files`, never from read calls. */
function readSurfaceFiles(files, accessErrors) {
  const readable = [];
  const textByFile = new Map();
  for (const file of files) {
    try {
      textByFile.set(file, readFileSync(file, "utf8"));
      readable.push(file);
    } catch (err) {
      accessErrors.push(
        `${relative(repoRoot, file)}: cannot read file (${err.code ?? err.message})`,
      );
    }
  }
  return { readable, textByFile };
}

/** Validates the shape of `SURFACES` itself, before any scan runs: every
 *  `id` is unique, and every entry's `checks` is non-empty and drawn only
 *  from `KNOWN_CHECKS`. Throws — a malformed `SURFACES` entry is a defect in
 *  the gate's own configuration, not a finding about the code it scans, the
 *  same class of failure `collectFiles` already throws on for an
 *  unrecognized `include`. Closes skeptic-final-1.md CR1 (a typo'd/unknown
 *  check name, or an empty `checks` array, silently ran zero checks while
 *  the surface still counted toward a green OK line) and backstops CR2
 *  (a duplicate id) with a clear, named error rather than a confusing
 *  double-counted breakdown line. */
function assertSurfacesValid() {
  const seenIds = new Set();
  for (const surface of SURFACES) {
    if (seenIds.has(surface.id)) {
      throw new Error(`SURFACES: duplicate id "${surface.id}" — every surface id must be unique`);
    }
    seenIds.add(surface.id);

    if (surface.checks.length === 0) {
      throw new Error(`SURFACES: surface "${surface.id}" declares an empty "checks" array`);
    }
    for (const check of surface.checks) {
      if (!KNOWN_CHECKS.has(check)) {
        throw new Error(
          `SURFACES: surface "${surface.id}" declares unrecognized check "${check}" — ` +
            `known checks are: ${[...KNOWN_CHECKS].join(", ")}`,
        );
      }
    }
  }
}

/** Scans one fixture/mcp file's text for a real-shaped bcrypt hash (outside
 *  the allow-listed dummy value) or an email address on a non-placeholder,
 *  non-reserved domain, appending any findings to `errors`. */
function checkFixtureFile(file, text, errors) {
  BCRYPT_HASH_REGEX.lastIndex = 0;
  let bcryptMatch;
  while ((bcryptMatch = BCRYPT_HASH_REGEX.exec(text)) !== null) {
    if (ALLOWED_BCRYPT_HASHES.has(bcryptMatch[0])) continue;
    const line = text.slice(0, bcryptMatch.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: contains a real-shaped bcrypt hash — ` +
        "fixture data must use the repo's dummy bcrypt value, not a real-looking hash",
    );
  }

  EMAIL_REGEX.lastIndex = 0;
  let emailMatch;
  while ((emailMatch = EMAIL_REGEX.exec(text)) !== null) {
    const domain = emailMatch[1].toLowerCase();
    if (ALLOWED_EMAIL_DOMAINS.has(domain)) continue;
    if (domain.endsWith(".test")) continue; // RFC 2606 reserved TLD (design.md Decision 4.1)
    const line = text.slice(0, emailMatch.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: contains an email address on a non-placeholder domain ` +
        `("${domain}") — fixture data must use an allow-listed placeholder domain ` +
        `(${[...ALLOWED_EMAIL_DOMAINS].join(", ")}, or any .test domain)`,
    );
  }
}

/** Scans one `mcp`-surface file's text for a hardcoded credential-shaped
 *  string literal (design.md Decision 4a), appending findings to `errors`.
 *  A synthetic-marker-carrying value is exempted (design.md Decision 4). */
function checkSecretLiterals(file, text, errors) {
  return; // HEL-996 AC3 TEMPORARY MUTATION - proves CI goes red. Reverted in the next commit.
  VENDOR_PREFIX_SECRET_REGEX.lastIndex = 0;
  let vendorMatch;
  while ((vendorMatch = VENDOR_PREFIX_SECRET_REGEX.exec(text)) !== null) {
    const value = vendorMatch[0];
    if (isSyntheticSecretLiteral(value)) continue;
    const line = text.slice(0, vendorMatch.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: contains a hardcoded vendor-prefixed credential-shaped ` +
        `literal — carry a synthetic marker (e.g. "should-never", "dummy") if this is a test fixture`,
    );
  }

  NAMED_SECRET_LITERAL_REGEX.lastIndex = 0;
  let namedMatch;
  while ((namedMatch = NAMED_SECRET_LITERAL_REGEX.exec(text)) !== null) {
    const value = namedMatch[2];
    if (isSyntheticSecretLiteral(value)) continue;
    const line = text.slice(0, namedMatch.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: identifier "${namedMatch[1]}" is assigned a hardcoded ` +
        `credential-shaped literal — carry a synthetic marker (e.g. "should-never", "dummy") if this ` +
        "is a test fixture",
    );
  }
}

/** Scans one delivery-evidence/docs/notes-surface file's text for a
 *  credential-shaped string (HEL-846 design.md Decision 2/4), appending
 *  findings to `errors`. Reuses `VENDOR_PREFIX_SECRET_REGEX` unchanged and
 *  adds the new high-entropy named-literal rule; both are exempted only via
 *  `isSyntheticSecretLiteral`. Deliberately does NOT reuse
 *  `NAMED_SECRET_LITERAL_REGEX` — measured to produce ~15 false positives
 *  against already-committed, immutable archived evidence (design.md
 *  Decision 2). The failure message never echoes the matched value — only
 *  file, line, and the convention hint — which is what makes this check's
 *  own transcripts safe to paste into committed evidence (design.md
 *  Decision 2a). For the delivery-evidence surfaces, eliding the value is
 *  explicitly as acceptable as marking it synthetic. */
function checkDeliverySecrets(file, text, errors) {
  VENDOR_PREFIX_SECRET_REGEX.lastIndex = 0;
  let vendorMatch;
  while ((vendorMatch = VENDOR_PREFIX_SECRET_REGEX.exec(text)) !== null) {
    const value = vendorMatch[0];
    if (isSyntheticSecretLiteral(value)) continue;
    const line = text.slice(0, vendorMatch.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: contains a hardcoded vendor-prefixed credential-shaped ` +
        'literal — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value ' +
        "before committing",
    );
  }

  HIGH_ENTROPY_NAMED_SECRET_REGEX.lastIndex = 0;
  let namedMatch;
  while ((namedMatch = HIGH_ENTROPY_NAMED_SECRET_REGEX.exec(text)) !== null) {
    const value = namedMatch[2];
    if (isSyntheticSecretLiteral(value)) continue;
    const line = text.slice(0, namedMatch.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: identifier "${namedMatch[1]}" is assigned a ` +
        'high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", ' +
        '"dummy") or elide the value before committing',
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
 *  along with the import chain that reached it, or `null` if none. A file
 *  reached through the walk that cannot be read is appended to
 *  `accessErrors` naming it and the underlying error, then skipped (HEL-993
 *  design.md Decision 2): the walk past that node is now incomplete, so "no
 *  banned import found" would be unproven, not a genuine clean result. This
 *  is an independent catch site from `readSurfaceFiles` above — a mutation
 *  of one leaves the other green, so each needs its own self-test case. */
function findBannedImport(rootFile, accessErrors) {
  const visited = new Set([rootFile]);
  const queue = [{ file: rootFile, chain: [rootFile] }];

  while (queue.length > 0) {
    const { file, chain } = queue.shift();
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (err) {
      accessErrors.push(
        `${relative(repoRoot, file)}: cannot read file reached through the import-graph walk from ` +
          `${relative(repoRoot, rootFile)} (${err.code ?? err.message}) — the walk is incomplete and proves nothing`,
      );
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

function checkTextPatterns(file, text, errors) {
  CREDENTIAL_PROP_REGEX.lastIndex = 0;
  let match;
  while ((match = CREDENTIAL_PROP_REGEX.exec(text)) !== null) {
    const key = `${relative(repoRoot, file)}:${match.index}`;
    if (ALLOWED_CREDENTIAL_PROPS.has(key)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    errors.push(
      `${relative(repoRoot, file)}:${line}: declares a property literally named "credential" — ` +
        "the agent/chat surface must never carry a credential-shaped field",
    );
  }
}

/** Runs every check named in `surface.checks` over `files`, appending
 *  findings to `errors`. This is the ONLY place checks are dispatched —
 *  driven entirely by the `SURFACES` table entry, never by a surface's `id`
 *  string matched elsewhere (see the header's "the table is load-bearing"
 *  note). `textByFile` holds each file's text read once up front by
 *  `readSurfaceFiles` (HEL-993 design.md Decision 1) — `files` here is
 *  ALREADY filtered to files that were readable, so a lookup miss can never
 *  happen; a text-needing check never re-reads. `accessErrors` is threaded
 *  through only for `findBannedImport`'s independent BFS read failures. */
function runChecksForSurface(surface, files, textByFile, accessErrors, errors) {
  for (const file of files) {
    if (surface.checks.includes("importGraph")) {
      const found = findBannedImport(file, accessErrors);
      if (found) {
        const chainStr = found.chain.map((f) => relative(repoRoot, f)).join(" -> ");
        errors.push(
          `${relative(repoRoot, file)}: transitively imports banned module "${found.bannedModule}" (${chainStr})`,
        );
      }
    }

    const needsText =
      surface.checks.includes("credentialProp") ||
      surface.checks.includes("bcrypt") ||
      surface.checks.includes("email") ||
      surface.checks.includes("secretLiteral") ||
      surface.checks.includes("deliverySecret");
    if (!needsText) continue;

    const text = textByFile.get(file);

    if (surface.checks.includes("credentialProp")) checkTextPatterns(file, text, errors);
    // bcrypt and email are always checked together by `checkFixtureFile` —
    // every surface that declares one declares both today (design.md
    // Decision 3's fixture-style checks are a pair, not independent knobs).
    if (surface.checks.includes("bcrypt") || surface.checks.includes("email")) {
      checkFixtureFile(file, text, errors);
    }
    if (surface.checks.includes("secretLiteral")) checkSecretLiterals(file, text, errors);
    if (surface.checks.includes("deliverySecret")) checkDeliverySecrets(file, text, errors);
  }
}

// ── Coverage-drift guard (design.md Decision 1/1a/1b) ───────────────────────

// Hardcoded duplicate of the UNANCHORED (root-matching) directory patterns
// in `.gitignore` — see the header comment above for the full table and the
// rationale for why this isn't derived at runtime.
const IGNORED_TOP_LEVEL = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
]);

// PARTIAL: a declared surface root is beneath this top-level directory, but
// the rest of the directory is deliberately not scanned. Distinct from
// UNSCANNED so a future loss of the surface root is never indistinguishable
// from a deliberate acknowledgment (design.md Decision 1a).
const PARTIAL_COVERAGE = {
  frontend:
    "only frontend/src/features/assistant/** (the `assistant` surface) is scanned; the rest of " +
    "the frontend tree is not an agent-facing or credential-fixture surface",
  backend:
    "only backend/src/test/resources/** (the `fixture` surface) is scanned; backend application " +
    "source is a code tree where the named-literal shape is common (e.g. test values like " +
    "`re_test_key_should_never_be_logged`) and widening the scan there is a deliberate, tracked " +
    "follow-up, not this ticket's scope (HEL-846 design.md Decision 3)",
};

// UNSCANNED: no declared surface root touches this top-level directory at
// all. Each entry states why that's an acceptable, deliberate gap.
const ACKNOWLEDGED_UNSCANNED = {
  e2e: "Playwright specs against the running app, not a credential-fixture or agent-surface directory",
  infra:
    "deployment scripts read secrets from the environment/Secret Manager; none are committed here",
  schemas: "JSON Schema contract definitions; no credential-shaped values are ever declared there",
  scripts:
    "build/CI tooling scripts; a code tree where the named-literal shape is common and widening " +
    "the scan there is a deliberate, tracked follow-up, not this ticket's scope " +
    "(HEL-846 design.md Decision 3)",
};

/** Classifies every top-level directory name in `topLevelDirNames` into
 *  `covered` / `partial` / `unscanned`, or collects it as `unclassified`.
 *  Exported as a pure function (rather than only run against
 *  `readdirSync(repoRoot)`) so task 2.6/5.5's verification can invoke it
 *  against the MAIN CHECKOUT's directory listing too, without modifying
 *  that checkout or running its own (pre-change) copy of this script —
 *  see design.md Decision 1b. Pure: no filesystem access, no process.exit —
 *  safe to import without triggering a scan (unlike the CLI body below,
 *  which only runs under the `import.meta.url` entry guard). */
export function classifyTopLevelDirs(topLevelDirNames) {
  const result = { covered: [], partial: [], unscanned: [], unclassified: [] };
  for (const name of topLevelDirNames) {
    if (name.startsWith(".")) continue; // dot-directories are out of scope (design.md 1c)
    if (IGNORED_TOP_LEVEL.has(name)) continue;

    const dirPath = join(repoRoot, name);
    const fullyCovered = SURFACES.some((s) => relative(dirPath, s.root) === "");
    const surfaceBeneath = SURFACES.some((s) => {
      const rel = relative(dirPath, s.root);
      // `rel` is the path from `dirPath` to the surface root. It's "beneath"
      // `dirPath` exactly when it's non-empty (not equal — that's the
      // fullyCovered case above) and doesn't start by climbing out (`..`).
      return rel !== "" && !rel.startsWith("..");
    });

    if (fullyCovered) {
      result.covered.push(name);
    } else if (surfaceBeneath) {
      if (Object.prototype.hasOwnProperty.call(PARTIAL_COVERAGE, name)) {
        result.partial.push(name);
      } else {
        result.unclassified.push(name);
      }
    } else if (Object.prototype.hasOwnProperty.call(ACKNOWLEDGED_UNSCANNED, name)) {
      result.unscanned.push(name);
    } else {
      result.unclassified.push(name);
    }
  }
  return result;
}

/** Computes the coverage-drift errors (one per unclassified top-level
 *  directory) without exiting — collected here rather than exiting
 *  immediately so a drift finding and a vacuity finding that are both true
 *  on the same run (e.g. the self-test's helio-mcp-rename case, where the
 *  moved-aside directory is simultaneously an unclassified top-level
 *  directory AND the cause of a zero-file `mcp` surface) are BOTH reported,
 *  instead of the first-computed check silently masking the second
 *  (design.md Decision 5's ordering note). */
function computeDriftErrors() {
  const topLevelDirNames = readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const { unclassified } = classifyTopLevelDirs(topLevelDirNames);
  return unclassified.map(
    (name) =>
      `COVERAGE DRIFT: top-level directory "${name}" is not classified as covered, ` +
      "partial, or acknowledged-unscanned. Add it to a declared surface's root (SURFACES), " +
      "to PARTIAL_COVERAGE with the scanned subtree and a reason, or to ACKNOWLEDGED_UNSCANNED " +
      "with a one-line reason.",
  );
}

/** The CLI body — runs the full gate against the real filesystem and calls
 *  `process.exit`. Guarded so that importing this module (e.g. for
 *  `classifyTopLevelDirs`, as the verification steps in tasks 2.6/5.5 do)
 *  never runs a scan or exits as a side effect. */
// Set to `true` the moment `main()`'s body starts, so the entry-guard
// backstop below can detect "this module was the process entry but main()
// never ran" (HEL-993 design.md Decision 3) independently of the strict
// entry comparison.
let mainRan = false;

function main() {
  mainRan = true;

  // Validate the table itself before touching the filesystem at all — a
  // malformed SURFACES entry is a defect in the gate's own configuration
  // (skeptic-final-1.md CR1/CR2), and should fail loudly and immediately
  // rather than after a scan that may already have printed something.
  assertSurfacesValid();

  const driftErrors = computeDriftErrors();

  // Access errors (unreadable file, unlistable directory, unreadable
  // import-graph node) accumulate here across every surface (HEL-993
  // design.md Decision 1/1a/2) — reported first, in the same early-exit
  // batch as drift and vacuity, so a read/listing failure is never masked by
  // either.
  const accessErrors = [];

  // Single loop over the surface table: this is the ONE place file lists
  // are built, and the counts below are derived from these SAME lists —
  // never from a second, hand-keyed structure (see header note; this is
  // exactly the defect this refactor closes). Positionally paired records
  // (`{ surface, files }`), NOT a lookup keyed by `surface.id` — so a
  // duplicate id (already rejected by `assertSurfacesValid` above) could
  // not silently drop a file list even if that assertion were ever bypassed
  // (skeptic-final-1.md CR2). `files` is filtered to files this run actually
  // READ successfully (HEL-993 design.md Decision 1a) — the reported count
  // and per-surface breakdown below mean "examined", not merely "collected".
  const surfaceRecords = SURFACES.map((surface) => {
    const collected = collectFiles(surface.root, surface.include, [], accessErrors);
    const { readable, textByFile } = readSurfaceFiles(collected, accessErrors);
    return { surface, files: readable, textByFile };
  });

  const allErrors = [];
  for (const { surface, files, textByFile } of surfaceRecords) {
    runChecksForSurface(surface, files, textByFile, accessErrors, allErrors);
  }

  // ── Vacuity check (design.md Decision 2) — a declared surface matching
  //    zero files is a failure, not a passing contribution of zero
  //    violations. Iterates `surfaceRecords` directly (populated for every
  //    entry above), so an entry with no matching files can never be missed
  //    the way a parallel hand-keyed count object could be. Note this now
  //    also fires when EVERY collected file of a surface turned out
  //    unreadable (HEL-993 design.md Decision 1a) — that case reports BOTH
  //    the named access errors above AND this vacuity line, never just the
  //    latter. ─────────────────────────────────────────────────────────
  const vacuousRecords = surfaceRecords.filter((r) => r.files.length === 0);
  const vacuityErrors = vacuousRecords.map(
    ({ surface }) =>
      `VACUOUS SURFACE: "${surface.id}" (root ${relative(repoRoot, surface.root)}) matched zero ` +
      "files. A surface matching nothing means its root has moved, been renamed, or been " +
      "deleted — fix the surface's root, or remove it from SURFACES and reclassify the " +
      "directory in the coverage-drift guard.",
  );

  // Access errors, then drift, then vacuity (HEL-993 design.md Decision 1a):
  // a structural coverage problem is more fundamental than a content
  // violation found within that (possibly wrong) coverage, and a file/
  // directory the gate never actually examined is more fundamental still —
  // none of the three may silently mask another (see `computeDriftErrors`'s
  // doc comment).
  if (accessErrors.length > 0 || driftErrors.length > 0 || vacuityErrors.length > 0) {
    console.error("check-no-credential-in-agent-surface: FAIL\n");
    for (const err of [...accessErrors, ...driftErrors, ...vacuityErrors])
      console.error(`  - ${err}`);
    process.exit(1);
  }

  const totalFilesScanned = surfaceRecords.reduce((sum, r) => sum + r.files.length, 0);

  if (allErrors.length > 0) {
    console.error("check-no-credential-in-agent-surface: FAIL\n");
    for (const err of allErrors) console.error(`  - ${err}`);
    console.error(
      `\n${allErrors.length} violation(s). The agent/chat surface (frontend/src/features/assistant/**) ` +
        "must never import a credential-carrying component or declare a field literally named " +
        '"credential" (HEL-829 design.md Decision 4); fixture/dump and helio-mcp directories ' +
        "must never carry a real-shaped bcrypt hash or a non-placeholder-domain email address " +
        "(HEL-927); helio-mcp files must never carry a hardcoded credential-shaped string " +
        "literal without a synthetic marker (HEL-956); and delivery-evidence files under " +
        "openspec/, docs/ and notes/ must never carry a vendor-prefixed or high-entropy " +
        "credential-shaped value without a synthetic marker, or must have the value elided " +
        "(HEL-846).",
    );
    process.exit(1);
  } else {
    const breakdown = surfaceRecords
      .map(({ surface, files }) => `${files.length} ${surface.id}`)
      .join(", ");
    console.log(
      `check-no-credential-in-agent-surface: OK (${totalFilesScanned} files scanned: ` +
        `${breakdown}, 0 violations)`,
    );
  }
}

// Entry guard: only run the CLI body when this file is the actual process
// entry point, not merely imported (e.g. for `classifyTopLevelDirs`, as the
// verification steps in tasks 2.6/5.5 do). Compares REALPATH-resolved
// `file://` URLs rather than a raw string/URL comparison
// (``import.meta.url === `file://${process.argv[1]}` ``), because that raw
// form evaluates false — silently never running `main()` — for a path
// containing a percent-encoded character (e.g. a space) or an invocation
// through a symlink, both of which `pathToFileURL` normalizes and
// `realpathSync` resolves away. Neither is reachable from this repo's own
// Husky invocation today. HEL-993 closed the residual shape risk this
// comment used to claim was "fixed rather than left as a documented
// residual limit": that claim was true for symlinks/percent-encoding, but
// the guard was still fail-OPEN in shape — if this comparison were ever
// false while this module WAS the process entry (a future refactor, a
// runtime path-normalization change, etc.), the process would exit 0
// having printed nothing. The independent backstop below closes that shape;
// see it for what actually changed.
const entryArg = process.argv[1];
const entryRealPath = entryArg ? realpathSync(entryArg) : null;
if (entryRealPath && import.meta.url === pathToFileURL(entryRealPath).href) {
  main();
}

// HEL-993 design.md Decision 3 — an independent, DELIBERATELY WEAKER
// fail-closed backstop: basename-only, not realpath-resolved-URL equality.
// It must NOT reuse the strict comparison's expression above, or a defect in
// that expression would mask itself here too — the whole point is an
// independently-computed answer to "was this module plausibly the process
// entry?". If it was (by this weaker test) and `main()` never actually ran,
// that is exactly the silent-zero-exit shape this ticket exists to close:
// print a diagnostic and exit non-zero instead. This is a backstop, never
// the primary guard — it is weaker on purpose (it would false-positive on a
// same-basename importer, which the strict guard above does not), so it
// only fires once the strict guard has already failed to set `mainRan`.
if (
  entryRealPath &&
  !mainRan &&
  basename(entryRealPath) === basename(fileURLToPath(import.meta.url))
) {
  console.error(
    "check-no-credential-in-agent-surface: FATAL — this module was the process entry point " +
      "(argv[1] shares its basename with this module) but main() never ran; the entry-guard " +
      "comparison must have evaluated false. Refusing to exit 0 silently.",
  );
  process.exit(1);
}
