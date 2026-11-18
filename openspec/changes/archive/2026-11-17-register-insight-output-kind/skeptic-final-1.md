## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 593d3681dff1155fb7b84ddc6792909524400bc4. Base resolved live with resolve-review-base.sh: 96ed5156b. origin/main is aeeb68675, and its highest migration is still V137.

### What I verified (with evidence)

**Guard and environment**
- assert-cwd.sh returned READY.
- start-servers.sh reused the lane servers, and `assert-phase.sh servers` returned PASS.
- The backend's cwd is this worktree's `backend/`.
- The lane DB's flyway history ends 141, 137, 136.
- A user I registered landed in helio_hel1740 and not in the shared `helio` DB: count 0 there, checked with psql. So the servers really run on the lane DB.

**AC1 (fail-first: 400 before, 201 after)**
- On base, `OutputKind.fromString` has no `insight` case (diff of model.scala:636), so create returns 400. fail-first.md records the red run, OutputRoutesSpec.scala:230, 400 against an expected 201.
- Live now: `POST /api/pipelines/6b249118.../outputs` with kind insight returns **201**.

**AC2 (400 naming the key). Live probes against :10079, all 400:**
- unknown key: "Unknown config key for an insight Output: `bogus`"
- `model`: rejected the same way. The driver's L1 scope (no `model` key) holds.
- nested `reads.foo`: "Unknown key `reads.foo`"
- `reads.outputs` naming an Output of another pipeline:
  - same user, pipeline 28ce0909: "reads.outputs must name other non-insight Outputs of this pipeline ...: 1dd9cf4f..."
  - another user's Output: the same message, so no cross-ACL existence oracle.
- self-read through PATCH: "reads.outputs must not name the insight itself"
- insight reading another insight: rejected.
- 9 reads, maxChars 79, maxSentences 7, refresh "hourly", window `previous_run`, `compare`: each rejected, naming the key.
- non-empty fieldMapping: "'insight' has no fieldMapping slots".
- Tolerance rule: `PATCH {prompt}` returns 200.

**AC3 (drift test pins every site)**
- I re-enumerated the kind sites from the tree by grepping `"timeline"`, the markdown/timeline dispatchers and `OutputKind.`. The list matches sites.md.
  - `mobilePanelHeights.ts` and `panel.ts` switch on panel kinds, not Output kinds.
  - `outputSheetDraft` and `buildOutputConfig` fall through by default, which is correct for insight (`{}`, so no config patch is sent).
- Mutations I re-ran myself. Every source was restored with `git checkout --`, and `git status` was clean afterwards apart from the evaluator's untracked evaluation-2.md:
  - F6, OutputPanelContent loses its insight branch: `FAIL PanelContent.test.tsx` (1 failed).
  - F7, LiveOutputRender loses its insight branch: `FAIL LiveOutputRender.insight.test.tsx`.
  - F4, `insight` dropped from the create-output-request kind enum: `FAIL outputKindDrift.test.ts`.
  - B5, KnownKeys drops Insight: drift spec "KnownKeys covers exactly the canonical kinds *** FAILED ***".
  - B7, PanelPacker drops Insight: "OutputPanelDefaultSize has a size for every canonical kind *** FAILED ***".
  - B8, the V141 CHECK drops insight: "the live outputs.kind CHECK ... list exactly the canonical kinds *** FAILED ***" (OutputKindDriftSpec.scala:154). This proves the live-constraint half is real, not vacuous.
  - X1, helio-mcp outputs.ts gains insight: "helio-mcp kind enums keep the six ... *** FAILED ***". The exclusion pin works.
  - Result: `Tests: succeeded 9, failed 5`. KeysDoc also went red, as a side effect of the B5 mutation's form.
- Unmutated, the targeted specs were green: OutputKindDriftSpec, InsightConfigSpec, InsightPreflightSpec, OutputSummaryReducerSpec, OutputRoutesSpec and DraftSaveApiSpec gave `Tests: succeeded 203, failed 0`, "All tests passed."

**AC4 ("not yet rendered" state on a dashboard)**
- Not just jest: I checked it in the running app. Insight output 5caca8b0 was placed on dashboard c7d011b9 with `POST /api/panels`, and it got the 6x3 default size (layout `{w:6,h:3}`).
- The panel shows "Not yet rendered" plus the detail line in light and dark, at 1440 desktop and 390 phone.
- No horizontal overflow at 390 (scrollWidth − innerWidth = 0). No console errors.
- Screenshots:
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/skeptic/dash-desktop-light.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/skeptic/dash-desktop-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/skeptic/dash-phone-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/skeptic/dash-phone-light.png
- Design: the state reuses the existing `panel-content--state`, `__state-label` and `__state-detail` classes. These are the same classes and tokens (`--text-xs`, `--app-text-muted`) as the sibling "Not run yet" state (PanelContent.tsx:194-197). It is visually consistent with neighbouring panels in both themes.

**AC5 (summary reducer stores null metric/series)**
- OutputSummaryReducerSpec has the new case, and it is green in the run above.

**AC6 (no model call)**
- The added lines in backend/src/main, frontend/src and helio-mcp contain no ClaudeClient, anthropic, InsightModel or new fetch.
- No HEL-1755 file is in the diff (no AssistantService, ClaudeConfig, ChatAccess, Settings or catalog).

**Gates I ran myself**
- frontend typecheck: exit 0
- eslint, max-warnings 0, on the changed frontend files: exit 0
- `node scripts/check-schema-drift.mjs`: exit 0, in sync
- The full sbt testFull and the full jest run are the evaluator's, pasted in evaluation-2 (9675 succeeded, 0 failed). My targeted reruns agree.

**Migration (C1, D2a)**
- V141 drops and re-adds `outputs_kind_check` with seven values, bracketed by NO FORCE/FORCE RLS like V108/V117.
- origin/main is at most V137, so V141 is above it. The driver's ledger caveat (V140 must merge before a release) is documented in D2a.

**Write paths (D4)**
- Read in the diff: `OutputService.create`/`update` (ValidateWrite only), `PipelineCreatePreflight` (empty map), and `DraftDiff.readsOk` (skipped under RestorePriorStored; the unchanged-Output short-circuit is kept). This matches sites.md.

### Judgment calls

- **(a) The footer shows "UPDATED <date>" on an unrendered insight.** Acceptable for L1. It is the shared Output-panel footer and reports the bound node's data freshness, which is true. No insight-specific render timestamp exists yet. L2 (the render store) should replace it with the render time. Non-blocking.
- **(b) KNOWN_PRE_EXISTING_DRIFT.** Acceptable. It is exact-label plus exact-value, and it fails as stale once Scala gains `insight` or the schema loses it, so L8 is forced to delete it. The evaluator showed the stale path going red. The script passes now.
- **(c) The patch-set preview does not run the reads scoping.** Acceptable for L1. The proposal surface cannot name the insight kind until L8. A refinement edit to an existing insight's `reads` would preview clean and then 400 at apply: a loud failure, never a silent bad write. Record it as an L8 requirement.

### Gate-defect check (CON-160)
- No report I relied on discloses unsound evidence mtimes, and nothing here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md 3.8 still reads "NOT RUN". The manual UI check has now been done: evaluation-1/2 for the editor, and this report for the dashboard panel in both themes and both widths. Update the line before archive, so the archived tasks do not claim it never ran.
- `InsightNotRenderedState` omits the `role="status"` that the sibling "Not run yet" state carries (PanelContent.tsx:194). Consider adding it for parity.
- The panel's refresh button on an insight re-fetches rows that the branch ignores. This is harmless, but L2 should give the button a meaning.
- Lane-DB residue I created, all in helio_hel1740, which is dropped whole at delivery:
  - user ea8ac1bc-2b54-4c56-97be-3841e94de51e (skeptic-hel1740@example.test)
  - dashboards c7d011b9-586f-49dc-978c-b48a845c694f and de464d64-d5e5-4e09-b1f4-7a6d182e14af
  - pipelines 6b249118-2ede-4247-902f-c559d9227460 and 28ce0909-9b74-4399-9df7-7d7b11f468c9
  - sources d375f11c-4d6c-4732-b273-56251ad62168 and 01a6e878-c877-47d9-98bd-6883a9495e7a
  - insight Output 5caca8b0-7118-4891-8b0e-a6e186a45b42
  - panel 3cd3243b-f4f2-4248-8586-f201d3c418c6
- Servers left running. The shared Playwright browser is now signed in as the skeptic user, with theme set to light.
