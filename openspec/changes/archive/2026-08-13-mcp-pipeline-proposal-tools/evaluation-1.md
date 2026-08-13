## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All six ticket acceptance criteria addressed explicitly, no partial or silent reinterpretation:
  - `propose_pipeline` assembles a `PipelineProposal` and returns `{ proposal, warnings, applyReady }`
    without writing (`pipelineProposalHandlers.ts:34-55` — only I/O call is the read-only
    `api.listDataSources()`).
  - `analyze_pipeline_proposal` is a dry pass-through to `POST /api/pipelines/analyze-proposal`
    (`pipelineProposalHandlers.ts:59-64`).
  - `apply_pipeline_proposal` is a pure pass-through to `POST /api/pipelines/apply-proposal`
    (`pipelineProposalHandlers.ts:71-76`); guardrail errors surface verbatim via the pre-existing
    `guarded`/`HelioApiError` handling in `pipelineProposal.ts:41-51` (copied from `proposal.ts`/`write.ts`'s
    identical helper, not reinvented).
  - All three tools registered in `index.ts:21,32`; `helioApi.ts` gained exactly the two new methods
    (`analyzePipelineProposal`, `applyPipelineProposal`) plus the existing `listDataSources` reused —
    matches task 2.3's explicit "no new client method beyond `listDataSources`" call.
  - Tool descriptions are consistent in style/verbosity with `write.ts`/`proposal.ts`'s existing prose
    (canonical Source → Pipeline → DataType → Panel path, explicit SQL-read-only-rule callouts,
    explicit `csv`-rejected-at-apply-time callout per D2).
  - Backward-compat: `git diff` confirms zero signature changes to any pre-existing tool; the only
    change to an existing file's *behavior surface* is `write.ts`'s `boundPipelineStepSchema` hoist,
    which is genuinely behavior-preserving (verified below).
- One documented, justified deviation from the ticket's literal scope text ("Zod schema for the proposal
  (step type/config per the op set)"): the implemented `steps` schema is `z.string().min(1)` for `type`,
  not a closed per-op enum. This is not scope creep or silent drift — design.md's Non-Goals section
  explicitly calls this out and justifies it by citing the existing precedent
  (`add_pipeline_step`'s identical `type: z.string().min(1)`, and HEL-379 design.md D3's own
  stale-enum-avoidance reasoning). Went through 2 rounds of skeptic design review; not a defect.
- All 19/19 tasks.md items are checked and match what was actually implemented — verified against the
  diff item by item, including the non-trivial ones (D3 hoist, D4b handler extraction, the 7.3 removal).
- No regressions to existing behavior: `write.test.ts`/`proposal.test.ts`/`context.test.ts` (pre-existing
  suites) all still pass unmodified (128/128 helio-mcp tests green, see Phase 2).
- No unnecessary changes outside ticket scope — `git diff --name-only main...HEAD` touches only the nine
  files files-modified.md declares plus openspec planning docs.
- API contract: no backend/schema changes needed or made (correctly — HEL-379/381/383 already merged and
  unchanged, confirmed by reading `PipelineProposalProtocol.scala`/`PipelineAnalyzeProposalProtocol.scala`
  and cross-checking the new TS interfaces field-by-field against them; they match exactly).
- Planning artifacts (proposal/design/tasks/spec.md) accurately reflect the final implemented behavior;
  `files-modified.md`'s deviation note for task 7.3 matches the actual code state.

### Phase 2: Code Review — PASS

Issues: none blocking. One non-blocking observation below.

**D3 (hoist) — verified genuinely fixed, not just `export` bolted on in place.**
`git diff main...HEAD -- helio-mcp/src/tools/write.ts` shows `boundPipelineStepSchema` newly declared at
module top level (`write.ts:20-33`, immediately after the `proposal.js` import, before `jsonResult`), and
the old in-function declaration (previously at ~line 535, inside `registerWriteTools`) is deleted from the
diff's `-` hunk. `export const boundPipelineStepSchema = z.object({...})` sits outside any function body —
confirmed by reading the file directly. `create_bound_panel`'s reference (`write.ts:596`,
`z.array(boundPipelineStepSchema).default([])`) is unchanged and resolves via ordinary module-scope lookup.
The declaration closes over nothing (`server`/`api` not referenced), so this is behavior-preserving, and
`write.test.ts` (all pre-existing cases) still passes. `pipelineProposal.ts:35` imports it
(`import { boundPipelineStepSchema } from "./write.js";`) and reuses it verbatim at `pipelineProposal.ts:76`
— no second, drift-prone copy.

**D4b (TS2589-safety) — verified `pipelineProposalHandlers.ts` imports neither `zod` nor `McpServer`.**
Read the file in full: its only imports are `type { HelioApi }`, plain type imports from `types.ts`, and
`computePipelineProposalWarnings` from `pipelineProposalValidation.ts` — no `zod`, no
`@modelcontextprotocol/sdk`. Confirmed independently by re-running the exact TS2589 trigger the executor's
own handoff describes: `npx jest --testPathPatterns=pipelineProposal` against a build where
`helio-mcp/dist/tools/pipelineProposalHandlers.test.js` and `pipelineProposalValidation.test.js` exist
alongside the `.ts` sources — both `.ts` test files compiled and ran cleanly with zero TS2589 errors
(the only failures were the stray `dist/*.test.js` files hitting an unrelated ESM/CJS Jest-transform issue,
see below, not TS2589). `pipelineProposal.ts` itself is a genuinely thin shell — zod `inputSchema` +
`guarded(() => xHandler(api, ...))` one-liners only, no business logic (verified by full read).

**Task 7.3 deviation — legitimate, not dropped coverage.**
`git diff --stat` and a `find` for `pipelineProposal.test.ts` confirm no such file exists on this branch —
consistent with files-modified.md's account that it was written, confirmed to trip TS2589 in practice
(`server.registerTool(...)` + the imported `boundPipelineStepSchema` zod type, exactly the D4b-predicted
combination), and removed per task 7.3's own pre-authorized fallback and task 7.5's explicit removal
instruction. This is documented in both `files-modified.md` and `tasks.md`'s 7.3 line, matching design.md
D4b and the skeptic-design-2.md report's own explicit anticipation of this exact failure mode (minor
observation #2 in that report). 7.1/7.2's *required* coverage is intact and independently re-verified
green (see Phase gates below) — the removed test was optional bonus zod-shape coverage per tasks.md's own
wording ("a nice-to-have on top of 7.1/7.2's required coverage, not a substitute for either"), not a
required AC.

**`helio-mcp/dist/` environmental workaround — verified no leftover artifacts.**
`git status --porcelain --ignored` in the worktree shows no `dist/` entry at all (properly covered by
`helio-mcp/.gitignore`'s `dist/` and the root `.gitignore`'s `dist/`), and nothing is staged/tracked under
it. Independently reproduced the hazard the executor described: running `npm --prefix helio-mcp run build`
populates `helio-mcp/dist/tools/*.test.js` (tsc's `include: ["src/**/*.ts"]` has no test-file exclusion),
and a scoped `npx jest --testPathPatterns=pipelineProposal` run picks up those stale compiled `.test.js`
files too, failing with `SyntaxError: Cannot use import statement outside a module` (an ESM/CJS Jest-config
mismatch, not a code defect) — for *both* the new pipeline-proposal test files and the pre-existing
`write.test.js`/`proposal.test.js`, confirming this is a pre-existing repo-wide hazard for the whole
`helio-mcp` package, not something newly introduced by this ticket. After `rm -rf helio-mcp/dist`, the full
suite passes cleanly (see gates below). No stray files were left behind by the executor.

**Canonical-standard compliance (CONTRIBUTING.md).** DESIGN.md is not binding here (no `frontend/**`
files touched). File-size soft budgets: all three new source files are well under the ~250-line budget
(`pipelineProposal.ts` 169, `pipelineProposalHandlers.ts` 76, `pipelineProposalValidation.ts` 67).
`check:scala-quality`'s mechanical Imports & Qualifiers enforcement is Scala-only and N/A to this
TypeScript-only diff; manually verified no inline-FQN-equivalent smells and no bare `any` anywhere in the
diff (`git diff | grep -w any` matches only prose in comments/tool descriptions, never a type annotation).
Ran `npm run check:schemas` (sync, 38 checked) and `npm run check:openspec` (flags only the expected,
not-yet-archived state at this cycle — not a code issue).

**DRY / readability / modularity.** `jsonResult`/`guarded` are duplicated in `pipelineProposal.ts`
rather than shared — verified this mirrors the exact existing convention already used identically in
`read.ts`, `write.ts`, and `proposal.ts` (all four files now independently declare the same two small
helpers), not new duplication. The `X as PipelineProposalSource`/`err as Error` casts in `pipelineProposal.ts`
mirror `proposal.ts`'s identical `panels as ProposalPanel[]` and `err as Error` casts verbatim — an
established, not new, pattern. Clear three-way separation of concerns (types → pure validation → zod-free
handlers → thin zod/registerTool shell) with no premature abstraction.

**Type safety / error handling / tests.** No untyped escape hatches. `HelioApiError` propagation is
exercised end-to-end in `pipelineProposalHandlers.test.ts` for all three handlers (rejected-promise
propagation, not just happy path). New TS interfaces (`PipelineProposalSource`/`PipelineProposal`/
`PipelineAnalyzeProposalResponse`/`PipelineProposalApplyResponse`) were cross-checked field-by-field
against the backend's `PipelineProposalProtocol.scala`/`PipelineAnalyzeProposalProtocol.scala` and match
exactly (including `source` being optional-and-omitted-when-absent on `PipelineProposalApplyResponse`,
matching spray-json's `Option` → omitted-not-null convention this codebase has hit drift on before).

**No dead code.** No TODO/FIXME/XXX in any new or touched file. No unused imports (confirmed by a clean
`tsc --noEmit` and `eslint --max-warnings=0`, both re-run fresh — see gates).

**Non-blocking suggestion:** `helioApi.ts`'s new `applyPipelineProposal` method body
(`return this.http.post<PipelineProposalApplyResponse>("/api/pipelines/apply-proposal", proposal);`) is a
single long line; Prettier already reformats/accepts it as-is (`format:check` passes), so this is purely
stylistic and not a change request.

**Fresh gate runs performed by this evaluator** (never trusting the executor's own report):
- `npm --prefix helio-mcp run build` → clean, zero errors.
- `npm --prefix helio-mcp run typecheck` (`tsc --noEmit`) → clean, zero errors.
- `npx eslint helio-mcp/src --max-warnings=0` → clean, zero warnings/errors.
- `npx prettier --check helio-mcp/src` → "All matched files use Prettier code style!"
- `rm -rf helio-mcp/dist && npx jest` (full helio-mcp suite, clean dist) → `5 passed, 5 total` test suites,
  `128 passed, 128 total` tests, including the two new `pipelineProposal*.test.ts` files (0 skipped).
- `npm test` (root — jest + `npm --prefix frontend test` per `package.json`) → `5/5` helio-mcp suites
  (128/128 tests) and `148/148` frontend suites (1506/1506 tests), all green. (Frontend wasn't touched by
  this change; run for completeness/no-regression confirmation only.)
- `npm run check:schemas` → in sync.
- `npm run check:openspec` → only the expected "complete but not yet archived" notice (correct at this
  cycle, not a defect).

No `backend/**` files changed — `cd backend && sbt test` correctly not required/run per the trigger rule.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`
(top-level canonical specs dir) files changed. `git diff --name-only main...HEAD` touches only
`helio-mcp/**` and this change's own `openspec/changes/mcp-pipeline-proposal-tools/**` planning docs
(the change-scoped `specs/mcp-pipeline-proposal-tools/spec.md` is not the top-level `openspec/specs/**`
trigger path). No dev servers started; no browser verification performed.

### Overall: PASS

### Non-blocking Suggestions

- `helioApi.ts`'s `applyPipelineProposal` return statement is a slightly long single line; Prettier
  already accepts it, purely stylistic, no action needed.
