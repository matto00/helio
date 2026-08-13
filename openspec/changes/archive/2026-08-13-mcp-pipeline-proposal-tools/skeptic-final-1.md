## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established, cold.** Read `ticket.md`, `design.md`, `tasks.md`,
`skeptic-design-1.md`/`skeptic-design-2.md`, `files-modified.md`, `evaluation-1.md` (as
claims, not facts), and `git diff main...HEAD` in full (`git diff main...HEAD --stat` /
`--name-only`). Single commit `8747f589` on `feature/mcp-pipeline-proposal-tools/HEL-385`,
`main` is an ancestor of `HEAD` (`git merge-base --is-ancestor main HEAD` → true, no drift).
`git status --porcelain` shows only expected review artifacts
(`workflow-state.md` modified, `evaluation-1.md` untracked) — no stray code changes.

**AC-by-AC trace against real code** (`ticket.md` lines 22-27):
1. `propose_pipeline` writes nothing / returns validated proposal + warnings — traced to
   `pipelineProposalHandlers.ts:34-55` (`proposePipelineHandler`): the only I/O is
   `api.listDataSources()` (a `GET`), returns `{ proposal, warnings, applyReady }`. Confirmed.
2. `analyze_pipeline_proposal` no-writes dry schema — traced to
   `pipelineProposalHandlers.ts:59-64` → `HelioApi.analyzePipelineProposal` →
   `POST /api/pipelines/analyze-proposal`. Independently read the (already-merged, unmodified)
   backend route `backend/.../routes/PipelineRoutes.scala:40-47`: dispatches to
   `pipelineService.analyzeProposal`, a sibling of the read-only `GET /:id/analyze` — no apply
   path invoked. Confirmed.
3. `apply_pipeline_proposal` atomic apply + verbatim guardrail surfacing — traced to
   `pipelineProposalHandlers.ts:71-76` → `POST /api/pipelines/apply-proposal`
   (`backend/.../routes/PipelineProposalRoutes.scala:33-40`, unmodified, already-merged HEL-383).
   `guarded()` in `pipelineProposal.ts:41-51` formats `HelioApiError` verbatim
   (`"<Name> (status <code>) for <url>: <message>"`) — identical helper body to `proposal.ts`'s
   (diffed `err as Error` / cast pattern against `proposal.ts:110` — real precedent, not invented).
   Confirmed.
4. Tools registered / `helioApi.ts` methods added / description consistency — `index.ts` diff
   adds one import + one `registerPipelineProposalTools(server, api)` call, alongside the
   existing three registrations; `helioApi.ts` diff adds exactly `analyzePipelineProposal` and
   `applyPipelineProposal` as thin `this.http.post(...)` pass-throughs. Confirmed.
5. MCP build + unit tests green — see fresh gate re-runs below. Confirmed.
6. Backward-compat / purely additive — `git diff main...HEAD --name-only` touches exactly the
   nine files `files-modified.md` declares plus openspec planning docs; the only change to an
   existing file (`write.ts`) is the D3 hoist (verified behavior-preserving below);
   `write.test.ts`/`proposal.test.ts` pass unmodified. Confirmed.

**D3 (hoist) — independently re-verified, not just re-read the evaluator's claim.**
`git diff main...HEAD -- helio-mcp/src/tools/write.ts` and a full read of the file: the `-` hunk
deletes the in-function declaration (previously ~line 535, inside `registerWriteTools`); the `+`
hunk adds `export const boundPipelineStepSchema = z.object({...})` at module top level (lines
23-35, before `jsonResult`), outside any function body. The declaration references no
`server`/`api`/other local — behavior-preserving. `create_bound_panel` (`write.ts:596`,
unchanged) resolves it via ordinary module-scope lookup. `pipelineProposal.ts:35` imports it
(`import { boundPipelineStepSchema } from "./write.js";`) and reuses it verbatim at line 76 for
`steps` — no second, drift-prone copy. This is genuinely hoisted, not merely `export`-annotated
in place — matches design.md D3's round-1 correction exactly.

**D4b (TS2589 avoidance) — independently reproduced, not merely trusted.**
Read `pipelineProposalHandlers.ts` in full: imports are only `type { HelioApi }`, plain types
from `types.ts`, and `computePipelineProposalWarnings` — no `zod`, no
`@modelcontextprotocol/sdk`. To verify the claimed TS2589 hazard is real (not a fabricated
justification for the file split), I wrote a throwaway test file
(`helio-mcp/src/tools/pipelineProposalRepro.test.ts`, deleted immediately after, confirmed via
`git status --porcelain` clean afterward) that imports `pipelineProposal.ts` directly and ran
`npx jest --testPathPatterns=pipelineProposalRepro`. It failed to compile with, verbatim:
```
helio-mcp/src/tools/pipelineProposal.ts:80:3 - error TS2589: Type instantiation is excessively deep and possibly infinite.
  80   server.registerTool(
       ~~~~~~~~~~~~~~~~~~~~
  81     "propose_pipeline",
```
— at the exact `server.registerTool(...)` call site, cascading into the same `TS2322`/`TS7031`
errors `files-modified.md`/`tasks.md` 7.3 describe from the executor's own removed attempt. This
independently confirms D4b's premise is a real, reproducible compiler constraint under this
repo's ts-jest config, not hand-waving — and confirms `pipelineProposalHandlers.ts` and
`pipelineProposalHandlers.test.ts` (which import each other only) never trigger it.

**Backend contract cross-check (not just trusted from the evaluator's report).** Read
`PipelineProposalProtocol.scala` and `PipelineAnalyzeProposalProtocol.scala` in full and
compared field-by-field against the new `types.ts` interfaces: `PipelineProposalSource`'s
single-`config`-key wire shape matches the hand-written `pipelineProposalSourceFormat`
reader/writer exactly (D1); `PipelineProposalApplyResponse.source?: DataSourceResponse` matches
the Scala `Option[DataSourceResponse]` (spray-json omits-when-`None` convention, correctly
modeled as TS-optional, not nullable); `PipelineAnalyzeProposalResponse.steps:
PipelineAnalyzeResponse["steps"]` reuse matches `jsonFormat4` using the same
`analyzeStepResponseFormat`/`SchemaFieldResponse` as `GET /:id/analyze`. Also confirmed the
`analyze-proposal` route is registered *before* the unconstrained `PipelineIdSegment` matcher in
`PipelineRoutes.scala` (so the literal segment isn't swallowed as a bogus pipeline id) — correct
and unrelated-to-this-ticket backend code, unmodified.

**Fresh gate re-runs (never trusted the evaluator's pasted output alone — reran everything):**
```
$ npm --prefix helio-mcp run build        → clean, zero errors
$ npm --prefix helio-mcp run typecheck    → clean, zero errors (tsc --noEmit)
$ npx eslint helio-mcp/src --max-warnings=0   → no output (clean)
$ npx prettier --check helio-mcp/src      → "All matched files use Prettier code style!"
$ rm -rf helio-mcp/dist && npx --prefix helio-mcp jest
  PASS helio-mcp/src/tools/pipelineProposalValidation.test.ts
  PASS helio-mcp/src/tools/write.test.ts
  PASS helio-mcp/src/tools/proposal.test.ts
  PASS helio-mcp/src/tools/pipelineProposalHandlers.test.ts
  PASS helio-mcp/src/context.test.ts
  Test Suites: 5 passed, 5 total
  Tests:       128 passed, 128 total
$ npm run check:schemas   → "schemas in sync ... (38 checked across 31 protocol files)"
$ npm run check:openspec  → only the expected "complete (19/19) but not archived" notice
```
All match the evaluator's claimed figures exactly (128/128, 5/5 suites, clean build/typecheck/
lint/format). No `frontend/**` files touched (`git diff --name-only` confirms), so DESIGN.md's
UI-review step is correctly N/A — no dev servers needed for this ticket.

**Scope discipline.** `git diff main...HEAD --name-only` = exactly the 9 code files
`files-modified.md` declares + expected openspec planning docs. No unrelated refactors, no
scope drift beyond the ticket. File sizes well under CONTRIBUTING.md's ~250-line soft budget
(`pipelineProposal.ts` 169, `pipelineProposalHandlers.ts` 76, `pipelineProposalValidation.ts`
67). No `any` in the diff outside prose comments (spot-checked).

### Verdict: CONFIRM

Both decisions the orchestrator flagged for special scrutiny (D3's genuine module-scope hoist,
D4b's zod/McpServer-free handler extraction) are faithfully and correctly implemented — verified
by direct reading of the code, not by re-trusting the executor's or evaluator's narrative, and
D4b's TS2589 premise was independently reproduced (not merely asserted) via a throwaway test
import that failed exactly as predicted. All six ticket acceptance criteria trace to real,
read code and passing tests. All gates re-run fresh and green. No scope drift, no regressions,
no placeholders. This ships.

### Non-blocking notes

- Same as evaluator's: `helioApi.ts`'s `applyPipelineProposal` return statement is a long single
  line; Prettier already accepts it as-is — purely stylistic.
- `design.md` D4b calls `HelioApi` "a zod-free interface" when it's actually `export class
  HelioApi` — a wording nit already caught by `skeptic-design-2.md`'s own minor observation;
  doesn't affect the plan's or the implementation's validity (the file only ever does a
  type-only `import type { HelioApi }`, carrying no zod dependency either way).
