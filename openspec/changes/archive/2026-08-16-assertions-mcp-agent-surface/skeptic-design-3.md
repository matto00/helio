## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### Environmental note (non-blocking, but disclosed)
`scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` were missing from
this worktree's `scripts/concertino/` (only `assert-phase.sh`/`cleanup.sh`/`setup-worktree.sh`/
`start-servers.sh` were present — `scripts/concertino/` is gitignored infra, and this worktree's bootstrap
copy predates these three scripts' addition to the main checkout). Copied unmodified from
`/home/matt/Development/helio/scripts/concertino/` (verified self-contained — `next-report-number.sh` has
no external sourcing; `emit-event.sh`/`persist-evidence.sh` source `.concertino.env`, which was already
present and `diff`-identical to main's copy) so this report could be numbered/persisted/emitted through
the prescribed mechanism rather than guessing a fallback path. This is a worktree-provisioning gap in
Concertino's own tooling, unrelated to HEL-581's design.

### What I verified (with evidence)

**Round-3 brief's specific ask — no stale `superRefine`/inputSchema-level references left behind.**
`grep -n "superRefine" design.md tasks.md` — every one of the 9 hits (design.md Context + Decision 1 +
Risks/Trade-offs + Planner Notes; tasks.md task 2.3) is framed in explicit past tense as a rejected,
reverted draft ("tried and reverted," "found broken," "the resulting superRefine-based fix was itself
found broken"). None is a live instruction to implement it. `add_pipeline_step`'s `inputSchema` in
design.md/tasks.md is consistently described as staying today's flat raw shape, unchanged. Clean.

**Independently re-verified the round-2 technical finding this round's Decision 1 rests on** (not just
re-read the citation — reproduced it live against the actual pinned deps):
- `helio-mcp/package.json` pins `zod: ^3.25.0`, `@modelcontextprotocol/sdk: ^1.29.0`; the installed
  versions (checked via the main checkout's `node_modules`, since this worktree has none) are exactly
  `zod@3.25.76` / `sdk@1.29.0` — the same versions design.md cites.
- Ran a real script (`node`, from within `helio-mcp/`) proving `z.object({...}).superRefine(fn)` returns a
  `ZodEffects` instance with `.shape === undefined`, vs. the base `z.object({...}).shape` which exists.
  Matches design.md's claim about zod v3 exactly.
- Registered `add_pipeline_step` twice against the real SDK (`McpServer` + `InMemoryTransport` +
  `client.listTools()`) — once with today's raw shape, once with a `superRefine`-wrapped instance. The
  raw-shape registration's `tools/list` entry lists `pipelineId`/`type`/`config` + `required: [pipelineId,
  type]`; the `superRefine` registration's entry collapses to `{"type":"object","properties":{}}`. This is
  the exact live reproduction design.md's Decision 1 cites — confirmed independently, not trusted from the
  prior round's narrative. Decision 1's reversion to handler-level validation is technically sound.

**Backend ground truth for Decision 2 (assert rule shape) and Decision 3 (run-history source), checked
against real code, not re-derived from design.md's own citations:**
- `backend/.../AssertStep.scala`: six kinds (`notNull`/`unique`/`range`/`rowCountMin`/`rowCountMax`/
  `regex`), `field` required via `requireField` for notNull/unique/range/regex, intentionally unused for
  rowCountMin/rowCountMax, `severity` checked against `["warn","error"]` — matches Decision 2 exactly.
- `backend/.../PipelineProtocol.scala`: `AssertionSummary(passed, warnFailed, errorFailed, failures:
  Vector[AssertionFailureDetail])`, `AssertionFailureDetail(kind, field: Option[String], severity,
  message: Option[String])`, `PipelineRunRecord.assertions: AssertionSummary = AssertionSummary()`
  (non-optional, zero-valued default) — matches design.md's Context/Decision 2/Decision 4 claims exactly.
- `backend/.../PipelineRunRepository.scala:210-216`: `listByPipelineInternal` is
  `.sortBy(_.startedAt.desc)` — confirms "most-recent entry first" (Decision 3) is real, not assumed.
- `PipelineRunHistoryRoutes.scala` confirms `GET /api/pipelines/:id/run-history` is the real, existing
  route design.md names (no new backend work needed, matching the ticket's own claim).

**helio-mcp ground truth for the plan's file-level claims:**
- `context.ts`'s per-pipeline fan-out (`pipelines.map(async (summary) => {...})` inside `Promise.all`,
  lines 1087-1116) exists exactly as described, including `analyzePipeline`'s own independent try/catch
  (lines 1101-1114) — the precedent Decision 3/task 3.1 says to mirror for the new run-history fetch's
  own independent try/catch. The file's repeated "ALWAYS present, never omitted" convention
  (`sampleRows`/`columnStats`/`joinHints`/`metrics`, lines 963-1030) is real and directly supports
  Decision 4's reading of AC2.
- `write.ts`: `add_pipeline_step`'s current `inputSchema` (`pipelineId`/`type`/`config: z.record(...)
  .default({})`) and description (lines 194-282) confirmed to NOT currently document the `assert` op at
  all — task 2.2's plan to add it is a real gap, not busywork. `boundPipelineStepSchema` (line 39) is
  confirmed exported at module scope with a comment explaining exactly why (a function-local `const`
  cannot carry `export`) — this is Decision 5's cited precedent and is accurate.
- `types.ts`/`helioApi.ts`: no `PipelineRunRecord`-equivalent response type or `getPipelineRunHistory`
  method exists yet — tasks 1.1/1.2 are genuinely additive, not duplicative. `analyzePipeline`'s
  thin-pass-through style (helioApi.ts:279-281) is the real precedent task 1.2 says to mirror.
- `AssertRule`'s exact per-kind shape (from AssertStep.scala) and `AssertionSummary`'s exact fields (from
  PipelineProtocol.scala) both trace 1:1 into the two spec deltas' scenarios — every acceptance scenario
  in both `specs/*/spec.md` files is independently traceable to real backend behavior already shipped.

**Two concrete, verified inaccuracies found (both new to this round, neither raised in rounds 1-2), both
minor/cosmetic — not architecture-level, and neither contradicts a tested acceptance scenario:**
1. Design.md's Decision (get_workspace_context description update), tasks.md task 3.4, and the
   `mcp-assertion-results-grounding` spec delta's second requirement all say to explain
   `lastRunAssertions` "alongside the existing `lastRunStatus` explanation." I read
   `helio-mcp/src/tools/read.ts:272-296` (the actual `get_workspace_context` tool description) and
   `helio-mcp/src/index.ts:40-51` (the `workspace-context` resource description) in full — neither
   currently mentions `lastRunStatus` anywhere. There is no "existing... explanation" to place anything
   "alongside." This doesn't block the actual AC (ticket AC3 / the spec's own tested scenario just needs a
   trustworthiness explanation to exist, which is trivially achievable regardless), and it's inert
   descriptive framing rather than an enforced/tested requirement clause — but it's a factually false
   premise, the exact class of thing this design gate's first two rounds exist to catch, now baked into
   three artifacts including the binding spec delta text.
2. tasks.md task 2.1 cites `restAuthSchema` alongside `computedFieldSchema` as parallel examples of "where
   ... schemas already live," to guide where the new (per Decision 2, must-be-`export`ed)
   `assertRuleSchema`/`assertConfigSchema` should go. I confirmed `restAuthSchema` (write.ts:107) is
   declared *inside* `registerWriteTools` (function-local) and is never exported — it structurally
   cannot be (`export` is illegal on a function-local `const`), which is the exact pitfall `write.ts`'s
   own comment on `boundPipelineStepSchema` (lines 30-38) documents having already been hit once in this
   file. `computedFieldSchema`, by contrast, genuinely is exported (from a separate module,
   `updateSchemas.ts`). Citing the two as equivalent precedents is imprecise; `boundPipelineStepSchema`
   (module-scope, exported, in this same file) is the correct analog for what Decision 2 asks for. Low
   real risk — the correct pattern is directly visible a few lines above `registerWriteTools` in the same
   file, and a wrong attempt would fail `tsc` immediately (task 4.3), self-correcting within the same
   execution cycle rather than silently shipping wrong.

**One further, genuinely non-blocking observation (same category as Decision 5, not previously named):**
Decision 5 explicitly discloses `boundPipelineStepSchema`/`pipelineProposal.ts` as an out-of-scope sibling
gap (assert configs added via `create_bound_panel`/`apply_proposal` stay unvalidated). It doesn't mention
`update_pipeline_step` (write.ts:939-967), which lets an agent PATCH an *existing* step's `config`
(including one already created as `assert` via the now-validated `add_pipeline_step`) via the same
unvalidated `config: z.record(z.unknown()).optional()`, with no type-specific check either before or after
this ticket. This is at least as close a sibling as the one Decision 5 already names (arguably closer — it
edits the very steps this ticket's `add_pipeline_step` creates), but the ticket's own Scope/AC1 name only
"add," so it's out of scope the same way Decision 5's is. Worth naming explicitly for the design's own
stated completeness bar, but not a blocker.

### Verdict: CONFIRM

The core architecture (Decisions 1-5) is sound, and — critically for a round that inherits two prior
false-claim corrections — I re-verified the load-bearing technical claims myself against the real pinned
SDK/zod and the real backend code rather than trusting design.md's or the prior rounds' narration: the
`superRefine`/`tools/list` finding reproduces live, the six assert-rule kinds and their field requirements
match `AssertStep.scala` exactly, `AssertionSummary`'s shape and the run-history endpoint's sort order
match the backend exactly, and every file-level claim about helio-mcp's current structure (fan-out
pattern, existing schema locations, absence of a `PipelineRunRecord`-equivalent type) checks out against
the real source. The two inaccuracies found above are wording-level (a false "existing lastRunStatus
explanation" premise in explanatory/spec text, and an imprecise same-file schema-location citation) — cosmetic corrections a competent implementer would very likely self-correct from adjacent code/context, neither blocks any tested acceptance scenario, and both are cheap, non-architectural fixes. Given the explicit "minor nits → non-blocking notes" guidance, these belong there rather than forcing a fourth design round.

### Non-blocking notes

1. Fix the false "alongside the existing `lastRunStatus` explanation" framing in design.md (the
   `get_workspace_context` decision text), tasks.md task 3.4, and the `mcp-assertion-results-grounding`
   spec delta's second requirement — there is no existing `lastRunStatus` mention in either
   `get_workspace_context`'s tool description or the `workspace-context` resource description today.
   Reword to just "add an explanation of `lastRunAssertions` as the trustworthiness signal" (optionally:
   "and of `lastRunStatus`, which the description does not currently explain either").
2. In tasks.md task 2.1, replace the `restAuthSchema` citation with `boundPipelineStepSchema` as the
   precedent for where an *exported* schema belongs in `write.ts` — `restAuthSchema` is function-local
   and cannot be exported (see `write.ts:30-38`'s own comment on this exact pitfall).
3. Consider having design.md name `update_pipeline_step` (write.ts:939-967) alongside Decision 5's
   `boundPipelineStepSchema` disclosure as a second, out-of-scope sibling gap for assert-config
   validation — it lets an agent overwrite an existing assert step's `config` with no type-specific check,
   before or after this ticket, and is at least as close a sibling as the one already named. Not a
   blocker; the ticket's Scope/AC1 name only `add_pipeline_step`, same reasoning that scopes out Decision
   5's gap.
4. Decision 2's phrasing for `notNull`/`unique`'s `params` field ("modeled as `params: z.object({}).strict()`
   or simply omitted from that variant's shape") leaves an open either/or for the implementer. Both satisfy
   AC1's literal scenario (`params: {}` present for a `notNull` rule), so this isn't blocking, but picking
   one explicitly would remove a small, avoidable ambiguity before task 2.1 is implemented.
