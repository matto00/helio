# HEL-1629: Live draft preview (c): atomic bulk Save & run endpoint, verified lock protocol, stale-base 409 and atomic undo

## Description

Split from HEL-1581 by owner ruling `split-and-restate` (2026-10-16). Design: `docs/live-draft-preview.md` §8 (8.1-8.7)
and §12 item (c). Parent epic HEL-1570. Blocked by HEL-1581 (a) and HEL-1628 (b), both merged. (e) HEL-1631 and
(f) HEL-1632 depend on it.

origin_kind: escalation-split
origin_ticket: HEL-1581

## Owner rulings (binding, do not re-ask)

- HEL-1580 ruling E: `new-atomic-bulk-endpoint`. Save & run is one transaction, not `POST /api/patch-sets/apply`.
- 2026-10-16, stale base: `reload-only`. A stale base (409) offers only "reload the saved pipeline"; the draft is kept
  as a diff to re-apply. There is NO force-overwrite.
- 2026-10-16, undo after a save that deleted steps or Outputs: `refuse-dependent-restore-rest`. Deleted steps and
  Outputs with no bound panels or alert rules are recreated under their ORIGINAL ids (the restore body may carry an
  explicit `id`, accepted only on an undo). If the cascade removed any panel or alert rule, the undo is refused with a
  409 naming each one (`PatchSetUndoConflictCheck` style).

## What

- Endpoint `POST /api/pipelines/:id/draft/save` (name indicative). Body `{baseFingerprint, steps[], outputs[],
  runAfterSave?, confirmCascade?}`. Declarative: the body is the final step tree (existing ids kept, new steps carry a
  `clientId`), diffed against the current definition. Creates, updates, deletes, re-parenting, trunk reorder and
  Output edits all happen in ONE DB transaction (§8.1-8.2, §8.4).
- Composable writes: `DBIO` variants of `updateInternal`, `deleteInternal` (with its cascade) and
  `reorderTrunkInternal` (with the lane-cycle guard and `PipelineCycleGuard`).
- Stale base: the pipeline read returns the `pipeline` fingerprint (`PatchSetTargetFingerprint`). The save recomputes
  it in-transaction; on mismatch 409 with the existing `PATCH_SET_STALE` body.
- Locking protocol (§8.3): G1 (atomic against every writer of fingerprinted state), G2 (no deadlock with
  `PanelRowLocks` order; `lockForDeletion` first and once), G3 (undo-journal completeness). The candidate protocol is
  UNVERIFIED; this ticket owns verifying it. Required specs: a two-connection race spec per writer class in §8.3's G1
  table; a deadlock spec running a panel create, pipeline delete, Output delete, source delete and save concurrently,
  asserting no `40P01`; an RLS spec run as a role WITHOUT BYPASSRLS. SERIALIZABLE-with-retry is not a substitute.
- Journal and undo: the save writes one journal row (`kind: "pipelineDefinition"`) holding the prior definition.
  `/undo` dispatches on it and re-applies through this endpoint against the post-save fingerprint. The delete case
  follows the 2026-10-16 ruling.
- Run after save (§8.6): the save commits first, then `PipelineRunService.submit` runs unchanged through the HEL-505
  guard. A guard rejection returns 200 with `run: {started: false, code: 429, retryAfterSeconds, reason}`; a rejected
  run never rolls back the save.
- Checks to keep (§8.7): ACL (owner or editor), the RLS owner context, cross-owner secondary refs, the upsert target
  check, strict `rawConfigProblem` validation, cascade confirmation (422 listing the impact) and one audit row.

## Acceptance criteria

- [ ] A whole-draft save (create, update, delete, reorder, Output edit) commits atomically. A fault injected mid-chain
  leaves the definition unchanged.
- [ ] A stale base returns 409 `PATCH_SET_STALE` and writes nothing. There is no overwrite path.
- [ ] The race, deadlock and non-BYPASSRLS RLS specs above exist and pass. The verified protocol is documented.
- [ ] Undo restores the prior definition atomically, including reorder. The delete case follows the 2026-10-16 ruling.
- [ ] A guard-rejected run after a committed save returns `started: false` with `retryAfterSeconds`, and the save
  persists.

## Driver constraints (binding for this run)

- Every required spec must be shown able to fail (mutation, or removing a lock), with the red recorded.
- Systematic-debugging iron law: no protocol change without a probe-confirmed cause.
- HEL-505 guards unchanged; HEL-1492 (editor's run counts against the owner's cap, owner-keyed lock) unchanged.
- Schemas + protocol in the same change as server and client code, with a seam test (both sides validate against the
  committed schema). No UI wiring beyond exposing the fingerprint; the draft UI is HEL-1631.
- Migration only if needed: next free number after V136 (V137 unclaimed on every branch at planning time), and it must
  run as the non-BYPASSRLS `helio` role Flyway uses in prod.
- Scratch only under /home/matt/Development/helio/.concertino/scratch/HEL-1629/. Isolated DB `helio_hel1629` preferred
  for race/deadlock probes against a real server (embedded Postgres per spec is also isolated). Concurrency specs under
  `nice -n 19`, bounded repeats; jest/Playwright at most 2 workers. Full `sbt testFull` under
  `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock`.
  Load gate: 1-min loadavg above 10 → sleep 60 s and recheck, up to 30 min. Never signal processes; never pgrep/pkill.
