## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `86ab9223df8bfcfe961f3d24e39d77685ee1ce68` against base `a6499da125f7984d9d0338f09a0ef62173865382`, which was resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1: every split file is under 250 lines. The composer is 212 and draft-save is 234. The sizes are recorded in design.md, so no exception was needed.
- AC2: the returned key sets are unchanged, and a key-set guard holds them. Its recorded mutation (drop `estimatedRows`) turns it red. Exported names (`usePipelineDraftSave`, `DraftNotice`, `DraftCascadePrompt`, `PipelineDraftSave`) are re-exported, and no consumer file is touched. The four named e2e specs pass on my own run (see Phase 3).
- AC3: draft-op routing is in `usePipelineDraftRouting.ts`, draft save in `usePipelineDraftSave.ts` + `draftSaveRequest.ts`, and page wiring in `usePipelineDetailPage.ts`. These are separate modules.
- AC4 and AC5: the CSS follows D4, applies only in the disclosure layout, and is built from tokens and `1lh`. The comment at `PipelineSpineLayout.css:64` is rewritten to describe what the CSS actually does. The e2e guard checks the title, the first condition row and that the document does not scroll.
- AC6: evidence.md says no bugs were found, and the diff contains no behaviour fix.
- Tasks 1.1–5.3 are all checked. Task 4.3's missing 1280x800 screenshot is covered by my own capture (Phase 3).
- There are no CONSTRAINTS entries in workflow-state.md.
- Scope: the three `ReturnType` alias exports were not listed in the design. They are used only to type the sub-hook result objects that D2 says the composer holds instead of destructuring, so they follow from D2. I accept them; this is not scope creep.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `npm test`: exit 0. Root jest: 66 suites, 579 tests. Frontend: 778 suites, 9538 tests. All passed.

**Effect order (D1).** I traced it line by line against main.

`usePipelineDetailPage`, main vs. branch:
1. useParams / useAppDispatch / useNavigate / useToast
2. OwnPipeline → AnalyzeState → EditorState → usePipelineDraft
3. [UiState: effect-free, moved earlier; allowed by D1] → useRunHistory → usePipelineRunStream
4. seed + `usePipelinePageLoad`
5. Fingerprint → lane graph → useSourceSamples → DeferWatchdog → DebouncedAnalyze → ClearRunOnLeave → AnalyzeLookups
6. DirtyAndOwner → OutputSheets → SourceScheduleActions
7. StepStructure → StepMutations → RootAndToggle
8. Routing: the three `useCallback`s, then the five `useLatestCallback`s, in their original order
9. RunAndSaveActions → `outputsLoaded` selector → usePipelineDraftSave

Every effect-bearing call keeps its relative position. `useNavigate` stays in the composer and is passed down; the `usePipelineDetailSaveWiring` doc comment says so.

`usePipelineDraftSave`:
1. mounted effect → dropped effect
2. adopt (effect-free) → undo (effect-free)
3. settle, which holds `useSearchParams`

This matches main, where the order was mounted, dropped, then `useSearchParams`.

`post` keeps its side-effect order: in-flight ref, then `setSaving`, then `setNotice(null)`, then the builder's notices, then `draftSaveRunPending`, then `setSseActive(true)`, then `posted`, then `finally`. The builder's inputs are still read after the await, as on main.

The `useCallback` dependency lists only gained stable values (`mountedRef`, `setNotice`, `setCascade`, `savedToastRef`), so callback identities are unchanged.

**Executor-flagged items:**
- **`eslint-disable-next-line react-hooks/refs` at `usePipelineDraftSettle.ts:316`: accepted.** The write it covers is the same render-time ref write that was at `usePipelineDraftSave.ts:200` on main. Neither the Vite build nor Babel uses the React Compiler (grep of vite/babel/eslint config and package.json finds no `compiler`), so this is a lint-only waiver with no runtime effect. The comment gives the reason. The alternatives would change behaviour: moving the write into a layout effect adds an effect and changes timing, and reading `searchParams` inside the closure would make `settleSaved` stale across `post`'s await. Its follow-up is tracked as non-blocking suggestion 1.
- **ReturnType aliases: accepted** (see Phase 1).

Other checks: DRY, typing, error handling and dead code are clean. I found no `any`, TODO or unused imports. The new tests are labelled guards and their recorded mutations are in evidence.md. The spreads (`...analyze`, `...outputSheets`, `...stepActions`, `...saveWiring`) contain only keys the page already returned, and the key-set guard enforces that.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` on 7136/10043 (`assert-phase servers` PASS) and stopped afterwards. I seeded one user, source, pipeline (filter step + chart Output) and run. They were deleted by exact id afterwards; a re-query returns 0 rows for each.

Running-app measurements, with the Output section open (`aria-expanded=true`) and `data-live-layout=disclosure`. Each line is a top-bottom range in px:
- **900x600, shipped CSS, light and dark (identical):**
  - main column 93-420, editor 109-355 (scrollH/clientH 267/246)
  - first condition row bottom 330, inside the editor
  - preview 367-404, title 376-394, inside both the preview and the column
  - no document scroll
- **900x600, main's CSS** (the two new rules reverted in-page by an injected style), light and dark: preview 388-404, title 397-415, so the title is **clipped in both themes**. This confirms the light-theme red that the executor's red run stopped before reaching.
- **900x700, light and dark:** the shipped and main-CSS measurements are byte-identical (preview 388-484, title 397-415, editor 267/267, no inner scroll). Nothing moves.
- **1280x800:** layout is `column`, so the disclosure rules do not apply. All 195 `.spine-body` descendant boxes are identical with and without the new rules. This covers task 4.3's missing screenshot.
- Console: one 404 on `GET /api/pipelines/:id/schedule`. The pipeline has no schedule, so this is an expected resource 404 and was not introduced by this change. There were no app errors.
- Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1704/evidence/e2e-evidence/HEL-1704/eval-900x600-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1704/evidence/e2e-evidence/HEL-1704/eval-1280x800.png`

E2E, my own run (DEV_PORT=7136, 2 workers): hel1704 (new) + hel1631 + hel1684 + hel1685 + hel1705 gave **46 passed**. The harness deleted the 46 users it registered.

Note: `.step-preview`'s computed min-height is 37px rather than the 35px design.md measured, because `1lh` depends on the font. This does not matter, since the title and first row both hold at 900x600.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
1. File the follow-up the executor named: replace the render-time `stepParamRef` write (`usePipelineDraftSettle.ts:317`) so the lint waiver can go. Name it in the PR body.
2. `usePipelineDetailStepActions` takes both `editor` and `setSteps: editor.setSteps` (`usePipelineDetailPage.ts:121-122`). One input would do: read `setSteps` from `editor`, as the other sub-hooks do.
3. `e2e/hel1704-narrow-preview-title.spec.ts` relies on the filter step being selected by default rather than selecting it explicitly as D5 describes. Adding an explicit `?step=` or a click would make the guard independent of the default selection.
4. The PR body should state that at 900x600 the header content below the title row (schema chips, count) is clipped, which design D4 accepts.
