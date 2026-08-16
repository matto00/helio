## Context

`add_pipeline_step`'s registered tool (`helio-mcp/src/tools/write.ts`) has `inputSchema: { pipelineId:
z.string().min(1), type: z.string().min(1), config: z.record(z.unknown()).default({}) }` — a flat,
per-op-agnostic "raw shape." Every one of the 21 currently-documented op kinds (rename through lookup)
is validated only by PROSE in the tool's `description` string; `config` itself accepts any object,
regardless of `type`'s value. `z.discriminatedUnion` IS used elsewhere in this exact file
(`restAuthSchema`, `create_rest_data_source`), but always as ONE nested field's type within an
otherwise-flat shape — every one of `write.ts`'s 20+ `registerTool` call sites, `add_pipeline_step`
included, uses the flat raw-shape form for `inputSchema` today; none currently passes a full pre-built
schema instance in its place. That is a fact about today's code, not a platform limit: the pinned
`@modelcontextprotocol/sdk@1.29.0` (`helio-mcp/package.json`/`package-lock.json`) types `registerTool`'s
`inputSchema` as `InputArgs extends undefined | ZodRawShapeCompat | AnySchema` (`mcp.d.ts:150`,
`AnySchema = z3.ZodTypeAny | z4.$ZodType` per `zod-compat.d.ts:3`) — a full schema instance, including a
`.superRefine()`-augmented `z.object(...)`, is an explicitly supported alternative to a raw shape, both
in the types and at runtime (`mcp.js`'s `getZodSchemaObject`/`isZodSchemaInstance`, which detects and
uses a pre-built schema instance as-is; `validateToolInput` runs it *before* the tool's handler callback
executes at all). This corrects an earlier, unverified draft of this document, which claimed the SDK
"does not accept" a pre-built schema in place of the raw shape — found false at the design gate's first
round (checked directly against the pinned SDK's type declarations and runtime, not assumed).

`WorkspaceContext.pipelines[]` (`helio-mcp/src/context.ts`) already fans out one `api.analyzePipeline(id)`
call per pipeline inside a `Promise.all`-driven `pipelines.map(...)`, merging the result into each
pipeline's summary. Several other fields in this same interface (`sampleRows`, `columnStats`,
`joinHints`, `metrics`) are explicitly documented "ALWAYS present ([]/{}, never omitted)" — an existing,
repeated convention this file enforces for exactly this "maybe nothing" shape of data.

HEL-576 already added `assertions: AssertionSummary` (non-optional, zero-valued when absent) to the
backend's `PipelineRunRecord`, returned by `GET /api/pipelines/:id/run-history` sorted most-recent-first
— no new backend work is needed for the grounding half of this ticket.

## Goals / Non-Goals

**Goals:**
- An agent can add a well-formed `assert` step via `add_pipeline_step`, with malformed rule shapes
  rejected by Zod before any network call.
- `get_workspace_context` reports each pipeline's latest-run assertion trustworthiness signal.

**Non-Goals:**
- Restructuring `add_pipeline_step`'s top-level `inputSchema` for all 22 op kinds.
- Touching `boundPipelineStepSchema`/`pipelineProposal.ts`'s parallel step schema (used by
  `create_bound_panel`/proposal-based flows) — named explicitly below as a real, adjacent gap this
  ticket does not close, since the ticket's own Scope section names only `add_pipeline_step`.

## Decisions

**1. Assert-config Zod validation happens inside `add_pipeline_step`'s HANDLER; `inputSchema` stays
today's flat raw shape, unchanged — reverted back from an intermediate `inputSchema`-level `superRefine`
draft, found broken at the design gate's second round.** The SDK genuinely supports a full pre-built
schema instance as `inputSchema` in place of a raw shape (Context section, verified at round 1) — but
adopting that for `add_pipeline_step` specifically via `z.object({pipelineId, type,
config}).superRefine(...)` was tried at round 1 and found, at round 2, to break `tools/list`'s JSON-schema
generation entirely: in zod v3 (this project's pinned version — `write.ts` imports the classic `{ z }
from "zod"` API), `ZodObject.superRefine()`/`.refine()` return a `ZodEffects` wrapper that no longer
exposes `.shape`, which the SDK's `normalizeObjectSchema` (`zod-compat.js`) requires to recognize an
object schema for `tools/list` specifically. Verified live against the real, pinned SDK: registering
`add_pipeline_step` with today's raw shape produces a `tools/list` entry listing all three real fields
(`pipelineId`/`type`/`config`) and `required`; registering it with the `superRefine` construction instead
collapses that to `{"type":"object","properties":{}}` — losing introspection of the base fields every
other MCP client relies on, not just the assert-specific rule shape. `validateToolInput` itself still
works via its `inputObj ?? tool.inputSchema` fallback (so the *functional* rejection-before-handler claim
was and remains correct), but the tool's own advertised schema would regress for everyone. No zod v3
construction preserves both pre-handler cross-field validation AND `tools/list` field visibility
(`.refine()`/`.superRefine()`/`.transform()`/`.preprocess()` all return `ZodEffects`), and
`registerTool`'s config surface has no separate hook for "extra validation, not reflected in the
introspected schema." Given that, handler-level validation is the correct choice — not because the SDK
"forbids" `inputSchema`-level validation (it doesn't), but because the only zod-v3-native way to attach
it there breaks a real, currently-working capability (`tools/list` field introspection) for no
compensating benefit, since AC1's literal requirement ("rejected... before the server call") is already
satisfied by a handler-level check. Implementation: `const parsed = type === "assert" ?
assertConfigSchema.safeParse(config) : undefined; if (parsed && !parsed.success) return <formatted Zod
error, isError: true>;` before calling `api.addPipelineStep(...)` — matching the file's existing
`guarded()`-error-result convention. A `z.union`-based `inputSchema` (one strict-assert arm, one
generic-fallback arm) remains rejected for the reason already established: Zod's union accepts the first
matching arm, so a malformed assert config would simply fall through to the permissive
`z.record(z.unknown())` fallback rather than being rejected. A `z.discriminatedUnion` covering all 22
literal `type` values (one arm per op) remains rejected as disproportionate scope for validating one op.

**2. The assert rule schema, `assertRuleSchema`, is a `z.discriminatedUnion("kind", [...six
variants...])`, exported alongside a wrapping `assertConfigSchema = z.object({ rules:
z.array(assertRuleSchema) })`.** Each variant encodes exactly HEL-454's own six v1 kinds and their
field/param requirements (verified against `AssertStep.scala`/`AssertRule`, not re-derived): `notNull`/
`unique` (`field: z.string().min(1)`, `params: z.object({}).strict()` — explicitly rejecting extra keys,
picked over silently allowing/ignoring stray params, since rejecting a malformed shape outright is this
whole schema's purpose); `range` (`field` required, `params: {min?: number, max?: number}`);
`rowCountMin`/`rowCountMax` (`field` intentionally ABSENT from these two variants' shape — matching
HEL-454 design.md Decision 4's field-requiring split, `params: {count: number}`); `regex` (`field`
required, `params: {pattern: string}`). `severity: z.enum(["warn", "error"])` on every variant.

**3. `lastRunAssertions` is sourced from `GET /api/pipelines/:id/run-history`'s first (most-recent)
entry, fetched in `Promise.all` alongside the existing `analyzePipeline` call inside `context.ts`'s
per-pipeline fan-out** — mirroring `getPipelineRunHistory`'s addition to `helioApi.ts` exactly the way
`analyzePipeline`/`getPipeline` are already structured there. The ticket's own text says "sourced from
the 419-B run-history summary," naming this endpoint specifically (not HEL-576's narrower
`GET /api/types/:id/assertion-status`, which returns only a boolean + count, not the richer
passed/warnFailed/errorFailed/failing-messages shape this ticket's AC1 asks for) — followed literally.
The new `getPipelineRunHistory` fetch gets its OWN try/catch, independent of `analyzePipeline`'s existing
one (raised as a non-blocking steer at both design-gate rounds 1 and 2, folded in here) — if it shares
`analyzePipeline`'s try/catch, a run-history-specific failure would also blank out `steps` and produce a
misleading `stepsError`; isolated failure domains mean a run-history fetch failure degrades only
`lastRunAssertions` (to the zero-valued summary, Decision 4) without affecting `steps`/`stepsError`.

**4. `lastRunAssertions` is ALWAYS present, zero-valued when there is no assert step or no runs — not
omitted or `null`.** Mirrors both this file's own repeated "ALWAYS present, never omitted" convention
(`sampleRows`/`columnStats`/`joinHints`/`metrics`) and the backend's own `AssertionSummary` convention
(HEL-576 Decision 1, itself already non-optional/zero-valued). The ticket's AC2 says "absent/empty" —
read here as "empty" (a zero-valued object), the reading consistent with every sibling field in this
same interface, not "the key itself is omitted from the JSON," which would be the one inconsistent
field in this interface.

**5. `boundPipelineStepSchema`/`pipelineProposal.ts`'s parallel step-config schema is NOT touched by
this ticket.** `write.ts` exports a second, structurally-identical `{type, config}` schema used by
proposal-based flows (`create_bound_panel`, `apply_proposal`'s pipeline steps). An agent adding an
`assert` step via one of THOSE tools would get the same today's-existing generic, unvalidated
`config: z.record(z.unknown())` behavior this ticket doesn't touch — a real, adjacent gap, but the
ticket's own Scope section names only `add_pipeline_step` explicitly, and extending coverage there was
not requested. Named here explicitly (not silently left out) so the design-gate skeptic can decide
whether this needs escalating, matching this epic's own established pattern (HEL-570's design gate
found and fixed exactly this class of "found a sibling gap the ticket didn't name" issue). A second,
equally out-of-scope sibling gap, named for the same reason (found at the design gate's third round):
`update_pipeline_step` (`write.ts`) lets an agent overwrite an EXISTING assert step's `config` with the
same unvalidated `z.record(z.unknown())` — before or independent of this ticket. Both gaps are accepted
as out of scope on the same grounds: the ticket's own Scope/AC1 name only `add_pipeline_step`.

## Risks / Trade-offs

- [Handler-level validation (Decision 1) means the assert-specific rule shape never appears in the SDK's
  auto-generated `tools/list` JSON-schema output — only the base `pipelineId`/`type`/`config` fields do]
  → the narrower, correctly-scoped version of a trade-off two earlier drafts of this section
  mischaracterized (first as unique to handler-level placement, then as costless to relocate to
  `inputSchema`-level via `superRefine` — both corrected across design-gate rounds 1-2). This is the
  ONLY JSON-schema cost of the chosen approach: the base fields stay fully visible (unlike the rejected
  `superRefine` alternative, which lost those too), and only the per-kind assert rule shape is
  undiscoverable via schema introspection alone. Mitigated by a thorough description string, matching
  every other op's existing documentation-only precedent for its own config shape.
- [`lastRunAssertions` fetch adds one more per-pipeline API call to an already-fanned-out loop] →
  bounded exactly the same way `analyzePipeline`'s existing fan-out already is (one call per pipeline,
  `Promise.all`'d concurrently) — no new scaling concern beyond what already exists in this file.

## Planner Notes

- Self-approved Decisions 2-4 — each resolves an ambiguity the ticket left open (which endpoint to
  source `lastRunAssertions` from, whether it's omitted-vs-zero-valued, error-isolation in the fan-out),
  grounded in the actual codebase precedent traced in Context, not invented from scratch. Decision 1 went
  through two design-gate corrections: round 1 found the original draft's "SDK forbids inputSchema-level
  validation" claim false; the resulting `superRefine`-based fix was itself found broken at round 2 (it
  silently destroys `tools/list`'s field introspection for the whole tool, in zod v3). Decision 1 as
  written above lands back on handler-level validation — the same practical outcome as the very first
  draft, but now for a verified, correct reason (preserving `tools/list` visibility) rather than a false
  one (an SDK limitation that doesn't exist). Decision 5 is explicitly NOT self-approved as "handled" —
  it's surfaced as a known, disclosed gap for the design gate to weigh in on, exactly because it's the
  kind of "sibling call site the ticket didn't name" this epic's own history shows is worth a second look.
