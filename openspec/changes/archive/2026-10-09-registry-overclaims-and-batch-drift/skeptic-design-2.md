## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `c91fffaf6ac92cfb0b21c69b0c96d97c4c851d9e`. The worktree HEAD has only the untracked change dir on top.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/correct-registry-overclaims-drift/HEL-1412`.

### What I verified (with evidence)

**Round-1 change requests**
- CR1/CR2: E5 now has a gate inventory, and P22 backs it. I checked each named spec on the live tree:
  - `PipelineStepSpec.scala:54-55`: `PipelineStepKind.All shouldBe Set("rename", ...)`. This is a literal list, which matches the comment.
  - `PipelineStepRepositorySpec.scala:102-111`: raw-INSERTs every kind in `PipelineStepKind.All` through SQL, so the DB CHECK constraint applies. It then decodes them via `listByPipeline` → `rowToDomain` (`PipelineStepRepository.scala:1320-1358`), a hand match over `Success(cfg: XConfig)` with an `IllegalStateException` fallthrough, and asserts that the set equals All. "so the CHECK constraint and row mapping" is accurate.
  - `PipelineAnalyzeServiceSpec.scala:1534`: "every kind in PipelineStep.Registry has an inferOutputSchema branch". The exemptions map is `Map.empty`, and another test asserts it stays empty, so "a branch per kind" is accurate.
  - `PipelineCostEstimatorSpec.scala:143`, `PipelineStepCatalogServiceSpec.scala:17` and `PipelineStepSecondSourceGuardSpec.scala:40` are each Registry-driven. They are named without a parenthetical, so they make no claim to check.
  - `stepNarrowing.test.ts:694`: "STEP_ICONS has an entry for every authorable backend-registered kind". It regex-parses PipelineStep.scala's Registry block and excludes the backend-declared unauthorable kinds. That matches "a `STEP_ICONS` entry per authorable kind".
- E5 re-derive command, run as written: it lists 18 files, including all 7 named ones, `stepNarrowing.test.ts`, and **no** helio-mcp file.
- "A site none of them exercises (e.g. the helio-mcp tool descriptions) is checked by nothing": **true**.
  - `git grep -l -i datebucket -- helio-mcp scripts .github .husky package.json` returns only `helio-mcp/src/tools/read.ts` and `write.ts`, and neither is a test.
  - `git grep -l -i 'fillnull\|unpivot\|stringops\|PipelineStep\.scala\|domain/steps'` over the helio-mcp tests, the frontend tests and `scripts` hits no helio-mcp test and no script.
  - `git grep 'Step\.scala\|domain/steps\|Registry'` over the helio-mcp tests returns nothing.
- CR3: E1 now reads "caught, if at all, by a registry-driven test or at runtime". That is accurate, and the trait is not sealed (round-1 P13).
- CR4: E7 no longer names `PatchSetApplyResolvers`. My P17 run matches the corrected claim:
  - `PanelServiceHelpers` has 8 arms covering all 6 distinct `*Create` names (Form and Output appear twice).
  - `DashboardSnapshotRepository` has exactly 6 arms, one per kind.
  - `PatchSetApplyResolvers` has 2 arms, both FormCreate, and E7 correctly leaves it out.
  - `PanelRowMapper.scala:36-48`: `row.kind match` has 5 arms plus `case _ => OutputPanel`, which is consistent with "maps `panels.kind` to a subtype itself".
- E7 other claims:
  - P15: each of the 3 defs has 6 kind arms (`PanelConfigCodec.scala:23-29, 51-56, 80-85`).
  - P16: the callers include panel create (`PanelServiceHelpers:111`) and snapshot import (`DashboardSnapshotImport:69`).
  - `PanelKind.All` re-derive command is present (`Panel.scala:140`).
  - E8: the renamed title matches what the test asserts (`PanelSpec.scala:60-67`, a `keySet shouldBe` over 6 kinds).

**Mechanical safety of the Scala comment text.** I extracted E1–E7 OLD/NEW verbatim from design.md and applied them to a scratch copy with a script:
- Each OLD occurs exactly once.
- No NEW block contains `/*` (Scala nested-comment opener) or an early `*/`. The only `*` adjacent to a slash is the original `/ \`*Config.Patch\`` text, with a space in between.
- The literal `\|` in E5's git-grep sits inside a `/** */` scaladoc. Scala neither interprets nor compiles it, and no `-Xlint`/fatal-warnings flag is set: `grep -i 'xlint|werror|fatal-warnings|scalacOptions'` over `backend/build.sbt` and `backend/project` finds nothing.
- No NEW text contains `val Registry`. The edited PipelineStep.scala has exactly 1 `val Registry`. Applying `stepNarrowing.test.ts`'s own regex to the edited file still captures 27 `XxxStep.Kind ->` entries, which matches the test's `toBe(27)`.
- In a diff of HEAD vs the edited PipelineStep.scala, every changed line is a scaladoc line (filtering out `*`/`/**` lines leaves nothing, exit 1), so C1 holds for E1–E5.
- E6: `PipelineStep` is already imported in PipelineService.scala (line 14). The design's parenthetical "no import is added" is moot but harmless.

**Item 4 re-run** (only E10b's pre-wrap changed since round 1). On a scratch `git archive HEAD` I applied E9/E10a–d/E11a–b verbatim:
- `check-schema-drift.mjs` exits 0 and prints `(9 surfaces checked)` and `panel-kind enum coverage: 5 schema enums detected, each checked or exempted`.
- The selftest passes all cases, including the 5 new ones.
- R2 (drop `"form"` from the batch-create enum) exits 1 with `schemas/panels/create-panels-batch-request.schema.json properties.panels.items.properties.type.enum:` / `missing: form`.
- The scratch copy was deleted afterwards.

**Other layer claims (E5).** I re-ran P6: every named file is present except `StepConfigValidation`, which P6 does not expect (P7 covers it instead). P7 shows 8 `XStep.Kind =>` arms in `StepConfigValidation.scala:64-71`, so it really is a hand-enumerated site.

**Plan pinning for a Haiku executor.**
- tasks.md pins every command, its expected output, the STOP-on-mismatch rule (C2), and the commit message.
- Every edit is verbatim with unique anchors.
- No placeholders, contradictions or scope drift: AC1–AC5 map to E1–E6, E8, E7 and E9–E11/R1–R4, and the P-table/4.x tasks respectively.

### Verdict: CONFIRM

### Non-blocking notes
- E5's re-derive command (`git grep -l -i datebucket ...`) does not surface `StepConfigValidation`, because datebucket has no validation arm. The comment already says the command "is not a completeness check", so this is not false. A reader may still miss that partial-match sites (validation, cost classes) need not mention every op.
- E5 names 7 of the 18 files its own test re-derive command prints. The others include `PipelineStepConfigCodecSpec` (decode({}) for every kind) and `PipelineStepRequiredConfigSpec` (a literal 27-kind registry pin). "Registry-driven tests catch some missed sites" plus "Re-derive that list" makes this acceptable, and the helio-mcp no-gate claim holds under either reading of "them".
- E7 labels `encodeConfig` as "(responses)", but it is also used for rollback snapshots (`PatchSetApplyRollback.scala:272,298`). The label is phrased as illustrative, so this is minor.
