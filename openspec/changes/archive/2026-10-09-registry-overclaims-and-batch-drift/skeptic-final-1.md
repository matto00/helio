## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2d2106557e4217b3ad72e081a0e0f314dc74401d` (code commit `401a9d1e9`). The base was resolved live with `resolve-review-base.sh` and is `c91fffaf6ac92cfb0b21c69b0c96d97c4c851d9e`. The spawn-cwd guard printed `READY`. No UI change, so no dev servers were started.

### What I verified (with evidence)

**The Scala diff changes only comments and one test name.**
- I ran `git diff -U0 base...HEAD -- '*.scala'` and filtered out comment lines (`*`, `/**`, `//`). Only two lines remain: the old and new `PanelSpec` test name.
- `/*` and `*/` appear in the added lines only where a comment opens or closes. So no nested comment is opened by accident (Scala allows nested comments).
- I ran `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.PanelSpec com.helio.domain.model.PipelineStepSpec"`. It exited 0 with `Tests: succeeded 44, failed 0`, and the log shows `should have exactly the 6 panel kinds as its key set`.

**AC1: every new comment sentence in `PipelineStep.scala` and `PipelineService.scala` is true.** I checked each claim against the tree:
- **`All.contains` checks.** `PipelineStepKind.All.contains` is called in `PipelineService` (lines 548, 1626, 1859) and `PipelineProposalService` (line 286). `git log -S AllowedOps` shows the old set was removed in HEL-236 CS2c-3a.
- **Hand-written kind matches.**
  - `PipelineStepConfigCodec.encodeConfig` matches by hand on 23 registered config classes plus `UpsertSourceConfig`.
  - `PipelineService.toAnalyzeStepResponse` (lines 1752–1778) matches every config class.
  - Each of the protocol files mentions DateBucket 7–8 times.
- **Named sites exist and enumerate kinds.**
  - `StepSchemaInference` and the Column/MultiInput/Reshape/Text `*SchemaInference` objects exist.
  - `StepConfigValidation` dispatches on `*Step.Kind` at lines 64–71, which covers the enum-config subset of kinds.
  - `AnalyzeSchemaWarnings`, `PipelineCostEstimator`, `PatchSetPreviewProjectionSteps`, `PipelineStepCatalogService` and `PipelineStepRepository` all exist and name kinds.
  - `domain/package.scala` has type aliases at lines 36–37 and 103–104.
- **Migration.** `pipeline_steps_op_check` was last redefined in V107. The only later migration that touches `pipeline_steps` is V119, and it changes RLS only.
- **Frontend and helio-mcp.** `types/pipelineStep.ts`, `state/stepNarrowing.ts`, `hooks/useStepCardState.ts`, `ui/StepOpEditor.tsx` and `ui/stepConfigs/*Config.tsx` all exist. helio-mcp's `write.ts` and `read.ts` both mention datebucket.
- **Re-derive commands.** Both commands run. The datebucket grep lists 39 files. The test grep lists every spec named in the comment, plus others; the comment calls its own list a snapshot, so the extras are fine.
- **Named tests do what the comment says.**
  - `PipelineStepSpec:55` pins `All` to a literal set.
  - `PipelineStepRepositorySpec:104-110` inserts a row for every kind in `All`.
  - `PipelineAnalyzeServiceSpec:1534` checks there is an inferOutputSchema branch for every Registry kind.
  - `PipelineCostEstimatorSpec:143`, `PipelineStepCatalogServiceSpec:17` and `PipelineStepSecondSourceGuardSpec:40` exist as described.
  - `stepNarrowing.test.ts:690` checks `STEP_ICONS` against the authorable kinds.
- **Old overclaims are gone.** The "single source of truth" and "only requires updating" text no longer appears in either file. The `PipelineStep` trait is not sealed, so the sentence saying the compiler checks no match for exhaustiveness is true.

**AC2:** `PanelSpec`'s registry test is now named `have exactly the 6 panel kinds as its key set`. The assertion is `Panel.Registry.keySet shouldBe Set(<6 kinds>)`, and the name matches it.

**AC3:** The `PanelConfigCodec` header is true.
- Its three methods are at lines 29, 53 and 72, and each one matches all six kinds by hand.
- `decodeCreateConfig` is called from `PanelServiceHelpers:111` (panel create) and from `DashboardSnapshotImport` / `DashboardSnapshotRepository` (snapshot import).
- `PanelServiceHelpers:139-144` and `DashboardSnapshotRepository:179-184` each match all six `*Create` results.
- `PanelRowMapper:37-48` matches on `row.kind`.
- `Panel.scala:139-140` has the re-derive command the header points to.

**AC4 and HEL-1149 AC1–AC4.** I fetched HEL-1149 live; it is in Backlog. The gates and all four mutations below are my own runs. Each mutation was restored by exact path, and `git status --short` afterwards showed only the evaluator's untracked `evaluation-2.md`.
- **Gates.**
  - `node scripts/check-schema-drift.mjs` exited 0: "9 surfaces checked" and "panel-kind enum coverage: 5 schema enums detected, each checked or exempted".
  - The selftest passed every case, including the 5 new ones, and exited 0.
- **M1: red-first proof.** I dropped `"form"` from the `create-panels-batch-request` enum.
  - The base script (`git show c91fffaf6:scripts/check-schema-drift.mjs`, run from a temporary file I then deleted) passed: "8 surfaces checked", no drift.
  - The HEAD script exited 1 and named `create-panels-batch-request.schema.json properties.panels.items.properties.type.enum`.
- **M2.** I deleted the batch-create entry from `panelTypeSurfaces`. The script exited 1, and the coverage check named the uncovered enum. So the hand-kept list can no longer silently lose a surface.
- **M3: HEL-1149 AC2.** I added a `case "widget" => Right(Form)` arm to `PanelType.fromString` in `model.scala`. The script exited 1 with `missing: widget` on all 5 surfaces, including batch-create.
- **M4: coverage is derived by scanning, not from a list.** I added a new file, `schemas/zzskeptic/probe.schema.json`, with a nested `["markdown","divider"]` enum. The script exited 1; the only error was the coverage error naming `zzskeptic/probe.schema.json#$defs.X.properties.k.enum`.
- **AC3 (exemptions):** an exemption must be an explicit entry in `PANEL_KIND_ENUM_EXEMPTIONS` with a stated reason. Selftest cases fail an exemption with no reason, a stale one, and one that is also a checked surface.
- **Threshold claim.** I scanned `schemas/**` myself. Enums with 5–6 panel kinds appear exactly 5 times; every other enum holds at most 1 panel kind (9 enums with 1, 76 with 0). The `PANEL_KIND_ENUM_MIN_HITS = 2` comment is true.
- **HEL-1149 can be closed by reference:**
  - AC1: the batch-create enum is checked (M1).
  - AC2: demonstrated by mutation, failing before the fix and caught after (M1, M3).
  - AC3: exemptions must be explicit and carry a reason.
  - AC4: coverage is derived by walking `schemas/` (M4).

**AC5:** `files-modified.md` contains P1–P22, each with the command and its real output. My own spot checks above agree with them.

**Commit messages:** neither commit (`401a9d1e9`, `2d2106557`) contains a claude.ai URL or a `Claude-Session` trailer; the grep count is 0. Both carry only a `Co-Authored-By: Claude Haiku 5.5` trailer.

**Tasks:** `tasks.md` has 26 of 26 tasks checked. Evaluator cycle 1's only change request is resolved.

**Gate integrity:** no report I relied on rests on mtime ordering. No gate defect found.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineStepConfigCodec.scala:45-49` (outside this ticket's scope) still says that adding a config class without an arm "is a compile error". A match on `Any` has no exhaustiveness check, so this is the same family of overclaim, and the new `PipelineStep.scala` header now correctly says the opposite. Fold it into the follow-ups already listed in `design.md` (`PipelineStepSecondSourceGuardSpec.scala:17` "single source of truth", `PipelineStepSpec` "sealed-trait exhaustiveness").
- `findPanelKindEnums` detects only `enum` arrays. A panel-kind set written as `oneOf: [{const: ...}]` would not be detected. No schema does this today.
- The PR body should carry (or link) the P1–P22 output so that AC5's "in the evidence / PR body" holds after the change dir is archived.
