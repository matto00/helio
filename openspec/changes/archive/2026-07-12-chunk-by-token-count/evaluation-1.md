## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket acceptance criteria addressed explicitly: apply/infer parity across all 8 enumeration
  sites (verified by diff read of `PipelineStep.scala`, `package.scala`, `PipelineStepProtocol.scala`,
  `PipelineStepConfigCodec.scala`, `PipelineStepRepository.scala`, `PipelineAnalyzeService.scala`,
  `PipelineAnalyzeProtocol.scala`, `PipelineService.scala`); the exact `toAnalyzeStepResponse` arm
  flagged in the ticket as the HEL-219 500-causing site is present (`PipelineService.scala:200`).
- `allowedOps`/Flyway: `V52__add_chunkbytokencount_op.sql` extends the CHECK constraint to all 13
  kinds, matching `V50`/`V51`'s established drop/re-add pattern; migrated cleanly to v52 in a live
  `sbt test` run (embedded Postgres log confirms "Migrating schema to version 52").
- StepCard/step-config UI: `ChunkByTokenCountConfig.tsx` added, wired into `StepCard.tsx`'s branch
  and the `OP_TYPES` picker (confirmed live — see Phase 3), field selector correctly gated to
  `string-body` fields.
- Tokenization approach: real BPE tokenization via `jtokkit:1.1.0` per the human-escalated decision
  in design.md; not unilaterally picked.
- All 25 `tasks.md` items map 1:1 to diff content — no task marked done without matching code.
- No scope creep: the only change outside the op itself is the pre-authorized
  `PipelineProtocol.scala`/`PipelineAnalyzeProtocol.scala` split (explicitly in-scope per the
  ticket's "Additional notes" and design.md decision 8).
- No regressions: full existing backend (1248 tests) and frontsend (831 tests) suites pass unchanged
  aside from additive coverage.
- Planning artifacts (proposal/design/tasks) match implemented behavior exactly — no drift found.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `npm run check:scala-quality` passes clean (0 inline-FQN
  violations). Confirmed manually — no inline `com.helio.*`/`spray.json.*`/`com.knuddels.*`
  qualifiers outside import blocks in `ChunkByTokenCountStep.scala` or any touched file.
  `PipelineProtocol.scala` (95 lines) and `PipelineAnalyzeProtocol.scala` (194 lines) are both
  comfortably under the 250-line soft budget — the proactive split achieved its stated goal
  (`PipelineProtocol.scala` was 257 lines pre-change per files-modified.md, now 95).
  Pre-existing over-budget files (`PipelineStepRepository.scala` 258 lines, `PipelineService.scala`
  424 lines) predate this ticket (256/420 lines at base commit `e3889f0`) — not new violations,
  and `check:scala-quality`'s own verdict is "clean" (soft warnings only, non-blocking).
- **Design-standard mechanical rules**: N/A violations possible — no new CSS was added; the new
  `ChunkByTokenCountConfig.tsx` reuses 100% pre-existing classnames
  (`pipeline-detail-page__splittext-config`, `__compute-field`, `__limit-config-row`, etc.) already
  used by `ExtractHeadingsConfig`/`SplitTextConfig`, inheriting their token/spacing compliance.
- **DRY**: config decode/encode follows the established `StepCodecUtil.asObject` tolerant-decode
  pattern; no duplicated logic.
- **Readable**: naming is clear (`chunkTokens`, `encodingFor`, `ChunkByTokenCountConfig`); no magic
  values (500-token default and both encoding names are documented in design.md and inline
  Scaladoc).
- **Modular**: `jtokkit` integration isolated entirely to `ChunkByTokenCountStep.scala` as decided;
  the pure `chunkTokens` function is separated from the row-level `apply`/`evaluate` glue.
- **Type safety**: no `any`/untyped escape hatches on either side; frontend
  `ChunkByTokenCountConfigValue.encoding` is a literal union type, not a bare `string`.
- **Security**: analyze-time validation rejects non-`string-body` fields and unknown fields with a
  `validationError`, mirroring the existing pattern; no injection surface (JSON config parsed via
  spray-json, not string interpolation).
- **Error handling**: malformed config JSON caught and surfaced as a `validationError` in
  `inferChunkByTokenCount`; `targetTokenCount < 1` clamped rather than throwing/looping; unrecognized
  `encoding` falls back rather than throwing.
- **Tests meaningful**: `ChunkByTokenCountStepSpec` performs a genuine round-trip
  (`encoding.encode(text).size() shouldBe tokenCount` re-derived from the decoded chunk text, not
  just asserting the shape) — this would catch a real jtokkit API misuse. `PipelineAnalyzeRoutesSpec`
  adds a live-route-level regression test asserting `GET /api/pipelines/:id/analyze` returns 200 with
  the exact HEL-219-class scenario the ticket calls out.
- **No dead code**: no unused imports or leftover TODO/FIXME found in any new/touched file.
- **No over-engineering**: config shape, chunking algorithm, and file split are all minimal and
  directly justified by design.md; no premature abstraction.
- **Behavior-preserving split**: `PipelineProtocol.scala` → `PipelineAnalyzeProtocol.scala` diff
  read line-by-line — pure relocation of the `AnalyzeStepResponse` ADT + `PipelineAnalyzeResponse` +
  their formats into the same package, with `PipelineProtocol extends ... with
  PipelineAnalyzeProtocol` restoring the original mix-in surface. No wire-shape or behavior change;
  confirmed empirically by all pre-existing analyze-route tests continuing to pass and the live
  `curl` check below.

### Phase 3: UI Review — PASS
Issues: none.

Servers started via `scripts/concertino/start-servers.sh` (DEV_PORT=5394, BACKEND_PORT=8301);
`assert-phase.sh servers` returned PASS.

- **Happy path end-to-end (live, not trusting executor's report)**: created a real pipeline against
  a text data source via the API, added a `chunkbytokencount` step
  (`field=content, targetTokenCount=50/500, encoding=o200k_base/cl100k_base`), then:
  - `GET /api/pipelines/:id/analyze` → **200**, with `steps[0].type == "chunkbytokencount"`,
    correct `outputSchema` (`chunkIndex`/`tokenCount` appended as `integer`), `validationError: null`.
    This is the exact regression class the ticket flags — confirmed live, independently of the
    executor's report.
  - `POST /api/pipelines/:id/run` → 26 real output rows from a 1-source-row Markdown file, each with
    `tokenCount: 50` (final chunk `13`), chunk text that visibly continues where the prior chunk left
    off — genuine BPE-token chunking, not a heuristic.
  - Frontend: navigated to the pipeline, expanded the "Chunk by token count" step card — field
    dropdown (`content`), numeric token-count input (`50`), encoding dropdown (`o200k_base (GPT-4o
    family)` default) all rendered correctly. Changed encoding to `cl100k_base` in the UI; confirmed
    via a follow-up API read that the persisted step config updated to `"encoding":"cl100k_base"`.
  - Step picker ("+ Add transformation step") lists "Chunk by token count" as the 13th op with its
    own icon, alongside all 12 existing kinds.
- **Unhappy paths**: analyze-time `validationError` path exercised by
  `PipelineAnalyzeServiceSpec`/`PipelineAnalyzeRoutesSpec` (unknown field, non-string-body field) —
  not independently re-verified live, but backed by passing automated tests exercising the real
  route.
- **No console errors**: 0 console errors during the live session (one stale error referencing a
  different, unrelated dev-server port from prior browser history was present but is not attributable
  to this session's servers — confirmed the same analyze endpoint returns 200 against the actual
  BACKEND_PORT).
- **Loading/empty states**: unchanged from existing step-card patterns; no new state surface
  introduced.
- **Entry points**: step reachable via the step picker on any pipeline detail page; no alternate
  entry points expected for this feature.
- **Accessible names/keyboard support**: field dropdown (`aria-label="Content field to chunk"`),
  token-count input (`aria-label="Target token count"`), encoding dropdown
  (`aria-label="Token encoding"`) all present and correctly labeled; verified via accessibility
  snapshot (`combobox`/`spinbutton` roles resolved by name).
- **Breakpoints**: no new CSS was introduced by this change (confirmed via diff — zero `.css` files
  touched); the new component reuses classnames already breakpoint-tested by the merged
  `ExtractHeadingsConfig`/`SplitTextConfig` components, so no new breakage risk exists.

### Fresh verification evidence (independently re-run, not trusting executor's report)
- `sbt test` (backend): **1248 tests, 0 failures**, migrated cleanly through V52.
- `npm run check:scala-quality`: clean (0 mechanical violations; 41 pre-existing soft-budget
  warnings unrelated to this change).
- `npm run lint` (zero-warnings policy): clean.
- `npm run format:check`: clean.
- `npm test` (frontend, full suite): **831 tests, 0 failures** across 74 suites.
- `npm run build` (frontend production build): succeeds.
- `npm run check:schemas`: in sync.
- `npm run check:openspec`: only flags the change as "complete but not archived" (expected —
  archival happens later in the workflow) and one untracked orchestrator state file
  (`workflow-state.md`, not part of the executor's diff).
- Live `curl` against a real running backend: `GET /api/pipelines/:id/analyze` → 200 for a pipeline
  containing a `chunkbytokencount` step (the ticket's explicit ask, independently re-verified).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineService.scala` (424 lines) and `PipelineStepRepository.scala` (258 lines) are pre-existing
  soft-budget violations, unrelated to this ticket but adjacent to the touched code; consider a
  future proactive split if either grows further, per the same rationale used for
  `PipelineProtocol.scala` in this change.
