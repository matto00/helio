## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 6ee72c5bc6ce6585c2cba2a5f5f934dc0f9602cd (on top of 86732687e). The base, c587643384d9ccb3b117dcbb5b9d4c2ca082fc70, was resolved live by resolve-review-base.sh.

This cycle's delta, from `git diff 86732687e..HEAD --name-only`:
- `PatchSetProtocol.scala`
- `PatchSetTargetKindsSchemaGuardSpec.scala`
- `design.md`, `tasks.md` and `files-modified.md`
- `evaluation-1.md`, now committed into the change dir

There are no frontend, helio-mcp, schema or script changes this cycle.

### Phase 1: Spec Review — PASS
Issues: none.
- Cycle 1 already verified the ACs, and they are unaffected by this delta.
- Claim "D7 note added": verified. design.md now records why `scripts/check-schema-drift.mjs` changed and that the script throws if the declaration shape stops matching. This addresses cycle-1 suggestion 1.
- Claim "tasks 1.5/1.6 ticked": verified. Both are present and `[x]`, and both match the diff.
- `openspec validate align-patch-set-target-kinds` reports the change as valid.
- Constraints:
  - C2: no `PatchSetPreviewProjection*` file is touched.
  - C3: the decoder's accepted set is unchanged. Only the wording of the error message changed.
  - C4: the prompt skeleton is untouched this cycle.
  - C1: no new tests were added this cycle; CR1 and CR2 are refactors covered by the existing guard/decoder tests.

### Phase 2: Code Review — PASS
Change-request verification:
- CR1 (inline FQN): FIXED.
  - `PatchSetTargetKindsSchemaGuardSpec.scala` now has `import java.util.regex.Pattern` at the top, and line 57 uses `Pattern.quote(word)`.
  - A grep of the three new Scala files for inline `java.*` / `scala.io.*` qualifiers outside import lines found nothing.
- CR2 (dead `AllList`): FIXED. `PatchSetProtocol.scala:157` now reads `s"edit target.kind must be one of ${PatchSetTargetKinds.AllList}, got '${target.kind}'"`, which gives a deterministic, schema-ordered message.
  - No backend spec asserts on the old message text: grep for "must be one of" plus kind under `backend/src/test` found no hits.
  - `PatchSetProtocolSpec` and the guard's "reject the removed dataType kind" test pass.

Gates I ran myself in WORKTREE_PATH at 6ee72c5bc:
- `npm run lint`: exit 0.
- `npm run format:check`: all files pass, which covers the edited markdown.
- `node scripts/check-scala-quality.mjs`: exit 0.
- `node scripts/check-schema-drift.mjs`: in sync, 14 surfaces checked.
- `node scripts/check-schema-drift.selftest.mjs`: all cases passed.
- Backend: the same targeted `sbt -batch -J-Xmx3g testOnly` set as cycle 1, run with MemAvailable at about 53 GB and `nice -n 19`. Result: 37 suites, 368 tests, 0 failed. The set includes:
  - `PatchSetPreviewRoutesSpec`
  - `PatchSetProtocolSpec`
  - `PatchSetTargetKindsSchemaGuardSpec`
  - `PatchSetPreviewResponseSchemaSpec`
  - `AssistantSystemPromptSpec`
  - `RefinementEditShapeSpec`
  - `AssistantProposalToolSchemasSpec`

  No sbt server was left running: there is no `backend/project/target/active.json`.
- Not re-run: frontend jest, the frontend build and helio-mcp. No file under `frontend/`, `helio-mcp/` or `schemas/` changed since 86732687e, where all of them passed in cycle 1.

Issues: none blocking.

### Phase 3: UI Review — N/A
The same reasoning as cycle 1 applies (no runtime UI change). This cycle touches no `frontend/**`, `schemas/**` or route files at all.

### Overall: PASS

### Non-blocking Suggestions
- In `tasks.md`, the new items 1.5 and 1.6 were appended under "## 4. Verification" instead of section 1. Consider moving them under "## 1. Backend single source and consumers" for readability. Cosmetic.
- This is a carry-over from cycle 1 and a follow-up candidate for a separate ticket. `scripts/check-scala-quality.mjs` blanks `s"${...}"` interpolation bodies along with the rest of the string, so an inline FQN placed there is never flagged.
