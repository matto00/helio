## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: dea17b3bd35818e635f30f2f3c32800ebb29a6e6

### Phase 1: Spec Review — PASS
Issues: none. Any-reference 409 implemented; body names only caller-visible pipelines plus an unnamed hidden count; tasks all checked; design enumerates delete paths and which references count (pipeline_roots only; step-JSON join/lookup inputs excluded as no-FK/no-cascade); helio-mcp description + test updated; first-run / proposal rollback callers updated.

### Phase 2: Code Review — PASS
Gates run fresh in the worktree (my own runs):
- `cd backend && nice -n 19 sbt testFull`: 5373 tests, 371 suites, 0 failed (no known flake seen). `sbt --client shutdown` run separately.
- `npm run lint` clean; `npm run format:check` clean; `npm --prefix frontend run build` OK.
- `npm test`: first run 1 failure in `PanelCard.test.tsx:625` (unrelated to this diff, timing-type flake, not one of the named known flakes); rerun of full suite 411/411, 4272/4272 pass.
- helio-mcp jest: 35 suites / 349 tests pass.

Scrutiny items:
- (a) Regression test: `DataSourceRoutesSpec` multi-root test seeds a panel on the dropped root's Output (`seedPanelOnRootOutput`) and, after the 409, asserts data_sources, pipeline_roots and panels rows all still exist (count == 1 each). The panel-destruction path on main is real: `outputs.root_id ... ON DELETE CASCADE` (V98:145) and `panels.output_id ... ON DELETE CASCADE` (V94:344), so the same assertions would fail on main. Caveat: the executor's red failed first at the 204-vs-409 status line, so the red run did not itself display the panel row disappearing. I did not mutate code (evaluator is read-only); this is established by schema + test reading, not by an observed pre-fix panel-absence probe. Non-blocking.
- (b) Mutation-failability: reverting `rootReferences` to a sole-root-only predicate makes the multi-root delete return 204, failing the status assertion and the row-survival assertions; the 3.7f V100 spec (invisible multi-root pipeline) also flips from refusal to deletion. Failable by reasoning; not executed.
- (c) Hidden-pipeline no-leak: `rootReferences` counts total on the privileged pool but names only pipelines via `findReadEdgesVisibleToFuture` (explicit owner-or-grant predicate); hidden contribute only a count. 3.7f asserts `pipelines` empty, reason contains neither pipeline id nor name, file survives. Live: visible pipeline named in the 409 body.
- (d) Delete paths: only `DataSourceRoutes` DELETE plus internal callers (`PipelineProposalService.rollback`/`rollbackAll`/`rollbackSourceOnly`, `FirstRunDashboardService`, `PatchSetApplyRollback`, `PatchSetUndoService`, `PatchSetApplyForward`). Ordering verified: proposal/first-run rollbacks delete the pipeline before the sources; patch-set rollback/undo iterate in reverse; refusal Lefts are now logged rather than discarded in the two cleanup helpers. Live: after deleting the pipelines, the sources deleted 204.
- Race path: P0001 recover remains only for sole-root TOCTOU; documented in the design.

### Phase 3: UI Review — PASS
Servers via start-servers.sh; `readlink /proc/<pid>/cwd` confirmed both the vite (6421) and backend (9328) processes run under the HEL-989 worktree. Live data: two CSV sources rooted in one pipeline via API, deleted from the UI.
- Sidebar delete (SidebarBody): pending-confirm warning text updated; on Confirm the 409 renders `SourceDeleteConflictNotice` naming the pipeline with a link to `/pipelines/<id>` and Dismiss; source stays in the list; no toast, no navigation. Dark and light both verified, readable contrast.
- EmptySchemaAffordance surface (empty-schema CSV rooted in a multi-root pipeline): "Delete and re-upload" -> confirm shows the inline notice naming the pipeline with link, in both light and dark.
- Console: only the expected browser network log for the 409; no app errors.
- Generic non-409 failure still toasts (unit-tested in toastListeners.test).
- Test data cleaned up by exact ids (2 pipelines, 3 sources, all 204); stray screenshots removed.
- Not run: breakpoint sweep at 1100/768/0 (notice is a plain flex column using tokens; sidebar notice wrapped properly at the default width).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- No component test covers the EmptySchemaAffordance conflict rendering (only the slice thunk and the Notice component are tested); a short test dispatching a rejected conflict and asserting the notice would lock in the second surface.
- For a stricter "red on main" artifact, a pre-fix probe asserting the panel row is absent after the 204 would show the destruction directly rather than via the status line.
- Flake observed once, unrelated: `frontend/src/features/panels/ui/PanelCard.test.tsx:625` (passed on rerun).
