## Context

`backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala`, 473 lines at a256261dc (see
proposal.md - Why). Constructed once in production (`ApiRoutes.scala:357`, four positional args) and in ~25 test
files; `deleteInternal` (`private[services]`) is called by `DashboardProposalService` (lines 133, 139). Companion
holds `CreateDashboardInput` and the forwarding `validateSnapshotPayload`.

Hard constraints (verified by reading `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala`):
- `filesCallingAccessHelpers` (regex `\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|
  authorizeResource)\(` over non-comment lines): dashboard rows (export, duplicate, layout repair, update, PATCH,
  DELETE) name only `DashboardService.scala`. `requireAccess(` today: `update` (215), `exportSnapshot` (357).
- `expectedForbiddenProducers` pins `"DashboardService.scala" -> 5`: `deleteInternal` (156), `duplicate` (176),
  `update` (217), `repairLayout` (308), `exportSnapshot` (359).
Both guards stay green with zero test edits, so every ACL call, 404-before-403 preamble and Forbidden producer stays
in `DashboardService.scala`. The pins are NOT edited (owner call, same as HEL-1253).

## Goals / Non-Goals

**Goals:** `DashboardService.scala` <= 300 lines (living spec `backend-file-size-compliance`), each new file <= 250;
verbatim moves; identical behaviour; zero test diff. **D8 floor fallback:** if after every D3 move the file is still
> 300, the executor records the measured floor and why each remaining block must stay (guard-pinned preambles,
constructor + its wiring comments, class doc, companion); it must be < 400 regardless. No further moves of ACL lines.
**Non-Goals:** proposal.md Non-goals. `DashboardLayoutRepair.scala`/`DashboardServiceValidation.scala` not edited.

## Decisions

**D1 — Entry point keeps name, package, constructor and signatures.** Constructor bytes identical (order, names,
comments, `auditService = null` before required `outputRepo`); `require(outputRepo != null, ...)` stays the FIRST
statement of the class body; `import DashboardService._` and `audit` stay. Every public method (`findAll`, `findById`,
`create`, `delete`, `duplicate`, `update` incl. `layoutPolicy = LayoutWritePolicy.Validate`, `repairLayout`,
`exportSnapshot`, `importSnapshot`) and `private[services] deleteInternal` keep identical signatures and scaladoc. The
companion object is unchanged. Module fields are `private val` (never `val`/`lazy val`: a public accessor must show
up in the diff below). Proof: `javap -public` (classes `DashboardService`, `DashboardService$`,
`DashboardService$CreateDashboardInput`, `...$CreateDashboardInput$`), base captured in task 1.2 before any edit,
diffed against head after filtering lines matching `\$anonfun\$` (compiler-generated public static lambda methods,
renumbered/removed by any body move): the FILTERED diff is empty; the unfiltered diff is also kept and shown to differ
only in `$anonfun$` lines.

**D2 — ACL lines stay put.** No new module may contain a non-comment access-helper call or a `ServiceError.Forbidden(`
producer, nor receive `accessChecker` (or a function value wrapping it). `findById`, `delete`, `deleteInternal`,
`duplicate`, `exportSnapshot` are not moved at all (all short, all ACL-bearing).

**D3 — Modules** (package `com.helio.services.dashboards`, each `private[dashboards] final class`, constructed once in
`DashboardService`'s body right after the `require` as `private val`s, from its own constructor params; each module
takes `(implicit ec: ExecutionContext)`; moved parameter names (`dashboardId`, `existing`, `patchPayload`, `user`)
kept so bodies stay verbatim; no module dereferences a
nullable dependency at construction):
- `DashboardWrites(dashboardRepo)` — `insertNew`, `applyUpdate`, `writeUpdate` bodies + comments verbatim.
  `create` keeps its branch/audit logic and calls `writes.insertNew(...)`; `update` keeps validation, 404/owner/
  `requireAccess`/Viewer preamble and the `resultF.map` audit, calling `writes.applyUpdate(...)` at the same points.
- `DashboardLayoutRepairWrite(dashboardRepo, audit)` — `repairLayout`'s post-ownership tail: from
  `validateDashboardLayoutPayload(Some(patchPayload)) match` through the re-read, verbatim (payload validation →
  `panelIdsInternal` → `DashboardLayoutRepair.plan` → `updateLayoutIfUnchanged` CAS → audit → `findByIdInternal`).
  `repairLayout` keeps its scaladoc and its `findById` → 404 / non-owner → Forbidden preamble and calls the module in
  the `Some(existing)` branch.
- `DashboardSnapshotImport(dashboardRepo, outputRepo, audit)` — `importSnapshot`'s body (validate payload →
  `validateImportPanels` → `importSnapshot(repairImportedLayoutGeometry(...))` → audit) and `validateImportPanels`
  with its scaladoc, verbatim. `DashboardService.importSnapshot` becomes a one-line delegate with identical signature.
  Note: inside the class body `validateSnapshotPayload` resolves (via `import DashboardService._`, inner scope) to the
  companion forwarder; in the module it resolves to `DashboardServiceValidation.validateSnapshotPayload`, the
  forwarder's own target — same function, recorded in evidence as the one resolution change.
Names are self-approved; the executor may rename but not change boundaries without recording why.

**D4 — Verbatim moves.** Bodies and comments move unchanged; allowed non-moved changes, each listed in evidence:
class scaffolding and imports; signature-line modifiers (`private def` → `def` on a `private[dashboards]` class);
receiver qualification (`applyUpdate(...)` → `writes.applyUpdate(...)`); passing `audit` as a function value;
re-indentation of the repair tail (whitespace-insensitively identical); positional words in comments ("above") made
false by the move.

**D5 — Audit semantics.** `audit` stays defined on `DashboardService` (same null guard); modules receive it as
`(String, Option[String], AuthenticatedUser, JsValue) => Unit` and call it at the identical position (repair: after
the CAS `true`, before the re-read; import: inside the `importSnapshot(...).map`). `update`/`create`/`delete`/
`duplicate` audits do not move. Default `metadata = JsObject.empty` only matters for callers that omit it; the moved
calls all pass metadata explicitly (verify).

**D6 — Evaluation order and Futures.** No new eager evaluation, no added `Future` hops, `.recover`, `try` or wrappers.
`Instant.now()` taken at the same points (`insertNew`, `writeUpdate`, `validateOne`). Every repo call happens in the
same order inside the same `flatMap`/`map`. A synchronous throw formerly inside a callback still is.

**D7 — Evidence (mechanical, failable)**, in this change dir:
(a) `move-evidence.md`: `git diff --color-moved=plain --color-moved-ws=allow-indentation-change` summary, plus a
script (adapt `openspec/changes/archive/2026-10-08-split-panel-service/move-match.py`) that compares each moved unit's
original text (from a256261dc) with the new file whitespace-normalised and prints MATCH/DIFF; red run on a scratch copy
with one token altered prints DIFF. Justified list of every non-moved changed line (D4).
(b) `test-count-evidence.md`: baseline `nice -n 19 sbt testFull` on unmodified a256261dc (total succeeded + counts for
`ExistenceNotLeakedRoutesSpec`, `DashboardServiceLayoutPolicySpec`, `DashboardSnapshotValidationSpec`,
`DashboardLayoutRepairRlsSpec`, every `*Dashboard*Spec`); after: same totals, all pass; `git diff <base>...HEAD --
backend/src/test` empty.
(c) Guard scan: access-helper file set and Forbidden counts on the new tree equal the old (`DashboardService.scala`, 5).
(d) `javap -public` diff per D1: filtered (`\$anonfun\$` removed) empty; unfiltered differs only in `$anonfun$` lines. (e) `node scripts/check-scala-quality.mjs` passes; new files eye-checked for
inline FQNs inside `s"${...}"` (HEL-1386 blind spot); line counts of touched files vs 300/250/400.

## Risks / Trade-offs

- [Implicit/import drift: `ExecutionContext`, spray-json, `DashboardServiceValidation._`] → compile + full suite.
- [Name-resolution change for `validateSnapshotPayload`] → D3 note; same target function; suite covers import.
- [Entry file near 300] → D8 floor fallback; the soft 250 budget is a warning only.
- [Concurrent lanes] → no file shared with HEL-1187/1358/1371 (PR #847); rebase if main moves.

## Planner Notes

- Self-approved: module names/boundaries (D3); keeping ACL preambles in the entry point (D2, guard-driven).
- Premise: 473 lines, not 431. The repair `plan` is in `DashboardLayoutRepair.scala`; only the owner entry + write tail
  are here. HEL-1071's suggestion (move `validateImportPanels`) is adopted inside `DashboardSnapshotImport`.
- No spec delta: the living file-size spec already states the 300 target.
- Comments in other files naming `DashboardService` internals are left untouched (follow-up candidate if stale).
