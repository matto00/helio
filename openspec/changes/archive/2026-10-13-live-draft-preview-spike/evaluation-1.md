## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `43453b36e80addbe13802fbf6c3f70f0da80a288` (commits c6b95274a, 43453b36e) against the live-resolved base
`5074b69377ea8ce1010739dddcf858448a3a0af5`. The diff touches only `docs/live-draft-preview.md` and
`openspec/changes/live-draft-preview-spike/**`. No product code changed.

### Phase 1: Spec Review — FAIL

Passing checks:

- **AC1 (design answering Q1-Q6, with a recommendation and rejected alternatives each).** Met: sections 3-8, with a
  consolidated list in section 10.
- **AC2 (browser latency number).** Met; details under Evidence below.
- **AC3 (kind list).** Met. The table has 27 rows, and the kind strings match the 27 `Kind` values that
  `PipelineStep.Registry` registers (`PipelineStep.scala:256-284`). I diffed them against the `val Kind = "..."` values
  in the tree. The only extra `Kind` strings in the tree are the six panel kinds, which is expected. The class counts
  are 9 + 12 + 2 + 4 = 27, and they agree with section 1.
- **C2 / section 14 is verbatim.** All six tokens match `events.jsonl` line 18 exactly, including the full free-form
  text of answer A.
- **Ruling A.** Section 6 picks the transport on measured latency and cost only. Section 6 line 253 states that "least
  work" is not an argument, and no size or effort reasoning remains. Section 6.3 argues why WebSocket's ~1.2 ms warm
  edge is not a tie. That argument is acceptable under the ruling.
- **Ruling E.** Section 8 is rewritten around a new declarative atomic endpoint. Patch-sets reuse appears only as the
  overridden alternative (lines 357-360 and 471).
- **Ruling F.** "Preview with AI" appears only in negations or rejected alternatives (lines 327, 474 and 566). It is
  never offered as a feature.
- **C1.** Every self-approved call in section 11 names either a ruling or the reason only one option is viable.
- **Scope.** No scope creep: no files outside `docs/` and the change directory.

Issues:

1. **AC4 (HEL-1581 scope walk): misquoted, missed and mis-mapped ACs.** Section 12 was written from the paraphrase in
   `skeptic-design-1.md`. Compared against the verbatim HEL-1581 text:
   - **AC1** is quoted without "(verified via network log), within the latency budget the spike set". Section 12 never
     states the latency budget the spike set for HEL-1581, even though HEL-1581 depends on it.
   - **AC2** is paraphrased as "Server-evaluated steps go through a transport within the HEL-505 limits". The verbatim
     text is "A server-only step updates through the chosen transport, debounced, with a pending state, and never fires
     more than the HEL-505 limits allow". Section 12 drops "debounced" and "with a pending state", so neither is
     mapped. The debounce exists only in 6.3 and the pending state only implicitly in 7 (the "live" pill). Also, the
     new draft-preview limiter is a `RateLimitDirective` instance, not a HEL-505 limiter. Item 2 should say outright
     that this adjusts the AC's "HEL-505 limits" wording.
   - **AC3** is paraphrased as "Discard / Save & run / undo are consistent". The verbatim text starts "Discard restores
     the saved pipeline exactly". Item 3 does not address Discard at all (it is only in section 8's bullets).
   - **AC4** is paraphrased as "Output render parity test". The verbatim text is "The Output render matches the
     saved-panel render for the same rows (parity test)". The mapping is fine; only the quote is wrong.
   - **AC5** is paraphrased as "Sample label and age". The verbatim text is "Non-static sources clearly show the sample
     label and its age". This conflicts with section 4 lines 193-195: a REST/SQL source with ≤ 1,000 rows "is usually
     exact" and "needs no caveat". As written, HEL-1581 could ship a non-static source with no sample label or age,
     which violates AC5 and the owner's "cached sample values" guidance. A cached exact sample still ages against the
     live source.
2. **Section 12 cannot be posted to Linear as written.**
   - Lines 507-508 are internal notes ("as summarised in `skeptic-design-1.md` change request 7 ... the orchestrator
     verifies wording"). They should not appear in a Linear comment.
   - The bare references "section 6", "(7)", "(3.3)" and "(4)" cannot be resolved from Linear unless the section names
     the document they point into.
3. **Parity plan: two of the named mutations cannot turn red.** This is the plan the ticket requires to name "a
   mechanism that can fail".
   - **Mutation 5(b)**, "sort with `a - b`: red on a `-0.0` vs `0.0` vector", cannot fail. The corpus is "JSON types
     only". On the Scala side, `-0.0` decodes as `BigDecimal`, which has no signed zero.
     `new BigDecimal("-0.0").doubleValue()` is `0.0` and `Double.compare(..., 0.0)` is `0` (checked in jshell); see
     also `PipelineRowJson.scala:61,75`. So the Scala oracle sees a tie. JS `a - b` gives `-0` for the pair, which is
     also a tie. Both sides agree and the vector stays green. NaN cannot be written in JSON at all.
   - **Mutation 5(c)**, "cast integer with `Number(s)`: red on `"0x10"` and `"1e3"`", is only half right. `"1e3"` is
     not red. Scala `castValue` (`CastStep.scala:80`) falls back from `toInt` to `toDouble.toInt` = 1000, and JS
     `Number("1e3")` is also 1000. The same is true of `" 5 "` (Java `parseDouble` trims, giving 5), which the
     section 3.1 `cast` row (line 110) also lists as a trap. Only `"0x10"` diverges (Scala null, JS 16). I checked this
     in jshell and node.
   - The overall mechanism still has failable checks: the Registry/manifest agreement, the `round(-2.5)` vector and
     `"0x10"`. So this is a correctness fix to the plan, not a missing mechanism.
4. **`tasks.md` 5.1 is unchecked.** Both commits went through the hook: there is no `-n`, and the format and openspec
   gates pass. Mark it `[x]`.

### Phase 2: Code Review — FAIL

The issues are the documentation-accuracy items above. There is no product code to review.

**Gates (my own fresh run, in the worktree):**

- `npm run format:check` passed: "All matched files use Prettier code style!".
- `npm run check:openspec` passed: "openspec/ is clean".
- Lint, jest, build and `sbt testFull` were not triggered: no `frontend/**` or `backend/**` file changed.

**How the hook ran without a local `node_modules`.** The worktree is nested under the main checkout
(`/home/matt/Development/helio/.claude/worktrees/...`).

- `npm run` puts every ancestor's `node_modules/.bin` on `PATH`. `npm run env` shows
  `/home/matt/Development/helio/node_modules/.bin` in the chain.
- Node's module resolution also walks up: `require.resolve("prettier")` from the worktree gives
  `/home/matt/Development/helio/node_modules/prettier/index.cjs`.
- `frontend/node_modules` is a real directory (populated at setup).

So the hook used the main checkout's toolchain, and the gates are the same ones the hook ran.

**Evidence: AC2 latency reproduction.** I re-ran the exact `measurements.md` §1 command once:
`PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node prototype/measure.cjs`. It
used one browser, its own playwright-core 1.55.1 headless shell, and not the shared MCP browser. The run reported
`browser.version()` = 140.0.7339.186, binary `chromium_headless_shell` and Node v22.23.2, which matches the recorded
environment. `verify.bad = 0` and 179 distinct row counts at both rates. Mine against the recorded figures (median /
p95 / max, ms):

| Measurement | Mine | Recorded |
| --- | --- | --- |
| 1x filter-drag, recompute | 0.10 / 0.20 / 0.30, mean 0.109 | 0.10 / 0.20 / 0.40, mean 0.111 |
| 1x filter-drag, recompute + render + forced layout | 1.1 / 1.5 / 2.0 | 1.0 / 1.6 / 2.7 |
| 4x filter-drag, recompute | 0.50 / 1.1 / 1.6 | 0.50 / 1.0 / 1.2, run 2: 0.50 / 1.1 / 1.6 |
| 4x filter-drag, render | 3.9 / 5.1 / 7.8 | 3.8 / 5.2 / 9.0 |
| Scaling 1x, 10k rows | 1.4 | 1.5 |
| Scaling 1x, 50k rows | 8.7 | 9.2 |
| Scaling 4x, 50k rows | 37.5 / 68.4 | 35.4 / 67 |

All within noise. The number is reproducible, measured in a real browser, and the browser is named.

**Prototype isolation.** `git grep -n live-draft-preview -- frontend backend schemas shared-test-fixtures package.json`
returns nothing (exit 1). Nothing imports the prototype.

**Dev DB fixtures (measurements.md §3).** I queried the shared dev DB read-only
(`default_transaction_read_only=on`) by exact id. For all 5 sources, 5 pipelines and 15 steps: `data_sources` 0,
`pipelines` 0, `pipeline_steps` 0, `pipeline_roots` 0, `outputs` on those pipelines 0, `pipeline_runs` 0,
`dataset_rows` for those sources 0. All gone.

**Citation spot-check (about 45 checked).**

Accurate:
- Registry: `PipelineStep.scala:256-284`, `:80`, `:197`, `:289`.
- Limits and deployment: `RateLimitConfig.scala:11-12`, `ApiRoutes.scala:312-317`, `:799`, `cd-backend.yml:91`
  (`--max-instances=2`, `--no-cpu-throttling`), `deploy-backend.sh:115` (concurrency 80).
- Session and preview: `UserSessionRepository.scala:25-35`, `PipelineRunPreview.scala:148`, `:255`, the HEL-1516 guard
  at `:108-120`, `PipelineRunStatusRoutes.scala:38-48`.
- Run guard: `PipelineRunService.scala:187-209` (including `auditSubmit`), `PipelineRunExecutor.scala:144`, `:164`.
- Run-events: `PipelineRunRegistry.scala:73-82`, `:98-120` (buffer 8, `dropHead`), `pipelineRunFanout.ts:4-8`, `:145-151`,
  `:183`, `:251-252`.
- Frontend: `useStepCardPersist.ts:18`, `useStepCardPreview.ts:17`, `aggregate.ts:36,54,108`, `chartTimeAxis.ts:130`,
  `metricHistoryView.ts:118,170`, `MetricOutputPanel.tsx:108-109`.
- Source caps: `DataSourceService.scala:74`, `CsvLimits.scala:18`, `InProcessPipelineEngine.scala:112,521`,
  `SourcePreviewRoutes.scala:42-47`.
- §8 atomic-save claims: `PipelineCreateTransaction.scala:76-89` (DBIO chain, `runTransactionally`,
  `PipelineCreateValidationFailure` recovery), `:196-216`, and `PipelineRepository.scala:506` (`withUserContext`). In
  `PipelineStepRepository.scala`, the return types are as claimed: `updateInternal:487` returns `Future`,
  `spliceInsertAtInternal:638` returns `Future`, `reorderTrunkInternal:866` returns `Future` and `deleteInternal:994`
  returns `Future`, while `insertInternalAction:410` returns `DBIO`, `attachTailInternalAction:776` returns `DBIO`,
  `removeRootCascadeAction:1200` returns `DBIO` and `rewriteUpsertTargetAction:124` returns `DBIO`.
- Patch-sets: `PatchSetTargetFingerprint.scala:43` (the pipeline field list), `ServiceResponse.scala:88-102`
  (`PATCH_SET_STALE`), `PatchSetApplyService.scala:153` and `PipelineStepWrites.scala:160-166` and `:184-188`.
- Parity precedents: `PipelineCostEstimatorSpec.scala:139-157` (partitions the Registry), `ExpressionEvaluatorSpec`
  round vectors, and 13 files in `shared-test-fixtures/`.

Minor drift (≤ 3 lines, non-blocking):
- `PipelineRunPreview.scala:280/293/297` are actually at 277/290/292.
- `PatchSetUndoService.scala:38-40`: the quoted text is at :43.
- `PipelineRepository.scala:514-520` locks **panel** rows before a pipeline delete, not the pipeline row. It is an
  acceptable precedent for "the repo takes row locks", but not literally "a row lock on the pipeline".

**"36-45 ms floor" correction.** It is consistent: no "floor" or "fixed per-request" claim survives in the doc. The
cold-state range is quoted four slightly different ways: 25-45 (line 28), 26-46 (§6.1), 25-46 (§13), and
24-44 / ~25-45 (measurements). This is non-blocking.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed.

### Overall: FAIL

### Change Requests

1. **`docs/live-draft-preview.md` §12, lines 507-508.** Replace the preface with:
   - a one-line intro ("HEL-1580 spike outcome, from `docs/live-draft-preview.md`"), or a link to it;
   - an instruction to quote each AC verbatim from the HEL-1581 text below.

   Delete the `skeptic-design-1.md` and "the orchestrator verifies wording" sentences. Change every bare "section N" /
   "(N)" reference in §12 to "`docs/live-draft-preview.md` §N".
2. **§12 item 1.** Quote verbatim: "Editing a client-evaluable step updates counts, preview and Output render with no
   network request (verified via network log), within the latency budget the spike set". State the budget explicitly:
   < 50 ms per edit, measured ~1 ms recompute+render and ~4-5 ms at 4x throttle on the 1,000-row three-step board
   pipeline (headless Chromium 140). Say what the network-log check must show: zero requests per edit after the
   page-load sample and baseline fetches.
3. **§12 item 2.** Quote verbatim: "A server-only step updates through the chosen transport, debounced, with a pending
   state, and never fires more than the HEL-505 limits allow". Then:
   - Map "debounced" to the ~300-400 ms trailing debounce, 600 ms floor and single-flight in §6.3.
   - Map "pending state" to the per-step status (`needsServer`/in-flight) and the "live" pill off, from §5 and §7.
   - State that the dedicated draft-preview limiter adjusts the AC's "HEL-505 limits" wording.
4. **§12 item 3.** Quote verbatim: "Discard restores the saved pipeline exactly. Save & run persists the draft and
   starts a run, and undo/patch-set history stays consistent". Map Discard (re-derive every frame from the saved
   pipeline, §8) and say how "exactly" is tested. Keep the 409, journal row and guard-rejection adjustments.
5. **§12 items 4 and 5.** Quote verbatim. Then fix §4 lines 193-195 so that a **non-static** (REST/SQL/connector)
   source always shows the sample label and its capture age, even when the cached sample is exact. "Needs no caveat"
   may apply only to the count/aggregate caveat, not to the label and age. Make item 5 say the same.
6. **§3.3 mutation 5(b), line 169.** Replace it with a sort mutation the JSON corpus can express. For example, a
   column mixing numbers, numeric strings, non-numeric strings and `null`, which distinguishes the three-tier
   comparator from `a - b` (NaN comparisons) or from a plain lexicographic sort. Drop the `-0.0` claim, or state that
   signed zero and NaN are not representable in the JSON corpus.
7. **§3.3 mutation 5(c), line 170, and the §3.1 `cast` row, line 110.** Remove `"1e3"` and `" 5 "` as traps. Scala's
   `toInt`→`toDouble.toInt` fallback gives 1000 and 5, which are the same as JS `Number`. Keep `"0x10"` (Scala null,
   JS 16) and add a vector that does diverge, such as `"1.9"` (Scala 1, JS `Number` 1.9) or `"Infinity"`.
8. **`tasks.md` 5.1.** Mark it `[x]`: the commits went through the full hook.

### Non-blocking Suggestions

- Unify the cold-state range: 25-45 (§1) vs 26-46 (§6.1) vs 25-46 (§13).
- Correct the small line drift in `PipelineRunPreview.scala:280/293/297` and `PatchSetUndoService.scala:38-40`. Reword
  "after taking a row lock on the pipeline (the repo already locks rows before a cascade...)" to make clear the cited
  precedent locks panel rows, and that the pipeline-row lock is new.
- `tasks.md` 1.2 and `design.md` D2 still name `measure.mjs` / `createRequire`. The delivered driver is `measure.cjs`
  with `require.resolve`; `measurements.md` explains why, but the planning artifacts could say so too.
- The measurements §2 and §4 commands use `cd .../`. Give the full path, as §1 does.
- HEL-1581's "What" bullets that are not ACs (changed-row flash with reduced motion, the 340-380 px Output column)
  could get one line in §12 noting they are unaffected by the spike.
