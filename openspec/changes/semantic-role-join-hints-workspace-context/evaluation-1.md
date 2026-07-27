## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket acceptance criteria are addressed, not partially: `semanticRole` enum per column
  (deterministic, documented precedence — design.md D1, `classifySemanticRole`); `joinHints` with
  confidence, bounded candidate search (design.md D2, `computeJoinHints`); hints labelled
  advisory/inferred both in schema descriptions and never mutate `dataType`; backend + MCP expose the
  same shape (verified field-by-field, see Phase 2); schema updated (`schemas/workspace-context.schema.json`);
  `sbt test` (2333/2333) + MCP/frontend tests (78/78 + 1433/1433) green (re-run fresh, see Phase 2);
  additive-only fields confirmed (`semanticRole` added to `Column`, `joinHints` new top-level array, no
  existing field removed/renamed).
- All 16 `tasks.md` items are marked done and match what's implemented — spot-checked 1.1–1.4 (protocol
  bumps `jsonFormat3→4`, `jsonFormat6→7`, new `WorkspaceContextJoinHint`/`jsonFormat5`), 2.1–2.2, 3.1–3.3,
  4.1–4.3, 5.1–5.4 against the actual diff; no task claims behavior the code doesn't have.
- No AC silently reinterpreted. The two design-gate round-1 fixes (candidacy via `columnStats` membership,
  token-exact `uuid`/`guid`/`id` matching) and the post-design-gate `evidenceWeight` confidence-damping fix
  are all present in the shipped code exactly as specified in design.md's final state (verified directly
  against `WorkspaceContextService.scala` and `context.ts` — see Phase 2 for line-level confirmation).
- No scope creep — diff touches exactly the files `files-modified.md` claims; no unrelated refactors.
- No regressions: full `sbt test` suite (2333/2333) and full root `npm test` (helio-mcp 78/78 + frontend
  1433/1433) re-run fresh by this evaluator, both green.
- API contract: `WorkspaceContextProtocol.scala` and `schemas/workspace-context.schema.json` updated
  together, in the same change, per CLAUDE.md's "keep schema updates in the same change as related
  client/server code."
- Planning artifacts reflect the final implemented behavior — `design.md`'s D1/D2/D3 read as a coherent,
  already-fixed-post-design-gate document, and the code matches it precedence-step-for-precedence-step,
  formula-term-for-formula-term.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Confidence-damping formula (specific scrutiny requested) — CONFIRMED CORRECT.**
`WorkspaceContextService.scala:618-624` (`joinHintConfidence`) implements
`0.5 + 0.5 * jaccard(leftValues, rightValues) * evidenceWeight`, with
`evidenceWeight = min(1.0, min(left.stats.distinctCount, right.stats.distinctCount) / MinDistinctForFullConfidence)`
and `MinDistinctForFullConfidence = 20` (line 126) — matches design.md D2's post-design-gate revision
exactly, not the original refuted `0.5 + 0.5*jaccard` formula. `context.ts:482-489`'s `joinHintConfidence`
is the same formula, same constant. Both sides have the required paired test cases:
`WorkspaceContextServiceComputeJoinHintsSpec.scala:146-169` and `context.test.ts:779-807` each assert the
low-cardinality-coincidence case (`distinctCount: 5` both sides, identical `["1".."5"]` example values)
produces `confidence <= 0.65`, and the high-cardinality sibling (`distinctCount: 20` both sides, same
values) reaches `confidence == 1.0` — proving the damping targets cardinality specifically, not overlap
itself. `schemas/workspace-context.schema.json:151-156`'s `confidence` description states the scale's
semantics explicitly and accurately against the actual formula (`0.5` = weak/no evidence, approaching `1.0`
only with both overlap AND `distinctCount >= 20` on both sides) — this is the required non-implicit
documentation given this epic's "confidently-worded-but-false" history.

**Design-gate round-1 fixes — both confirmed present in shipped code, not the defective originals.**
- Candidacy: `computeJoinHints` (`WorkspaceContextService.scala:660-664`) gathers candidates via
  `dt.columns.filter(c => c.semanticRole == "identifier" && dt.columnStats.contains(c.name))` — exactly the
  round-1 fix, not the unbounded `dt.columns`/`t.fields` list. `context.ts:518-532` mirrors this exactly
  (`c.semanticRole !== "identifier"` / `dt.columnStats[c.name] === undefined` guard). A dedicated test
  (`WorkspaceContextServiceComputeJoinHintsSpec.scala:175-208`, mirrored `context.test.ts:812-850`) proves a
  45-field DataType yields at most 40 candidates and a source-companion DataType (empty `columnStats`)
  contributes zero, even with an `identifier`-role column present in `columns`.
- Token-exact matching: `normalizedNameTokens` (`WorkspaceContextService.scala:295-298`,
  `context.ts:353-356`) is the ONE shared helper for both temporal (step 4) and identifier (step 5) checks;
  `isIdentifierName`/`isTemporalName` both use `tokens.exists(...)`/`tokens.some(...)` set-membership, not
  substring matching. Both `WorkspaceContextServiceClassifySemanticRoleSpec.scala:101-126` and the TS mirror
  assert `guidance`/`guideline`/`misguided` are NOT classified `identifier` and `validated`/`paid`/`avoid`
  are NOT classified `identifier`/`temporal`, while `extGuid`/`external_uuid`/bare `id` still correctly
  match.

**Cross-language parity — confirmed.** `classifySemanticRole` and `computeJoinHints` are independent
implementations (no shared runtime, per the epic's established pattern) but agree term-for-term: same
8-step precedence order, same constants (`DimensionCardinalityThreshold`/`DIMENSION_CARDINALITY_THRESHOLD`
= 50, `MaxColumnsPerNameBucket`/`MAX_COLUMNS_PER_NAME_BUCKET` = 50, `MaxJoinHints`/`MAX_JOIN_HINTS` = 50,
`MinDistinctForFullConfidence`/`MIN_DISTINCT_FOR_FULL_CONFIDENCE` = 20), same bucketing/tie-break/canonical
left-right assignment logic, same Jaccard divide-by-zero guard (`0.0`/`0` on empty-vs-empty, not `NaN`).
`context.test.ts:910+`'s dedicated cross-language parity fixture asserts one representative case per role
plus one join-hint confidence value agree with the Scala side's expected outputs.

**CONTRIBUTING.md compliance.**
- No inline fully-qualified names anywhere in the diff (`git diff | grep`'d for
  `(com|scala|java|org)\.\w+\.\w+\(` patterns in added lines — zero hits); all new types imported at file
  top in braces, consistent with the existing style.
- Per-domain JSON formatters correctly live in `WorkspaceContextProtocol.scala`, mixed into the
  `JsonProtocols` aggregator, not added there directly.
- `WorkspaceContextService.scala` grew from 478 to 706 lines, well past the ~400-line "propose a split"
  soft trigger. This is a real, non-trivial finding but not a blocking one: (a) `check:scala-quality`
  itself treats file-size as a non-blocking soft warning (78 pre-existing warnings across the codebase,
  many services/specs already 2-10x this file's size); (b) the same file was already over 400 lines
  (478) before this ticket touched it, grown there by two prior same-epic siblings (HEL-372/373) without
  a split being required at that point either; (c) `computeJoinHints`/`classifySemanticRole` and their
  helpers are cohesive, single-purpose, well-isolated private functions within the file, not a tangle —
  this is breadth-of-feature-count growth in one service class, not disorganization; (d) the executor
  explicitly flagged it in `workflow-state.md` as a spinoff-candidate rather than silently absorbing it.
  Reasonable call for a focused ticket. See Non-blocking Suggestions below.
- Value-class ID wrapping, ACL triad, and other backend conventions are unaffected — this ticket adds no
  new route, no new repository method, no new DB access.

**DRY / readability / modularity.** `normalizedNameTokens` is the single shared implementation for both
temporal and identifier name checks, and is reused verbatim (not re-derived) by `computeJoinHints`'s
bucketing key — exactly the "one implementation, not a forked copy" discipline the design calls for.
`roundToFourDecimals` (existing HEL-373 helper) is reused verbatim for the new confidence score, not
reimplemented. Function names (`typeBucket`, `jaccard`, `joinHintConfidence`, `classifySemanticRole`,
`computeJoinHints`) are self-explanatory; the 8-step precedence and D2's bounding logic are heavily but
usefully commented given the amount of prior design-gate history behind each decision.

**Type safety / error handling.** No untyped escape hatches. `computeJoinHints` and `classifySemanticRole`
are pure functions with no I/O and thus no new error paths to handle; existing `Future`/`Either` error
handling elsewhere in the file is untouched by this diff.

**Security / RLS.** Traced the call graph directly rather than trusting the design doc's citation (per this
ticket's explicit design-gate-attention item): `computeJoinHints`'s only input is
`dataTypes: Vector[WorkspaceContextDataType]`, built by `Future.traverse(typesPage.items)(toDataTypeEntry)`
where `typesPage` comes from `dataTypeService.findAll(user, Page.Default)` → confirmed
`DataTypeRepository.findAll` filters `WHERE ownerId = <caller>` at the query itself, and each DataType's
`columnStats` is populated only via `listRows`'s `findByIdOwned` choke point. `assemble` never holds more
than one caller's `typesPage` in scope for a given request, so cross-DataType comparison inside
`computeJoinHints` structurally cannot mix two callers' data. Verified with a real DB-backed regression
test, not just a code comment (see Phase 3/test review below).

**Tests meaningful, no dead code, no over-engineering.** Every `spec.md` scenario has direct test coverage
(mapped explicitly below in the scenario-by-scenario check). No leftover TODO/FIXME, no unused imports (npm
lint / scala-quality both clean). No premature abstraction — the new helpers are exactly as general as the
two call sites need, nothing speculative.

### Phase 3: UI Review — N/A (with a fresh functional smoke test performed anyway)
Issues: none.

This ticket touches `schemas/workspace-context.schema.json`, which matches the literal Phase-3 trigger
list, but has **zero frontend/`ApiRoutes.scala` surface** — confirmed `git diff main...HEAD -- frontend/`
is empty and no `ApiRoutes.scala` changed; `grep`'d the frontend source tree for any `WorkspaceContext`/
`workspace/context` consumption and found none. `GET /api/workspace/context` is an existing
agent/MCP-facing endpoint (HEL-371) with no React UI rendering its response, so the browser-based checks in
the Phase-3 checklist (breakpoints, keyboard nav, loading/empty states, etc.) have no applicable surface to
exercise. Rather than skip verification entirely, ran a live functional smoke test in place of the
browser-based checks:
- Started servers via the canonical script (`scripts/concertino/start-servers.sh`), both backend
  (`:8454/health`) and frontend (`:5547`) reported READY.
- Logged in as the dev account and called `GET /api/workspace/context` directly: `200 OK`, response
  included `semanticRole` on every column (spot-checked, e.g. `{"name":"a","dataType":"string",...,
  "semanticRole":"text"}`) and a non-empty, bounded `joinHints` array (13 entries against 91 real seeded
  DataTypes, confidences well within `[0.5, 1.0]`) — confirms the happy path works end-to-end against real
  demo data, not just fixtures.
- No 500s, no malformed JSON, no schema-shape surprises.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `WorkspaceContextService.scala` is now 706 lines, well past the 400-line soft-split trigger, and has been
  grown well past that line by three consecutive same-epic tickets (HEL-372/373/374) without a split. The
  executor's call not to split mid-ticket is reasonable, but recommend filing a real spinoff ticket (not
  just a workflow-state.md note) once the HEL-345 epic's remaining ticket lands, to split
  `classifySemanticRole`/`computeJoinHints`/their helpers (and likely the `computeColumnStats`/
  `sanitizeSampleRows` HEL-373 additions too) into a sibling file (e.g. `WorkspaceContextHeuristics.scala`)
  before this file's growth becomes harder to untangle.
