## Standing Constraints

### Tests (red first)

- [x] 1.1 Replace `DraftSaveRlsSpec`'s two C5 tests with editor root add/remove tests (D7); run them on unchanged code and record the red output
- [x] 1.2 Add viewer 403 / stranger 404 (state unchanged) for both verbs and owner add/remove 2xx on `TwoUserRlsApiFixture`
- [x] 1.3 Add a NOBYPASSRLS test: editor root add closing a cycle via the owner's `upsertsource` step answers 400, nothing written (D2); state whether the cycle is built via the API or seeded by SQL

### Backend

- [x] 2.1 Run `PipelineRootRepository.add`'s chain on the privileged connection; verify 1.1 editor-add goes green
- [x] 2.2 Extract the phase-2 remove transaction into ONE shared privileged method (cascade, `pipelineId`-scoped `removeAction`, `compactPositions`) called by `removeRoot`; verify 1.1 editor-remove green
- [x] 2.2a Point the four specs named in design D4 at the shared method instead of their hand-built user-context transaction; verify they still pass
- [x] 2.3 D5: 0 rows deleted aborts with a dedicated exception mapped to 404 before `classifyDbError`; test at the shared-method seam where the cascade deleted rows first, asserting they are restored
- [x] 2.4 D2 audit of every statement in both chains for RLS-supplied filters; record in the executor report
- [x] 2.5 D6: prove via migrations alone (non-superuser Flyway harness `has_table_privilege`) that `helio_privileged` can write `pipeline_roots`, delete `pipeline_steps`/`node_snapshots`, update `data_sources`; add a grant migration only if red
- [x] 2.6 Update scaladoc in `PipelineRootRepository`/`PipelineRootWrites`/`DraftSaveRlsSpec` that describes owner-scoped user-context root writes

### Tests

- [x] 3.1 Mutation: revert 2.1 alone -> editor-add red; point the shared remove method at the user-context runner -> editor-remove red; both recorded, both restored
- [x] 3.2 Add one editor-actor root-add race case to `DraftSaveRaceSpec` (D4)
- [x] 3.3 Run `PipelineCascadeLockOrderRaceSpec`, `OutputDeleteRacesPanelCreateSpec`, `DraftSaveRaceSpec`, `DraftSaveSetRaceSpec`, `DraftSaveDeadlockSpec`, `DraftSaveRlsSpec` and root/cycle-guard suites on the changed code; record output
- [x] 3.4 Run the gate-selected backend suite (`sbt testFull` scope) green

### Delivery

- [x] 4.1 PR body states D1 (editors allowed, delegated by the ticket) and its consequences (a)-(c) so the owner can overturn it
