# HEL-1485: After HEL-1456: patch-set preview vs apply on ghost layout items; dashboard+panel delete deadlock; auto-layout bypasses the live-panel filter

## Description

These follow-ups came from HEL-1456 (matto00/helio#934, e8161b17b). It added V122, a trigger that strips a deleted
panel's layout entries; V123, a one-off cleanup of existing ghost entries; and a live-panel filter on
`DashboardWrites.applyUpdate`. Re-derive file and line references from main.

1. **Patch-set preview doesn't match apply for ghost items** (`PatchSetPreviewProjection.scala:214`). Apply now filters
   layout items down to live panels, but the preview projection doesn't, so the preview can show items that apply will
   drop. Make preview match apply, with a test that fails first.
2. **Possible 40P01 deadlock** when a dashboard and one of its panels are deleted at the same moment. The final skeptic
   reasoned this from Postgres lock order but did not reproduce it. No data is lost; one request fails and can be
   retried. Reproduce it first with two concurrent transactions. If it's real, fix the lock order or retry the
   deadlocked request.
3. **Auto-layout bypasses the live-panel filter** and has the same stale-read window as a layout PATCH (HEL-1457
   class). Route it through the same filter, or document why it can't produce ghosts.
4. **Cosmetic:** `PatchSetUndoConflictCheck.checkDashboard` converts the layout to the response type and back before
   filtering.

V122 and V123 are applied in prod-bound history. Never edit them; any change goes in a new migration (next free: V124).

## Acceptance Criteria

- Patch-set preview of a dashboard update drops ghost layout items exactly as apply does; proven by a test that is red
  on the unfixed code.
- The dashboard-delete vs panel-delete deadlock is reproduced (or shown not to occur) with two real concurrent
  transactions on embedded Postgres as a non-superuser, non-BYPASSRLS role. If it reproduces, it is fixed (lock order
  or transparent retry) with that repro as the red-first test; if not, the evidence is recorded and no code changes.
- Auto-layout never stores an item for a panel that is not on the dashboard (routed through the same filter), with a
  red-first test.
- `PatchSetUndoConflictCheck.checkDashboard` filters the live domain layout directly (no response round-trip),
  behaviour unchanged.
- V122/V123 are not edited; any SQL change is a new migration (V124, re-checked before commit).

## Driver constraints (overnight)

New specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` must appear in sbt runs; red-first tests; no inline
FQNs; HEL-1475 may overlap in patch-set undo — re-sync before PR.
