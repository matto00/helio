## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-assert-step-authoring/spec.md`, `specs/mcp-assertion-results-grounding/spec.md`.

- **Decision 1's central SDK-typing claim — checked directly against the actual, pinned
  `@modelcontextprotocol/sdk` source, per the orchestrator's explicit request. This claim is FALSE.**

  design.md's Context section states: *"the MCP SDK's `registerTool` types `inputSchema` as a
  `ZodRawShape` (a plain object of independent per-field Zod types) specifically so it can
  auto-generate the tool's JSON Schema listing per field; it does not accept a single pre-built
  `z.object(...)`/`z.union(...)` instance in place of that raw shape."* Decision 1 then builds its
  entire justification for handler-level (not `inputSchema`-level) validation on this claim: *"the
  only way to make `config`'s validation depend on `type === 'assert'` specifically... is inside the
  handler callback."*

  `helio-mcp/package.json` pins `"@modelcontextprotocol/sdk": "^1.29.0"`; `package-lock.json` resolves
  it to exactly `1.29.0`. `helio-mcp/node_modules` isn't installed in this worktree, but the primary
  checkout (`/home/matt/Development/helio/helio-mcp/node_modules/@modelcontextprotocol/sdk`) has the
  identical `1.29.0` installed (verified via `node_modules/@modelcontextprotocol/sdk/package.json`'s
  `"version"` field) — the real, currently-resolvable type declarations for this exact dependency.

  `dist/esm/server/mcp.d.ts:150`:
  ```ts
  registerTool<OutputArgs extends ZodRawShapeCompat | AnySchema,
               InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
    name: string,
    config: { title?: string; description?: string; inputSchema?: InputArgs; outputSchema?: OutputArgs; ... },
    cb: ToolCallback<InputArgs>
  ): RegisteredTool;
  ```
  `InputArgs` is explicitly typed to accept `AnySchema`, not only `ZodRawShapeCompat`. `dist/esm/server/zod-compat.d.ts:3`: `export type AnySchema = z3.ZodTypeAny | z4.$ZodType` — i.e. any full Zod
  schema instance (`z.object(...)`, `z.union(...)`, `z.discriminatedUnion(...)`, and refined/transformed
  schemas alike), not a raw shape.

  This is not a type-only artifact of loose typing — the **runtime** confirms it too.
  `dist/esm/server/mcp.js`'s `getZodSchemaObject()` explicitly branches:
  ```js
  function getZodSchemaObject(schema) {
    if (!schema) return undefined;
    if (isZodRawShapeCompat(schema)) return objectFromShape(schema);
    if (!isZodSchemaInstance(schema)) throw new Error('inputSchema must be a Zod schema or raw shape, received an unrecognized object');
    return schema;
  }
  ```
  — a pre-built schema instance (detected via `isZodSchemaInstance`, whose own comment reads *"This
  includes transformed schemas like z.preprocess(), z.transform(), z.pipe()"*) is used as-is; only a
  raw shape gets wrapped. `normalizeObjectSchema` (used for both `tools/list`'s JSON-schema generation
  and `validateToolInput`) handles both forms identically.

  Practical consequence: `z.object({ pipelineId, type, config }).superRefine((data, ctx) => { if
  (data.type === "assert") { ...validate config against assertConfigSchema, ctx.addIssue(...)... } })`
  passed directly as `inputSchema` is a **supported, SDK-native** way to get exactly the cross-field
  ("`config` depends on sibling `type`") validation Decision 1 says is unreachable outside the handler
  — and it would run inside the SDK's own `validateToolInput` (`mcp.js` ~line 125), strictly *before*
  `executeToolHandler` runs at all, not merely "before the network call" as the currently-proposed
  handler-level `safeParse` achieves.

  I also confirmed the *observational* half of Context is accurate (current code really does only use
  the raw-shape form everywhere, and `z.discriminatedUnion` really is only ever nested one field deep,
  e.g. `restAuthSchema` at `write.ts:107-140` used as `auth: restAuthSchema.optional()`) — `write.ts`
  has 20+ `registerTool` call sites and every one uses `inputSchema: { ...raw shape... }`, including
  `add_pipeline_step` itself (`write.ts:278-282`: `{ pipelineId: z.string().min(1), type:
  z.string().min(1), config: z.record(z.unknown()).default({}) }`). But "no call site currently does
  this" is a fact about today's code, not a fact about what the SDK "does not accept" — design.md
  conflates the two, and the "does not accept" half is what Decision 1's whole architecture rests on.

- **Decision 2 (assert rule shape)** — verified against `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala`:
  matches exactly (six kinds `notNull`/`unique`/`range`/`rowCountMin`/`rowCountMax`/`regex`; `field`
  required via `requireField` for notNull/unique/range/regex, absent/ignored for the two `rowCount*`
  kinds; `severity` warn|error). Accurate.

- **Decision 3/4 (`lastRunAssertions` sourcing)** — verified `GET /api/pipelines/:id/run-history`
  (`PipelineRunHistoryRoutes.scala`) returns `Vector[PipelineRunRecord]` with a non-optional,
  zero-valued `assertions: AssertionSummary = AssertionSummary()` field
  (`PipelineProtocol.scala:56-79`), and `PipelineRunRepository.listByPipelineInternal` sorts
  `.sortBy(_.startedAt.desc)` — confirms "first entry = most recent" and the "always present,
  zero-valued" claims. The file's existing "ALWAYS present, never omitted" convention
  (`context.ts:958,964,1012,1029`) is real precedent. Accurate.

- **Fan-out plan feasibility** — `context.ts:1087-1116`'s existing `pipelines.map(async (summary) =>
  {...})` inside `Promise.all` (with `analyzePipeline` wrapped in its own try/catch) is a real,
  matching precedent for Decision 3's plan to add a second per-pipeline fetch. `helioApi.ts:279`'s
  `analyzePipeline` is confirmed as the "thin pass-through" style Task 1.2 says to mirror.

- **Naming collisions** — `AssertionSummaryResponse`/`AssertionFailureDetailResponse`/`PipelineRunRecord*`
  do not already exist in `helio-mcp/src/types.ts` or `helioApi.ts` — no conflict.

### Verdict: REFUTE

Decision 1's stated justification for its core architectural choice (handler-level, not
`inputSchema`-level, assert-config validation) rests on a specific, falsifiable technical claim about
the MCP SDK that is objectively false for the exact SDK version this project depends on — confirmed
against both the type declarations and the runtime implementation. This is precisely the class of
design-soundness defect a design gate exists to catch before implementation encodes it: an
implementer following this design.md will build (and future readers will trust) an architecture
justified by reasoning that doesn't hold up, in a change whose own stated practice elsewhere
("verified against `AssertStep.scala`/`AssertRule`, not re-derived") is to ground claims in real
code — this one claim wasn't.

To be clear on scope: this is not a claim that the *resulting implementation* would fail the ticket's
literal acceptance criteria — handler-level `safeParse` would still reject malformed configs "before
any network call," satisfying AC1 as written. The problem is that the design's stated rationale for
*why* that's the only option is false, and a demonstrably viable, simpler, more SDK-idiomatic
alternative (`inputSchema`-level `superRefine`, validated by the SDK itself before the handler even
runs) exists and was never actually considered because of that false premise.

### Change Requests

1. **Correct the false claim in design.md's Context section and Decision 1.** Replace "the SDK ...
   does not accept a single pre-built `z.object(...)`/`z.union(...)` instance in place of that raw
   shape" with an accurate statement: the SDK's `registerTool` (`@modelcontextprotocol/sdk@1.29.0`,
   the pinned version) types and runtime-supports `inputSchema` as *either* a raw shape *or* a full
   pre-built schema instance (`AnySchema` — including a `.superRefine()`-augmented `z.object(...)`),
   per `mcp.d.ts:150` and `mcp.js`'s `getZodSchemaObject`/`isZodSchemaInstance`. Cite the actual
   evidence (as above) the way every other Decision in this document does.

2. **Re-decide Decision 1 on the corrected premise**, choosing one of:
   - **(a)** Adopt `inputSchema`-level validation: replace `add_pipeline_step`'s raw-shape
     `inputSchema` with `z.object({ pipelineId, type, config }).superRefine((data, ctx) => { if
     (data.type === "assert") { ... } })`, passed directly as the tool's `inputSchema`. This is SDK-
     native, runs before `executeToolHandler` (earlier than the current handler-level check), and
     removes the need for hand-rolled Zod-error-to-`CallToolResult` formatting in the handler. Note
     this still needs to avoid the *already-correctly-rejected* `z.union`-first-match pitfall — it
     does, since `superRefine` isn't a union arm-selection mechanism.
   - **(b)** Keep handler-level validation, but justify it honestly: e.g. "for consistency with
     every other `registerTool` call site in this file (all ~20+ currently use the flat raw-shape
     form; this would be the file's only exception), and because a `superRefine`'s cross-field check
     is **not** reflected in the SDK's auto-generated `tools/list` JSON-schema output either way
     (Zod-to-JSON-Schema conversion doesn't encode `.refine()`/`.superRefine()` logic) — so moving the
     check up doesn't eliminate the disclosed introspection trade-off, and there is no functional
     reason to disturb this file's established convention for one op." This is a legitimate,
     correctly-reasoned choice — but design.md as currently written does not make this argument; it
     makes the false "SDK forbids it" argument instead, and must be rewritten either way.
   Either path is acceptable; the current text is not, regardless of which implementation is ultimately
   chosen.

3. **Fix the Risks/Trade-offs section's framing to match.** It currently attributes "the tool's own
   auto-generated JSON-schema listing won't reflect assert's strict shape" specifically to the
   handler-level choice, implicitly suggesting the `inputSchema`-level alternative wouldn't have this
   limitation. Per the evidence above, it would too (refinements never appear in the generated JSON
   Schema) — this trade-off is inherent to using Zod refinements for cross-field validation at all, not
   specific to where the refinement is attached. Correct this regardless of which of (2a)/(2b) is
   chosen, so the document doesn't misrepresent the trade-off as avoidable by relocating the check.

4. **If (2a) is chosen, update `tasks.md` to match.** Task 2.3 currently reads "`add_pipeline_step`'s
   handler: when `type === "assert"`, `assertConfigSchema.safeParse(config)` before calling
   `api.addPipelineStep(...)`" — this describes handler-level validation and would need rewriting to
   describe constructing the full `z.object(...).superRefine(...)` schema and passing it as
   `inputSchema` instead (with the handler simplified to a plain pass-through, since the SDK's own
   `validateToolInput` would already have rejected a malformed config by the time the handler runs).
   Task 2.1's schema-module placement note stays accurate either way. If (2b) is chosen, `tasks.md`
   needs no change on this point — only design.md's prose (per items 1-3).

### Non-blocking notes

- **Error-isolation nuance in the `context.ts` fan-out (Decision 3 / Task 3.1).** The existing
  `analyzePipeline` call inside the per-pipeline `Promise.all` is wrapped in its own try/catch that
  degrades to `{...base, steps: [], stepsError: ...}` on failure (`context.ts:1101-1114`). Design.md
  doesn't say whether the new `getPipelineRunHistory` fetch shares that same try/catch or gets its own.
  If it's folded into the same try/catch, a run-history-specific failure would also blank out `steps`
  and produce a misleading `stepsError`. Recommend the executor give it an independent try/catch that
  defaults `lastRunAssertions` to the zero-valued summary on failure, mirroring `analyzePipeline`'s own
  isolation rather than coupling the two fetches' failure domains. Not blocking — a reasonable default
  either way still satisfies the ticket's ACs — but worth a one-line steer before Task 3.1 is written.

- **Decision 5 (proposal-based flows' parallel `{type, config}` schema left unvalidated) — accepted as
  correctly scoped.** The ticket's own Scope section names only `add_pipeline_step`; design.md
  discloses this gap explicitly rather than silently omitting it, matching this epic's own established
  practice (cited: HEL-570's design gate). Recommend a spinoff ticket to extend the same assert-config
  Zod validation to `boundPipelineStepSchema`/`pipelineProposal.ts`'s parallel schema (used by
  `create_bound_panel`/`apply_proposal`), but this is not a blocker for HEL-581 itself.
