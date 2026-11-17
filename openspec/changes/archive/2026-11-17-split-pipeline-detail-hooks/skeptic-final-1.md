## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: 86ab9223df8bfcfe961f3d24e39d77685ee1ce68. Base resolved live with `resolve-review-base.sh` (main, origin), which returned a6499da125f7984d9d0338f09a0ef62173865382.

### What I verified (with evidence)

**AC1, sizes.** Read the measured-sizes table and cross-checked it against the diff stat. The composer `usePipelineDetailPage.ts` is 212 lines (was 562) and `usePipelineDraftSave.ts` is 234 (was 433). Every new module is 130 lines or fewer. No file is over 250, so no exception needed justifying.

**AC2, behaviour preserved.** I compared main's `usePipelineDetailPage.ts` and `usePipelineDraftSave.ts` line by line against the new modules.
- **Effect-bearing call order is identical.**
  - Composer: useNavigate → OwnPipeline → AnalyzeState → EditorState → usePipelineDraft → useRunHistory → RunStream → PageLoad → (Fingerprint, SourceSamples, DeferWatchdog, DebouncedAnalyze, ClearRunOnLeave, Lookups) → DirtyAndOwner → OutputSheets → SourceSchedule → StepStructure → StepMutations → RootAndToggle → routing → RunAndSave → selector → DraftSave.
  - The only things that moved earlier are effect-free: the UiState `useState`s and the render-time outputName sync. That is allowed by D1. A render-time setState is order-insensitive anyway, because React re-runs the render before it commits.
  - `useNavigate` stays in the composer and is passed down.
- **The routing code was moved verbatim.** Diffing `usePipelineDraftRouting.ts` against main lines 344-413 shows the same `useCallback` and `useLatestCallback` bodies and the same dependency arrays.
- **Draft save keeps its order.** The mounted effect and the dropped effect still run before `useSearchParams`, which now lives in Settle.
  - `post` keeps the same side-effect order.
  - The builder's inputs (`stepsRef.current`, `allOutputsRef.current`, `overlayRef.current`) are still read after the await.
  - The catch mapping is equivalent: stale → notice; cascade → prompt with the "A step" and "An Output" fallbacks; anything else → error naming the step.
  - Dependency arrays only gained stable values (state setters and refs), so callback identities are unchanged.
- **Return shapes are unchanged and consumers are untouched.** The key-set guard `usePipelineDetailPage.keys.test.tsx` was recorded on main. The re-exports of `DraftNotice`, `DraftCascadePrompt` and `PipelineDraftSave` are in place. No consumer file appears in the diff.
- **Fresh gate runs, all by me:**
  - `npm --prefix frontend run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - prettier `--check` on the changed files: clean.
  - jest `features/pipelines` with `--maxWorkers=3`: 185 suites, 2973 tests passed, exit 0.
  - e2e hel1704, hel1685, hel1684, hel1631 and hel1705 on DEV_PORT 7136 with `--workers=2`: **46 passed**, exit 0.

**AC3, seams.** Draft-op application is in `usePipelineDraftRouting.ts`, which has the `ImmediateStepHandlers` interface. Draft save is split across `usePipelineDraftSave.ts`, `draftSaveRequest.ts` (where the Outputs part of `buildDraftSaveRequest` is) and the adopt, undo and settle hooks. Page wiring is in the composer. HEL-1733 and HEL-1734 can extend each of these separately.

**AC4, the title is never clipped.** I measured it myself in the running app on my own servers (7136/10043), on a pipeline I seeded with one filter step and a chart Output, with the Output section open and the layout in `disclosure` mode:
- **900x600, dark and light (identical):**
  - main column 93-420
  - editor 109-355 (scrollHeight/clientHeight 267/246)
  - first condition row bottom 330, inside the editor
  - preview 367-404, title 376-394, fully inside the preview
  - no document scroll
- **900x700:** editor 109-376 (267/267, no inner scroll), preview 388-484, title 397-415. Nothing moved compared with main.
- **Red first, reproduced independently.** I injected main's rules in-page at 900x600 (editor `flex-shrink: 0`, preview `min-height: 0`). The preview became 388-404 and the title 397-415, so the title is clipped and the spec's `title.bottom <= preview.bottom` assertion fails.
- **Screenshots:** I looked at both. The "Rows after step 1 · 14 rows" title row is fully visible, light and dark have the same layout, and the condition inputs are fully visible. Only "+ Add condition" scrolls inside the editor, which is the trade-off D4 chose.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1704/evidence/e2e-evidence/HEL-1704/skeptic-900x600-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1704/evidence/e2e-evidence/HEL-1704/skeptic-900x600-light.png`
- **Design standard.** The `min-height: calc(1px + 2 * var(--space-2) + 1lh)` is built from a spacing token plus the title's line box. DESIGN.md has no border-width token, so the 1px border is not a missed token. The rule is scoped to `[data-live-layout="disclosure"]`. There is no new component and no new colour.
- **Console.** The only error is a 404 on `GET /api/pipelines/:id/schedule`, which is expected because the pipeline has no schedule.

**AC5.** The comment at `PipelineSpineLayout.css:64` now says the editor is capped at 45%, with a 290px floor in the disclosure layout, and that the table is guaranteed no rows. That matches the CSS.

**AC6.** No bugs were found. One possible follow-up is noted in evidence.md: the `react-hooks/refs` waiver could be replaced with a read at settle time, which would be a behaviour change and so is not done here. The waiver at `usePipelineDraftSettle.ts` covers a render-time ref write that was moved verbatim from main; I accept it.

**Out-of-scope files.** The diff does not touch `PipelineSpineHeader.css`, `useNow` or `useTopModalDialog` (checked against the diff stat).

**Cleanup.**
- I deleted the dev-DB user I created (38b7d750-5354-45e1-a1b8-d0003513d8d8) by exact id through the harness's `buildUserDeleteSql`. A re-query shows 0 rows for that user and for its pipeline, source and Output.
- The e2e harness deleted its own 46 users.
- I removed my probe script and stopped the servers with `stop-servers.sh`.

### Verdict: CONFIRM

### Non-blocking notes
- `e2e/hel1704-narrow-preview-title.spec.ts` relies on the filter step being selected by default and does not assert that the theme was applied. Adding `?step=` and a `data-theme` check would harden it (the evaluator also noted the first point).
- The proposal's Impact section names `StepPreviewTable.css`, but the CSS actually lives in `PipelineSpineLayout.css`. This is cosmetic.
- No mtime-ordering evidence was relied on.
