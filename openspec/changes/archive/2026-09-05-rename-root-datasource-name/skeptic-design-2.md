## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Spawned cold. Every conclusion below is derived from the live worktree, not from the
orchestrator's summary or from round 1's narrative. Round 1's report was used only as a
checklist of claims to re-verify.

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/pipeline-analyze-api/spec.md` (the delta), and `skeptic-design-1.md`.

**CR1 — AC8 unsatisfiable / contradicts D5. ADDRESSED.**
Ran the AC8 command verbatim against the current (pre-implementation) tree:
`grep -rn "sourceDataSourceName" backend/src/main/scala/com/helio/api/protocols schemas/pipelines helio-mcp/src frontend/src`
→ 16 hits. Subtracting the hits that the plan's own tasks rename
(`PipelineAnalyzeProtocol.scala:186`, `pipeline-analyze-response.schema.json:37,43`,
`pipeline-analyze-proposal-response.schema.json:32,38`, `types.ts:490`,
`context.test.ts:135,501`, `tools/pipelineProposalHandlers.test.ts:119`) leaves **exactly
the eight comment/description lines AC8 now enumerates**, line-for-line, with no
omissions and no phantom entries:
`WorkspaceContextProtocol.scala:125`, `pipeline-analyze-response.schema.json:17`,
`PipelineAnalyzeProtocol.scala:181`, `PipelineProtocol.scala:103`, `context.ts:321`,
`runPipelineTruncation.test.ts:23`, `types.ts:277`, `types.ts:503`. I read each of the
eight; all are genuinely narration of the *retired singular scalar* HEL-913 removed, not
declarations of the live field. AC8 is now a classified grep with content-based matching
("line numbers may shift"), explicitly forbids deleting history to force a zero, and
D5 states the same rule in the same words. AC8 / D5 / task 7.1 now agree.

**CR2 — false `check:schemas` mitigation. ADDRESSED, and the correction is accurate.**
Re-read `scripts/check-schema-drift.mjs:112-148` myself. Confirmed independently: it
keys each `*.schema.json` to a case class by the schema's **`title`**, then diffs
`new Set(Object.keys(schema.properties ?? {}))` — **top-level `properties` only** — and
never reads any `required` array anywhere in that loop. The renamed field lives in
`$defs.RootSourceSchema`, untitled and with no entry in the gate's class map, so the
gate is indeed blind to it. `design.md`'s Risks section now says exactly this and
explicitly disclaims the coverage, and new task 4.4 requires printing the
`$defs.RootSourceSchema` block from *both* files and confirming `properties` **and**
`required` by eye. Task 4.3 additionally carries an inline warning not to read a green
`check:schemas` as proof. Mitigation-by-gate is no longer claimed anywhere in `design.md`.

**CR3 — AC7 vacuously satisfiable via substring. ADDRESSED.**
Confirmed the trap is real (`dataSourceName` is a literal substring of
`sourceDataSourceName`). AC7 now requires all three halves *at the AC level* — key-set
contains `dataSourceName`, key-set does **not** contain `sourceDataSourceName`, value is a
non-empty `JsString` — asserted on the **parsed JSON object**, with `entityAs[...]` and
substring containment both explicitly ruled out. D3 gives the same reasoning; task 3.2
matches clause-for-clause; task 3.3 keeps the red-demonstration requirement and now
requires the observed failure output be pasted into the handoff.

**AC7's home is feasible (checked, not assumed).** `PipelineAnalyzeRoutesSpec.scala`
exists and already has tests that seed a pipeline whose root is bound to a real named
DataSource and produce a non-empty `sourceSchemas` (`:127-144`) — so a parsed-body
assertion with a non-empty `JsString` value has a working fixture to land in. Its
`RootSourceSchemaResponse` construction sites (`:570`, `:588`) are positional, so the
rename is compile-safe there.

**Spec delta well-formedness (re-derived).** The delta's MODIFIED header
`### Requirement: Source schema derived from bound DataSource's registered DataType fields`
matches `openspec/specs/pipeline-analyze-api/spec.md:116` exactly. The delta reproduces all
three pre-existing scenarios and adds one new scenario that encodes AC7's contract
(`dataSourceName` present with value `"Orders"`, no `sourceDataSourceName` key).

**Non-blocking notes from round 1 were taken up.** The design's consumer table now lists
`context.ts:321` and `runPipelineTruncation.test.ts:23` as comment-only/in-AC8-scope; AC3
carries an explicit scope clarification that `spec.md:50` is out of scope (I confirmed
`spec.md:50` does name the retired singular scalar in the *summary-fields* sentence, a
different requirement from `:116`), with a matching instruction in task 6.1; and
`PipelineAnalyzeRoutesSpec.scala` is now named in D3 and task 3.2.

**Scope exclusion re-verified independently.** `grep -rn "sourceDataSourceName" backend/src/test`
shows the only other hits are `WorkspaceSearchServiceSpec.scala:146,168,234`, which type
and read `PipelineSummary`'s list scalar — a genuinely different concept, correctly excluded.
The four `PipelineAnalyzeProposalRoutesSpec` assertions at `:185,:255,:302,:452` exist at
exactly the lines task 3.1 cites.

### Verdict: CONFIRM

The three round-1 defects are fixed at the level they were raised — not paraphrased away.
Each fix is internally consistent across ticket AC, design decision, and task, which was
the specific failure mode of round 1. I found no new blocking defect.

### Non-blocking notes

- **The helio-mcp interface is named `RootSourceSchemaResponse`, not `RootSourceSchema`.**
  Task 5.1, the design's consumer table, and the ticket's premise-validation scope list all
  say "`helio-mcp/src/types.ts` — `RootSourceSchema.sourceDataSourceName`". The actual
  declaration is `export interface RootSourceSchemaResponse` at `helio-mcp/src/types.ts:488`.
  `RootSourceSchema` is the *frontend* type (`frontend/src/features/pipelines/types/pipelineStep.ts:490`),
  which — per HEL-969 — deliberately does not carry this field at all. The coincidence that
  both sit at line 490 is presumably how the two got conflated. Non-blocking because the
  cited file, line, and field name are unambiguous and there is exactly one such declaration
  in `helio-mcp/src`; but the executor should not go hunting for a `RootSourceSchema` in
  helio-mcp, and should not "helpfully" add the field to the frontend type.
- `proposal.md`'s What Changes still describes the schema edits as "keeping the
  `npm run check:schemas` drift gate green". That is literally true (the gate stays green
  either way) but reads like the residue of the coverage claim CR2 removed from `design.md`.
  A half-clause noting the gate does not actually see this field would keep the proposal
  aligned with the corrected Risks section. Purely editorial.
