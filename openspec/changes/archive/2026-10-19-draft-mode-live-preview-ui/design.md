## Context

All paths below are under `frontend/src/features/pipelines/` unless stated. Facts were read from the tree at `538a867d7`.

- **Editor writes today.** `ui/StepCardFocused.tsx:45-48` → `hooks/useStepCardState.ts:91-97` → `hooks/useStepCardPersist.ts:106-170` (`persist`: 400 ms debounce, `PATCH /api/pipeline-steps/:id`, `invalidateAll()`, tracker registration, unmount flush at `:68-100`). Field/op handlers (`stepCardFieldHandlers.ts`, `stepCardOpHandlers.ts`) call `persist`/`emitOrPersist`. `hooks/useStepCardPreview.ts` is imported by nothing (dead). The editor is shared by `ui/mobile/MobileStepSheet.tsx:75`.
- **Other mutations are immediate** (optimistic `setSteps`, then a request): remove (`usePipelineStepMutations.ts:64-105`, then `syncStepsFromServer`), reorder (`:133-204`), enabled toggle (`usePipelineRootAndToggleActions.ts:97-122`), duplicate, add/remove root, add/insert step, lane add, shape instantiate, Output create/update/delete (`state/outputsSlice.ts:143,155,167`).
- **An unrelated "draft" exists.** `usePipelineDraftCreate.ts`: an AI-kind step stays a local temp-id (`step-N`, `isTempStepId`) until its config is complete, then is POSTed once. UI string "Draft — not yet saved".
- **Counts** come from run results (`state/stepRowCount.ts:9-26`, wired as `rowCountFor` in `PipelineSpineLayout.tsx:83-90,188` and `PipelineMobileLayout.tsx:126-132,190`). **Preview rows** are component-local in `hooks/useStepPreviewFetch.ts` (saved-config `GET .../steps/:stepId/preview`, 500 ms after a config fingerprint change), rendered by `ui/spine/StepPreviewTable.tsx` (desktop) and `ui/mobile/MobilePreviewTab.tsx` (phone).
- **Analyze** (`GET /api/pipelines/:id/analyze`) is dispatched 300 ms after any change to the LOCAL steps fingerprint (`usePipelineDebouncedAnalyze.ts`, `usePipelineStepsFingerprint.ts:36-39`) and returns the SAVED schema; editors read column lists from it (`getAnalyzeColumns` etc.).
- **Header.** `ui/spine/PipelineSpineHeader.tsx`: Dry run (secondary, `:174-184`), Run pipeline (primary, `:185-196`); "Save pipeline"/"Cancel changes"/"Discard changes?" there are the NAME rename (`usePipelineDirtyAndOwner.ts:28`, `isDirty` = name only). Phone: `ui/mobile/MobilePipelineActions.tsx:45-69` (empty `data-slot="draft-status"` row, Dry run and Run pills, a `ResizeObserver` publishing `--pipeline-mobile-actions-h`).
- **Evaluator** (`evaluator/index.ts`, `evaluatePipeline(steps, rootFrames, {sources?, previous?, editedStepId?}) → {order, nodes}`). Node statuses `ok | disabled | error | needsServer | notPreviewed | blocked{blockedBy}`. Incremental reuse is keyed ONLY by `editedStepId` (no identity check): `previous` may be passed only when exactly one step's config changed and nothing else did. Dependents of an error or needsServer step come back `blocked`. Wire codec in `evaluator/wire.ts` (not re-exported).
- **Samples.** `features/sources/state/sourceSamplesSlice.ts`: `selectRootFrames(state, roots)`, `selectSourceFrames(state, ids)`, frames memoized per sample object; `useSourceSamples` (already called in `usePipelineDetailPage.ts:189-193`) samples root sources only. Label: `ui/spine/SpineSourceCard.tsx` renders `SourceSampleLabel` (refresh for owners/editors).
- **Scheduler.** `services/draftPreviewScheduler.ts`: `createDraftPreviewScheduler({pipelineId, onLine, onSettled, onError, onTooLarge, onRateLimited, ...}) → {update(request), dispose()}`; 350 ms debounce, 600 ms max wait, 600 ms floor, single-flight latest-wins, honours 429 `Retry-After`. Lines: `step`, `unavailable`, `error`, `rows` (only for `rowsStepId`), `failed`.
- **Save.** `services/draftSaveService.ts`: `getPipelineWithDefinition(id)` (`GET /api/pipelines/:id?definition=true` → `fingerprint` + `definition{steps,outputs}` from one snapshot), `saveDraft(id, req)`, `extractDraftSaveConflict(err)` → `stale{currentFingerprint, staleTargets}` (409 `PATCH_SET_STALE`) or `cascadeRequired{impact}` (422). Request is the FINAL tree: an omitted stored step/Output is deleted. Response `{saved:{fingerprint, definition, applicationId}, run: {started:true,...} | {started:false, code, retryAfterSeconds?, reason} | null}`.
- **Motion.** `theme/ThemeProvider.tsx` `useMotion()` (`full|subtle|off`), `shared/motion/useOneShot.ts` `useOneShotOnChange`, token `--motion-duration-highlight` (1200 ms, zeroed to 0.01 ms under Off) is defined but unused. No shared flash primitive.
- **Undo.** `features/patchSets/services/patchSetService.ts:32` `undoPatchSet(applicationId)`.

## Goals / Non-Goals

**Goals:** the ticket's six acceptance criteria; zero requests for a client-evaluable edit; exact Discard; one Save & run request path with every documented outcome surfaced; phone and desktop parity.

**Non-Goals:** the live Output column rendered from draft rows (HEL-1632; the `spine-body__live-output` track stays reserved and empty); drafting structural operations other than delete (see D2); any backend change (HEL-1677 items are backend); HEL-1676; sampling join/union/lookup secondary sources that are not roots (a step needing one is `needsServer` → transport).

## Decisions

### D1. The draft is an overlay on the saved steps, owned by the page hook

A new hook (e.g. `hooks/usePipelineDraft.ts`) called from `usePipelineDetailPage` (so it survives the phone/desktop switch, which re-renders a different layout over the same page object) holds:

```
overlay = { configs: Record<stepId, config>, enabled: Record<stepId, boolean>, deleted: string[] (in order) }
```

- The saved steps (`page.steps`, as loaded and as updated by immediate writes) are the **base**. The **draft steps** are `applyOverlay(base, overlay)`, a pure function.
- `hasDraft` is true iff the draft steps differ from the base (an edit set back to its saved value drops that entry, so the overlay never holds no-op entries).
- Temp-id AI steps (`isTempStepId`) are never part of the overlay; their existing local create flow is unchanged.
- **Discard** = clear the overlay. Because the base was never mutated, the page re-renders exactly the saved state; Discard sends no request of its own. A step first opened DURING the draft had its saved-preview fetch paused and has nothing cached, so it fetches that one preview when shown, as any first-opened step does (owner ruling `amend-ac-fetch-on-view`, escalation HEL-1631-1792470998080-9a4d45).

Rejected: mutating `page.steps` in place and snapshotting a copy (two sources of truth; Discard would depend on the copy being complete, including Output config).

### D2. What the draft carries

Config edits, enabled toggles and step deletes. Deletes follow the server's splice semantics (`openspec/specs/pipeline-steps-persistence/spec.md` "DELETE ... removes a step"): the FIRST child (by sibling `position`) is promoted into the deleted step's slot (its `parentStepId`/`position` become the deleted step's), every other child and its full subtree is removed, and every Output whose node is removed is dropped from the save body. The delete emulation is a pure function with unit tests mirroring the spec's scenarios (trunk step, childless tail leaf, branch point with a tail that has a child).

Every other structural operation (add/insert/duplicate, reorder, lane add, add/remove root, shape instantiate, Output create/edit/delete) stays immediate when there is no draft and is **disabled while a draft exists**, with the reason "Save or discard your draft first" as the control's accessible description/title. Rationale: these need client emulation of server-side id assignment, lane-cycle rules or Output wiring. **Owner ruling (2026-10-19, `escalation.answered` t=1792451059308, channel chat, answer_source human): `block-during-draft-recommended`.** Drafting these operations is a follow-up ticket, not this one. The pipeline name rename is unrelated and unchanged.

### D3. Frames: evaluator over samples for base AND draft

A hook (e.g. `hooks/usePipelineDraftFrames.ts`) maps `Step` → evaluator `StepDefinition` (`opType.id` → `kind`, null-safe parent/root/position) and runs `evaluatePipeline` twice, memoized:

- **base walk** over the saved steps (recomputed only when the base or the samples change), giving the "104" side.
- **draft walk** over the draft steps, giving the "92" side. When the only change since the previous draft walk is one step's config, pass `previous` + `editedStepId`; on ANY other change (sample identity, enabled, delete, base change, Discard) do a full walk. This respects the evaluator's identity-free reuse contract.
- Root frames come from `selectRootFrames`; secondary sources from `selectSourceFrames` (secondaries that are not sampled are absent, so those steps are `needsServer`).
- With no draft, the draft walk is the base walk, and NOTHING displayed changes from today (see D7a): the walks are only displayed while a draft exists.

**Displayed status per step** (a pure mapping, unit-tested):

| evaluator / transport state | displayed |
|---|---|
| `ok`, `disabled` | `ok` (count shown; "off" for disabled as today) |
| `error` | `error` (message in the editor/preview) |
| `blocked` by an `error` step | `stale`: show this step's last good frame (from the previous draft walk or the base walk) |
| `needsServer`, or `blocked` by a `needsServer` step, while a transport request is in flight or queued | `needsServer` shown as pending; previous frame visible, marked stale |
| same, after the transport answered for it | `ok`/`error` from the server line |
| `notPreviewed` (AI) and its dependents | "not previewed (AI step): runs on Save & run" |

### D4. Server-only steps use the HEL-1630 scheduler, only in draft mode

One scheduler per page (`createDraftPreviewScheduler`, disposed on unmount/pipeline change). While a draft exists and at least one draft node is `needsServer` (or blocked by one), call `update()` with the full draft request: root rows encoded with `evaluator/wire` `encodeRow`, steps, lanes/sources as the request type requires, and `rowsStepId` = the selected step when it is a server-resolved node. `step`/`unavailable`/`error` lines update per-step counts/status; the `rows` line updates the selected step's preview rows. `onRateLimited` keeps the pending state (the scheduler retries itself); `onTooLarge` shows "Too large to preview before saving" for those steps; `onError`/`failed` mark them `error` with a generic message, frames stay visible marked stale. The scheduler is never invoked for a client-evaluable draft, and never with no draft. Nothing in this path calls a run endpoint, so the HEL-505 run guard is never consumed.

With **no draft**, nothing changes from today (D7a): every step keeps the saved-config `GET .../steps/:stepId/preview` via `useStepPreviewFetch`.

### D5. Analyze is suspended during a draft

`usePipelineDebouncedAnalyze` does not dispatch while `hasDraft`. Editors' column lists for a step whose parent node is `ok` in the draft walk come from that parent frame's schema (`frameSchema`); otherwise they fall back to the last analyze result. After Save & run or Discard, analyze runs once as today (one request, not per edit).

### D6. Editor persistence seam

`useStepCardPersist`'s network path is removed: `persist(cfg)` becomes "write the config into the draft overlay" (synchronously, no debounce, no `invalidateAll`, no tracker registration, no unmount flush). `emitOrPersist`'s temp-id branch is unchanged. `captureErrors`/client validation error display keeps working against local validation. `useStepCardPreview.ts` is deleted. `StepSaveContext`/`useStepSaveSeam` stay for the remaining immediate writes (toggle with no draft is now a draft entry too, so the tracker only covers structural writes). The phone sheet shares the editor, so both layouts get it.

### D7a. Count and preview source per state (decided; spec deltas in `pipeline-detail-spine-layout` and `pipeline-detail-mobile-layout`)

| State | Spine / phone Steps counts | Preview table |
|---|---|---|
| No draft | Unchanged: in-session run count, else persisted latest-run count, else "—"; partial marker as today | Unchanged: the saved-config step preview (`useStepPreviewFetch`), exactly one request on open |
| Draft | Sample counts from the walks: draft count, and "base → draft" when they differ, BOTH from the same sample (never a run count beside a sample count). When the root sample is truncated (source larger than the 1,000-row sample) the counts carry a visible "sample" marker and an accessible name saying they are counts over the first 1,000 rows | The selected step's draft frame rows |

The saved-config preview fetch keys on the SAVED step config only (the base), so a draft edit and Discard never trigger it; after Discard the table shows the rows it already held for the saved config with no request. After Save & run the base changes, so it fetches once, as today after a run.

### D7. Spine count and preview table (draft state)

- Spine row: draft count; when it differs from the base count, "base → draft" (e.g. "104 → 92") in mono with an accessible label "104 rows saved, 92 in draft". Disabled stays "off"; unknown stays "—". Status glyph/text: pending, error, stale (dimmed count), not previewed.
- Preview table (desktop `StepPreviewTable`, phone `MobilePreviewTab`): the selected step's frame rows (first 50 rendered as today's grid allows; count shows the frame count), caption state `live` (fresh), `updating` (pending) or `stale`; error message when the step is in error; "not previewed (AI step): runs on Save & run".
- The `live` indicator is not accent (DESIGN.md accent discipline): use the success/positive token.

### D8. Changed-row flash

On a new frame for the selected step, rows whose content key (stable JSON of the row) was not in the previous frame of the SAME step are marked changed. CSS: `.step-preview__row--changed` animates a background tint over `var(--motion-duration-highlight)` with the shared easing token; under `data-motion="off"`/OS-reduced the animation collapses (global rule) and a static tint stays until the next frame instead. Subtle keeps the fade. No literal durations (the `motionPrimitiveLiterals` rule). Switching the selected step never flashes (it is not a change of the same step). A frame of more than ~200 changed rows does not flash (whole-table churn is noise) — reversible, listed.


**Cycle 2 (DESIGN.md §11, [mechanical]):** the draft chip carries an `--app-accent` dot on desktop (including the collapsed dot at 769-1100) and in the phone `draft-status` slot; §11 names it, so it is the DESIGN.md exception to "accent only on Save & run, the selected step and focus". The flash wash is an `--app-accent` wash at 22% via `color-mix` (fading over `--motion-duration-highlight` on `--motion-ease-out`; a static 22% tint under Off). Owner ruling `accent-22-amend-design` (escalation HEL-1631-1792466384183-32dd07): §11's 30% is amended to 22%, an already-scored accent-text tint strength, so `appearance.ts` and `theme.css` are untouched.

### D9. Save & run

1. `getPipelineWithDefinition(id)`. Normalize its steps (`id, type, config, enabled, parentStepId, rootId, position`) and Outputs (`id, name, kind, nodeStepId, rootId, config`) and compare to the page's base. Mismatch → the stale notice (D10) without posting. Match → use its `fingerprint` as `baseFingerprint`. (This avoids relying on `currentPipeline.fingerprint`, which immediate writes do not refresh.)
2. Build `DraftSaveRequest`: every draft step with its id (the FINAL tree, D2) and ALWAYS an explicit boolean `enabled` (the server treats a missing `enabled` as true, `DraftDiff.scala:228`, so omitting it would silently re-enable every disabled step), every surviving Output from the definition unchanged, `runAfterSave: "run"`.
3. `saveDraft`:
   - **The run is synchronous.** The save response returns only after the run finished (`DraftSaveService.scala:146-160` awaits `runService.submit`) and carries `{runId, status: succeeded|blocked}` but no rows or counts; the page's run state (`runStatus`, `runStepRowCounts`, `runResult`) is set today only by `submitPipelineRun` (`state/pipelinesSlice.ts:217-246`). So:
     - **Before posting**, dispatch a new `pipelines` action (e.g. `draftSaveRunPending({pipelineId})`) that sets the same fields `submitPipelineRun.pending` sets (`runStatus: "queued"`, `runPipelineId`, `runIsDry: false`, cleared `runError`/truncation) and call `setSseActive(true)` exactly as `handleRunPipeline` does (`usePipelineRunAndSaveActions.ts:65`), so the header's run status chip and the existing run-progress stream show the run while the save request is open. Save & run shows a busy "Saving…" state; Discard and editing are disabled while it is open.
     - **On 200 with `run.started`**: dispatch `draftSaveRunSettled({pipelineId, status})` (both new reducers copy the HEL-1483 `runPipelineId` ownership guard the existing run reducers have) mapping `succeeded` → `runStatus: "succeeded"` and `blocked` → `runStatus: "failed"` with `runError` = "Run blocked by an assertion" (the same copy the run path uses for a blocked run, if one exists — the executor greps for it and reuses it), and clearing `runStepRowCounts`/`runResult` so the spine falls back to the persisted counts; then `fetchPipelineById` (one request: refreshes `lastRunStepRowCounts`, last-run meta and truncation from the run that just finished), `refreshRunHistoryAfterRun` and `refreshVisibleOutputPreviews` as `handleRunPipeline` does.
     - **On 200 with `run.started === false`** or any non-200: `draftSaveRunSettled` resets the run fields as `submitPipelineRun.rejected` does (no error banner for a refused run; the toast below explains it), and `setSseActive(false)` if it was set.
   - **200**: replace the base steps and Outputs with `saved.definition` (dispatch into the existing slices), clear the overlay, run analyze once, and settle the run as above. If `run.started === false`: toast "Saved. Run not started: rate limit, retry in N s" (`reason`-based copy; N from `retryAfterSeconds`, omitted when absent) with a **Run now** action calling the existing run handler. Always a toast "Saved" with an **Undo** action (`applicationId`).
   - **409 stale** → D10. **422 cascade** → D11. **400/other** → an error alert; the draft is kept; when the error names a step, the alert names it.
4. Save & run is disabled while a save is in flight and while a run is queued/running; Discard is disabled while a save is in flight.

### D10. Stale base (owner ruling `reload-only`)

An inline alert under the header: "This pipeline changed since you started editing." with ONE action, **Reload the saved pipeline**. Reload: `getPipelineWithDefinition`, replace the base steps/Outputs with the definition, keep the overlay, and drop overlay entries whose step id no longer exists (then show "N of your edits no longer apply" when N > 0). No overwrite path anywhere.

### D11. Cascade confirmation

A confirmation dialog listing the impact from the 422 (`stepIds` resolved to step names, `outputIds` to Output names, `panelIds` and `alertRuleIds` counted; the server's `hints` when present). Confirm → resend once with `confirmCascade` = the impact. A second 422 shows the new impact again (never loops automatically).

### D12. Undo

The Undo toast action calls `undoPatchSet(applicationId)`. Success: reload the definition into the base (as D10's reload, with an empty overlay) and toast "Undone.". 409: an alert naming the bound panels and alert rules that block it, per the owner ruling `refuse-dependent-restore-rest`; the saved state is unchanged. Undo is offered only while there is no newer draft (a click with a draft open first asks to discard it).

### D13. Leaving with a draft

The existing `beforeunload` guard also fires while `hasDraft`. In-app navigation away from the page with a draft asks for confirmation through the same "Discard changes?" pattern (reuse, not a new dialog style).

### D14. Phone

Corroborated by the archived HEL-1582 change (`openspec/changes/archive/2026-10-17-mobile-pipeline-step-spine/design.md:94-97`): on phones the draft status lives in the action bar's slot, not the header, and clearance follows `--pipeline-mobile-actions-h`.


`MobilePipelineActions` gets `{hasDraft, saving, onDiscard, onSaveAndRun}`. With a draft: the `draft-status` slot shows "Draft · unsaved changes" (with the same dot as desktop), the pills are Discard (secondary) and Save & run (the only accent fill). Without: unchanged. The `ResizeObserver` clearance already follows the slot height. Alerts (stale, cascade, errors) use the same components as desktop; the cascade confirmation uses the existing phone sheet/dialog pattern.

### D15. e2e and measurement

- New `e2e/hel1631-draft-mode.spec.ts` with `attachApiRequestCounter` (HEL-1620) attached before login, asserting the worst 60 s window ≤ `MAX_WINDOW_TARGET` and zero 429s in `afterEach`.
  - Zero-request burst: after the page has loaded and samples arrived, record EVERY request to `/api/` during a burst of ≥ 10 edits to a client-evaluable step (filter/compute), assert 0 (no PATCH, no analyze, no preview); assert spine count shows "saved → draft" and the preview updates; measure per-edit latency (input to DOM update, `performance.now()` in page) and assert < 50 ms.
  - Discard: snapshot the steps/configs/order/enabled/Output config shown and the definition fingerprint (one `GET ?definition=true` via `page.request` before and after, OUTSIDE the zero-request window), Discard, assert deep equality and zero page requests during Discard.
  - Save & run: exactly one `POST .../draft/save`; the header shows the run status while the request is open and the persisted counts of the finished run afterwards; one journal row: counted through a read endpoint for patch-set applications if one exists, else by citing HEL-1629's backend spec that asserts exactly one row per save, plus the observable that the returned `applicationId` undoes to the prior config. A pipeline with a DISABLED step is saved and the step is still disabled afterwards.
  - Server-only step (e.g. `convertformat` or `chunkbytokencount`): edits show pending then a server-updated count; the number of `draft-preview` requests over a 3 s drag-like burst is ≤ the scheduler's pacing bound and no `/run` request is made.
  - Stale 409 (a second API write between load and Save) shows only "Reload the saved pipeline"; reload re-applies the draft.
  - Run refused: `page.route` fulfils `draft/save` with `run.started=false, code 429, retryAfterSeconds 12` → the message and Run now. (UI contract test; the backend half is HEL-1629's.)
  - Phone 375: draft slot text and pills.
- `e2e/hel1579-pipeline-spine-layout.spec.ts:381-396` changes from asserting a PATCH on step switch to asserting none.
- HEL-1677 item 8: measure locally whether aborting an in-flight draft-preview fetch closes the backend stream (backend log or the gate's in-flight release), if it can be done without new backend code; Cloud Run itself cannot be measured locally and is listed as a follow-up.

## Risks / Trade-offs

- **Client/server disagreement at save** (a draft passes the client and fails `validateRawConfig`): surfaced as a 400 naming the step; draft kept. Accepted per `docs/live-draft-preview.md` §5.
- **Definition comparison false mismatch** (D9 step 1): normalization differences would show a spurious stale notice. Mitigation: unit tests over a real `?definition=true` payload shape and the e2e Save path; if a field cannot be compared reliably it is excluded and named in the PR.
- **Blocking structural ops during a draft** (D2) is a UX restriction; reversible; listed.
- **Sample absent** (error, no access): with a draft, steps with no root frame show `error`/unavailable with the sample label explaining why; Save & run still works.
- **Analyze suspended** (D5): an editor whose parent is not client-evaluable sees saved columns until save; acceptable and stated in the editor via the step status.

## Migration Plan

Frontend-only; ships behind no flag. Rollback = revert the PR (the endpoints it uses are already live and unchanged).

## Open Questions

None. D2 is an owner ruling. Reversible UI calls taken as recommended (D8 200-row flash cap, D13 in-app confirm, draft chip with an accent dot per DESIGN.md §11) are listed in the PR body.


## Cycle 3 addendum (skeptic-final-1)

- D13: `useDraftLeaveGuard` holds reloads, tab closes and in-app link clicks. Leaves it cannot hold (Back/Forward, palette, Settings) keep the overlay in `sessionStorage` (`helio.pipelineDraft.<pipelineId>`, per tab), re-applied through `rebaseOverlay` when the page reopens with its saved steps loaded; Discard and a successful save remove it. Edits whose step is gone are dropped silently on restore.
- D12: the "Saved." toast is dismissed when its Undo succeeds or a newer save replaces it; an application can be undone once from the UI.
- D9: after a save the Output previews refresh from `saved.definition.outputs`, never the pre-save list.
- Resolved (owner ruling `amend-ac-fetch-on-view`): Discard sends no request of its own; a step preview not yet loaded is fetched on view, as for any step first opened. The Discard e2e no longer carries a `test.fixme`.

- D13 (skeptic-final-2): the kept draft stores `{overlay, base}`, `base` being a signature of the saved steps it was made against (`baseSignature`; Outputs are not part of it: Outputs cannot be edited while a draft exists, because the structural controls, Add output included, are blocked by D2, so the overlay holds nothing about them; `definitionMatchesBase` in `state/pipelineDraft.ts` still compares the Outputs against the freshly read definition when the draft is saved). On open, a differing signature restores the overlay but sets `staleRestored`: the stale notice shows at once and `post` refuses to save until `reload` (D10) re-bases it. Kept drafts (`helio.pipelineDraft.*`) are removed by the `logout` thunk and, since HEL-1685, by every `clearAuth` (the 401 interceptor and a failed session check too).
- Measured (HEL-1631 cycle 6): the first draft edit also pays first-execution V8 compile and cold-interpreter cost, about 20-25 ms at 4x CPU (trace: `V8.CompileCode`/`ParseFunction`/`CompileIgnition`); edits 2-10 are warm. The latency budget is therefore 100 ms for the first edit, 50 ms after (owner ruling `relax-cold-first-edit`). An idle warm-up of the draft evaluation path is a possible follow-up.
