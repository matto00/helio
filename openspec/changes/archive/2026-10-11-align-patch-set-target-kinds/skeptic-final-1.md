## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `6ee72c5bc6ce6585c2cba2a5f5f934dc0f9602cd`. Review base resolved live: `c587643384d9ccb3b117dcbb5b9d4c2ca082fc70` (origin/main via `resolve-review-base.sh`, exit 0).
The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/patch-set-target-kind-drift/HEL-1459`.

### What I verified (with evidence)

**AC1. The frontend type matches `patch-set.schema.json` (drops `dataType`, adds `output`, adds `parentId?`).** Met.
- `frontend/src/features/patchSets/types/patchSet.ts`: `PATCH_SET_TARGET_KINDS` holds the six kinds `as const`, `EditTarget.kind: PatchSetTargetKind`, and `parentId?: string` is present. `dataType` is gone.
- I ran this mutation in a scratch worktree: put `"dataType"` back into the const. `tsc --noEmit` then fails with `patchSetTargetKinds.guard.test.ts(39,1): error TS2578: Unused '@ts-expect-error' directive.` (exit 2). The compile-time pin is real, and `frontend/tsconfig.json` includes `src`, so CI's `npm run typecheck` checks it.

**AC2. The tool description lists `output`.** Met.
- The description is now built from `PatchSetTargetKinds.AllSlashed`, so it renders `panel/dashboard/dataSource/pipeline/pipelineStep/output`.
- Mutation in the scratch worktree: I restored the old hand-written literal `(panel/dashboard/dataSource/pipeline/pipelineStep)`. The guard went red: `propose_patch_set description does not name 'output'` (PatchSetTargetKindsSchemaGuardSpec.scala:93).

**AC3. A drift test fails CI when a schema enum changes and the frontend union or tool description does not.** Met. I tested the ticket's exact scenario myself.
- Mutation M1, schema only: I added `"widget"` to both schema `kind` enums. Results:
  - frontend guard: 2 failed / 1 passed
  - helio-mcp guard: 2 failed / 2 passed
  - `check-schema-drift.mjs`: exit 1 (`in JSON Schema, missing from AssistantProposalToolSchemas.scala: widget`)
  - backend guard: red, `patch-set.schema.json ... diverges from PatchSetTargetKinds.All` (compile came from cache; the test ran)
- Mutation, preview schema reverted to the pre-fix enum (no `output`): the backend guard and `PatchSetPreviewResponseSchemaSpec` both went red. The spec's message was `$.edits[0].kind: does not have a value in the enumeration [panel, dashboard, dataSource, pipeline, pipelineStep]`. So the preview-schema spec is a real red-then-green, not a vacuous pass.
- CI wiring:
  - The backend guards run in `testFull`. `TestShards` assigns suites automatically and has no allow-list.
  - The helio-mcp guard is picked up by root `jest` (`npm test` = `jest && npm --prefix frontend test`). The `testMatch` pattern covers `helio-mcp/src/**`.
  - The frontend guard is picked up by frontend jest.
- The evidence files under `.concertino/runs/HEL-1459/evidence/` match this. I read mutation1–4, frontend-mutation1/2, mcp-mutation1/2 and the RED-prechange transcripts. Each shows a real `*** FAILED ***` / `✕` on the asserted surface. I did not rely on them: I reproduced the key reds independently, as described above.

**Premise-validation additions.**
- The preview-response enum gained `output`. The stale "P1.4's job to add" text is fixed.
- The refinement skeleton now uses `PatchSetTargetKinds.AllPiped`. Mutation evidence 3 shows it red. The guard reads `RefinementEditShape.Skeleton` at runtime.
- helio-mcp now derives `z.enum` and `EditTarget.kind` from one const. An extra guard test checks that `editTargetSchema` uses that const.

**`scripts/check-schema-drift.mjs` (design D7): not weakened.**
- Before this change, the script compared the literal `enumSchema(...)` arguments with the schema's EditTarget enum. Now, when the arguments reference `PatchSetTargetKinds.All`, it compares that list's literal values instead. The tool schema is built from exactly that list, so the comparison is equivalent.
- Reds I reproduced:
  - Drop `output` from `All` only: exit 1.
  - Reformat `All` across several lines: still parsed, still red (exit 1).
  - Change the declaration shape (`Vector[String]` → `Seq[String]`): throws `PatchSetTargetKinds.scala: no 'val All: Vector[String] = Vector(...)' found` (exit 1). It fails loudly rather than skipping silently.
- On HEAD: `node scripts/check-schema-drift.mjs` exits 0 (14 assistant surfaces checked). `check-schema-drift.selftest.mjs` passes all cases (exit 0).

**Gates I re-ran on HEAD in the reviewed worktree.**

| Check | Result |
|---|---|
| sbt `testOnly` PatchSetTargetKindsSchemaGuardSpec | 7/7 |
| PatchSetPreviewResponseSchemaSpec + RefinementEditShapeSpec | 35/35 including the guard |
| AssistantProposalToolSchemasSpec, PatchSetProtocolSpec, AssistantSystemPromptSpec, AggregateFnDocDriftSpec, AssistantToolExecutorSpec | 98/98, ScalaTest summary failed=0 aborted=0 |
| frontend jest `src/features/patchSets` | 54/54 |
| root `npm run typecheck` | exit 0 |
| root jest `helio-mcp/src/tools` | 270/270 |
| helio-mcp typecheck | exit 0 |
| prettier `--check` on changed files | clean |
| eslint `--max-warnings 0` on `src/features/patchSets` | exit 0 |

**Constraints.**
- C2: no `PatchSetPreviewProjection*` file is in the diff.
- C3: there are no apply/preview code changes. `output` create stays rejected, and that path is untouched.
- C4: the skeleton change is limited to the kind list; no `parentId` line was added.

**UI.** This change has no runtime UI. `PatchSetReview.test.tsx` only changes fixtures (`dataType` → `output`, cosmetic), and `EditPreview.kind` stays `string`. No visual review applies.

**Scratch-worktree hygiene.** The scratch worktree at `.../scratchpad/hel1459-skeptic` was removed by its exact path with `git worktree remove`. The node_modules that its symlinks pointed to are intact. No sbt server was left running.

### Verdict: CONFIRM

### Non-blocking notes
- `check-schema-drift.mjs` has a misleading message when `PatchSetTargetKinds.All` is the side that drifted. It reports "missing from AssistantProposalToolSchemas.scala" when the file to edit is `PatchSetTargetKinds.scala`. A one-line hint would help.
- `check-schema-drift.mjs` matches `args.includes("PatchSetTargetKinds.All")` as a substring. A future `enumSchema(PatchSetTargetKinds.All.filterNot(...): _*)` would make the script compare against the unfiltered list. This is not a regression in protection: the backend guard's runtime check (tool input-schema enum == `AllSet`) would still catch it.
- `PatchSetPreviewResponseSchemaSpec` lives in the `domain.patchsets` test package but exercises `api.protocols.patchsets`. Placement is cosmetic.
- Possible product decision for the owner (named here, not decided): whether the refinement prompt should offer `parentId` and `pipelineStep` create. The design defers this (C4). That is correct, but it needs a filed follow-up ticket so it is not lost. Adding `output` to the model-visible kind lists does change model behavior, but the AC requires it; it is not hidden.
- Evaluation-2 carry-over: `check-scala-quality.mjs` does not scan `s"${...}"` interpolation bodies for inline FQNs. This is a follow-up candidate, unrelated to this diff's correctness.
