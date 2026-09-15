## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `6d016214` against base `04d8b59090d695c33b2b5e4c522af9433c62795d` (parent
commit, resolved via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS

- AC1 (round trip / lossless): D4/D5 round-trip contracts implemented and tested (see Phase 3
  evidence below); independently confirmed via two extra hand-constructed adversarial cases not
  in the named test list (mixed structural+escape string, 4-backslash line, non-ASCII/emoji) —
  all round-tripped correctly against the running code.
- AC2 (named failure reasons + mutation-proven): confirmed via two independent re-applied
  mutations (below, Phase 2) — both proven red, then restored byte-identical.
- AC3 (full op wiring, persisted row loads, analyze 200): confirmed via fresh `sbt test` run and
  a targeted re-run of `PipelineAnalyzeConvertFormatSpec`, which persists a real `convertformat`
  step and calls `PipelineService.analyze` end-to-end — 200, no `Unknown op`, no throw. Also
  confirmed live via the running dev server (Phase 3).
- AC4 (deliberate HEL-1092 cost classification, `AiOps` untouched): `git diff` on
  `PipelineCostEstimator.scala` shows `AiOps = Set("analyzewithai", "generatetext")` byte-for-byte
  unchanged from base; only its doc comment changed (`HEL-1105/1106` → `HEL-1106/1107`, matching
  ticket AC6). New `ContentConversionOps`/`content-conversion` code added, checked after
  AI/write-back and before `CheapOps`, matching design.md D7.
- AC5 (test stand-ins updated, not deleted; different fake op for the unregistered-op probe):
  `PipelineCostEstimatorSpec`'s partition probe uses `"notarealop"` (not `convertformat`);
  `PipelineCreateTransactionalSpec`'s rejection loop is now `Seq("analyzewithai", "generatetext")`
  plus a new "accept a convertformat step" case. Both specs still exist and pass.
  `PipelineCostEstimatorSpec` widened to a four-set partition test as design.md D8 describes.
- AC6 (design spec §6 correction): confirmed — `convertformat` no longer grouped with the two
  `ClaudeClient` steps; states it is deterministic/local; the AI-set comment corrected.
- AC7 (openspec capability spec): `openspec/changes/convertformat-pipeline-step/specs/
  pipeline-convertformat-op/spec.md` added with requirements/scenarios covering config validation,
  1:1 row shape, CSV/JSON round trip, text/Markdown round trip, named failure reasons, and analyze
  inference — matches the implemented behavior.
- AC8 (no migration, no StepCard editor): confirmed — zero files under
  `backend/src/main/resources/db/migration` and zero files under `frontend/` in the diff. V107
  already admits the op (pre-existing).
- CONSTRAINTS C1–C6 (workflow-state.md / tasks.md standing constraints): all honored — no
  `ClaudeClient`/AI hook added (grepped the full diff, zero hits outside comments/prose); supported
  pairs are exactly the four named; `AiOps` set contents unchanged; stand-in tests updated not
  deleted with a distinct fake op; no migration/StepCard; C6 independently re-verified below.
- No scope creep found: diff is limited to `convertformat` wiring, its own tests, the doc
  correction, and the openspec change artifacts. `PipelineStepRequiredConfigSpec`'s registry-size
  guard bump (24→25) is an expected mechanical trip of a drift guard, not scope creep.
- Planning artifacts (design.md, tasks.md) match the implemented behavior; tasks.md is fully
  checked off and consistent with what's in the diff.

### Phase 2: Code Review — PASS

**Gates re-run fresh, in `WORKTREE_PATH`** (no `CLEAN_WORKTREE`):
- `sbt test` (full suite): **4436/4436 passed**, 0 failed — matches executor's claim.
- `npm run check:schemas`: schemas in sync (95 protocol surfaces checked, including the new
  `content-conversion` enum entry).
- `npm run check:scala-quality`: clean; only pre-existing soft file-size warnings (none newly
  introduced by this change — verified none of the flagged files are new/modified by this diff).
- Frontend gates not run: zero files under `frontend/` changed in this diff (only `backend/**`,
  `schemas/**`, `openspec/**`, `docs/**` changed), so the frontend-gate trigger does not match.

**C6 — independent mutation re-verification** (two of the eleven recorded mutations, including
the flagged vacuous-pass risk):
1. `csv-malformed` (unterminated quote), `ConvertFormatStep.scala:117`: replaced the
   `if (inQuotes) fail(...)` guard with a no-op. Re-ran
   `sbt "testOnly com.helio.domain.steps.ConvertFormatStepSpec -- -z unterminated"` — confirmed
   RED (`Expected exception ... but no exception was thrown`). Confirmed the test fixture is
   single-column (`"a\n\"unterminated"`, `ConvertFormatStepSpec.scala:222`), so the ragged-row
   check cannot mask this mutation — the vacuous-pass risk the executor flagged is genuinely
   closed. Reverted; `diff` against a pristine pre-mutation copy was empty.
2. `json-inconsistent-keys`, `ConvertFormatStep.scala:152`: removed the key-set equality check.
   Re-ran the targeted test — confirmed RED, downstream `NoSuchElementException` still fails the
   `intercept[IllegalArgumentException]` assertion, exactly as the handoff describes. Reverted;
   `diff` against the pristine copy was empty; `git status --short` in the worktree is clean.

Both mutations independently confirm C6's mutation-testing claim for the arms checked.

**Design/code quality:**
- `SupportedPairs` is the single source shared by the write-path validator, the run-path
  dispatch, and analyze inference (`ConvertFormatStep.scala:41-42`) — no divergence risk.
- DRY: reuses `StepCodecUtil`, mirrors `UpsertSourceConfig`'s custom-format pattern for the
  cross-field default, mirrors `splittext`'s `inferSplitText` shape for `inferConvertFormat`.
- Readable: reason codes are named constants surfaced in exception messages; no magic values.
- Error handling: engine failures use `IllegalArgumentException` messages that survive
  `StepExecutionException.from` verbatim, matching D3; the `"unsupported-pair"` fallback branch in
  `convert` is documented defense-in-depth (write-path already rejects this at create/update time).
- Type safety: `ConvertFormatConfig` is a typed case class; decode is tolerant on read
  (`StepCodecUtil.str(..., "")` defaults), strict on write (`pairError`).
- Tests are meaningful: one test per named reason code, each proven failable (C6); round-trip
  tests cover every design-named adversarial case plus a property-style generator; an
  engine-level test confirms the reason code (not the opaque fallback) surfaces through
  `StepExecutionException`.
- No dead code / no leftover TODOs found in the new files.
- No over-engineering: the implementation is a straight hand-rolled RFC4180 CSV parser and a
  single left-to-right Markdown scanner, matching the scope design.md called for (no new
  dependencies, as design.md's Non-Goals state).

### Phase 3: UI Review — PASS

Triggered because `schemas/pipelines/pipeline-analyze-response.schema.json` is in the diff (no
`frontend/**` files changed).

Started dev servers via `scripts/concertino/start-servers.sh` (ports 6537/9444), confirmed healthy
via `assert-phase.sh servers`.

- Logged in as the seeded dev owner account; created a real `convertformat` step
  (`{field: "sku", from: "text", to: "markdown"}`) on an existing pipeline via the live API (201
  Created), then navigated to that pipeline's edit page in the actual running frontend.
- **Confirmed**: the persisted `convertformat` step renders via the unsupported-op fallback —
  "Unsupported step (convertformat)" card, read-only, no crash, no blank screen. Screenshot
  captured (`page-2026-09-15T19-14-15-050Z.png` in the Playwright output dir).
- Console errors during the flow: one pre-existing, unrelated `404` on
  `GET /api/pipelines/:id/schedule` for this test pipeline (not touched by this diff, not new —
  every pipeline without a configured schedule 404s there; confirmed by inspecting
  `ApiRoutes.scala`/`PipelineScheduleService` is untouched in this diff).
- No AC/task requires a new UI state for this ticket (design.md: "No frontend change: the
  unsupported-op fallback already renders a persisted convertformat step safely") — confirmed
  true against the running app, not just asserted.
- Did not persist a screenshot via `persist-evidence.sh` — the claim it supports (fallback
  renders, no crash) is corroborated by the console-message capture and the AC3
  `PipelineAnalyzeConvertFormatSpec` re-run above, not resting on the screenshot alone.

### Overall: PASS

### Non-blocking Suggestions
- The stray `convertformat` step created on the shared dev DB's "HEL-1081 e2e pipeline" for this
  UI check could not be deleted (no `DELETE /api/pipelines/:id/steps/:id` route exists in this
  codebase — steps are apparently never hard-deleted via API). This is inert test residue
  consistent with the shared dev DB's known 94%-test-residue state (see project memory); not a
  code defect from this diff, just noting it for anyone auditing that DB later.
