## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence, live tree)
- Round-1 CRs resolved in the artifacts: (1) panel list = `DashboardRepository.panelIdsInternal` (system ctx, unpaged), no new service collaborator, in design D2/tasks 1.1/Impact; (2) layout-only compare-and-set write `updateLayoutIfUnchanged`, 409 on 0 rows, rename-survives test in 1.4; (3) HEL-301 4.1 declared the single documented exception (D4; PanelGrid header, test comment, README, phone-width test in 3.6); (4) RLS plan re-targeted at the three genuinely RLS-gated pieces with named reds (D3, task 1.5); (5) no new schema (both case classes already have schemas), actionLabels task 3.3a.
- `WHERE layout = expected` is expressible: `DashboardRepository.scala:215-218,243` maps `layout` as `MappedColumnType.base[DashboardLayout,String]`; the column is JSONB (V33) and `application.conf:32,109` sets `stringtype=unspecified`, so a bound String compares as jsonb (semantic equality, key-order insensitive). `update` (line 163) already assigns the same way. V36 `dashboards_update` policy (owner OR editor) admits the owner's write; `dashboards_select` uses `helio_can_access_dashboard`; `helio_app_test` harness exists in ApiTokenAuthSpec/RlsOwnerTablesSpec.
- Client trigger/HEL-1230 contract: useLayoutSave header classes 1-4 re-read; a repair moves or drops an item so it cannot be a class-3 prefix extension; no local commit/revision so class 4 re-baseline. D5 guard mirrors existing PATCH fulfilled behaviour. `Page.Default` limit 200 confirmed (pagination.scala:11); >200 case is pinned to 400/no-retry.
- Import: D6 self-reflow via `LayoutReflow` valid by construction; `validateImportedLayoutGeometry` (DashboardServiceValidation.scala:94) is the single reject site; spec delta correct; test flip listed.
- ACs 1-8 each map to a task/spec scenario (AC3 server ownership D2 step 1; AC5 D7/4.x seam; AC7 D2 step 3 + fixture cases; AC8 task 5.3).

### Verdict: CONFIRM

### Non-blocking notes
- Compare-and-set `expected` is the decoded-then-reserialized domain layout. If any legacy row has JSON that does not round-trip (extra keys, differing item fields), jsonb equality never matches and repair would 409 forever for that row. Add one spec seeding the stored-bad layout by raw SQL (different key order) to prove it still matches; keep the 409 path non-fatal (already designed).
- Seed the ScalaTest seam cases via the repository/SQL, as D7 states, not a validating HTTP path.
- Import self-reflow differs from what the exporter saw; say so in the PR (already planned).
