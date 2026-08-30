## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `0f05ec79` (HEL-891). Backend-only Scala change.

### Phase 1: Spec Review — PASS

All eight ticket acceptance criteria are addressed explicitly:

- Key union across all rows — `SchemaInferenceEngine.inferShallowFromJsObjects` (`SchemaInferenceEngine.scala:134-164`), call site `PipelineRunService.scala:751`.
- Bindability of any-row columns — pinned by tests 1.2/1.3 asserting on persisted `fields` *and* `PanelCapabilityService.getCapabilities`.
- Widening + order independence — tests 1.5, 1.6 (a second reversed-order keyed URL, not a re-sort of one result).
- Canonical wire values only — `DataFieldType.asString` at the projection; `inferFieldType` deleted.
- Nullability pinned `true` with a comment naming HEL-868 (`PipelineRunService.scala:764-769`).
- Red-first heterogeneous fixture — recorded in `evidence/red-before-change.log`.
- Compat assessment — design D5's three-transition consumer table.
- Derived-schema-path enumeration — recorded in ticket.md.

Design decisions verified individually:

- **D8 (most load-bearing)** — `case JsNull` is the FIRST branch of the value match (`SchemaInferenceEngine.scala:139`) and does `m.updated(key, prior)`, leaving the accumulator untouched. `inferJsonType` is never reached for a null. Correct.
- **D2** — `JsonFlattener.leaves` is not called; only `obj.fields` (top level) is folded. Test 1.8 asserts a single `content` field typed `string`, no `content.storageKey`, and that the persisted row key set contains `content`.
- **D3** — `nullable = true` literal at the projection; engine's `nullable` discarded (engine returns `nullable = false` unconditionally and says so in its doc comment).
- **D7** — `displayName = f.name` (raw), engine's title-cased `displayName` discarded.
- **D6 totality** — output is `accByKey.toSeq.sortBy(_._1).map { ... dataTypeOpt.getOrElse(StringType) }`. No `.get`, no `filter`/`collect`, no `flatMap`. A JsNull-only key is registered in the accumulator as `None` and still emitted.
- **D4** — `inferFieldType` deleted; `grep -rn inferFieldType backend/src helio-mcp/src frontend/src` yields only two prose comment references, zero call sites.
- **D1** — `onUnblockedRunSuccess` passes `jsRows`, the same value handed to `overwriteRows`.

Tasks 1.1–3.6 all checked and all match what was implemented. Spec delta covers union, order independence, widening, D8 (both branches), canonical types, and nullability. No scope creep: `PipelineAnalyzeService` (HEL-895), `WorkspaceContextService` (HEL-896) and `UnionStep` (HEL-894) are untouched; no `scripts/concertino/**` or `.claude/**` render changes are in the diff. The only collateral edit is a doc comment in `AlertEvaluationService.scala:34-36` that named the deleted method — required, and it does not change behaviour.

### Phase 2: Code Review — PASS

**Gates, run fresh by me in `WORKTREE_PATH`:**

- `cd backend && sbt test` → `Total number of tests run: 3785 / Suites: 242 / failed 0 / All tests passed` (259 s). This is the gate that counts; per HEL-880 the root jest gate is vacuous in a delivery worktree and was not treated as evidence.
- `node scripts/check-scala-quality.mjs` → `clean (142 soft warning(s))`, exit 0. All warnings are pre-existing file-size soft budgets.
- No frontend files changed, so the frontend gates do not apply.
- Working tree clean; no uncommitted residue.

**Red/green evidence audit (the critical part).**

`evidence/red-before-change.log` shows 42 succeeded / 7 failed against unmodified production code, matching tasks 1.12's prediction exactly. I verified the log corresponds to the tests actually committed: every failure's file:line maps to the committed assertion —
1015 `contain("rec")` (1.2), 1021 caps `contain("rec")` (1.3), 1028 `frac_col == "float"` (1.4), 1036 `rec_yd == "float"` (1.5), 1046 order-independence (1.6), 1063 `mixed_col == "string"` (1.9), 1079 `date_col == "timestamp"` (1.11). Each failure message names the exact pre-change value the defect predicts (`Some("double")`, `Some("integer")`, `Some("string")`, `did not contain "rec"`) — each red is attributed to its own defect, none to a fixture/wiring/compilation error. No test in the green set came up red, and none was weakened.

**Green-set guards proven capable of failing (mutation probes).** Attestation is not evidence, so I re-verified by measurement in a throwaway detached worktree at `0f05ec79`, mutating one decision at a time and re-running `testOnly PipelineRunServiceSpec`:

| Mutation | Expected red | Observed |
| -- | -- | -- |
| D8: `case JsNull if false` in the shallow fold (null joins the lattice) | 1.11a | 1.11a FAILED, 48/49 pass — exactly one, precisely targeted |
| D3: `nullable = f.nullable` | 1.7 | 1.7 FAILED |
| D7: `displayName = f.displayName` | 1.10 | 1.10 FAILED |
| D6: `.collect { case (key, Some(dt)) => ... }` (drop all-null key) | 1.11b | 1.11b FAILED |

All four green-set guards are live, not vacuous. 1.8 (D2, no flattening) was not mutation-probed, but its assertions are structurally incapable of passing under flattening (it requires a field literally named `content` and rejects `content.storageKey`, and cross-checks the persisted row key). Note the first probe attempt mutated the wrong `case JsNull` (the pre-existing one in `inferFromObjects` at :103) and produced a false green — the corrected probe above is the one that counts.

**`PipelineRunRoutesSpec` change: correction, not weakening.** The test previously asserted `fieldMap("rate") shouldBe "double"`, encoding the exact D4 defect (`"double"` is not one of the seven canonical `DataFieldType` values, so `PanelCapabilityService.wireType`'s `fromString` drops the column). It now asserts `shouldBe "float"` — same strength (exact equality on a single specific value), name and comment updated to say why. Nothing was relaxed to a `should not be empty`, a `contain`, or a removal.

**Code quality.** Reuse is correct and explicit: the widening lattice and `InferredField` are shared, the flattening and nullability policies deliberately are not, and each exception carries a comment naming its design decision and (for D3) the follow-up ticket that should delete the pin. No dead code, no TODO/FIXME, no `asInstanceOf`, no `null` introduced, no untyped escape hatch. The fold is total and order-independent. Comments are dense but each states a non-obvious *why* — consistent with HEL-849's standard. Assertions in the new tests are on persisted repository state and on `PanelCapabilityService` output, never on a helper's return value, as the ticket requires. No security surface is touched (background post-run sync, privileged path unchanged).

### Phase 3: UI Review — N/A

Stated explicitly rather than skipped: this change touches only `backend/src/main/scala/**` and `backend/src/test/scala/**`. None of the Phase-3 triggers match — no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` (the spec delta lives under `openspec/changes/`, not `openspec/specs/`). There is no UI surface to exercise, so no dev server was started and no browser check was run.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `PipelineRunServiceSpec.scala` is now 1124 lines (soft budget 250, informational only). Pre-existing and growing; a future split by concern would help, but is out of scope here.
- `seedDsImage` uses inline `java.io.File` / `java.awt.image.BufferedImage` / `javax.imageio.ImageIO` FQNs. This is a verbatim mirror of the existing `PipelineRunRoutesSpec.seedDsImage:154-159` and the mechanical `check:scala-quality` rule does not cover those packages, so it is consistent with precedent rather than a violation — worth top-of-file imports if that helper is ever touched again.
- Worth carrying design D5's two user-visible notes into the PR body as planned: stored schemas only self-correct on the next run, and a pending patch-set undo of a `dataType` edit may 409 once after that run.
