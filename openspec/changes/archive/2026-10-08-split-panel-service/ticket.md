# HEL-1253: Split PanelService.scala (~730 lines, over the 400-line threshold)

## Description

Surfaced by the executor during HEL-1203: PanelService.scala is ~730 lines, well over CONTRIBUTING.md's split
threshold. HEL-1203 kept its additions in the new BatchControlsCheck.scala but the split is still owed.
Behaviour-preserving refactor only.

origin_kind: followup
origin_ticket: HEL-1203

## Acceptance Criteria (derived from ticket + driver brief)

- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` (709 lines at 24f6de4cf) is split by concern
  so it is <= 300 lines (living spec backend-file-size-compliance; if the ExistenceNotLeakedRoutesSpec guards pin a
  higher floor, the measured floor is recorded and it is still < 400); each new file stays within 250 lines.
- Behaviour-preserving only: no API, status-code, error-message, ACL, audit, logging-category or query-count change.
  Any non-trivial bug found is recorded as a follow-up, never fixed here (owner standing refactor rule).
- Public API is source-compatible: `PanelService`'s constructor (parameter order, names, defaults incl. the
  HEL-1295 `require(outputRepo != null, ...)`), every public and `private[services]` method signature (incl.
  `buildAllForCreate`'s `itemLabel` default) and `ResolvedPanelPatch` (same package, same shape) are unchanged.
- Recent work preserved exactly: HEL-1295 (required outputRepo), HEL-1260 (create/duplicate/batch placement via
  `defaultSizesFor` + `insertPlaced`/`insertBatchPlaced`), HEL-1203 (config-patch decode after 404/403, before any
  further read/write), HEL-1189 controls validation, HEL-1086/1087 form submit paths.
- Proof: full backend suite (`sbt testFull`) passes with at most import-only test edits (target: zero test diff) and
  an equal test count; moved code shown byte-identical via move-detection diff; no inline FQNs
  (`check:scala-quality`, plus eye-check inside `s"${...}"` per HEL-1386).
