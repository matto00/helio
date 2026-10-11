## Standing Constraints

- [C1] V123 reads panels/dashboards only via a helio_privileged SECURITY DEFINER helper with row_security off; never under RLS
- [C2] Every new test is shown RED against unfixed code; RLS proofs run as a non-superuser non-BYPASSRLS role

## 0. Probe (before any fix)

- [x] 0.1 Live repro on the worktree dev server (ports 6888/9795): create A, B; delete B via UI and via `DELETE /api/panels/:id` (header `X-Helio-Requested-With: 1`); read layout via `GET /api/dashboards` -> record B's items in lg/md/sm/xs in `probe.md`
- [x] 0.2 Probe an Output delete and a pipeline-step delete cascade the same way; record result in `probe.md`
- [x] 0.3 Prod-count query (for the owner ruling; do NOT run against prod) recorded verbatim in `probe.md`, and run against the dev DB with the result

### Backend

- [x] 1.1 `V122__strip_deleted_panel_layout_items.sql`: statement-level AFTER DELETE trigger on `panels` per design D1
- [x] 1.2 V122: `SECURITY DEFINER`, pinned search_path, `row_security = off`, re-owned to `helio_privileged` with V100's bracket + explicit grants (D2)
- [x] 1.3 V122: `COALESCE(jsonb_agg(...), '[]'::jsonb)` so a breakpoint emptied by a delete is `[]`, never null
- [x] 1.4 No change to `PanelRepository` delete methods (D3 — no pre-lock)
- [x] 1.5 `V123__strip_existing_ghost_layout_items.sql` (D4, approved): helio_privileged helper, row_security off, idempotent, no last_updated; header states prod counts unmeasured + count query
- [x] 1.6 `DashboardWrites.applyUpdate`: filter BOTH `existing.layout` and the patch to `panelIdsInternal` ids before the policy, Validate AND RestorePriorStored (D5); also filter `existing.layout` on the no-layout-patch branch that writes it back (appearance-only PATCH, DashboardWrites.scala:87-93)
- [x] 1.6a `PatchSetUndoConflictCheck.checkDashboard`: compare layouts restricted to current panel ids (D7), calling `panelIdsInternal` only after `findById` returns Some; re-sync with origin/main (HEL-1482) before PR
- [x] 1.7 Record in design/PR: duplicate/import/repair/replaceContents cannot store unknown ids; auto-layout has the HEL-1457 stale-read window

### Tests

- [x] 3.1 Each test below is shown RED against unfixed code first (record the failing run in the evidence dir)
- [x] 3.2 Embedded-PG spec (`VerifiedEmbeddedPostgres.start`): single delete strips all four breakpoints, others unchanged in order; deleting the only panel leaves `[]` not null
- [x] 3.3 Same spec: create after delete starts at A's bottom on every breakpoint (no gap)
- [x] 3.4 Same spec: auto-layout after delete adds no offset
- [x] 3.5 Same spec: Output delete (bulk), pipeline-step/pipeline delete cascades and `replaceContents` strip; dashboard delete still succeeds
- [x] 3.6 RLS proof: a cascade delete run as a non-superuser, non-BYPASSRLS role on a dashboard it cannot update still strips; mutation (function NOT re-owned) goes loud (42501), not silent
- [x] 3.7 V123: ghosts stripped, live items byte-identical on a multi-panel dashboard, second run no-op, runs as non-BYPASSRLS role
- [x] 3.8 Concurrency (repeat N times): create + delete on one dashboard, and bulk Output delete + FK-cascade delete sharing dashboards — both effects present, no deadlock
- [x] 3.9 D5: PATCH with a ghost item stores no ghost; stored layout holding a ghost in a breakpoint the patch does NOT send is written back ghost-free (must fail against a supplied-only filter); a valid write never newly 400s
- [x] 3.9a D5 RestorePriorStored, reachable sequences: patch set [delete P on D, update D] then undo, and the same set + a failing edit (rollback); assert status restored / rolledBack and no ghost stored
- [x] 3.9b D7: patch set [update D, delete P on D] undo succeeds (RED today-with-V122), and undo after a later unrelated panel delete on D succeeds
- [x] 3.9c D5: a panel created by an EDITOR then an owner PATCH keeps that panel's item (filter lookup not RLS-limited); appearance-only PATCH stores no ghost
- [x] 3.10 Seam test: the web client's real PATCH body (built by `buildLayoutPatch` from a ghost-bearing store layout) sent to the real route; response layout, parsed by the client type, holds no ghost, and the client adopts it and clears pending
- [x] 3.11 Live dev-DB row check after fix: repeat 0.1/0.2 and query `dashboards.layout` rows by exact id; clean up created rows by exact id
- [x] 3.12 sbt runs show `[hel1468-guard]`; `nice -n 19`; MemAvailable >= 15 GB before `sbt testFull`/full jest
