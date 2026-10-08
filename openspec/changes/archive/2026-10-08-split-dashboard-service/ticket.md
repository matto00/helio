# HEL-1234: Split DashboardService.scala (431 lines after HEL-1071) along its layout-policy / update seams

## Description

origin_kind: followup
origin_ticket: HEL-1071

DashboardService.scala is 431 lines after HEL-1071 (406 before), over the ~400-line split threshold in CONTRIBUTING.
HEL-1071's execution-progress.md (archived change per-breakpoint-layout-validation) has a split suggestion. Pure
refactor, behavior-preserving.

## Acceptance Criteria

(Derived from the ticket body plus the driver's standing structural-refactor rules for this run.)

- `DashboardService.scala` is split along its concern seams (update write path, import validation, layout-repair
  write tail, and as needed create/import bodies) into collaborators in `com.helio.services.dashboards`; it ends
  well under CONTRIBUTING's ~400-line trigger, targeting the living spec's <= 300 (measured floor recorded if the
  ExistenceNotLeakedRoutesSpec pins prevent it), every new file <= 250.
- Behaviour-preserving only: no route, status, message, ACL, audit, ordering or logging change. Bugs found become
  follow-ups, never fixed here.
- Public API source-compatible: constructor (names, order, defaults incl. `auditService = null`), every public and
  `private[services]` method signature, companion `CreateDashboardInput` and `validateSnapshotPayload`; a
  `javap -public` diff of `DashboardService`/`DashboardService$`, with compiler-generated `$anonfun$` lines filtered,
  is empty (unfiltered diff differs only in `$anonfun$` lines).
- ExistenceNotLeakedRoutesSpec guards unchanged and green: every access-helper call and all 5
  `ServiceError.Forbidden(` producers stay in `DashboardService.scala` (pins are NOT edited).
- Full backend suite (`sbt testFull`) passes with zero (or import-only, justified) test diffs and an unchanged test
  count; byte-move evidence for every moved block (mechanical script + red run); `check:scala-quality` passes; no
  inline FQNs (incl. inside `s"${...}"`).

## Premise validation (Setup)

Actual size at a256261dc is 473 lines, not 431 (HEL-1233 added `repairLayout` and import geometry repair). The pure
repair `plan` lives in `DashboardLayoutRepair.scala`; the owner-only `repairLayout` entry stays in DashboardService.
