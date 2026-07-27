## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/workspace-context-assembly/spec.md`,
  `skeptic-design-1.md`, `skeptic-design-2.md`, `workflow-state.md`, `files-modified.md` in full.
- `git diff main...HEAD --stat` — 19 files, no frontend files touched (confirms no UI-judgment component
  applies to this ticket: `WorkspaceContextProtocol.scala`, `WorkspaceContextService.scala`, 3 backend
  spec files, `helio-mcp/src/context.ts` + `context.test.ts`, `schemas/workspace-context.schema.json`,
  openspec change artifacts).
- `git status --short` clean both before and after my probing; my own temp probe file
  (`/tmp/.../scratchpad/probe.scala`) was written, never actually invoked (no `scala` binary on PATH),
  and deleted immediately — no artifact survives.

**1. RLS/cross-tenant scoping for `joinHints` — traced the real call graph, not the design doc's citation**
- `WorkspaceContextService.assemble` (`WorkspaceContextService.scala:133-163`): `computeJoinHints(dataTypes)`
  is called once, after `Future.traverse(typesPage.items)(toDataTypeEntry(_, user))` resolves — its only
  input is the `Vector[WorkspaceContextDataType]` this one request already built.
- `dataTypeService.findAll` (`DataTypeService.scala:24`) → `dataTypeRepo.findAll(user.id, page, tag)` →
  `DataTypeRepository.findAll` (`DataTypeRepository.scala:49-63`): filters `r.ownerId === ownerUuid` **at
  the query itself**, runs on `ctx.withUserContext` (not the privileged `withSystemContext` pool). Read the
  method body directly, confirmed the design's D3 citation is accurate, not merely asserted.
- `dataTypeService.listRows` (`DataTypeService.scala:37-47`) calls `dataTypeRepo.findByIdOwned(id, user)`
  (app-layer choke point) before ever touching `data_type_rows`; a miss → `Left(NotFound)`, degraded to
  `columnStats = Map.empty` in `toDataTypeEntry` (`:243-255`), never a leak.
- `computeJoinHints` itself (`WorkspaceContextService.scala:659-696`) takes only `dataTypes:
  Vector[WorkspaceContextDataType]` and does not reference `dataTypeService`, `dataTypeRepo`, or any other
  field of the service — confirmed by reading the full function body, it is genuinely DB-free.
- **Empirical verification**: `WorkspaceContextServiceSpec.scala:854-876` ("assemble (HEL-374 6.3 joinHints
  owner-scoping)") constructs two DIFFERENT owners (`userA`, `userB`), each with their own pipeline-output
  DataType named `order_id`, with **overlapping** example values (`1`, `2` on both sides — engineered so a
  cross-tenant leak, if one existed, would actually produce a hint, not silently miss one by chance). Calls
  `service.assemble(userB)` and asserts `respB.joinHints` contains no entry referencing `userA`'s DataType
  AND is empty overall (pins the exact shape so the assertion isn't vacuous). Ran this test fresh (see
  below) — passes. This is a genuine two-owner test, not a single-owner scenario dressed up as one.

**2. The confidence-damping (`evidenceWeight`) fix — attacked directly, not accepted on the doc's word**
- Read `joinHintConfidence` (`WorkspaceContextService.scala:618-624`): `evidenceWeight =
  min(1.0, min(left.stats.distinctCount, right.stats.distinctCount) / MinDistinctForFullConfidence)`,
  `confidence = roundToFourDecimals(0.5 + 0.5 * jaccard(...) * evidenceWeight)`, `MinDistinctForFullConfidence
  = 20` (`:126`). Matches design.md D2 verbatim, not a paraphrase.
- Read the TS mirror (`helio-mcp/src/context.ts:466-489`): identical formula, identical constant
  (`MIN_DISTINCT_FOR_FULL_CONFIDENCE = 20`, `:428`).
- **Independent probe** (not trusting the repo's own tests): computed the OLD formula
  (`0.5 + 0.5*jaccard`) vs. the NEW formula by hand for the exact coincidental case the human review
  flagged — two unrelated identifier columns holding `{"1","2","3","4","5"}` on both sides, `distinctCount
  = 5` both sides:
  - `jaccard = 1.0` (full overlap)
  - OLD: `confidence = 0.5 + 0.5*1.0 = 1.0` — confirms the pre-fix defect is real, not hypothetical.
  - NEW: `evidenceWeight = min(1.0, min(5,5)/20) = 0.25` → `confidence = 0.5 + 0.5*1.0*0.25 = 0.625` —
    genuinely damped, well below the scale's `1.0` ceiling.
  - High-cardinality sibling (`distinctCount = 20` both sides, same full overlap):
    `evidenceWeight = min(1.0, 20/20) = 1.0` → `confidence = 1.0` — confirms damping targets low
    cardinality specifically, not overlap itself. (Computed via a throwaway Python calculation, since no
    `scala` binary was on PATH — pure arithmetic, not implementation-dependent; matches the formula read
    directly from both `WorkspaceContextService.scala` and `context.ts`.)
- **Required test coverage, verified present and run fresh, on both sides**:
  - Scala: `WorkspaceContextServiceComputeJoinHintsSpec.scala:146-169` — low-cardinality case asserts
    `confidence <= 0.65`; high-cardinality sibling asserts `confidence shouldBe 1.0`. Two materially
    different assertions (not the same number restated), matching the coordinator's requirement.
  - TS: `helio-mcp/src/context.test.ts:776-805` — same two cases, same distinct assertions
    (`toBeLessThanOrEqual(0.65)` / `toBe(1.0)`).
  - Cross-language regression fixture (`context.test.ts:937-972`) independently pins one shared numeric
    case (`0.5 + 0.5*0.5*1 = 0.75`) both sides agree on.
- Schema description (`schemas/workspace-context.schema.json:155`): `"0.5 means a name+type match with
  weak or no value/cardinality evidence; the score approaches 1.0 only as sampled values overlap AND both
  columns show enough distinct values (>= 20, MinDistinctForFullConfidence) to make coincidental overlap
  unlikely. This is a bounded heuristic over a small sample (<=5 example values per side), not certainty —
  always advisory, never a substitute for verifying the join."` — read word-for-word against the actual
  formula: accurate, not overclaiming, matches the epic's documented "confidently-worded-but-false
  documentation" lesson by explicitly stating the scale's semantics rather than leaving them implicit.

**3. Design-gate round-1 fixes genuinely shipped, not just referenced in comments**
- (a) Candidate-gathering bound: `computeJoinHints` (`WorkspaceContextService.scala:660-664`) —
  `dt.columns.filter(c => c.semanticRole == "identifier" && dt.columnStats.contains(c.name))`, exactly the
  round-1-fix expression, not the unbounded `dt.columns`/`t.fields` alone. TS mirror
  (`context.ts:519-532`) applies the identical `stats === undefined` skip. Both sides tested explicitly:
  `WorkspaceContextServiceComputeJoinHintsSpec.scala:175-208` constructs a 45-column DataType with only the
  first 40 in `columnStats`, asserts the 41st (`id40`) never produces a hint while a within-cap column
  (`id0`) does; `context.test.ts` mirrors this.
  - (b) Token-exact `uuid`/`guid`/`id`: read `isIdentifierName`/`normalizedNameTokens`
  (`WorkspaceContextService.scala:283,295-304`) and hand-walked the adversarial names myself against the
  actual shipped function (not the design doc's claim): `guidance` → tokens `[guidance]` → no match;
  `guideline` → `[guideline]` → no match; `misguided` → `[misguided]` → no match; `valid` → `[valid]` → no
  match; `paid` → `[paid]` → no match; `user_id` → `[user, id]` → match; `external_uuid` → `[external,
  uuid]` → match. All consistent with the token-exact design, no new false positive/negative found. Both
  Scala (`WorkspaceContextServiceClassifySemanticRoleSpec.scala:102-115`) and TS
  (`context.test.ts`, `classifySemanticRole` block) carry these exact cases as regression tests, and I ran
  both suites fresh (below) — they pass.

**Standard final-gate scope**
- `sbt test` (fresh run, full suite): `2333/2333` passed, matching the executor's claimed number exactly
  (`backend/`, `sbt -batch test`).
- Scoped re-run of the three touched specs (`WorkspaceContextServiceComputeJoinHintsSpec`,
  `WorkspaceContextServiceClassifySemanticRoleSpec`, `WorkspaceContextServiceSpec`): `63/63` passed,
  including the 6.1/6.2/6.3 DB-backed integration tests by name in the output.
- Root `npm test`: helio-mcp `78/78` passed (including `classifySemanticRole`/`computeJoinHints`/parity
  fixture tests by name in the output), frontend `1433/1433` passed.
- `npm run lint` — clean (`--max-warnings=0`).
- `npm run format:check` — clean.
- `npm run check:schemas` — clean ("schemas in sync with JsonProtocols (32 checked across 28 protocol
  files)").
- `npm run check:scala-quality` — clean pass, 78 soft file-size warnings (unchanged category from prior
  epic siblings); `WorkspaceContextService.scala` (706 lines) and the two new test files are among them —
  confirmed non-blocking (soft budget, not a hard gate), consistent with the executor's disclosure.
- `npx openspec validate "semantic-role-join-hints-workspace-context" --strict` — valid.
- `npx tsc --noEmit` in `helio-mcp/` — clean (no TS build errors introduced).
- Confirmed `WorkspaceContextProtocol.scala`'s diff matches the design/tasks exactly: `jsonFormat3 →
  jsonFormat4` for `WorkspaceContextColumn`, new `WorkspaceContextJoinHint` + `jsonFormat5`,
  `WorkspaceContextResponse` `jsonFormat6 → jsonFormat7`, `joinHints` added as a plain (non-`Option`)
  `Vector` field — always present on the wire as `[]`, matching the schema's `required` list
  (`schemas/workspace-context.schema.json:7-15`, `joinHints` listed).

**Acceptance criteria traced**
- Fixed enum `semanticRole`, deterministic, documented precedence → `classifySemanticRole`
  (`WorkspaceContextService.scala:325-341`), 8-step precedence matches design.md D1 exactly, wired into
  `toDataTypeEntry` (`:263`).
- `joinHints` with confidence, bounded search (documented cap) → `computeJoinHints`
  (`:659-696`), `MaxColumnsPerNameBucket`/`MaxJoinHints` constants (`:110,116`), worst-case cost derived
  from the genuinely-enforced `columnStats`-membership bound.
- Advisory labelling, no mutation of authoritative `dataType` → schema descriptions + code comments
  throughout; `dataType` itself is never written by either new function.
- Backend/MCP parity → `context.ts`/`context.test.ts` mirror both derivations; cross-language regression
  fixture asserts agreement.
- Schema updated, tests green → confirmed above.
- Additive-only → `semanticRole` and `joinHints` are both new, non-optional-but-additive fields; no
  existing field removed or reshaped.

### Verdict: CONFIRM

All three items the human coordinator flagged for explicit re-verification hold up against the actual
shipped code, not just the design doc's or evaluator's narrative: the RLS/ownership argument traces
cleanly through the real call graph and is empirically pinned by a genuine two-owner DB-backed test; the
`evidenceWeight` confidence-damping fix is implemented identically on both the Scala and TS sides, my own
independent probe reproduces both the pre-fix defect (coincidental `1.0`) and the fix's genuine damping
(`0.625` for the low-cardinality case, `1.0` still reachable for the high-cardinality sibling), and the
required test coverage exists with materially different assertions on both sides; both design-gate
round-1 fixes (columnStats-membership candidate bound, token-exact `uuid`/`guid`/`id` matching) are
genuinely present in the shipped functions, verified by reading the code and hand-walking adversarial
names myself, not by trusting a comment. The full verification suite reproduces the executor's claimed
numbers exactly. No UI changes in this ticket (backend/MCP/schema only), so no design-standard review
applies.

### Non-blocking notes
- `proposal.md`'s Impact section still cites `JsonProtocols.scala` instead of `WorkspaceContextProtocol.scala`
  (carried forward from both design-gate rounds as a known, non-blocking hygiene item; `tasks.md` has the
  correct file). Still not fixed as of this gate — trivial, doesn't block delivery.
- `WorkspaceContextService.scala` (706 lines) and the two new test specs continue to exceed the 250-line
  soft budget, consistent with every other HEL-345-epic sibling (HEL-372/373 also grew this file past 400)
  — flagged again here only to confirm it's a known, accepted, non-blocking pattern for this file, not a
  new regression.
