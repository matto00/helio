## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 15ab89d5d1694737ad925b794fbea3f9b3ba1f16
Diff base (LIVE-resolved): 22341994a5689f60f19d9644b5caab2cf69f4cae

### Phase 1: Spec Review — PASS

- Ticket AC ("A failable probe: one pipeline the estimator must deny (contains an AI step) and one
  it must allow, with a mutation showing the deny arm actually fires") is met: `PipelineCostEstimatorSpec`
  has the paired AI-deny/AI-allow tests and `mutation-evidence.md` documents M1/M2, independently
  re-run and confirmed below.
- Deny-on list from the ticket (any AI step, any remote fetch, row count above threshold, step count
  above bound) is all implemented: `ai-step`, `remote-fetch`, `rows-above-threshold`,
  `steps-above-bound`, plus the design's additional `writeback-step`/`unclassified-op`/
  `unclassified-source`/`row-estimate-unavailable`/`no-roots` deny-by-default codes.
- No AC silently reinterpreted.
- Tasks 1.1–4.5 all marked done and match the diff (estimator, repo method, service wiring, wire
  protocol, schema, frontend/helio-mcp types, probe + mutation evidence + route spec).
- No scope creep: touched files are exactly what `files-modified.md` describes; the frontend/
  helio-mcp test-fixture edits are typecheck/build fixes for the new required field, not new
  feature surface.
- No regressions: `analyzeConcise` and `analyzeProposal` are separate methods in
  `PipelineService.scala`, untouched by the diff — confirmed by direct inspection (grep) and the
  full backend suite (4372/4372 green, including all existing concise/proposal specs).
- Schema (`pipeline-analyze-response.schema.json`) updated in the same change: `costVerdict`
  required, closed 9-code enum, `additionalProperties: false`. `npm run check:schemas` reports 0
  drift.
- Planning artifacts (design.md D1–D8) match the implemented behavior exactly, including the
  `hasSourceUrl` per-kind dispatch (D3) and the derived, non-hand-maintained `CheapOps` allowlist
  (D2).
- `workflow-state.md` Standing Constraints C1–C3 (tasks.md) all honored — see Phase 2 for C1/C3,
  Phase 2 mutation section for C2.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set):

- `sbt test` (full suite): **4372/4372 passed**, 0 failed (4m33s).
- `npm run check:schemas`: clean, 0 drift (95 protocols checked).
- `npm run typecheck`: clean.
- `npm run lint` (`--max-warnings=0`): clean.
- `npm run format:check`: clean.
- `npm test` (full Jest, frontend + helio-mcp): **317/317 + 28/28 suites passed**, 3379 + 271 tests.
- `npm --prefix frontend run build`: succeeds (pre-existing >500kB chunk warning, unrelated to this
  diff).
- `npm --prefix helio-mcp run build`: clean.

Standing Constraints:
- **C1 (deny by default)**: `CostVerdict.autoRunnable` is derived in exactly one place
  (`CostVerdict.of`, private companion method) as `reasons.isEmpty`; the case class constructor is
  private, so no other code path can construct an allow with reasons or an allow for an
  unclassified op/source. Verified by reading `PipelineCostEstimator.scala:60-67` and confirmed
  behaviorally by mutation M2 below (adding an op to the allowlist is the only way to widen an
  allow, and it is caught by the `CheapOps` parity test).
- **C2 (failable evidence)**: independently re-ran M1 and M2 myself (not trusting
  `mutation-evidence.md`'s report) — see Mutation re-verification below. Both reproduced the exact
  RED failures recorded, tree reverted and confirmed clean + green after each.
- **C3 (no implementation of analyzewithai/generatetext/convertformat)**: confirmed by grep — these
  op names appear only as string literals in `AiOps`/classification and in the route spec's direct
  SQL insert probe; no `PipelineStep.Registry` entry, no new step-config class, no route wiring.

Mutation re-verification (independent, not trusting the executor's report):

- **M1** — removed the `AiOps.contains(step.op)` branch from `classifyStep` (deny-arm deletion).
  Re-ran `sbt "testOnly com.helio.domain.engine.PipelineCostEstimatorSpec"`: **3 tests failed**,
  same failure messages and line numbers as `mutation-evidence.md` (`ai-step` assertions fail via
  `unclassified-op` fallback, exactly as D8 predicts). Reverted via `git checkout --`; `git status`
  clean; re-ran the same spec: 16/16 green.
- **M2** — added `"analyzewithai"` to `CheapOps` and removed the same AI-deny branch. Re-ran the
  same spec: **4 tests failed** (the `autoRunnable` assertion goes red directly — `true was not
  equal to false` — plus the derived-allowlist parity test independently catches the same
  mutation), matching `mutation-evidence.md` exactly. Reverted; `git status` clean; spec green
  again (16/16).

Route-level AI-op-row finding: `PipelineAnalyzeRoutesSpec`'s third `costVerdict` test (direct SQL
insert of an `analyzewithai` row, bypassing request-time validation) reproduces the claimed
`500 Internal Server Error` — confirmed by my own fresh run
(`sbt "testOnly com.helio.api.routes.pipelines.PipelineAnalyzeRoutesSpec"`, 28/28 passed, including
this test) and by a live server check below. The recorded root cause
(`PipelineStepRepository.rowToDomain` re-raising a `Try`-caught decode failure as
`IllegalStateException` because `analyzewithai` has no `Registry` entry) is consistent with the
stack trace observed in the test log.

Concise/proposal byte-unchanged claim (design D6): confirmed by direct inspection —
`PipelineService.analyzeConcise` and `PipelineService.analyzeProposal` are untouched methods with
their own response construction, and the full test suite (including their existing specs) stayed
green.

Other checks:
- **DRY**: `countDatasetRows` reuses the existing `DatasetRowTable`/`ctx.withSystemContext` pattern
  used by `readDatasetRows` nearby; no duplication introduced.
- **Readable**: reason codes, thresholds (`MaxAutoRunRows`/`MaxAutoRunSteps`), and classification
  branches are named clearly with doc comments explaining the "why" (e.g. why `ai-step` is checked
  before the general allowlist, for HEL-1108).
- **Modular**: estimator is IO-free and pure (D1); `PipelineService.analyze` does only IO + hands
  off to `estimate`.
- **Type safety**: `CostVerdict`'s private constructor enforces the autoRunnable/reasons invariant
  at compile time for in-file callers; no `any`/untyped escape hatches on the TS side.
- **Error handling**: the AI-op-row 500 is a pre-existing decode-boundary behavior (not introduced
  by this diff), correctly recorded per D8 rather than silently assumed or hidden.
- **No dead code**: no unused imports/TODOs introduced (verified via the diff).
- **No over-engineering**: single pure object, no premature abstraction layers.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**` files touched: `pipelineStep.ts` type addition, two fixture test
files), so Phase 3 was run rather than skipped, even though this is a backend-only wire addition
with no new UI surface (ticket non-goals: "no UI").

- Started servers via `scripts/concertino/start-servers.sh` (port 6524/9431); `assert-phase.sh
  servers` → `PASS servers`.
- Logged in as the dev account, called `GET /api/pipelines/:id/analyze` on a real persisted
  pipeline directly against the live backend: response includes a well-formed `costVerdict`
  (`autoRunnable: false`, `remote-fetch` reason for a `rest_api` root), matching the estimator's
  contract.
- Navigated to that pipeline's detail page in the browser (`/pipelines/<id>`): page loads
  correctly, title renders, **zero console errors** (`browser_console_messages` level=error → 0
  entries).
- No UI component currently renders `costVerdict` (correct per design's non-goals — HEL-1093/1096
  consume it later); no visual regression possible since no new UI was added.
- Not applicable: loading/empty states, breakpoints, keyboard/accessible-name checks — no new
  interactive UI surface was added by this diff.

### Overall: PASS

### Non-blocking Suggestions

- None beyond what's already tracked as spinoff scope (HEL-1105/1106/1107, HEL-1108, HEL-1093,
  HEL-1096) per the ticket's own context section.
