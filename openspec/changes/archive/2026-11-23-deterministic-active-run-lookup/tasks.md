## Standing Constraints

- [C15] Overlapping open manual runs stay allowed (owner ruling): add no refuse (409) or coalesce rule, and do not change hasActiveRunInternal, the scheduler/auto-run guards, the HEL-505 cap or the frontend.

### Backend

- [x] 1.1 (after 3.1-3.3) Order `findActiveRunInternal` by `(started_at DESC, id DESC)` with `take(1)` (design D1)
- [x] 1.2 Rewrite its doc comment: several open runs can exist; the newest by that order is returned (D2)
- [x] 1.3 Add one clause to `docs/agent-native.md` (hook section, ~:103-106) naming which in-flight run is returned when several are open; keep HookTriggerService.scala comments as is (no new `Forbidden` token: ExistenceNotLeakedRoutesSpec counts them)

### Measurement

- [x] 2.1 Record `EXPLAIN (ANALYZE)` of the new query on `helio_hel1833` (300 terminal + 2 open runs) as a `.txt` (D4)
- [x] 2.2 No V148 index: EXPLAIN shows a 0.043 ms bitmap-index plan; see explain-active-run.txt

### Tests

- [x] 3.1 Write `PipelineRunActiveLookupSpec` repository cases (a)-(c) from D3, both insertion orders, repeated calls
- [x] 3.2 Add a `HookRoutesSpec` case beside :292: two open runs in both insertion orders (newer inserted LAST at minimum), assert response `runId` is the newest; plus a tied-`started_at` variant (greater id wins)
- [x] 3.3 Run both specs red against the unchanged code; commit output as `red-run.txt` in this change dir, showing the hook case failing on its own
- [x] 3.4 After 1.1, run the spec green; record mutations (no sortBy, startedAt asc, no id.desc, no completedAt filter) red in `mutations.txt`
- [x] 3.5 Run the full spec file plus the hook/guard specs that use `HookTriggerService` (`HookRoutesSpec`, `PipelineRunGuardIntegrationSpec`, `ExistenceNotLeakedRoutesSpec`) green
