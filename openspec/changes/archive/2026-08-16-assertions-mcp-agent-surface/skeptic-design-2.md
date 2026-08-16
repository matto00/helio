## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### Environmental note (non-blocking, but disclosed)

This worktree's `scripts/concertino/` is missing `next-report-number.sh`, `persist-evidence.sh`, and
`emit-event.sh` (present in the primary checkout at the identical commit `adfac767` — confirmed via
`git ls-tree -r HEAD -- scripts/concertino/` in both locations returning the same 6 tracked files, and
`git check-ignore` confirming the whole directory is gitignored/locally-generated, so this worktree's copy
was simply never fully synced). These three scripts are pure, git-resolved, path-parameterized functions
with no dependency on their own install location (read `persist-evidence.sh`/`emit-event.sh` source: both
resolve "main checkout" via `git rev-parse --git-common-dir` off the caller's cwd, which resolves
correctly through a worktree regardless of which copy of the script file is invoked). I invoked the
primary checkout's copies against this worktree's actual paths instead of guessing a fallback filename
myself — `next-report-number.sh` returned `READY number=2
path=.../skeptic-design-2.md`, confirming no collision (only `skeptic-design-1.md` exists in this
change dir). This is disclosed for the record; it did not affect the substance of this review, and I did
not modify anything in the worktree besides this report file.

### What I verified (with evidence)

- **Read all planning artifacts fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-assert-step-authoring/spec.md`, `specs/mcp-assertion-results-grounding/spec.md`,
  `workflow-state.md`. Also read round 1's report (`skeptic-design-1.md`) as a claim to verify, not as
  fact.

- **Round 1's corrected SDK claim (design.md Context + Decision 1) — re-verified independently, and it
  is accurate as far as it goes.** `helio-mcp/package.json`/`package-lock.json` pin
  `@modelcontextprotocol/sdk@1.29.0`; the primary checkout's installed copy matches exactly (confirmed
  via `package.json`'s `version` field). Read `dist/esm/server/mcp.d.ts:150` (`registerTool<...,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>`) and
  `zod-compat.d.ts:3` (`AnySchema = z3.ZodTypeAny | z4.$ZodType`) directly — a full pre-built schema
  instance genuinely is an accepted `inputSchema` type, not only a raw shape. Read the runtime
  (`mcp.js`'s `getZodSchemaObject`/`isZodSchemaInstance`, `validateToolInput`) and confirmed a pre-built
  schema instance is used as-is and validated inside the SDK's own `validateToolInput`, strictly before
  the tool's handler runs. This part of design.md's correction is true.

- **A NEW, more severe, and equally unverified claim in the corrected Decision 1 and Risks section — found
  false by direct, reproduced empirical testing against the real, pinned SDK. This is the basis of my
  REFUTE.**

  Decision 1's stated justification for choosing `inputSchema`-level `superRefine` over handler-level
  validation is: *"Chosen over keeping handler-level validation... because the `inputSchema`-level
  approach is more SDK-idiomatic, requires no custom error formatting, and validates strictly earlier in
  the SDK's own request lifecycle — **with no offsetting cost, since (Decision 1a below) the
  JSON-schema-visibility trade-off is identical either way.**"* The Risks section restates this: *"this is
  inherent to using a Zod refinement for cross-field validation at all, **not a cost specific to the
  `inputSchema`-level placement chosen here**... an MCP client that only introspects the tool's schema
  (never calls it) won't see **the per-kind rule shape** either way."* Both passages assert that switching
  `add_pipeline_step`'s registered `inputSchema` from the current flat raw shape to
  `z.object({pipelineId, type, config}).superRefine(...)` costs nothing beyond "the per-kind assert rule
  shape isn't visible" — implying the base `pipelineId`/`type`/`config` field list stays visible in
  `tools/list` either way.

  **This is false, and I confirmed it two independent ways against the exact pinned SDK + zod (both
  installed via `helio-mcp/package.json`: `@modelcontextprotocol/sdk@1.29.0`, `zod@^3.25.0`, and
  `write.ts:12` confirms the actual import is the classic v3 API — `import { z } from "zod"` — matching
  what I tested):**

  1. **Static trace**: in zod v3 (the version this project imports), `ZodObject.superRefine()` (and
     `.refine()`) returns a `ZodEffects` wrapper, not a `ZodObject`. `ZodEffects` does not expose a
     `.shape` property. The SDK's `normalizeObjectSchema` (`zod-compat.js:79-121`, shared by both
     `tools/list`'s JSON-schema generation path and `validateToolInput`) requires `.shape` to recognize an
     object schema (`if (v3Schema.shape !== undefined) return schema; ... return undefined;`); lacking it,
     `normalizeObjectSchema` returns `undefined` for a `.superRefine()`-wrapped schema.

  2. **Live, reproduced runtime test** (not just source-reading) — I built a minimal script against
     `helio-mcp`'s own installed `zod`, confirming `z.object({...}).superRefine(fn)` really is a
     `ZodEffects` instance with `.shape === undefined`. I then spun up a real `McpServer` (the actual
     pinned SDK class), registered `add_pipeline_step` twice — once with today's flat raw shape, once
     with the exact `z.object({pipelineId, type, config}).superRefine(...)` construction design.md's
     Decision 1 proposes — connected a real `Client` over an `InMemoryTransport`, and called
     `client.listTools()` on each. Results (reproduced 3x for stability):
     - **Today's raw shape**: `tools/list` reports the full, correct schema — `{"type":"object",
       "properties":{"pipelineId":{"type":"string","minLength":1},"type":{"type":"string","minLength":1},
       "config":{"type":"object","additionalProperties":{},"default":{}}},"required":["pipelineId","type"],
       "additionalProperties":false,...}`.
     - **Decision 1's proposed `superRefine` construction**: `tools/list` reports
       `{"type":"object","properties":{}}` — **the entire base field list (`pipelineId`, `type`, `config`)
       and the `required` array vanish, not just the assert-specific per-kind rule shape.**
     I also confirmed (same live harness) that a malformed assert `config` really is rejected before the
     handler runs (the SDK's own `-32602 Input validation error` is returned, the mocked handler is never
     invoked) — so the *functional* validation claim in Decision 1/Context is correct; only the
     JSON-schema-visibility cost-accounting is wrong.

  **Practical consequence**: adopting Decision 1 as written would regress `add_pipeline_step` — one of
  `write.ts`'s most heavily-used, 22-op-kind tools — from a `tools/list` schema that documents its three
  real fields and which are required, down to an empty object schema, for every MCP client that relies on
  structured tool-parameter introspection (a scenario design.md's own Risks section explicitly
  acknowledges exists). That is a materially larger and different cost than "the per-kind assert rule
  shape isn't visible" (true and unavoidable either way, as design.md correctly notes elsewhere) — and
  Decision 1's explicit "no offsetting cost... identical either way" claim, which is the stated reason for
  choosing this over handler-level validation, does not hold.

  I looked for a construction that would preserve both the SDK-native pre-handler validation AND
  `tools/list` field visibility (e.g. some zod v3 API that adds a cross-field check without leaving the
  `ZodObject` class) and did not find one — `.refine()`/`.superRefine()`/`.transform()`/`.preprocess()`
  all return `ZodEffects` in zod v3, and the registered-tool config surface (`registerTool`'s `config`
  object: `title`/`description`/`inputSchema`/`outputSchema`/`annotations`/`_meta`) offers no separate
  hook for "extra validation that runs pre-handler but isn't reflected in/doesn't replace the introspected
  schema." A zod v4 migration might resolve this (v4's checks don't necessarily wrap the object in an
  effects type) but that is clearly out of scope for this ticket and not what design.md proposes.

- **Decision 2 (assert rule shape) — independently re-verified against
  `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala`** (not just trusting round 1's
  citation): six kinds `notNull`/`unique`/`range`/`rowCountMin`/`rowCountMax`/`regex`;
  `requireField`/`SupportedKinds`/`SupportedSeverities` confirm `field` is required for
  notNull/unique/range/regex and intentionally unused for the two `rowCount*` kinds; `severity` is
  `warn`/`error`. Matches design.md exactly.

- **Decision 3/4 (`lastRunAssertions` sourcing) — independently re-verified.** Read
  `PipelineProtocol.scala:56-79`: `AssertionSummary(passed: Int = 0, warnFailed: Int = 0, errorFailed:
  Int = 0, failures: Vector[AssertionFailureDetail] = Vector.empty)` and
  `PipelineRunRecord.assertions: AssertionSummary = AssertionSummary()` — non-optional, zero-valued,
  matching design.md's claims exactly. Read `PipelineRunRepository.scala:159/185/204/214/312`: every
  relevant query is `.sortBy(_.startedAt.desc)`, confirming "first entry = most recent." Read
  `context.ts:1087-1116`'s existing `pipelines.map(async (summary) => {...})` fan-out (with
  `analyzePipeline` in its own try/catch) and `helioApi.ts:279`'s `analyzePipeline` as the "thin
  pass-through" precedent Task 1.2 cites — both real and as described.

- **Scope / acceptance-criteria trace against `ticket.md`** — AC1 (assert step authoring + Zod rejection
  before server call): satisfied by Decision 1/2 regardless of which of inputSchema-level or
  handler-level validation is ultimately chosen (the ticket's literal wording only requires rejection
  "before the server call," not specifically inside the SDK's `validateToolInput`) — so this finding does
  not block AC1, but it does undermine Decision 1's *stated rationale* for its specific implementation
  choice, which is exactly the class of design-soundness defect a design gate exists to catch before it's
  encoded into `tasks.md`/implementation. AC2 (`lastRunAssertions` present, absent/empty) — Decision 4's
  "empty, not omitted" reading is well-justified against this file's own repeated precedent
  (`sampleRows`/`columnStats`/`joinHints`/`metrics`) and the backend's own non-optional convention; a
  reasonable, disclosed interpretation, not scope drift. AC3 (tool descriptions explain trustworthiness) —
  covered by tasks 2.2/3.4 and both spec deltas' second requirement. AC4 (build+tests pass, additive) —
  covered by task 4.3; no capability in "Modified Capabilities" contradicts an existing documented
  contract.

- **No placeholders/TBDs/hand-waving found** in design.md, tasks.md, or either spec delta. Decision 5
  (proposal-based `boundPipelineStepSchema` left untouched) remains explicitly disclosed, not silently
  omitted, and correctly scoped to the ticket's own stated Scope section — consistent with round 1's
  assessment; no new evidence contradicts it.

- **Minor, non-blocking editorial defect**: Decision 1 and the Risks section both reference "(Decision 1a
  below)" — no "Decision 1a" heading exists anywhere in the document (the numbered decisions run 1-5).
  Dangling cross-reference, likely left over from an editing pass; harmless on its own but worth cleaning
  up alongside the substantive fix below.

### Verdict: REFUTE

Decision 1's central cost-benefit claim — that choosing `inputSchema`-level `superRefine` validation over
handler-level validation has "no offsetting cost" because "the JSON-schema-visibility trade-off is
identical either way" — is false, confirmed by directly registering both variants against the real,
pinned `@modelcontextprotocol/sdk@1.29.0` and calling `tools/list` on each (reproduced 3x). The
`inputSchema`-level construction design.md proposes collapses `add_pipeline_step`'s entire introspectable
schema (not just the assert-specific rule shape, but the `pipelineId`/`type`/`config`/`required` fields
every other op already relies on) down to an empty object schema — a real regression from today's
behavior that the design's own risk accounting explicitly (and incorrectly) rules out. This is the same
category of defect round 1 caught (an unverified, false technical claim baked into the architectural
justification) surviving into the very revision meant to correct it — exactly what a cold, independent
second pass is supposed to catch rather than rubber-stamp.

To be clear on scope, as round 1 was: this is not a claim that AC1 as literally worded would fail either
way — handler-level validation (today's flat raw shape + a `safeParse` in the callback) also satisfies
"rejected... before any network call." The problem is that Decision 1's stated reason for preferring the
`inputSchema`-level approach is false, and the honest cost-benefit calculus (validate one step earlier,
inside the SDK's own lifecycle, in exchange for losing all of `add_pipeline_step`'s field-level schema
introspection for every consumer of `tools/list`) was never actually weighed.

### Change Requests

1. **Correct the false "no offsetting cost / identical either way" claim in design.md's Decision 1 and
   Risks section.** Replace with an accurate statement, e.g.: in zod v3 (this project's pinned version —
   `write.ts:12` imports `{ z } from "zod"`, the classic v3 API), `ZodObject.superRefine()` returns a
   `ZodEffects` wrapper that no longer exposes `.shape`; the SDK's `normalizeObjectSchema` (used by both
   `tools/list`'s JSON-schema generation and `validateToolInput`) requires `.shape` to recognize an object
   schema for the `tools/list` path specifically (`validateToolInput` itself still works via its
   `inputObj ?? tool.inputSchema` fallback — only the JSON-schema-listing path is affected). Cite the
   actual evidence: a live `registerTool` + `client.listTools()` comparison shows today's raw shape
   produces `{"type":"object","properties":{"pipelineId":{...},"type":{...},"config":{...}},
   "required":["pipelineId","type"],...}`, while the proposed `superRefine` construction produces
   `{"type":"object","properties":{}}`.

2. **Re-decide Decision 1 on the corrected cost-benefit facts**, choosing one of:
   - **(a) Revert to handler-level validation** (the alternative round 1 offered as 2b, now for the
     *correct* reason): keep `add_pipeline_step`'s registered `inputSchema` as today's flat raw shape
     (preserving full `tools/list` field visibility, consistent with every other `registerTool` call site
     in this file), and validate `config` against `assertConfigSchema` inside the handler callback when
     `type === "assert"`, before calling `api.addPipelineStep(...)` — matching AC1's literal wording
     ("before the server call").
   - **(b) Keep the `inputSchema`-level `superRefine` approach, but only if the design explicitly accepts
     and justifies the now-disclosed cost** — i.e., state plainly that adopting it means
     `add_pipeline_step`'s `tools/list` schema becomes `{"type":"object","properties":{}}` for every MCP
     client (not just "the assert-specific shape is invisible"), and give an affirmative reason this
     tool's base-field introspection loss is acceptable (I did not find one in the ticket's ACs or
     elsewhere in this document, and I believe (a) is the correct choice, but this is the design gate's
     call to make explicitly rather than by omission).
   Either path is acceptable; the current text's false "no cost" framing is not, regardless of which is
   chosen.

3. **Fix the Risks/Trade-offs section to match whichever of (2a)/(2b) is chosen**, replacing "not a cost
   specific to the `inputSchema`-level placement chosen here" with the accurate, larger-scope cost
   identified above if (b) is kept, or removing the now-moot `inputSchema`-level framing entirely if (a)
   is chosen (handler-level validation's only JSON-schema cost is the same narrow one design.md already
   correctly describes: the per-kind rule shape isn't visible — true and unavoidable, and the ONLY cost
   in that path, since the base `pipelineId`/`type`/`config` fields stay fully visible).

4. **Update `tasks.md` task 2.3 to match whichever of (2a)/(2b) design.md settles on.** Currently it
   describes the `inputSchema`-level `superRefine` replacement (matching round 1's fix). If (a) is chosen,
   rewrite it back to describe handler-level `assertConfigSchema.safeParse(config)` inside the tool's
   callback (as round 1's original draft described, but this time for the verified-correct reason —
   preserving `tools/list` introspection — not the false "SDK forbids it" reason of the very first draft).
   If (b) is chosen, task 2.3 needs no structural change, only whatever prose update mirrors design.md's
   corrected justification.

5. **Fix the dangling "(Decision 1a below)" cross-reference** — no such heading exists in the document.
   Minor, but should be cleaned up in the same pass as items 1-4.

### Non-blocking notes

- Round 1's "error-isolation nuance in the `context.ts` fan-out" note (whether the new
  `getPipelineRunHistory` fetch shares `analyzePipeline`'s existing try/catch or gets its own) remains
  unaddressed in design.md, and remains non-blocking for the same reason round 1 gave — a reasonable
  default either way still satisfies the ticket's ACs, but worth a one-line steer to the executor before
  task 3.1 is implemented (independent try/catch, mirroring `analyzePipeline`'s own isolation).
- Decision 5 (proposal-based `boundPipelineStepSchema`/`pipelineProposal.ts` left unvalidated) remains
  correctly scoped and explicitly disclosed — accepted, same as round 1. A spinoff ticket to extend the
  same assert-config validation there remains a reasonable follow-up, not a blocker for HEL-581.
