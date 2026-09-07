## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**1. Blocking CR-1 is resolved, and the branch chosen is the correct one.**
tasks.md 5.1 now takes branch (b) explicitly: no `schemas/` change for the workspace-context
half, with the reasoning recorded (the MCP snapshot is assembled client-side and is not a REST
response) and the hard constraint stated — `schemas/workspace/workspace-context.schema.json`
MUST remain byte-unchanged, verified by `git diff`. I confirmed the premise from the tree, not
the document: that file's own `description` reads *"Response body for GET /api/workspace/context
(HEL-371)"*, so it governs exactly the backend route D6 says this change never touches. 5.2
correctly disposes of the analyze half (`schemas/pipelines/pipeline-analyze-concise-response.schema.json`
exists — confirmed by `ls`), and 5.3 explicitly fences off the pre-existing `dataTypes`/`joinHints`
staleness as out of scope. The three tasks are now mutually consistent and consistent with
proposal.md's "Modified Capabilities: None". No ambiguity remains for an implementer.

I do **not** think a new MCP-scoped schema file is required here. `schemas/` in this repo
documents REST request/response contracts (every `$id`/description in `schemas/workspace/`
and `schemas/pipelines/` is route-scoped). The concise analyze mode got a schema because it *is*
a REST response; the MCP workspace snapshot is a client-side fan-out over ~8 endpoints
(`context.ts:16-24`) with no route of its own. Branch (b) is the right call.

**2. All five non-blocking notes landed, each verified against the tree.**
- D8 exists (design.md:109-122) and states 180,726 B / ~9.6% headroom, ~2.6 KB/pipeline concise
  marginal cost, "~50 pipelines would exceed budget even in concise mode", and "adding any
  per-entity detail will bust the target". The Risks section gained a cross-referencing
  "The bound is conditional" bullet. Numbers match my round-1 measurement exactly.
- 2.2 now names the mode-dependent top-level shape (`{nodes}` vs `{id,name,sourceSchemas,steps}`)
  and says the return type becomes an overload/union. New 2.2a pins `context.ts:477` — I confirmed
  that line is `const analyzed = await api.analyzePipeline(summary.id);` consuming `analyzed.steps`.
- 4.1 now names `analyze_pipeline` (`read.ts:163-166`) as the documented fallback for omitted
  per-step columns; I confirmed that description text is really there.
- 6.2 now flips `:558` (`structuralFloorExceedsBudget` → `true`) alongside `:559`. Confirmed both
  assertions sit exactly at those lines.
- 6.10 uses `--testPathPatterns` (plural) and warns that the singular form silently reports
  `Tests: 0 total`.

**3. Measurement re-reproduced (not taken on trust from round 1).**
`npx jest --testPathPatterns=hel865` → `Tests: 4 passed`, THIN 50,870 / REALISTIC 465,036 /
perPipeline 9,101 / perSource 2,978 — byte-identical to round 1 and to design.md's table.

**4. Remaining line references spot-checked.** `helioApi.ts:290-292` is `analyzePipeline`;
`:622-626` is `runPipeline`'s `dry ? { dry: "true" } : undefined` precedent; `read.ts:159-171`
is `inputSchema: { pipelineId: z.string().min(1) }`; `read.ts:270` is `inputSchema: {}`. The
backend concise parameter exists (`parameter("concise".as[Boolean].?)` with an explicit
byte-identical-when-absent comment), so task 1.1's "no backend change" holds.

**5. Scope unchanged.** Still 1:1 with the six ACs, no backend change, no migration. Proportionate
to a LOW ticket. `git status` shows only the probe file and the change dir — no stray edits.

### Verdict: CONFIRM

### Non-blocking notes

- proposal.md's **Impact** line still ends "...their tests, and `schemas/`", which is now
  contradicted by tasks 5.1/5.2 (no `schemas/` change at all). Not blocking: the tasks are the
  executable instruction and they are unambiguous and prohibitive, so no implementer is misled
  into editing that file. Worth a two-word trim if the executor is touching proposal.md anyway.
- tasks.md 1.1 cites `PipelineRoutes.scala:52-56`; the actual `parameter("concise"...)` block runs
  to ~:58 and the file lives at `backend/src/main/scala/com/helio/api/routes/pipelines/`. The
  reference is close enough to find, and 1.1 prescribes no edit there.
