## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 30bf2390a563704789f3bff725fbce48bd3f582d (base 96ed5156b, resolved live via resolve-review-base.sh).
Working tree at review time also carried uncommitted planning edits (design.md D2a, tasks.md C1) that were not made by
the executor; see CR2.

### Phase 1: Spec Review — FAIL

- AC fail-first (400 -> 201): PASS. fail-first.md records the red run; I re-ran it live: `POST` of an insight Output
  returns 201 (lane DB helio_hel1740).
- AC 400 naming the key (unknown key, foreign `reads.outputs`, self-read): PASS. The route specs cover it, and I checked
  it live: `{model:"x"}` gives 400 naming `model`. An all-zero id gives 400 naming `reads.outputs`. A PATCH that makes
  the insight read itself gives 400 "reads.outputs must not name the insight itself".
- Reads check scoping: PASS. These validating paths enforce it:
  - `OutputService.create`, which is always ValidateWrite.
  - `OutputService.update`, under ValidateWrite only (`OutputService.scala:250-253`).
  - `PipelineCreatePreflight`, where the empty map rejects any id.
  - `DraftDiff.readsOk`, which skips under RestorePriorStored.

  These restore paths skip it:
  - `PatchSetApplyRollback` goes through update with RestorePriorStored.
  - `DraftRestore` sets allowExplicitIds, which selects RestorePriorStored.
  - `PatchSetUndoService` writes raw rows and is unchanged.

  A PATCH of another key on an insight whose reads dangle returns 200. This is pinned by the OutputRoutesSpec HEL-1740
  case. My mutation L6 (rollback judged like a write) and my mutation L4 (tolerance removed) both turned it red.
- No `model` key and no model call: PASS. The `model` key is rejected, and specs plus mutation L11 pin that. The diff
  adds no ClaudeClient or InsightModel reference. The only `model` strings in the diff are test cases that assert
  rejection. No file owned by HEL-1755 is touched: AssistantService, ClaudeConfig, ChatAccessService, the composer,
  Settings and the model catalog are all absent from `git diff --name-only`.
- The summary reducer stores null metric and series: PASS. OutputSummaryReducerSpec pins it, and the recorded mutation
  L16 turned it red.
- Not-yet-rendered state on a dashboard: PASS. Checked live, see Phase 3.
- AC "A drift test pins every Output-kind enumeration site. Dropping `insight` from any one site fails it": **FAIL**.
  See CR1. `OutputPreviewPane.tsx:172` is an Output-kind dispatch site that nothing pins. In addition, design D8 and
  task 2.1 ("tsc passes with assertNever switches") are marked done, but the diff contains no `assertNever` or
  `const _exhaustive: never` switch. The frontend branches are plain `if (kind === "insight")` chains, guarded by
  per-component jest tests only where those tests exist.
- My re-enumeration from the tree (grep of `"timeline"`, `'timeline'`, `OutputKind.Timeline` and `"markdown"` across
  backend/src/main, frontend/src, schemas, helio-mcp/src and scripts) matches sites.md, with one gap: the
  OutputPreviewPane site is listed but not guarded. OutputPicker, mobilePanelHeights, panel.ts and stepNarrowing are
  panel or convert-format kinds, not Output kinds, as sites.md says. `helio-mcp/src/tools/outputs.ts:80-81` holds
  per-kind config-key prose. It is part of the MCP surface that L8 owns, it is not pinned, and that is acceptable.
- Constraint C1 (CONSTRAINTS in workflow-state.md): the committed V138 is above origin/main's max (V137). That satisfies
  C1 as recorded in workflow-state.md. The working-tree plan now says V141, see CR2.
- Scope: one change sits outside the plan, `scripts/check-schema-drift.mjs` (KNOWN_PRE_EXISTING_DRIFT).
  - It is narrow: one exact surface label plus one exact value (`insight` missing in Scala).
  - It is justified: D6 keeps the assistant proposal tool on six kinds until L8, while D8 requires
    `create-pipeline-transactional-output-request.schema.json` to list `insight`. The two contradict unless one is
    allowed.
  - It is load-bearing: I emptied the allowed set and `node scripts/check-schema-drift.mjs` exited 1 with "in JSON
    Schema, missing from AssistantProposalToolSchemas.scala: insight".
  - It is acceptable. The issues are in its comment and in files-modified.md, both under Non-blocking Suggestions.

### Phase 2: Code Review — FAIL (CR1 only; gates are green)

Gates, run fresh by me in WORKTREE_PATH at 30bf2390a:
- `npm run lint`: clean, 0 warnings.
- `npm run format:check`: clean.
- `npm --prefix frontend run typecheck`: clean.
- `npm test`: root 66 suites, 579 tests. Frontend 790 suites, 9657 tests. All passed.
- `npm --prefix frontend run build`: OK.
- `node scripts/check-schema-drift.mjs`: in sync, 14 assistant surfaces.
- `npm run check:scala-quality`: clean, soft warnings only.
- `cd backend && sbt -J-Xmx3g testFull`: "Tests: succeeded 9675, failed 0, canceled 5", "All tests passed.", exit 0.

Mutation spot-checks. I re-ran each one, restored it with `git checkout -- <file>`, and confirmed afterwards that
`git status` showed no source changes:

| Id | Mutation | Command | Result |
| --- | --- | --- | --- |
| B8 | Drop `'insight'` from the V138 CHECK | `testOnly OutputKindDriftSpec` | RED: "should list exactly the canonical kinds *** FAILED ***" |
| B7 | Drop the Insight entry from `OutputPanelDefaultSize` | `testOnly OutputKindDriftSpec` | RED: "OutputPanelDefaultSize has a size for every canonical kind *** FAILED ***" |
| L6 + L4 | Update checks reads under RestorePriorStored, and readsChanged ignores equality | `testOnly OutputRoutesSpec InsightConfigSpec` | RED: both the dangling-PATCH/rollback test and "not judge reads the write does not change" failed (2 FAILED) |
| F3 | Drop the insight spec from frontend `nodeCapabilities.ts` SPECS | `jest outputKindDrift` | RED: 1 failed |
| F6 | `OutputPanelContent` loses its insight branch | `jest PanelContent.test` | RED: 1 failed |
| unrecorded | `OutputPreviewPane` loses its insight branch (`OutputPreviewPane.tsx:172`) | `jest outputEditor OutputPreviewPane liveOutput` | **GREEN: 469 passed. Unguarded site, CR1.** |

The recorded mutations I sampled are real and reproduce as described.

Other review points:
- Security: no injection or XSS surface is added. Foreign and unknown ids get the same message, so there is no
  existence oracle. `listByPipelineInternal` is used only to build the id-to-kind map and is never echoed back beyond
  the ids the caller supplied.
- Type safety: `OUTPUT_KIND_SET: Record<OutputKind, true>` makes a missing union member a tsc error (mutation F1).
  Good.
- Error handling: messages name the key, in the existing style.

### Phase 3: UI Review — PASS

I used the lane servers (backend 10079, frontend 7172, DB helio_hel1740). `assert-phase.sh servers` returned PASS.
Steps:
1. Signed up a fresh user through `/register`.
2. Instantiated the `founder` persona template, which creates a source, a pipeline and a 3-panel dashboard.
3. Created the insight Output through the API, since the editor picker deliberately excludes it until L5.
4. Placed it from the dashboard's **Add panel** picker, the real entry point. The picker lists it with an "insight" tag.

Checks:
- The dashboard panel shows "Not yet rendered" plus the muted detail line. It sits at 6 columns wide, next to the
  full-width table and chart panels. It uses the same card chrome, title, actions and footer as its neighbours, and the
  text is centred like other panel states.
- Light and dark, desktop (1440) and phone (390): consistent and no breakage. At 768, 1100 and 1440 there is no
  horizontal overflow.
- Live Output column, with the insight selected in the "Displayed Output" select: shows the same state.
- Output editor: an existing insight opens without a crash. Kind is locked to "Insight", the configuration card shows
  "Insight settings arrive in a later release.", the preview shows "Not yet rendered", and there is no History card.
  A rename and Save sent `PATCH` and got 200.
- Console: no errors during these flows. The only errors were the pre-login `/api/auth/me` 401, a pre-existing 404 on
  `/schedule` for an unscheduled pipeline, and the three 400s my own negative API probes produced deliberately.
- Screenshots (persisted):
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/desktop-light.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/desktop-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/phone-light.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/phone-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/live-output-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/editor-dark.png

Lane-DB residue I created, all in helio_hel1740, which is dropped whole at Delivery:
- user eval-hel1740@example.test
- dashboard 29da9838-6f26-451b-88d5-c933b798a25f
- pipeline f837770e-9225-4860-9ce2-b00693594122
- source 9c5aba9e-d2d2-4a26-99ff-b58e5ac663c8
- insight Output 68f19564-1e0a-4954-bcf9-c9a906ee3a4f, renamed to "Weekly insight renamed"

### Overall: FAIL

### Change Requests
1. **Pin the `OutputPreviewPane` insight site** (AC "dropping insight from any one site fails it", D8, task 2.1).
   - Today `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:172`
     (`if (kind === "insight") return <InsightNotRenderedState />;`) can be removed with every test still green.
     Without it, an insight falls through to the generic preview table.
   - Add a jest test that renders `OutputPreviewPane` with `kind="insight"` and non-empty rows. It must assert
     "Not yet rendered" and the absence of the row values.
   - Also move the insight branch above the `rawRowData.length === 0` early returns at `:116-121`. As written, an
     insight with no rows shows "No preview rows yet.", and since an insight ignores rows its state should not depend
     on them.
   - Then record the mutation and its red run in drift-mutations.md.
   - Either implement the D8/2.1 exhaustiveness idiom (`const _exhaustive: never = kind`, per
     `shared/chrome/resourceNavigation.ts:90`) in the kind-dispatch functions, or correct task 2.1 and the D8 text to
     describe the jest-test guard that was actually used. As it stands, task 2.1 is checked against a claim the diff
     does not meet.
2. **Migration number (planning change in the working tree, not the executor's).** design.md now has D2a and the
   tasks.md C1 text now says this ticket's migration is **V141** (ledger: V140 HEL-1755, V141 HEL-1740, V142 HEL-1742).
   The commit ships `V141__outputs_kind_insight.sql`. If that decision stands:
   - Rename the file to V141.
   - Update every reference: the file's own comment, drift-mutations.md B8, sites.md, files-modified.md, the
     tasks/design text, and any spec text that names V138.
   - Re-run `OutputKindDriftSpec` and `sbt testFull`.

   Orchestrator note: helio_hel1740 already has V138 applied (`flyway_schema_history`). After the rename, Flyway
   validation will fail there because an applied migration will no longer resolve locally. The lane DB will need to be
   recreated before the servers restart. If the orchestrator did not intend V141 for this cycle, drop this CR.

### Non-blocking Suggestions
- `scripts/check-schema-drift.mjs:826-829`: the new comment says OutputKindDriftSpec "forc[es] the removal" of the
  allowance. It does not. When L8 adds `insight` to the Scala enum, the drift spec forces an update to the spec's
  exclusion, but the allow-list entry stays behind silently, and a later regression that removed `insight` from Scala
  again would still be allowed. Consider making the loop fail on an allowance that matched nothing. Separately, the
  HEL-948 paragraph above it ("remove these two entries") is now stale: the map was empty before this change.
- files-modified.md does not list `scripts/check-schema-drift.mjs`.
- The error copy reads "Unknown config key for a insight Output" (an article mismatch for a vowel-initial kind,
  reachable through `OutputConfigValidation`'s `$kindName` interpolation). It is minor, but this is the first kind
  that hits it.
- `OutputService.scala:250-270`: the new nested `.flatMap` block is not re-indented, so the inner
  `outputRepo.updateOwned` body and the closing `}` sit at the outer level. Extracting a small
  `checkUpdateReads(...)` and calling it with `flatMap` would read better.
- `OutputPreviewPane.tsx:18`: the `InsightNotRenderedState` import is placed above the `react` import. Lint passes,
  but it breaks the file's import grouping.
- For the skeptic, a judgment call only: the insight panel footer shows "UPDATED <date>" although nothing has
  rendered.
- `PatchSetPreviewPipelineProjection` does not run the reads scoping, so a preview can pass where the apply then
  returns 400. This is already documented in sites.md and has no impact until L8.
