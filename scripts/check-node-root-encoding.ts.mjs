#!/usr/bin/env node
/**
 * HEL-913 task 9.10: the TypeScript sibling of `check-node-root-encoding.mjs` (the Scala guard
 * against design.md R12's "absent `nodeStepId` means THE root" encoding). That script's own
 * header names this gap explicitly: "DOES NOT COVER: TypeScript (`helio-mcp/**`) ... a sibling
 * guard in that codebase, not this one. Do not treat a green run of THIS script as evidence the
 * TypeScript surface is also clean." This script is what makes that statement SAFE rather than
 * merely honest -- it is the reason `helioApi.createPipeline`'s legacy-scalar-body break (found
 * task 9's own audit) was NOT the only kind of "gate green, surface broken" MCP defect: an
 * `OutputResponse`/`WorkspaceContextOutputSummary` that carries `nodeStepId` with no sibling
 * `rootId` is the identical encoding, one language over, and no `tsc --noEmit` run catches it
 * (it is a structurally valid, fully-typed TypeScript program either way).
 *
 * TWO independent checks, mirroring the Scala guard's two detection forms (raw SQL / Slick):
 *
 *   1. VALUE-LEVEL (per-line): a `nodeStepId ?? null` / `nodeStepId || null` construction --
 *      the literal null-coalesce that turns "absent" into the wire value `null`, precisely
 *      R12/R15's banned form -- is a violation UNLESS the SAME LINE also names `rootId`.
 *   2. TYPE-LEVEL (per-interface): a TypeScript `interface`/inline object-type block that
 *      declares a `nodeStepId` field but has NO `rootId` field anywhere in that SAME block is a
 *      violation. This is the check task 9.10 exists for specifically -- "the TYPE, not only
 *      the VALUE" (the coordinator's own framing): a value-level check alone would have missed
 *      `types.ts.OutputResponse` lacking `rootId` entirely, since nothing IN THAT FILE ever
 *      wrote `nodeStepId ?? null` against it -- the omission was structural, in the shape of
 *      the type itself, not in any one line of code that used it.
 *
 * COVERAGE, STATED HONESTLY (same standard `check-node-root-encoding.mjs`'s own header sets):
 *   - COVERS: `helio-mcp/src/**\/*.ts`, excluding `*.test.ts` (test fixtures legitimately
 *     construct partial/mock shapes that are not the real contract).
 *   - DOES NOT COVER: `backend/**` (that is the Scala guard's job) or `frontend/**` (out of
 *     scope for this whole ticket).
 *   - DOES NOT COVER every possible TypeScript spelling of "absent means root" -- e.g. a
 *     destructured `const { nodeStepId } = output` with no `rootId` alongside it, if `output`'s
 *     own TYPE already carries `rootId` (this script's type-level check on that type is what
 *     catches the real gap; a value-level check on every destructure would be extremely noisy
 *     and low-signal). Text-level, not a real type-checker -- like its Scala sibling.
 *   - The type-level check is INTERFACE-BLOCK-SCOPED: it does not understand `extends`/spread
 *     composition (a type inheriting `rootId` from a base interface it `extends` would be
 *     flagged as if it lacked the field entirely). `KNOWN_TYPE_EXEMPT_INTERFACES` below is the
 *     explicit, itemized escape hatch for that case, exactly like the Scala guard's
 *     `KNOWN_EXEMPTIONS`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = join(repoRoot, "helio-mcp", "src");

// Interfaces that legitimately declare `nodeStepId` with NO `rootId` sibling -- reviewed and
// found correct, named here rather than silently exempted (mirrors the Scala guard's own
// `KNOWN_EXEMPTIONS` convention: an itemized escape hatch, not a blanket one).
const KNOWN_TYPE_EXEMPT_INTERFACES = new Set([
  // ProposalOutputSummary (types.ts) mirrors the backend's `ProposalOutputSummary` verbatim
  // (`PipelineProposalProtocol.scala`'s `ProposalOutputSummary` case class) -- that backend type genuinely has NO `rootId` field,
  // because `apply_pipeline_proposal` is confirmed single-source by design (HEL-913 7.2a's own
  // finding: PipelineProposalService never touched the multi-root wire fields). Adding a
  // `rootId` here would claim a capability the backend does not have.
  "ProposalOutputSummary",
]);

// Value-level: `nodeStepId ?? null` / `nodeStepId || null` -- the literal encode-absence-as-null
// construction. `\b` boundaries so this doesn't match `someNodeStepIdish` etc.
const NULL_COALESCE_FORM = /\bnodeStepId\s*(\?\?|\|\|)\s*null\b/;

// Lines already reviewed where a real `rootId` companion IS present, just on an ADJACENT line
// (an object literal spanning several lines) rather than the same one -- mirrors the Scala
// guard's content-keyed `KNOWN_EXEMPTIONS` convention exactly (HEL-1282: previously keyed on
// `relPath:lineNumber`, which broke on any unrelated edit above the site), for the identical
// reason (a plain per-line check cannot see a value split across lines). An entry is
// `{ file, scope, arm, text, count, reason }`: `scope` is the nearest preceding
// `function <name>`, `arm` the governing `case ... =>` line in that scope (`<none>` here),
// `text` the whitespace-normalised hit line, `count` the EXACT number of occurrences covered.
// More hits than `count` -> every hit in the group is a violation; fewer -> the entry is
// reported STALE (and the guard fails); no matching key -> violation. `file` is repo-relative,
// the same form the entry point passes to `scanTextForViolations`.
export const KNOWN_EXEMPTIONS = [
  {
    file: "helio-mcp/src/context.ts",
    scope: "buildOutputSummariesByPipeline",
    arm: "<none>",
    text: "nodeStepId: o.nodeStepId ?? null,",
    count: 1,
    // context.ts's buildOutputSummariesByPipeline: `nodeStepId: o.nodeStepId ?? null,` is
    // immediately followed by `rootId: o.rootId ?? null,` in the SAME object literal (the very
    // next line) -- verified by eye, not merely assumed, since 8.1a's own lesson is that a gate's
    // green result is scoped to exactly what it can see, and a per-line regex genuinely cannot
    // see the next line.
    reason: "rootId companion is on the very next line of the same object literal",
  },
];

function isRootQualifiedSameLine(line) {
  return /rootId/.test(line);
}

/** Finds every top-level `interface Name { ... }` block's [name, bodyText, bodyStartLine]. Also
 *  matches a `satisfies X` object-literal-typed block is NOT attempted -- interface declarations
 *  only, which is where every real shape in this codebase's `types.ts`/`context.ts` lives. */
function findInterfaceBlocks(text) {
  const blocks = [];
  const re = /\binterface\s+(\w+)\s*(?:extends\s+[^{]+)?\{/g;
  let m;
  while ((m = re.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 1;
    let i = openIdx + 1;
    while (depth > 0 && i < text.length) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      i += 1;
    }
    const body = text.slice(openIdx + 1, i - 1);
    const bodyStartLine = text.slice(0, openIdx + 1).split("\n").length;
    blocks.push({ name: m[1], body, bodyStartLine });
  }
  return blocks;
}

const normalise = (line) => line.trim().replace(/\s+/g, " ");
const SCOPE_RE = /\bfunction\s+(\w+)/;
const ARM_RE = /^\s*case\b.*=>/;
const NO_ARM = "<none>";
const keyOf = (file, scope, arm, text) => JSON.stringify([file, scope, arm, text]);

/** Exported for the selftest (task 9.10-i, "prove the guard fires"): scans already-in-memory
 *  text (no disk access), mirroring `check-node-root-encoding.mjs`'s `scanTextForViolations`
 *  export contract exactly, so both guards' selftests share the same shape. `exemptions`
 *  defaults to the shipped table; stale entries for `relPath` are returned in the same array,
 *  prefixed `stale exemption:`. */
export function scanTextForViolations(relPath, text, exemptions = KNOWN_EXEMPTIONS) {
  const found = [];

  // Check 1: value-level, per-line.
  const hits = [];
  let scope = "<top>";
  let arm = NO_ARM;
  text.split("\n").forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    const declared = SCOPE_RE.exec(raw);
    if (declared) {
      scope = declared[1];
      arm = NO_ARM;
    }
    if (ARM_RE.test(raw)) arm = normalise(raw);
    if (!NULL_COALESCE_FORM.test(raw)) return;
    if (isRootQualifiedSameLine(raw)) return;
    hits.push({ lineNo: idx + 1, trimmed, key: keyOf(relPath, scope, arm, normalise(raw)) });
  });

  const entries = new Map();
  for (const e of exemptions) {
    if (e.file === relPath) entries.set(keyOf(e.file, e.scope, e.arm, e.text), e);
  }
  const groups = new Map();
  for (const h of hits) groups.set(h.key, [...(groups.get(h.key) ?? []), h]);

  for (const h of hits) {
    const entry = entries.get(h.key);
    const n = groups.get(h.key).length;
    if (entry && n === entry.count) continue;
    const surplus = entry ? ` -- ${n} occurrences, exemption covers ${entry.count}` : "";
    found.push(
      `${relPath}:${h.lineNo}: null-means-root value encoding ("${h.trimmed}") -- see design.md R12${surplus}`,
    );
  }
  for (const [key, e] of entries) {
    const n = groups.get(key)?.length ?? 0;
    if (n < e.count) {
      found.push(
        `stale exemption: ${relPath} scope '${e.scope}' arm '${e.arm}' text "${e.text}" ` +
          `matches ${n} line(s), expected ${e.count} -- delete or update the KNOWN_EXEMPTIONS entry`,
      );
    }
  }

  // Check 2: type-level, per-interface-block.
  for (const { name, body, bodyStartLine } of findInterfaceBlocks(text)) {
    if (KNOWN_TYPE_EXEMPT_INTERFACES.has(name)) continue;
    const hasNodeStepId = /^\s*nodeStepId\s*[?:]/m.test(body);
    if (!hasNodeStepId) continue;
    const hasRootId = /\brootId\b/.test(body);
    if (hasRootId) continue;
    found.push(
      `${relPath}:${bodyStartLine}: interface '${name}' declares nodeStepId with no rootId ` +
        `sibling -- see design.md R12 (name it in KNOWN_TYPE_EXEMPT_INTERFACES if this is a ` +
        `genuine, reviewed single-source-by-design exception)`,
    );
  }

  return found;
}

/** Entry-point post-scan pass: an exemption whose file was not among `scannedRelPaths`
 *  (renamed/deleted) is stale -- scanning "" reports it. Paths must be in the same repo-relative
 *  form the table uses. Exported pure so the selftest can drive it without touching the repo. */
export function staleForUnscannedFiles(scannedRelPaths, exemptions = KNOWN_EXEMPTIONS) {
  const scanned = new Set(scannedRelPaths);
  const found = [];
  for (const file of new Set(exemptions.map((e) => e.file))) {
    if (!scanned.has(file)) found.push(...scanTextForViolations(file, "", exemptions));
  }
  return found;
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Only run the real file scan (and exit) when this module is the entry point --
// importing `scanTextForViolations` (the selftest, task 9.10-i) must not trigger it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = [];
  const files = listTsFiles(SRC_ROOT);

  for (const absPath of files) {
    const relPath = relative(repoRoot, absPath);
    const text = readFileSync(absPath, "utf8");
    violations.push(...scanTextForViolations(relPath, text));
  }

  violations.push(...staleForUnscannedFiles(files.map((absPath) => relative(repoRoot, absPath))));

  if (violations.length > 0) {
    process.stderr.write(
      `check-node-root-encoding.ts: ${violations.length} violation(s) of design.md R12's ` +
        `"absent nodeStepId means THE root" rule, in helio-mcp/src/**:\n\n`,
    );
    for (const v of violations) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      "\nA root-bound value/type must carry a real root id (rootId), never a bare absent-means-" +
        "root reading. If this is a genuine, reviewed exception, name the interface in " +
        "KNOWN_TYPE_EXEMPT_INTERFACES with the reason.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `check-node-root-encoding.ts: clean (${files.length} file(s) scanned under helio-mcp/src/**, ` +
      `excluding *.test.ts -- see this script's header for what it does NOT cover)\n`,
  );
}
