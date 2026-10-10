## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `401a9d1e9adae222513c312cb5e68f8be3164c43`, against base `c91fffaf6ac92cfb0b21c69b0c96d97c4c851d9e`. The base was resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — FAIL

- AC1 (PipelineStep.scala and the PipelineService header): PASS. E1–E6 are applied verbatim. On the new tree, no "only requires updating", "single source of truth —", "11th kind", "13th step kind" or "round-trip through the" text remains.
- AC2 (PanelSpec rename): PASS. The renamed test `have exactly the 6 panel kinds as its key set` runs and passes in sbt.
- AC3 (PanelConfigCodec header): PASS. E7 is applied, the "single source of truth" text is gone, and the header now correctly says six kinds where it used to say seven.
- AC4 and HEL-1149 AC1–AC4: PASS. I fetched HEL-1149 and checked each AC:
  - AC1: the batch-create enum is now a checked surface (9 surfaces, up from 8).
  - AC2: the red-before-fix evidence (R1/R1b) is in files-modified.md. I confirmed the base script has 0 references to `create-panels-batch`. After the fix, R2 fails as it should (see Phase 2).
  - AC3: an exclusion requires an explicit, reasoned exemption in `PANEL_KIND_ENUM_EXEMPTIONS`.
  - AC4: coverage is derived by scanning `schemas/`, and five selftest cases prove the coverage check can fail.
  - HEL-1149 can be closed by reference.
- AC5: PASS. I re-ran P1–P22 myself and they all match. Details:
  - P1: no `AllowedOps` remains in main code.
  - P2: the `All.contains` checks are in PipelineService (lines 548/1626/1859) and PipelineProposalService:286.
  - P3: `V31` and `PipelineStepRoutesSpec` prove the old `AllowedOps` set existed.
  - P4: `decode` and `encode` call `companionFor`, and `parseKind` uses `All`.
  - P5: 27 `case c:` arms in the codec, 54 each in the protocol files.
  - P6: every file named in E5 is in the re-derive output, including TimeSeriesShape and ColumnClassifier.
  - P7–P14: all match. P10 shows the constraint was last redefined in V107; P13 shows the trait is not sealed and the build uses Scala 2.13.15.
  - P15–P17: all six kinds appear in each of the 3 codec methods. PanelServiceHelpers (lines 139–144) and DashboardSnapshotRepository (lines 179–184) each match all six `*Create` results, and PanelRowMapper matches on kind.
  - P19: the `PanelKind.All` re-derive command exists in Panel.scala.
  - P22: the test inventory matches, it contains no helio-mcp file, and the three specific greps hit.
  - P21: no output.
- Scope: no scope creep. Every changed path is in the plan.
- CONSTRAINTS:
  - C1: honored. The main-code diff filtered to non-comment lines is empty, and PanelSpec changes by exactly one string line.
  - C3: honored (verbatim).
  - C4: honored. The tree is clean and no mutant is left behind.
- **Issue:** `tasks.md` has **0 of 26** task checkboxes ticked (`- [ ]` × 26, `- [x]` × 0), but the work is done. Every recently archived change has every task ticked (for example `2026-10-09-wire-ts-eslint-recommended`: 15/0). This fails the checklist item "All task items marked done".

### Phase 2: Code Review — PASS

Gates, which I re-ran myself in WORKTREE_PATH:
- `node scripts/check-schema-drift.mjs`: exit 0. Output: "9 surfaces checked" and "panel-kind enum coverage: 5 schema enums detected, each checked or exempted".
- `npm run check:schemas:selftest`: all 15 cases ok, including the 5 new ones; exit 0.
- `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.PanelSpec com.helio.domain.model.PipelineStepSpec"`: 44 succeeded, 0 failed; exit 0.
- `npx prettier --check` and `npx eslint` on the 3 script files: both clean.
- `openspec validate registry-overclaims-and-batch-drift --type change`: valid.

Mutations I ran myself (each restored by exact path; `git status --short` was empty afterwards):
- R2 (drop `"form"` from the batch-create enum): exit 1. Output: `schemas/panels/create-panels-batch-request.schema.json properties.panels.items.properties.type.enum: missing: form`.
- R4 (`schemas/panels/hel1412-mutant.json` = `{"enum": ["text", "output"]}`): exit 1. Output: `panel-kind enum coverage: schemas/panels/hel1412-mutant.json#enum holds a panel-kind enum but is neither a checked surface ... nor exempted ...`. I then deleted that exact file.
- R5 (my own mutation, not in the plan: delete the batch-create `schemaEnumSurface(...)` entry from `panelTypeSurfaces`): exit 1, and the coverage check names `create-panels-batch-request.schema.json#properties.panels.items.properties.type.enum`. This proves that if the surface is ever removed from the hand list again, the derived coverage check fails rather than letting it go unnoticed. Restored with `git checkout -- scripts/check-schema-drift.mjs`.

Code quality:
- The helpers are small, pure and DRY (`schemaEnumSurface` replaced four near-identical literals).
- The new script code has no dead code and no magic values (the threshold is a named and dated constant).
- The Scala changes are comment and test-name only, so they change no behavior.

Commit message: it has no claude.ai session URL and no `Claude-Session` trailer. The only trailer is `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`, which matches the configured executor model.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed. The change touches comments, a test name and scripts only.

### Overall: FAIL

### Change Requests
1. `openspec/changes/registry-overclaims-and-batch-drift/tasks.md`: tick every completed task (`- [ ]` → `- [x]` for 1.1–6.3; all were done, and their evidence is in files-modified.md). Commit the edit. No other change is needed: every other check in all three phases passes.

### Non-blocking Suggestions
- `readdirSync(..., { recursive: true })` returns relative paths with the platform's separator. On Windows, the enum keys would then use `\` and never match the `/`-joined `schemaFile` values. This is harmless on the Linux/CI hosts used today.
- The follow-ups listed in design.md (`PipelineStepSpec`'s "sealed-trait exhaustiveness" comment, the stale `upsertsource` note in `PipelineStepConfigCodec.scala:75`, the steps README count, the `PipelineShape.scala:39` and `PipelineStepSecondSourceGuardSpec.scala:17` claims) should be filed as tickets during delivery, as the plan says.
