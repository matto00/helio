## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD f6fc78a87cc6a22ab2a36955f597f1c74116f1a5. The diff base is e3eda3eda (resolve-review-base.sh). The cycle-2 delta is c234f78f7..f6fc78a87.

### Phase 1: Spec Review — PASS
Cycle-1 change requests:
1. **CR1 (hel1746 viewer dialog name): resolved.** `e2e/hel1746-ask-ui.spec.ts:498` now uses `getByRole("dialog", { name: "Orders table", exact: true })`. The full file passes in all 4 projects (fresh run below).
2. **CR2 (positive copy assertions): resolved.**
   - `previewNoSteps`: viewer and editor are asserted through the real phone page (`PipelineMobileLayout.viewerReadOnly.test.tsx`, "phone Preview tab with no steps").
   - `spineRootEmpty`: viewer and editor are asserted in `PipelineSpine.test.tsx`, which uses a two-root harness with an empty second root.
   - `editorPickDescription`: pinned at the table level in `ui/viewerCopy.test.ts`. The weak negative-only test was removed.
   - Judgment on the executor's justification. The claim that "the page never rests in that state" is not strictly true. `defaultSelectedStepId` (`hooks/useStepSelection.ts:22-30`) selects only the first trunk step of root 0. A multi-root pipeline whose first root has no trunk steps therefore rests on "Select a step" with steps present. The table-level pin is still adequate, because the layout wiring is a one-line `copyFor(VIEWER_COPY.editorPickDescription, page.canEdit)` beside the empty-pipeline branch, and that branch is page-tested. I record this as a non-blocking note, not a change request.
   - The new invariant test ("no viewer variant invites add/edit/run the", every variant differs from the editor string) is a useful guard.
3. **CR3 (contrast evidence): resolved.**
   - The persisted `contrast-{desktop,phone}-{light,dark}.json` now hold green values between 8.70 and 15.89.
   - mutations.md says the M1 JSON was not kept and that the screenshots are from the cycle-1 green run.
   - My fresh run on f6fc78a87 agrees: the minimum is 6.17 (phone light, output name) and every value is at least 4.5:1.
   - This rests on content values, not mtimes.

Optional follow-ups the executor also did:
- `canEdit`/`editable` are now required (fail-closed) in `usePipelineDraft`, `usePipelineDraftRouting`, `usePipelineDetailStepActions`, `usePipelineDetailSaveWiring`, `usePipelineRunAndSaveActions` and `usePipelineSourceScheduleActions`. The existing test call sites now pass the value explicitly. No test was weakened; each one adds a single prop.
- There is a new rename-save viewer/editor test.
- `PipelineDetailDialogs.memo.test.tsx` adds a role-flip test, as D4 asked: `readOnly` flips to true and the schedule dialog closes.

Every non-retired CONSTRAINTS entry (C15) is honoured.

### Phase 2: Code Review — PASS
Gates (my own fresh runs in WORKTREE_PATH):
- `npm run lint` 0, `npm run format:check` 0, `npm run typecheck` 0, `npm --prefix frontend run build` 0.
- `npm test`: root 645/645; frontend 10663/10663 (928 suites).
- e2e, full files, lane DB helio_hel1794, 2 workers: `hel1794-viewer-read-only`, `hel1746-ask-ui` (all 4 projects, including :421 which was red in cycle 1) and `hel1661-viewer-run-controls`. 19/19 passed.

Code: the cycle-2 delta is types, tests and one e2e locator. There is no runtime behaviour change beyond removing the permissive defaults, and every production caller already passed the value. No dead code was added. The cycle-1 code findings stand as PASS.

### Phase 3: UI Review — PASS
No UI-rendering code changed in cycle 2. The cycle-1 live viewer check still applies (desktop 1440/1100/768, phone 390 step sheet, Output sheet, console clean apart from the expected pre-login 401 and grantee schedule 404). The fresh e2e run re-exercised viewer desktop and phone in light and dark (allow-list scan, network watch, no draft, contrast) and the editor control, all green.

Evidence (fresh, cycle 2): /home/matt/Development/helio/.concertino/runs/HEL-1794/evidence/e2e-evidence/HEL-1794-eval2/eval2-contrast-{desktop,phone}-{light,dark}.json

### Overall: PASS

### Non-blocking Suggestions
- The e2e allow-list scan skips every element under `fieldset[disabled]`. Links are not disabled by a fieldset, so an active `a[href]` inside the read-only step or Output fieldset would go unseen. Consider scanning `a[href]` inside disabled fieldsets too.
- A viewer still sees `HistoryPayloadsField`'s "Request Beta access (opens in a new tab)" upsell link, active inside the disabled History card of the Output sheet. It is not a pipeline edit control, so this is a product call, not decided here: should a viewer, who cannot configure history payloads, be shown that upsell?
- `viewerCopy.test.ts`'s comment says the no-selection description is "a transient the page never rests in". A multi-root pipeline whose first root has no trunk steps does rest there (`useStepSelection.ts:22-30`). Correct the comment. Optionally, add a page-level assertion with such a fixture.
