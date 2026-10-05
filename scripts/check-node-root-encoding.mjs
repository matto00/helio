#!/usr/bin/env node
/**
 * HEL-913 design.md R12, tasks.md 5.8b/5.8b-i/5.8b-ii/5.8b-iii: mechanical guard against the
 * "`node_step_id IS NULL` (alone) means the pipeline's raw root" encoding, on the three tables
 * R12 rebinds (`outputs`, `node_snapshots`, `binary_refs`). Under multi-root, that predicate is
 * ambiguous -- it means "every root", not "the root" -- so R12 bans it as a STANDALONE
 * predicate (design.md's own wording): a line matching the banned form is a violation UNLESS
 * the same line also qualifies by `root_id` (the explicit-root scoping this ticket's Stage 2
 * added to `NodeSnapshotRepository.overwriteRows`/`BinaryRefRepository.overwriteForNode`).
 *
 * COVERAGE, STATED HONESTLY (design.md Rule B / task 5.8b-ii — a guard that reads as complete
 * while covering less is the same defect one level up):
 *   - COVERS: raw SQL (`sqlu"..."`/`sql"..."`) and Slick-lifted (`.nodeStepId.isEmpty`,
 *     `.nodeStepId.isDefined`, `=== Option.empty`) forms, in backend/src/main/scala ONLY, on the
 *     three tables named above.
 *   - DOES NOT COVER: TypeScript (`helio-mcp/**`) — the SAME encoding as an absent/`?? null`
 *     field is `check-node-root-encoding.ts.mjs`'s job (HEL-913 task 9.10, a genuine sibling
 *     guard in that codebase now, not merely a planned one). Do not treat a green run of THIS
 *     script as evidence the TypeScript surface is also clean -- run that sibling separately
 *     (`npm run check:node-root-encoding:ts`).
 *   - DOES NOT COVER: `frontend/**` (out of scope for this whole ticket).
 *   - DOES NOT distinguish "pattern-matching on an already-resolved domain value" (e.g.
 *     `nodeStepId.isEmpty` on a plain `Option[PipelineStepId]` local/parameter — legitimate,
 *     not a DB predicate) from "querying the TABLE'S column via Slick" (the actual violation) --
 *     it is a text-level guard, not a type-aware one. `KNOWN_EXEMPTIONS` below is the explicit,
 *     itemized escape hatch for sites already reviewed and found correct, one named entry each,
 *     so the debt stays visible rather than silently exempted.
 *
 * EXEMPTIONS ARE KEYED ON CONTENT, NOT LINE NUMBER (HEL-1282; the old `file:line` keys broke on
 * every unrelated edit above them -- HEL-1027, HEL-1188, HEL-1271). An entry is
 * `{ file, scope, arm, text, count, reason }`: `scope` is the nearest preceding `def <name>`,
 * `arm` the governing `case ... =>` line within that scope (or `<none>`), `text` the hit line
 * with whitespace normalised. Hits are grouped by `(file, scope, arm, text)` and the group must
 * match an entry's `count` EXACTLY, in both directions:
 *   - more hits than `count` (a copy of an exempt line) -> EVERY hit in the group is a violation;
 *   - fewer hits than `count` (the site was fixed/deleted/renamed) -> the entry is reported as
 *     STALE and the guard fails, so a dangling entry can never absorb a future line;
 *   - a hit with no matching key (new method, other file, other text, rewritten arm) -> violation.
 * See openspec/changes/content-keyed-root-encoding-exemptions/design.md for the residual risks.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const TARGET_FILES = [
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepository.scala",
];

// HEL-913 task 5.8b-iv: re-examined now that 5.8b-iv-a removed EVERY `explicitRootId`'s default
// argument on these two repositories -- the exact thing that used to make "does a caller reach
// the (None, None) fallback?" a judgement call instead of a provable fact. `OutputRepository
// .listByNodeInternal` (the one entry this list used to carry for that file) had ZERO callers
// anywhere in `src/main` or `src/test` -- provably unreachable, so it was DELETED outright
// (5.8b-iv, task 5.8b-iv-a's follow-through), not merely re-justified. Its entry is gone from
// this list because the method it named no longer exists.
//
// The 6 entries below could NOT be similarly deleted -- each is exercised by real, deliberate
// test call sites (`explicitRootId = None`, single-root fixtures reading back what they wrote).
// Deleting the match arm would break those tests, not fix a defect. Each was instead traced,
// per-call-site, for whether ANY production code path can reach it with `nodeStepId = None`
// (root-bound) AND `explicitRootId = None` simultaneously -- the one combination that would
// silently mix roots' rows (design.md R12's named bug). The proof, same for every entry: every
// production caller of `overwriteRows`/`listRows`/`listRowsPaged`/`overwriteForNode`(each
// checked directly, `grep -rn` against `src/main`) derives `explicitRootId` from either (a)
// `output.node.rootId`, or (b) a `NodeKey` match's `RootKey(rid) => Some(rid)` arm, or (c) an
// explicit `val explicitRootId = if (trunkLastStepId.isEmpty) Some(lowestRootId) else None`
// guard immediately at the call site (in `PipelineRunService`'s run-success path) -- and in every one of those cases, `nodeStepId.isEmpty` is
// structurally paired with a REAL root id, never bare `None`, because a root-bound `Output`/
// snapshot ALWAYS carries a real `root_id` (V98's `(node_step_id IS NULL) <> (root_id IS NULL)`
// CHECK enforces this at the DB row level, and the domain model reads it straight off that
// column). `findByNode`/`findByNodeAndRow` have ZERO production callers at all (like the
// deleted `listByNodeInternal`) -- they exist ONLY as read-verification helpers for
// `BinaryRefRepositorySpec`/`PipelineRunRoutesSpec`, never reached from any route or service.
//
// Conclusion, stated precisely rather than forced into a false binary: PRODUCTION-UNREACHABLE
// (proven, not assumed, per the call-site audit above) but TEST-REACHABLE (deliberately, by
// single-root fixtures that correctly rely on "no explicit root" meaning "the pipeline's only
// root" when there genuinely is only one). Not a defect (no live code path can trigger R12's
// named silent-mixing bug through these six lines) and not deletable (real tests depend on the
// fallback existing).
//
// WHY this is safe, not just true today -- the structural reason, not the observation: these
// arms are not dead code, they are the SINGLE-ROOT QUERY FORM, and 5.8b-iv-a's removal of every
// `explicitRootId` DEFAULT is what converted reaching them from an accident into a decision. The
// danger this encoding ever posed was that it was SILENT -- a caller omitting the argument and
// getting "every root" without knowing it. That silent path no longer exists (it is a compile
// error to omit the argument at all). What remains is a caller EXPLICITLY writing
// `explicitRootId = None` -- a visible, reviewable choice, not an inherited fallback. A test
// fixture writing that is stating, out loud, "this pipeline has exactly one root" -- true of
// every fixture that does it. This is why "production callers were traced" is not the load-
// bearing fact (that observation decays the moment a new caller is added); "a caller must now
// say `None` out loud" is the load-bearing fact, and it is structural, not empirical.
//
// Kept here, exempted BY NAME with this proof, not silently -- any NEW occurrence anywhere else
// in these files still fails the guard.
//
// HEL-1282: exemptions were previously `file:line` strings (re-mapped by hand after HEL-1027,
// HEL-1188 and HEL-1271 shifted the lines above them); they are now keyed on content -- see the
// header's EXEMPTIONS paragraph. The proof above applies to every entry below, unchanged.
const PERSISTENCE = "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/";
const NODE_SNAPSHOT_REPO = `${PERSISTENCE}NodeSnapshotRepository.scala`;
const BINARY_REF_REPO = `${PERSISTENCE}BinaryRefRepository.scala`;
const REASON =
  "single-root `(None, None)` arm: production-unreachable, test-reachable (see proof above)";
const ARM = "case (None, None) =>";
const NSF = 'sql" AND node_step_id IS NULL"';

export const KNOWN_EXEMPTIONS = [
  {
    file: NODE_SNAPSHOT_REPO,
    scope: "overwriteRowsAction",
    arm: ARM,
    text: 'sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"',
    count: 1,
    reason: REASON,
  },
  {
    file: NODE_SNAPSHOT_REPO,
    scope: "listRows",
    arm: `${ARM} ${NSF}`,
    text: `${ARM} ${NSF}`,
    count: 1,
    reason: REASON,
  },
  {
    file: NODE_SNAPSHOT_REPO,
    scope: "nodeFilterFragment",
    arm: `${ARM} ${NSF}`,
    text: `${ARM} ${NSF}`,
    count: 1,
    reason: REASON,
  },
  {
    file: BINARY_REF_REPO,
    scope: "overwriteForNode",
    arm: `${ARM} sqlu"DELETE FROM binary_refs WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"`,
    text: `${ARM} sqlu"DELETE FROM binary_refs WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"`,
    count: 1,
    reason: REASON,
  },
  {
    file: BINARY_REF_REPO,
    scope: "findByNodeAndRow",
    arm: ARM,
    text: 'WHERE pipeline_id = $pipelineId AND node_step_id IS NULL AND row_index = $rowIndex"""',
    count: 1,
    reason: REASON,
  },
  {
    file: BINARY_REF_REPO,
    scope: "selectQuery",
    arm: ARM,
    text: 'WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""',
    count: 1,
    reason: REASON,
  },
];
// Raw SQL: `node_step_id IS NULL` as a standalone (not `... IS NULL AND root_id ...`) predicate.
const RAW_SQL_STANDALONE = /node_step_id\s+IS\s+NULL(?!\s+AND\s+root_id)/i;
// Slick-lifted forms.
const SLICK_FORMS = [
  /\.nodeStepId\.isEmpty\b/,
  /\.nodeStepId\.isDefined\b/,
  /===\s*Option\.empty\b/,
];

function isRootQualifiedSameLine(line) {
  return /root_id/i.test(line) || /rootId/.test(line);
}

const normalise = (line) => line.trim().replace(/\s+/g, " ");
const SCOPE_RE = /\bdef\s+(\w+)/;
const ARM_RE = /^\s*case\b.*=>/;
const NO_ARM = "<none>";
const keyOf = (file, scope, arm, text) => JSON.stringify([file, scope, arm, text]);

/** Exported for the selftest (task 5.8b-i, "prove the guard fires"): scans already-in-memory
 *  text (no disk access) for the banned encoding. Exemptions are content-keyed (see header);
 *  `exemptions` defaults to the shipped table and exists so a selftest can inject others.
 *  Stale-exemption failures (entries for `relPath` that no longer match exactly `count` hits)
 *  are returned in the same array, prefixed `stale exemption:`. */
export function scanTextForViolations(relPath, text, exemptions = KNOWN_EXEMPTIONS) {
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

    const rawMatch = RAW_SQL_STANDALONE.test(raw);
    const slickMatch = SLICK_FORMS.some((re) => re.test(raw));
    if (!rawMatch && !slickMatch) return;

    // A same-line root-id qualifier (raw SQL `root_id = ...` or a Slick `.rootId ===` alongside
    // `.nodeStepId.isEmpty`) means this specific occurrence IS already root-scoped -- not a
    // violation, regardless of which form (raw or Slick) triggered the match.
    if (isRootQualifiedSameLine(raw)) return;

    hits.push({
      lineNo: idx + 1,
      trimmed,
      scope,
      arm,
      key: keyOf(relPath, scope, arm, normalise(raw)),
    });
  });

  const entries = new Map();
  for (const e of exemptions) {
    if (e.file === relPath) entries.set(keyOf(e.file, e.scope, e.arm, e.text), e);
  }
  const groups = new Map();
  for (const h of hits) groups.set(h.key, [...(groups.get(h.key) ?? []), h]);

  const found = [];
  for (const h of hits) {
    const entry = entries.get(h.key);
    const n = groups.get(h.key).length;
    if (entry && n === entry.count) continue;
    const surplus = entry ? ` -- ${n} occurrences, exemption covers ${entry.count}` : "";
    found.push(
      `${relPath}:${h.lineNo}: standalone node-root-NULL encoding ("${h.trimmed}") -- see design.md R12${surplus}`,
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
  return found;
}

// Only run the real file scan (and exit) when this module is the entry point --
// importing `scanTextForViolations` (the selftest, task 5.8b-i) must not trigger it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = [];

  for (const relPath of TARGET_FILES) {
    const absPath = join(repoRoot, relPath);
    let text;
    try {
      text = readFileSync(absPath, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      // A missing file is skipped unless exemptions still name it: scanning "" then reports
      // each such entry as stale, so renaming/deleting an exempt file forces a table update.
      text = "";
    }
    violations.push(...scanTextForViolations(relPath, text));
  }

  if (violations.length > 0) {
    process.stderr.write(
      `check-node-root-encoding: ${violations.length} violation(s) of design.md R12's "node_step_id IS NULL is not a standalone predicate" rule:\n\n`,
    );
    for (const v of violations) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      "\nEach root-bound row must be scoped to a real root id (root_id), never a bare NULL check. " +
        "If this is a genuine known gap, add a content-keyed KNOWN_EXEMPTIONS entry with the proof that owns it.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `check-node-root-encoding: clean (${TARGET_FILES.length} file(s) scanned; SQL+Scala only -- see this script's header for what it does NOT cover)\n`,
  );
}
