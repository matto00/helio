#!/usr/bin/env node
// Self-test for scripts/check-node-root-encoding.ts.mjs (HEL-913 task 9.10-i: "prove the
// TypeScript guard fires" -- the same standard 5.8b-i already set for the Scala guard: a guard
// never observed failing against the defect it names is not evidence). Drives
// `scanTextForViolations` against in-memory fixture text and read-only copies of the real
// context.ts (nothing is written) -- and asserts on the VIOLATION COUNT AND CONTENT, never on
// "the function ran without throwing" alone.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanTextForViolations,
  staleForUnscannedFiles,
  KNOWN_EXEMPTIONS,
} from "./check-node-root-encoding.ts.mjs";

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) {
    failures++;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ── Check 1: value-level `nodeStepId ?? null` / `|| null` ───────────────────────────────────

// (a) The literal null-coalesce form, no rootId anywhere nearby -- FIRES.
{
  const text = `      nodeStepId: o.nodeStepId ?? null,\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check("value-level ?? null fires", violations.length, 1);
}

// (b) The `||` variant -- FIRES.
{
  const text = `      nodeStepId: o.nodeStepId || null,\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check("value-level || null fires", violations.length, 1);
}

// (c) A same-line `rootId` qualifier -- does NOT fire.
{
  const text = `      const x = { nodeStepId: o.nodeStepId ?? null, rootId: o.rootId ?? null };\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check("value-level same-line rootId does not fire", violations.length, 0);
}

// (d) The REAL context.ts text with its shipped exemption is clean; a line shift (40 comment
// lines at the top, 40 non-comment lines above the function) keeps it clean.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CTX = "helio-mcp/src/context.ts";
const ctxText = readFileSync(join(repoRoot, CTX), "utf8");
const SITE = "nodeStepId: o.nodeStepId ?? null,";
const stale = (m) => String(m).startsWith("stale exemption:");
const mentions = (v, file, text) => String(v).includes(file) && String(v).includes(text);
{
  check("(d) real context.ts is clean", scanTextForViolations(CTX, ctxText), []);
  const shifted =
    Array.from({ length: 40 }, (_, i) => `// shifted ${i}`).join("\n") +
    "\n" +
    ctxText.replace(
      "async function buildOutputSummariesByPipeline",
      "const harmless = 1;\n".repeat(40) + "async function buildOutputSummariesByPipeline",
    );
  check("(d) line-shifted context.ts stays green", scanTextForViolations(CTX, shifted), []);
  check("(d) shifted text really differs", shifted === ctxText, false);
}

// (d2) A `case ... =>` line in an EARLIER function must not leak into the exempt function's arm
// (the arm resets on every scope change): the real site stays green.
{
  const marker = "async function buildOutputSummariesByPipeline";
  const t = ctxText.replace(
    marker,
    'function earlier(k: string) {\n  case "a": return () => 1;\n}\n' + marker,
  );
  check("(d2) shifted-in case arm does not leak across scopes", scanTextForViolations(CTX, t), []);
  check("(d2) text really differs", t === ctxText, false);
}

// (text) Changing the exempt line's text in place (same scope and arm) is red: one unmatched hit
// plus one stale entry. Pins the `text` component of the key.
{
  const pair = `${SITE}\n        rootId: o.rootId ?? null,`;
  const weakened = "nodeStepId: o.nodeStepId || null,";
  const t = ctxText.replace(pair, weakened);
  check("(text) pair really replaced", t === ctxText, false);
  const v = scanTextForViolations(CTX, t);
  check("(text) changed text: unmatched hit + stale entry", v.length, 2);
  check(
    "(text) unmatched hit names the new text",
    v.some((m) => !stale(m) && mentions(m, CTX, weakened)),
    true,
  );
  check(
    "(text) stale entry reported",
    v.some((m) => stale(m)),
    true,
  );
}

// (e) A verbatim copy of the exempt line in the SAME function: both occurrences red.
{
  const at = ctxText.indexOf(SITE);
  const dup = ctxText.slice(0, at) + SITE + "\n        " + ctxText.slice(at);
  const v = scanTextForViolations(CTX, dup);
  check("(e) same-scope duplicate: both occurrences red", v.length, 2);
  check(
    "(e) same-scope duplicate names count mismatch and text",
    v.every((m) => m.includes("2 occurrences, exemption covers 1") && mentions(m, CTX, SITE)),
    true,
  );
}

// (e2) The same line pasted into a DIFFERENT function, and into a different file: red.
{
  const pasted =
    ctxText +
    `\nfunction pasted(o: any) {\n  return { ${SITE} };\n}\n`
      .replace("{ nodeStepId", "{\n  nodeStepId")
      .replace(",", ",\n");
  const v = scanTextForViolations(CTX, pasted);
  check("(e2) other-function copy: exactly one violation", v.length, 1);
  check("(e2) other-function copy names file and text", mentions(v[0], CTX, SITE), true);
  check(
    "(e2) same text in another file is red",
    scanTextForViolations(
      "helio-mcp/src/other.ts",
      `function buildOutputSummariesByPipeline() {\n  ${SITE}\n}`,
    ).length,
    1,
  );
}

// (f0) Removing the exemption turns the real site red, naming file and text.
{
  const v = scanTextForViolations(CTX, ctxText, []);
  check("(f0) removed exemption: site red", v.length, 1);
  check("(f0) removed exemption names file and text", mentions(v[0], CTX, SITE), true);
}

// (g0) Deleting the site makes the entry stale; a missing file (empty text) does too.
{
  const v = scanTextForViolations(CTX, ctxText.replace(SITE, "// gone"));
  check("(g0) deleted site: one stale exemption", v.length, 1);
  check(
    "(g0) stale message names the entry",
    stale(v[0]) && String(v[0]).includes("buildOutputSummariesByPipeline"),
    true,
  );
  const m = scanTextForViolations(CTX, "");
  check("(g0) missing file (empty text): entry stale", m.length === 1 && stale(m[0]), true);
  check(
    "(g0) file without entries and empty text: nothing",
    scanTextForViolations("helio-mcp/src/x.ts", ""),
    [],
  );
}

// (h0) A hit preceded by a `/* ... */` comment on the same line is still a hit.
check(
  "(h0) leading /* */ comment does not hide a hit",
  scanTextForViolations("fake/File.ts", "/* note */ nodeStepId: o.nodeStepId ?? null,").length,
  1,
);
{
  const v = staleForUnscannedFiles(["helio-mcp/src/other.ts"]);
  check(
    "(g1) entry-point post-scan: unscanned entry file reports stale",
    v.length === 1 && stale(v[0]),
    true,
  );
  check("(g1) scanned entry file reports nothing", staleForUnscannedFiles([CTX]), []);
  check(
    "(g1) absolute-form path would not match (repo-relative required)",
    staleForUnscannedFiles([join(repoRoot, CTX)]).length,
    1,
  );
}
check("shipped table has 1 entry", KNOWN_EXEMPTIONS.length, 1);

// (e-old) The SAME pattern at a non-exempted location in a file with NO entry fires.
{
  const text = Array.from({ length: 10 }, (_, i) => (i === 4 ? "      " + SITE : "")).join("\n");
  check(
    "same value-level pattern in a non-exempted file still fires",
    scanTextForViolations("helio-mcp/src/other.ts", text).length,
    1,
  );
}

// ── Check 2: type-level -- an interface declaring nodeStepId with no rootId sibling ──────────

// (f) An interface with `nodeStepId` and NO `rootId` anywhere in the block -- FIRES.
{
  const text = `export interface Foo {\n  id: string;\n  nodeStepId?: string;\n  kind: string;\n}\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check("interface with nodeStepId, no rootId, fires", violations.length, 1);
}

// (g) The SAME interface, but WITH a `rootId` field elsewhere in the block -- does NOT fire.
{
  const text = `export interface Foo {\n  id: string;\n  nodeStepId?: string;\n  rootId?: string;\n  kind: string;\n}\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check("interface with nodeStepId AND rootId does not fire", violations.length, 0);
}

// (h) An interface named in KNOWN_TYPE_EXEMPT_INTERFACES (the real, reviewed
// `ProposalOutputSummary` exception -- backend genuinely has no rootId there, confirmed
// single-source by design) does NOT fire even without a rootId field.
{
  const text = `export interface ProposalOutputSummary {\n  id: string;\n  name: string;\n  kind: string;\n  nodeStepId?: string | null;\n}\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check(
    "KNOWN_TYPE_EXEMPT_INTERFACES entry (ProposalOutputSummary) does not fire",
    violations.length,
    0,
  );
}

// (i) An interface with NEITHER nodeStepId nor rootId -- does not fire (nothing to flag).
{
  const text = `export interface Bar {\n  id: string;\n  name: string;\n}\n`;
  const violations = scanTextForViolations("fake/File.ts", text);
  check("interface with neither field does not fire", violations.length, 0);
}

if (failures > 0) {
  console.error(`\n${failures} selftest case(s) failed.`);
  process.exit(1);
}
console.log("\nAll check-node-root-encoding.ts selftest cases passed.");
