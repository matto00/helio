## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD c234f78f7091c370da2a42ffa20841b2cf811502 (red ff8f658de + implementation c234f78f7), diff base e3eda3eda (resolve-review-base.sh).

### Phase 1: Spec Review — FAIL
Issues:
1. Copy table (design.md D3, tasks 3.5: "each asserted by a jest test"): three viewer variants have no positive jest assertion.
   - `VIEWER_COPY.previewNoSteps` ("This pipeline has no steps yet.", `mobile/MobilePreviewTab.tsx:75`) is not asserted anywhere.
   - `VIEWER_COPY.spineRootEmpty` ("No steps use this source yet.", `spine/PipelineSpine.tsx:240`) is not asserted anywhere.
   - `VIEWER_COPY.editorPickDescription` is covered only by the negative `queryByText(/to edit it/)` in `PipelineSpineLayout.viewerReadOnly.test.tsx`. That check passes even if the description is missing entirely.
   (`grep -rln` over `*.test.*` returns zero hits for the first two strings.)
2. Evidence defect (mutations.md: "Final-green runs: `.concertino/runs/HEL-1794/evidence/` (contrast-*.json)"). The persisted `contrast-desktop-light.json` (3.61 / 3.61 / 2.39 / 2.39) and `contrast-desktop-dark.json` (5.50 / 2.88 / 3.47) do not come from the final green run. Those values fail 4.5:1, and the light values are exactly the M1-mutation figures quoted in mutations.md. They are M1 output, persisted as final-green evidence. My fresh green run against HEAD measures every value at or above 6.16:1 (refs below), so the code is fine and the persisted artifact is wrong. Identification rests on content (byte-identical values matching M1's quoted numbers). It does not rest on mtimes: the persisted directory's mtimes are uniform (all 11:43:37.75, a copy), so they are unsound and I did not use them.

Everything else passes:
- All ACs are addressed.
- The tasks are all done.
- No scope creep. "Run to update" hidden via `canRun` is a run entry the inventory found (E1), which is consistent with HEL-1661/AC1.
- C15 is honoured: the red commit is named `-n`, and red-jest.txt shows assertion failures only, none from tsc.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs in WORKTREE_PATH, after `npm ci` root + frontend):
- `npm run lint` 0, `npm run format:check` 0, `npm run typecheck` 0, `npm --prefix frontend run build` 0.
- `npm test`: root 645/645, frontend 10657/10657 (927 suites).
- e2e (full files, lane DB, 2 workers): `hel1794-viewer-read-only` 3/3, `hel1661-viewer-run-controls` 2/2, `hel1624`, `hel1668-editor-phone-refresh`, `hel1648`, `hel1782-viewer-shell` all green.
- **`e2e/hel1746-ask-ui.spec.ts:421` fails in all 4 projects (light/dark x desktop/phone).** This is not on the known-flake list. It is a regression caused by this change:
  ```
  Locator: getByRole('dialog', { name: /^Edit Orders table/ })   (hel1746-ask-ui.spec.ts:498)
  Expected: visible / Received: <element(s) not found>
  ```
  The viewer's Output sheet title is now the bare Output name (`OutputEditorSheet.tsx` readOnly title, D3), so the existing viewer-ask test cannot find its dialog. design.md D4 requires grepping `e2e/` for every changed accessible name and running the matches. That missed this spec, and files-modified.md does not list it.

Code:
- Hook guard (`setOverlayIfEditable` via ref, stable identities), routing guards (all 15 handlers plus temp-step paths), and the rename/schedule-toggle/dialog guards match D2.
- The memo comparers are handled (`OUTPUTS_COMPARERS.readOnly: is`; `samePageForDialogs` compares the primitive `canEdit` because it is not edit-volatile).
- `isPipelineOwner` extraction (deviation 6) is behaviour-preserving and keeps the effect order (selector-only hoist).
- Deviation 2 (`open={scheduleOpen && canEdit}`) is acceptable: every opener is hidden and the dialog cannot open for a viewer.
- Deviation 3 (`ui/viewerCopy.ts`) is fine as a DRY single table.
- Deviation 5: the adapted existing tests are not weakened. They change sync `getByRole("Pipeline actions")` to an awaited `findByRole`, because the menu now appears only after the role resolves. The assertions are unchanged; the Share/Edit-source "absent" tests still run against a resolved non-owner role.
- Deviation 7 (M2 killed only by the hook test) is accepted and documented: the routing guard shadows the hook guard at page level, so the hook test is the right proof of defence in depth.

### Phase 3: UI Review — PASS (objective checks)
Live check as a real viewer grantee (lane DB, owner-PUT schedule present):
- Desktop 1440: the header has the "Pipelines" crumb, a static name, "View only", and "Pipeline actions" containing only "Run history". There is no schedule chip, no Add source, + Add step, shape, New output, row menu or grip.
- The step fields are disabled at full strength.
- The Output sheet title is "eval-out". Every field is disabled at full value strength, the footer is "Close" only, and the preview copy is the viewer variant.
- Phone 390: the step sheet is titled "Step", has no header actions menu, and its fieldset is disabled (screenshot).
- 768 and 1100: no horizontal overflow; the static name renders 28px.
- Console: only the pre-login `401 /api/auth/me` and the grantee `404 /schedule`, both pre-existing and expected.
- Contrast (fresh, opacity included): desktop light 14.20 / 12.13 / 12.86, desktop dark 15.89 / 12.02 / 14.06, phone light 14.20 / 6.16 / 9.71, phone dark 15.89 / 12.03 / 13.19.

The "Duplicate step" probe in the red network watch is genuine evidence. On main, a viewer with no draft clicking Duplicate fires `POST /api/pipeline-steps/:id/duplicate` (the `…Now` branch); typing alone only creates a client draft and sends nothing. So the probe is the only way the network watch can observe a write, and red-e2e.txt shows that exact request. On green the probe is skipped because the button is absent, so the green leg of the watch is weak on its own. The routing guard's no-write property is proven by `usePipelineDraftRouting.viewer.test.tsx` (M3/M3b), so together the evidence is adequate.

Evidence refs:
- /home/matt/Development/helio/.concertino/runs/HEL-1794/evidence/e2e-evidence/HEL-1794-eval/eval-contrast-{desktop,phone}-{light,dark}.json
- /home/matt/Development/helio/.concertino/runs/HEL-1794/evidence/e2e-evidence/HEL-1794-eval/eval-viewer-desktop-1440-light-output.png (the app rendered dark; the filename is a misnomer)
- /home/matt/Development/helio/.concertino/runs/HEL-1794/evidence/e2e-evidence/HEL-1794-eval/eval-viewer-phone-light-sheet.png

### Overall: FAIL

### Change Requests
1. `e2e/hel1746-ask-ui.spec.ts:498`: the viewer's Output sheet is now titled with the bare Output name. Change `getByRole("dialog", { name: /^Edit Orders table/ })` to `getByRole("dialog", { name: "Orders table" })` (exact) for the viewer branch, then re-run the full `hel1746-ask-ui.spec.ts` (all 4 projects) green. Also re-grep `e2e/` for `/^Edit ` dialog names used by non-owner users, so no other grantee spec depends on the old title.
2. Add positive jest assertions for the three untested viewer copy variants, with the editor/owner string asserted alongside each, as D3 requires:
   - `MobilePreviewTab` empty state: "This pipeline has no steps yet." for a viewer, "Add a step on the Steps tab…" for an editor (e.g. in `PipelineMobileLayout.viewerReadOnly.test.tsx`, Preview tab with zero steps).
   - `PipelineSpine` per-root empty line: "No steps use this source yet." on a multi-root pipeline where one root has no steps.
   - The no-selection description: `getByText("Pick a step on the left to see its configuration and the rows it produces.")` for a viewer, in place of or alongside the negative `/to edit it/` check.
3. Replace the persisted `/home/matt/Development/helio/.concertino/runs/HEL-1794/evidence/contrast-desktop-light.json` and `contrast-desktop-dark.json` with the final-green run's output (they hold M1-mutation values that fail 4.5:1). Alternatively, rename them as M1 evidence and persist the green ones separately, and correct the "Final-green runs" line in mutations.md so it matches what the directory actually holds.

### Non-blocking Suggestions
- Several new props default to the permissive value (`canEdit = true`, `editable = true`, `readOnly = false`). Every current call site passes them, but a future caller that forgets one fails open. Consider making `canEdit`/`editable` required in the hooks (`usePipelineDraftRouting`, `usePipelineDraft`, `usePipelineRunAndSaveActions`, `usePipelineSourceScheduleActions`).
- The e2e scan skips everything under `fieldset[disabled]`. A link inside the fieldset stays fully active: `HistoryPayloadsField`'s "Request Beta access" upsell is live for a viewer in the Output sheet. It is not a pipeline edit control, but the scan cannot see this class of escape. Consider scanning `a[href]` inside disabled fieldsets too, and deciding whether a viewer should see that upsell.
- The `ALLOWED` comment on "Request Beta access" names the Ask panel. That is correct: the `AskUpsell` inside the closed `<details>` still reports client rects in Chromium. It would help to note that the scan counts closed-details content as visible.
- The design called for a role-flip test in `PipelineDetailDialogs.memo`; only `SpineOutputs` has one.
