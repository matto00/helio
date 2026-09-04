#!/usr/bin/env node
// Self-test for scripts/check-node-root-encoding.ts.mjs (HEL-913 task 9.10-i: "prove the
// TypeScript guard fires" -- the same standard 5.8b-i already set for the Scala guard: a guard
// never observed failing against the defect it names is not evidence). Drives
// `scanTextForViolations` against in-memory fixture text -- no disk, no real repo files touched
// -- and asserts on the VIOLATION COUNT AND CONTENT, never on "the function ran without
// throwing" alone.

import { scanTextForViolations } from "./check-node-root-encoding.ts.mjs";

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

// (d) A line inside KNOWN_ROOT_QUALIFIED_LINES for the REAL target file does not fire (proves
// the exemption mechanism works, using the actual exempted line from the shipped file: rootId
// is present on the VERY NEXT line, not this one).
{
  const relPath = "helio-mcp/src/context.ts";
  const lines = Array.from({ length: 206 }, () => "");
  lines[204] = "        nodeStepId: o.nodeStepId ?? null,"; // line 205 (0-indexed 204)
  lines[205] = "        rootId: o.rootId ?? null,"; // line 206
  const text = lines.join("\n");
  const violations = scanTextForViolations(relPath, text);
  check("known-root-qualified line 205 of context.ts is exempted", violations.length, 0);
}

// (e) The SAME banned pattern at a DIFFERENT, non-exempted line in context.ts DOES fire --
// proves the exemption is line-pinned, not file-wide.
{
  const relPath = "helio-mcp/src/context.ts";
  const lines = Array.from({ length: 10 }, () => "");
  lines[4] = "      nodeStepId: o.nodeStepId ?? null,";
  const text = lines.join("\n");
  const violations = scanTextForViolations(relPath, text);
  check("same value-level pattern at a non-exempted line still fires", violations.length, 1);
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
