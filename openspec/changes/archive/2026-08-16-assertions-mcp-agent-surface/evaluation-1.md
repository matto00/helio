## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Checklist:
- [x] All ticket acceptance criteria addressed explicitly (not partial)
  - AC1 (assert step via `add_pipeline_step`, six kinds, both severities, Zod-rejected pre-call):
    confirmed via `helio-mcp/src/tools/assertSchemas.ts`'s `assertRuleSchema`
    (`z.discriminatedUnion("kind", [...])`) + `addPipelineStepHandler`, and independently exercised
    live (see Phase 3) — a well-formed `notNull` rule calls through, a `kind: "bogus"` rule is
    rejected with `isError: true` and the mocked API is never invoked.
  - AC2 (`get_workspace_context` reports per-pipeline latest-run assertion summary, empty when no
    assert step/no runs): confirmed via `context.ts`'s new `getPipelineRunHistory` fan-out +
    `ZERO_ASSERTION_SUMMARY` fallback, `WorkspaceContext.pipelines[].lastRunAssertions` always
    present. AC's literal wording "absent/empty" is explicitly, non-silently reinterpreted as "empty"
    (design.md Decision 4) — see below.
  - AC3 (tool descriptions explain trustworthiness): confirmed in both `write.ts`'s `add_pipeline_step`
    description (assert op's shape + rationale) and `read.ts`'s `get_workspace_context` description
    ("the trustworthiness signal for whether that pipeline's MOST RECENT run's data can be trusted").
  - AC4 (build + tests pass, additive): confirmed by independent re-run (Phase 2) — `tsc --noEmit`
    clean, 186/186 Jest tests pass; diff is additive-only (no removed/renamed fields).
- [x] No AC silently reinterpreted — AC2's "absent/empty" → "always-present, zero-valued" reading is
  explicitly argued in design.md Decision 4 (citing this file's own `sampleRows`/`columnStats`/
  `joinHints`/`metrics` "ALWAYS present" convention and the backend's own non-optional
  `AssertionSummary` default), not a quiet substitution.
- [x] All task items marked done and matching what was implemented — verified each of tasks.md's 12
  items (1.1/1.2/2.1-2.3/3.1-3.4/4.1-4.3) against the diff; all present and matching.
- [x] No unnecessary changes outside ticket scope — diff touches exactly the 8 `helio-mcp/src/**`
  files files-modified.md names, plus planning artifacts. No backend/frontend changes (confirmed —
  ticket correctly says none needed since HEL-454/509/570/576 already shipped the backing endpoints).
  Design.md Decision 5 explicitly declines to touch `boundPipelineStepSchema`/`pipelineProposal.ts` or
  `update_pipeline_step` (disclosed, not silently skipped) — diff confirms neither file is touched.
- [x] No regressions to existing behavior covered by other specs — full helio-mcp Jest suite (186
  tests, 8 suites, all pre-existing suites included) passes; the one pre-existing fixture updated
  (`applyBudget` tier-0 test in `context.test.ts`) was updated only because it now needs the new
  required `lastRunAssertions` field, not because behavior changed.
- [x] API contracts / schemas updated if the change affects them — N/A, no backend/schema changes;
      `npm run check:schemas` reports clean (59 protocol files, 7 panel-type-enum surfaces).
- [x] Planning artifacts reflect the final implemented behavior — design.md/tasks.md/spec deltas match
  the diff precisely, including the two wording-level inaccuracies skeptic-design-3.md flagged as
  non-blocking (false "existing `lastRunStatus` explanation" premise; `restAuthSchema` cited as an
  exportable-schema precedent when it's function-local) — both are already corrected in the final
  tasks.md/spec.md text I read (no "alongside the existing lastRunStatus explanation" phrasing remains
  anywhere; task 2.1 now correctly cites `boundPipelineStepSchema`/`computedFieldSchema` and explicitly
  disclaims `restAuthSchema`).

Design-gate round-2 regression re-verified as genuinely avoided (not just avoided in prose): see Phase 2.

### Phase 2: Code Review — PASS

**Gates re-run myself** (fresh evidence, in `WORKTREE_PATH`; `CLEAN_WORKTREE` was not set — `slow` speed
did not apply):
- `npm run lint` → clean (`eslint . --max-warnings=0`, no output/errors)
- `npm run format:check` → "All matched files use Prettier code style!"
- `helio-mcp && npx tsc --noEmit` → clean, no output
- `npx jest --testPathPatterns=helio-mcp` (root jest; `frontend/` is excluded by
  `testPathIgnorePatterns` and no frontend files changed) → **8 suites / 186 tests, all passing** —
  matches the executor's reported 186/186 exactly
- `npm run check:schemas` → clean (no schema drift; expected, since no backend/schema files changed)
- `npm run check:openspec` → reproduced the exact failure the executor's commit message cites: "change
  'assertions-mcp-agent-surface' is complete (12/12) but not archived" — confirms the `git commit -n`
  bypass account is accurate, not a hand-wave. This mirrors HEL-576's identical, already-merged
  precedent (`308a4c8a`), which used the same bypass for the same reason.

Neither `frontend/**` nor `backend/**` gate triggers technically match (all changed source is under
`helio-mcp/**`, a separate TS project) — I ran the closest applicable JS/TS gates (root ESLint/Prettier,
which do cover `helio-mcp/**`; the package's own `tsc` build; root Jest, which picks up `helio-mcp`'s
test files) rather than skip verification.

**Round-2 design regression independently re-verified (not trusted from design.md's/skeptic's prose)**:
registered `add_pipeline_step` live against the real `McpServer` + `InMemoryTransport` and called
`client.listTools()` — the tool's `inputSchema` in `tools/list` output is the full flat shape
(`pipelineId`/`type`/`config` with `required: [pipelineId, type]`), **not** collapsed to
`{"type":"object","properties":{}}`. Confirms Decision 1's `superRefine`-collapse regression is
genuinely avoided in the shipped code, not merely narrated as avoided. Full output in Phase 3.

**helio-mcp/node_modules debugging account, independently verified (not taken at face value)**:
- `scripts/concertino/.concertino.env`'s `CONCERTINO_LINK_MODULES='frontend/node_modules'` — confirms
  `helio-mcp/node_modules` is genuinely NOT provisioned by `setup-worktree.sh`'s hardlink/npm-ci step,
  which only covers the module dirs named in that variable. This is a real, structural gap that would
  explain a from-scratch worktree missing `helio-mcp/node_modules`.
- `helio-mcp/node_modules` exists now, with an mtime (`Aug 16 03:33`) *after* `package-lock.json`'s
  mtime (`Aug 16 03:20`) — consistent with `npm ci` having run post-checkout, not a stale artifact.
- `git status --short` on `helio-mcp/package.json`/`package-lock.json` is clean — consistent with a
  plain `npm ci` (no new dependency added), matching the ticket's stated scope (no new deps needed).
- Together this corroborates the executor's account: a genuinely missing `helio-mcp/node_modules` in
  this worktree, fixed by `npm ci` (not something else).

**Canonical standards compliance (CONTRIBUTING.md)**:
- Imports & Qualifiers rule is Scala-specific (`check:scala-quality`, mechanically enforced only for
  `com.helio.*`/`spray.json.*`/etc. FQNs) — N/A, no Scala files touched.
- File-size soft budgets (~250/~400 lines, informational only): the new `assertSchemas.ts` is 111 lines,
  well within budget, and was deliberately split out (matching `metricSchemas.ts`/`updateSchemas.ts`/
  `pipelineProposalHandlers.ts` precedent) specifically to keep `write.test.ts`'s import surface narrow
  — good decomposition, not budget creep. The larger touched files (`context.ts` 1269, `write.ts` 1146,
  `types.ts` 793, `helioApi.ts` 977) were already well over any soft budget pre-existing this ticket;
  this diff's additions to each are modest, additive, and follow each file's own established per-op /
  per-field pattern rather than compounding disorganization.
- Type safety: no `any`/untyped escape hatches anywhere in the diff (checked all 8 changed
  `helio-mcp/src/**` files).
- DRY: `assertConfigSchema.safeParse` reused as the single validation entry point;
  `ZERO_ASSERTION_SUMMARY` is one shared constant reused across the zero-valued paths (no-assert-step,
  no-runs, run-history-fetch-failure) rather than three separate literals.
- Error handling: the new `getPipelineRunHistory` fetch has its OWN independent `try/catch`, verified
  both by reading the diff and by two dedicated tests
  (`context.test.ts` — a `getPipelineRunHistory` failure leaves `steps`/`stepsError` untouched, and the
  reverse direction, an `analyzePipeline` failure leaves `lastRunAssertions` untouched) — this is exactly
  design.md Decision 3's requirement and the design gate's own repeatedly-raised non-blocking steer,
  correctly landed, not merely asserted.
- Tests meaningful: `write.test.ts`'s new suite exercises the real `addPipelineStepHandler` function
  (not a mock of it) against a fake `HelioApi`, asserting the mock was never called on rejection — this
  would catch a real regression (e.g. accidentally calling the API before validating, or loosening the
  discriminated union). `context.test.ts`'s new suite drives `buildWorkspaceContext` end-to-end with a
  fake API, not the internal helper functions — also regression-catching, not implementation-testing.
- No dead code: `eslint --max-warnings=0` (which includes unused-var/import checks) passed clean.
- No over-engineering: handler-level validation (not a `z.discriminatedUnion` covering all 22 op kinds)
  is the narrowest fix satisfying AC1; explicitly justified as such in design.md.
- Behavior-preserving where expected: `context.ts`'s existing `analyzePipeline` try/catch logic is moved
  into its own `async` IIFE inside the new `Promise.all`, not rewritten — same catch/fallback behavior,
  confirmed identical field-by-field in the diff.

One test-comment citation is imprecise (non-blocking): `write.test.ts`'s last `range`-rule test cites
"design.md Decision 6's 'no shape validation of params' scope line" with a bare "design.md" — this
ticket's own `design.md` only has Decisions 1-5; the cited Decision 6 ("No `params` shape validation in
`inferAssert`") is actually from the archived HEL-454 change's `design.md`
(`openspec/changes/archive/2026-08-16-assert-pipeline-step/design.md`). The substance is correct (the
backend genuinely doesn't validate `range`'s `min`/`max` presence), but the bare "design.md" reference is
ambiguous within this ticket's own artifact set.

### Phase 3: UI Review — N/A (confirmed explicitly, not skipped silently)

This ticket touches only `helio-mcp/**` (a separate TypeScript MCP-server project) plus
`openspec/changes/**` planning artifacts. None of Phase 3's triggers (`frontend/**`,
`backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) match — no
`frontend/`, backend Scala, `schemas/`, or `openspec/specs/` (only `openspec/changes/`) files changed.
Playwright/dev-server review does not apply. In its place, gave equivalent rigor by directly exercising
both new/changed MCP tools live, in-process, against the real SDK (`McpServer` + `InMemoryTransport` +
`Client`, real `zod@3.25.76`/`@modelcontextprotocol/sdk@1.29.0`, fake `HelioApi` mirroring the existing
test-harness pattern):

1. **`tools/list` schema-collapse check (round-2 regression)** — `add_pipeline_step`'s registered
   `inputSchema` in the live `tools/list` response:
   ```json
   {
     "type": "object",
     "properties": {
       "pipelineId": { "type": "string", "minLength": 1 },
       "type": { "type": "string", "minLength": 1 },
       "config": { "type": "object", "additionalProperties": {}, "default": {} }
     },
     "required": ["pipelineId", "type"],
     "additionalProperties": false
   }
   ```
   Full field visibility — NOT collapsed to `{"type":"object","properties":{}}`. Confirms the round-2
   regression design.md documents finding-and-reverting is genuinely absent from the shipped tool.

2. **`get_workspace_context` description** — live `tools/list` description text contains
   `"lastRunAssertions"` (`true` on a substring check) with the trustworthiness framing AC3 asks for.

3. **`add_pipeline_step` called with a well-formed `assert` config** (`notNull`, `field: "email"`) —
   succeeded, called through to the fake `addPipelineStep` exactly once with the config unchanged, and
   returned the fake's response.

4. **`add_pipeline_step` called with a malformed `assert` config** (`kind: "bogus"`) — returned
   `isError: true` with a Zod-derived message (`"Invalid assert step config: rules.0.kind: Invalid
   discriminator value..."`), and the fake API's call log was UNCHANGED from the prior step (i.e. never
   invoked for the invalid call) — directly confirms AC1's "rejected... before the server call."

5. **`get_workspace_context` called** with a fake `getPipelineRunHistory` returning one run with a
   real `assertions` summary (1 error failure) — the tool's JSON response's
   `pipelines[0].lastRunAssertions` matched that summary exactly (`passed: 4, warnFailed: 0,
   errorFailed: 1, failures: [...]`).

No console errors / exceptions during any of the above; the ad hoc verification script was written to
`helio-mcp/tmp-eval-exercise-mcp.ts` for execution and deleted immediately after (confirmed via
`git status --short helio-mcp/` showing no changes) — no code was left behind or committed.

Also ran the two new Jest suites in isolation and read them closely: `write.test.ts`'s new
`addPipelineStepHandler` describe block (13 tests: one per v1 rule kind well-formed, mixed-kind
multi-rule, 4 rejection cases, a `.strict()` extra-key rejection, an empty-rules-array acceptance, and a
non-assert-type pass-through) and `context.test.ts`'s new `lastRunAssertions wiring` describe block (5
tests: most-recent-first selection with an older entry present to prove it's ignored, zero-valued for no
assert steps, zero-valued for no runs, and the two independent-try/catch isolation directions) — both
exercise `buildWorkspaceContext`/`addPipelineStepHandler` end-to-end against fake API objects, not
internal implementation details; each would fail on a real regression (e.g. if the try/catch sharing bug
design.md warns against were reintroduced, the isolation tests would catch it).

### Overall: PASS

### Non-blocking Suggestions
- `helio-mcp/src/tools/write.test.ts`'s "accepts a range rule with neither min nor max set" test cites
  "design.md Decision 6" bare — clarify as "HEL-454 design.md Decision 6" (the archived change), since
  this ticket's own design.md only has Decisions 1-5 and the bare reference is ambiguous in-context.
- (Already resolved by the time of this review, noted for completeness) skeptic-design-3.md's two
  round-3 non-blocking notes — the false "alongside the existing `lastRunStatus` explanation" premise
  and the `restAuthSchema` mis-citation in tasks.md task 2.1 — are both already corrected in the
  planning artifacts as delivered; no further action needed.
