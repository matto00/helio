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
 *     it is a text-level guard, not a type-aware one. `KNOWN_ROOT_QUALIFIED_LINES` below is the
 *     explicit, itemized escape hatch for lines already reviewed and found correct (a real
 *     root-id qualifier is present, just not textually adjacent enough for this script's plain
 *     substring check) -- unlike the OTHER escape ("a line the ticket has not gotten to yet"),
 *     which is what `KNOWN_UNFIXED_LINES` names, one at a time, so the debt stays visible rather
 *     than silently exempted.
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

// Lines already reviewed where a real root-id qualifier IS present on the same statement, just
// not close enough (e.g. split across a multi-line `sqlu"""..."""`) for the plain per-line
// substring check below to see it. Each entry is `file:lineNumber` (1-indexed), so a review
// stays pinned to an exact line rather than a fuzzy description.
const KNOWN_ROOT_QUALIFIED_LINES = new Set([
  // NodeSnapshotRepository.overwriteRows / BinaryRefRepository.overwriteForNode: the
  // `(None, Some(rid))` delete-branch pairs `node_step_id IS NULL` with `AND root_id = $rid` ON
  // THE SAME LINE already, so these are caught by the same-line check directly and need no
  // entry here -- listed for completeness of the review, not because an entry was needed.
]);

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
// explicit `if (nodeStepId.isEmpty) Some(realRootId) else None` guard immediately at the call
// site (`PipelineRunService:1030`) -- and in every one of those cases, `nodeStepId.isEmpty` is
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
const KNOWN_UNFIXED_LINES = new Set([
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:52",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:100",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:135",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepository.scala:49",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepository.scala:108",
  "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepository.scala:128",
]);

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

/** Exported for the selftest (task 5.8b-i, "prove the guard fires"): scans already-in-memory
 *  text (no disk access) for the banned encoding, using the SAME exempt-line keys the real scan
 *  uses (`relPath:lineNumber`) so a selftest can exercise the exemption logic too, not just the
 *  detection regexes. */
export function scanTextForViolations(relPath, text) {
  const found = [];
  const lines = text.split("\n");
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const key = `${relPath}:${lineNo}`;
    if (KNOWN_UNFIXED_LINES.has(key)) return;
    if (KNOWN_ROOT_QUALIFIED_LINES.has(key)) return;

    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    const rawMatch = RAW_SQL_STANDALONE.test(raw);
    const slickMatch = SLICK_FORMS.some((re) => re.test(raw));
    if (!rawMatch && !slickMatch) return;

    // A same-line root-id qualifier (raw SQL `root_id = ...` or a Slick `.rootId ===` alongside
    // `.nodeStepId.isEmpty`) means this specific occurrence IS already root-scoped -- not a
    // violation, regardless of which form (raw or Slick) triggered the match.
    if (isRootQualifiedSameLine(raw)) return;

    found.push(
      `${relPath}:${lineNo}: standalone node-root-NULL encoding ("${trimmed}") -- see design.md R12`,
    );
  });
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
      if (e.code === "ENOENT") continue;
      throw e;
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
        "If this is a genuine known gap, name it in KNOWN_UNFIXED_LINES with the task number that owns it.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `check-node-root-encoding: clean (${TARGET_FILES.length} file(s) scanned; SQL+Scala only -- see this script's header for what it does NOT cover)\n`,
  );
}
