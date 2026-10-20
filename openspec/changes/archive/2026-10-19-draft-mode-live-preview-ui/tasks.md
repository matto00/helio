## Standing Constraints

- [C1] Resource and process discipline: at most 2 test workers, every heavy command under `nice -n 19`; frontend jest gets `HELIO_JEST_MAX_WORKERS=2` explicitly; before a heavy run, if the 1-minute load is over 10, sleep 60 s and recheck, for up to 30 minutes; long Bash calls use `timeout: 600000`; no kill/pkill/pgrep/killall and never signal a parent or grandparent; stop servers only with `scripts/concertino/stop-servers.sh`.
- [C2] Locks: full Playwright suites run under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`; `sbt testFull` under the same directory's `sbtfull.lock`. Playwright uses `--trace retain-on-failure`.
- [C3] Evidence and screenshots go to `/home/matt/Development/helio/.concertino/scratch/HEL-1631/`. Throwaway data created by tests or probes is deleted by exact id.
- [C4] DESIGN.md is binding: compare against the running app at 1280 and one width in 769–1100 on desktop, 375 and 430 on phone, light and dark, and motion Full/Subtle/Off. The accent goes only on the primary action (Save & run during a draft), the selected step and focus.
- [C5] `files-modified.md` lists every path explicitly (no extensionless shorthand, no "(+ test)") — CON-260.
- [C6] Zero-request claims are proven by a network-log e2e that records every `/api/` request (any method) in the window, demonstrated red first (e.g. against the pre-change PATCH path or by mutation), not by absence of a specific route.
- [C7] The changed-row flash is an `--app-accent` wash at 22% (owner ruling `accent-22-amend-design`), and DESIGN.md §11 is amended from 30% to 22%; no other surface changes.
- [C8] Discard sends no request of its own; a step preview not yet loaded is fetched on view, as for any step first opened (owner ruling `amend-ac-fetch-on-view`).

## 1. Draft model (pure, unit-tested first)

- [x] 1.1 Add a pure draft module (e.g. `state/pipelineDraft.ts`): overlay type `{configs, enabled, deleted}`, `applyOverlay(baseSteps, overlay)`, `hasDraft`, no-op-entry pruning, delete emulation per the server splice semantics (first child promoted into the slot; other children and their subtrees removed), Outputs-on-removed-nodes computation, and `buildDraftSaveRequest(draftSteps, definitionOutputs, removedOutputIds)`, which ALWAYS sets an explicit boolean `enabled` on every step (unit test with a disabled step: it stays `enabled: false` in the body). Unit tests cover the spec's delete scenarios (trunk step, childless tail leaf, branch point with a tail that has a child), edit-back-to-saved pruning, enabled toggles, and the request shape against `types/draftSave.ts`.
- [x] 1.2 Add the definition comparison for Save (normalized steps `id,type,config,enabled,parentStepId,rootId,position`; Outputs `id,name,kind,nodeStepId,rootId,config`) with unit tests over a payload shaped like a real `GET /api/pipelines/:id?definition=true` response (capture one from the dev backend into a fixture).
- [x] 1.3 Add the status mapping (evaluator node + transport state + previous frame → displayed `ok | error | pending | stale | notPreviewed`), unit-tested for each row of design D3's table.

## 2. Page wiring

- [x] 2.1 `hooks/usePipelineDraft.ts` called from `usePipelineDetailPage` (survives the phone/desktop switch): overlay state, `hasDraft`, edit/toggle/delete/discard actions, base = the page's saved steps.
- [x] 2.2 `hooks/usePipelineDraftFrames.ts`: map `Step` → `StepDefinition`; memoized base walk and draft walk with `selectRootFrames`/`selectSourceFrames`; incremental (`previous` + `editedStepId`) ONLY for a single-config change, full walk otherwise; last-good-frame retention for stale steps.
- [x] 2.3 Scheduler integration (design D4): one `createDraftPreviewScheduler` per page, used only with a draft that has a needsServer/blocked-by-needsServer node; encode roots with `evaluator/wire` `encodeRow`; map lines to per-step results; `rowsStepId` = selected step when server-resolved; handle `onRateLimited`, `onTooLarge`, `onError`, `failed`; dispose on unmount/pipeline change.
- [x] 2.4 Editor seam (design D6): `useStepCardPersist`'s network path removed (no PATCH, no `invalidateAll`, no tracker registration, no unmount flush); `persist` writes into the draft; temp-id branch unchanged; delete `hooks/useStepCardPreview.ts`; update the StepCardFocused tests that asserted PATCH behaviour (`StepCardFocused.blurNoRepatch`, `castSaveError`, `enumSaveError`, others found by grep) to assert draft behaviour instead — a test that loses its purpose is replaced, not silently deleted, and the PR lists each.
- [x] 2.5 Enabled toggle and step delete route into the draft (both layouts); all other structural actions disabled during a draft with the reason (design D2).
- [x] 2.6 Analyze suspended during a draft; editor column lists from the draft parent frame schema when `ok`, else last analyze (design D5); one analyze after save/discard.
- [x] 2.7 Count/preview source per design D7a: no draft = today's run counts and saved-config preview, unchanged; draft = sample counts (base → draft, sample marker when truncated) and draft frame rows; the saved-config preview fetch keys on the base config only so draft edits and Discard never refetch.

## 3. UI

- [x] 3.1 Desktop header (`PipelineSpineHeader.tsx`): draft chip "Draft · unsaved changes", Discard (secondary), Save & run (primary) replacing Dry run/Run during a draft; narrow widths 769–1100 keep one row and never clip Discard/Save & run.
- [x] 3.2 Phone (`MobilePipelineActions.tsx`): fill the `draft-status` slot and swap the pills (design D14); `PipelineMobileLayout.tsx` passes the props.
- [x] 3.3 Spine rows (`SpineStepRow.tsx`) and phone step list: draft count, "saved → draft" with accessible label, status glyph/text for pending/error/stale/not previewed.
- [x] 3.4 Preview table (`StepPreviewTable.tsx`, `MobilePreviewTab.tsx`): draft frame rows, live/updating/stale caption (non-accent live indicator), error and not-previewed states; changed-row flash per design D8 with tokens only.
- [x] 3.5 Save & run flow (design D9): definition read and base check, request build, `draftSaveRunPending`/`draftSaveRunSettled` reducers (unit-tested, with the HEL-1483 `runPipelineId` guard, and a test that a refused run leaves `runError` null) with `setSseActive(true)` before posting, success handling (base replaced from `saved.definition`, overlay cleared, `fetchPipelineById` + run history + Output preview refresh, Saved toast with Undo), blocked-run status, run-refused toast with Run now, 400 alert naming the step.
- [x] 3.6 Stale notice with only "Reload the saved pipeline" and re-apply with "N of your edits no longer apply" (design D10).
- [x] 3.7 Cascade confirmation dialog from the 422 impact, resend with `confirmCascade` (design D11).
- [x] 3.8 Undo action (design D12) including the 409 naming panels and alert rules.
- [x] 3.9 Leave-with-draft guard: `beforeunload` and in-app navigation confirm (design D13).
- [x] 3.10 Verify non-static sources show sample label + age + refresh on desktop and phone (existing `SpineSourceCard`); fix only if the AC does not hold.

## 4. Tests and verification

- [x] 4.1 Jest: unit tests from section 1; component tests for header/pills draft states, spine "→" counts, status rendering, Save & run outcomes (200 started, 200 not started, 409, 422, 400), Discard, Undo 409. Run frontend jest with `HELIO_JEST_MAX_WORKERS=2 nice -n 19`.
- [x] 4.2 e2e `e2e/hel1631-draft-mode.spec.ts` per design D15 (zero-request burst with < 50 ms per edit, Discard deep-equal + zero requests, Save & run one request + run + undo, server-only pending and pacing bound with no run request, stale 409 reload, run-refused UI, phone 375), with `attachApiRequestCounter` and the window/429 assertions. Delete created data by exact id.
- [x] 4.3 Update `e2e/hel1579-pipeline-spine-layout.spec.ts` (PATCH on step switch → no PATCH; its one-step-preview-request-on-open assertion must still pass unchanged) and any other e2e that asserted per-edit PATCH (grep the e2e directory for `pipeline-steps` PATCH waits).
- [x] 4.4 HEL-1677 item 8: locally measure whether aborting an in-flight draft-preview request reaches the backend (observable without new backend code); record the result and method in `.concertino/scratch/HEL-1631/abort-measurement.md`; Cloud Run remains a follow-up.
- [x] 4.5 Visual check against the running app (C4) with screenshots in scratch: 1280 and ~900 desktop, 375 and 430 phone, light and dark, motion Full/Subtle/Off for the flash; accent audit with a draft.
- [x] 4.6 Gates before handoff: lint, typecheck, format check, frontend jest, the frontend CI job's script checks (e.g. `check:node-root-encoding`, schema drift — read `.github/workflows` for the exact list), the new and touched e2e specs; the FULL e2e suite under the e2e lock before Delivery.

## 5. Cycle 3 addenda

- [x] 5.1 Kept draft (sessionStorage, per pipeline id) stores its saved-steps base; a differing base on return takes the stale-base path (no silent re-base); kept drafts cleared on logout (skeptic-final-2).
