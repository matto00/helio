## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- AC1 (Playwright add-second-root/join/place) — addressed: `e2e/hel968-multi-root-editor-flow.spec.ts` drives the full flow through the running UI (register→create pipeline→"+ root"→union secondary input→Output→dashboard panel), matching HEL-913's original AC5 verbatim per the ticket.
- AC2 (Jest: deterministic root-column layout; root removal removes its lane's Outputs and surfaces placement count) — addressed in `laneLayout.test.ts` (D2 contiguity/determinism) and `PipelineDetailPage.test.tsx` (root-removal success surfaces server counts; named refusal renders verbatim).
- AC3 (multi-root node-path format, not stale single-root form) — addressed by new `nodePath.ts` + `nodePath.test.ts`, explicitly asserting the stale bare-`root` head is never produced.
- AC4 (mobile stacking + >=44px touch targets at 375/430px) — addressed in CSS + the E2E touch-target spec; independently re-verified live (see Phase 3).
- AC5 (lint/typecheck/test green) — re-verified fresh, all pass (see Phase 2).
- No AC silently reinterpreted; no scope creep found — diff is entirely inside `frontend/src/features/pipelines/**`, `frontend/src/theme/tokenAuditSweep.css.test.ts` (an unavoidable consequence, see below), `e2e/**`, and this change's own openspec artifacts.
- No regressions found to `buildLaneGraph`/`flattenLaneGraph`/`laneLayout` single-root behavior — both files' tests explicitly cover "single-root pipelines unchanged" and the totality/fallback paths are documented and tested.
- API contracts: none owned by this ticket; `pipelineService.ts`'s `createPipelineStep`/`addPipelineRoot`/`removePipelineRoot` all match the backend routes/shapes already shipped by HEL-913 (verified live, not just by type — see below).
- Planning artifacts (`design.md`, `tasks.md`) match the implemented behavior; all 37 `tasks.md` items are checked and each corresponds to real code found in the diff.

**`tokenAuditSweep.css.test.ts` judgment**: legitimate. It is a pre-existing, line-number-pinned regression baseline for `PipelineDetailPage.css`; the change adds ~110 lines to that CSS file, unavoidably shifting every subsequent pinned line number. The diff only renumbers baseline entries (verified content-identical at old→new line per the executor's note); it does not relax or remove any check. This is exactly the documented "fixture/baseline change as a byproduct of a legitimate structural edit" pattern, not scope creep or a weakened guard.

### Phase 2: Code Review — PASS

Ran fresh (not trusting executor's report):
- `npm run lint` — 0 warnings/errors.
- `npm run format:check` — clean.
- `npx jest --testPathPatterns='pipelines|tokenAuditSweep'` — 59 suites / 796 tests passed.
- `npm test` (full suite) — 256 suites / 2636 tests passed.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk warning, unrelated to this change).
- `git diff --name-only main...HEAD -- backend/ schemas/ backend/src/main/resources/db/migration/` — empty. Zero Flyway migration, zero backend/schema diff, confirming the run constraint.
- Diff otherwise confined to `frontend/**` + one `e2e/**` file + openspec artifacts — no sibling-owned files (HEL-844 REST fetch path, HEL-970 `previewAtNode`/`pathToRoot`, HEL-893 CSV/static inference) touched.

Code quality:
- `stepTree.ts`/`nodePath.ts`/`laneLayout.ts` are thoroughly commented, explaining the design rationale (R1–R7, D1–D6) inline, which materially aids reviewability. No magic values; sibling ordering, tiebreaks, and totality/fallback sweeps are all explicit and tested.
- `AddRootModal.tsx` implements the double guard specified in the ticket (disabled control + independent handler-level refusal), matching the HEL-620 regression-guard pattern, and is unit-tested asserting on the service spy rather than the disabled attribute (`AddRootModal.test.tsx`).
- The `createPipelineStep` wire-shape defect (missing `rootId` on root-level step creation against a >1-root pipeline) is a genuine, well-documented fix, discovered exactly the way the ticket anticipated (typecheck can't see it — proven live). Fix is scoped to the one broken call path and its three root-level call sites; the confirmed-unaffected call site (`handleAddOutputViaAggregateTail`, always has a real `parentStepId`) is correctly left alone.
- `removePipelineRoot`/`addPipelineRoot` surface the server's own `removedStepCount`/`removedOutputCount` and named refusals verbatim rather than re-deriving them client-side, per D5.
- DRY/modularity: `RootColumn.tsx` reuses `LaneColumn`; `nodePath.ts` reuses `laneLayout.ts`'s `secondaryInputOf` rather than re-deriving edge traversal.
- No dead code, no leftover TODO/FIXME, no untyped escape hatches found in the reviewed diff.
- Type safety: `rootId?: string | null` on the wire type documents the nullable-vs-absent distinction; UI `Step.rootId?: string` documents the not-yet-persisted-local-step case.

### Phase 3: UI Review — PASS

Servers reused (already healthy) via `start-servers.sh` / `assert-phase.sh` (`PASS servers`). Live-verified with Playwright against the shared session (closed before returning, per run constraint):

- Created a real pipeline (`Profit` single root), used the live "+ Add root" affordance with an existing source ("Netflix"): the new root column appeared as a new rightmost column with the empty-lane affordance ("No steps yet — join this source into another lane's step to use it"), an accessible "Remove root Netflix" button, and no page reload. Confirmed the `POST /api/pipelines/:id/roots` request succeeded (201) and no wire-shape defect on this path.
- Exercised the HEL-620 double-guard live: with no source selected, "Add root" is rendered `disabled=""` in the DOM.
- Removed the root via its "Remove root" control: `DELETE /api/pipelines/:id/roots/:rootId` returned 200, and the column disappeared from the tabpanel immediately (no reload), confirming the round trip and re-sync.
- Confirmed no root is styled/labelled primary — `RootColumn` renders a plain "Netflix" header, not a "primary"/"trunk" label.
- Mobile: at 375px viewport, "+ Add root"'s rendered bounding box measured 343×44 CSS px — the >=44px touch-target guard holds against the RUNNING app, not just a CSS declaration.
- Console errors: only one pre-existing, unrelated 404 for `GET /api/pipelines/:id/schedule` (expected "no schedule set yet" response, not a regression — reproduces identically on pipelines created before this change).
- No blank screens, no unhandled exceptions, across create-root / remove-root / resize flows.
- Did not re-trigger HEL-970's `previewAtNode` defect in this session (didn't attempt a non-ancestor lane rejoin); this matches the ticket's explicit instruction not to chase it.

Browser closed at the end of the review, releasing the shared Playwright session.

### Overall: PASS

### Non-blocking Suggestions

- The executor reports the new `e2e/hel968-multi-root-editor-flow.spec.ts` is intermittently flaky under parallel load. Read through: the spec already uses `page.waitForResponse` on every network-dependent step and unique per-run registration emails, which is the correct pattern — nothing in the spec itself reads as a race condition. Given this run explicitly shares one Playwright session across 3 parallel worktrees (a documented run constraint, not a defect in this test), the flakiness most plausibly traces to contention on that shared resource/dev DB rather than a test-quality defect in this file. Not a change request; worth a follow-up ticket only if it recurs outside parallel-worktree conditions.
