## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all design artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/workspace-context-assembly/spec.md` in full.
- **Confirmed `Page.Default` = 200** — `backend/src/main/scala/com/helio/domain/pagination.scala:11`
  (`val Default: Page = Page(offset = 0, limit = 200)`). Matches design.md D2's citation.
- **Confirmed `SampleColumnLimit` = 40** and `StatsRowLimit` = 500 in
  `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala:69,75`. Matches design.md's
  citation of these constants (not invented).
- **Confirmed `DataTypeRepository.findAll`** (`backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala:49-63`)
  filters `WHERE ownerId = <caller>` at the query itself and runs on `ctx.withUserContext` (not the
  privileged `ctx.withSystemContext` pool `listRows` uses) — design.md D3's RLS/ownership claim is
  accurate as stated, verified by reading the method body, not the doc's citation.
- **Confirmed `computeJoinHints` as specified takes no DB-touching input** — `assemble` (WorkspaceContextService.scala:102-128)
  only calls `computeJoinHints` (per task 3.3) after `Future.traverse(typesPage.items)(toDataTypeEntry)`
  completes, so cross-DataType comparison only ever sees one caller's data per request. This part of D3
  is sound.
- **Confirmed `roundToFourDecimals`'s reuse is safe** — `BigDecimal(v).setScale(4, HALF_UP).toDouble`
  (WorkspaceContextService.scala:432-433) has no overflow surface for `v ∈ [0.5, 1.0]`; nowhere near the
  `math.round`-as-`Long` clamping bug from HEL-373. Confirmed by reading the function.
- **Confirmed the wire-format bump claims in tasks.md** against `WorkspaceContextProtocol.scala`:
  `WorkspaceContextColumn` is currently `jsonFormat3` (3 fields: name/dataType/nullable, line 127-128) →
  task 1.1's "bump to jsonFormat4" is correct; `WorkspaceContextResponse` is currently `jsonFormat6`
  (line 144-145) → task 1.3's "bump to jsonFormat7" is correct.
- **Walked the name-normalization regex by hand** against the false positives the design explicitly
  claims to avoid (`validated`, `estimated`, `valid`, `paid`, `avoid`) — all correctly fail to match, per
  the token-exact (not substring) design of steps 4/5's `_id`/date-token checks.
- **Found a real, unclaimed false positive** in D1 step 5's `uuid`/`guid` check (below).
- **Found the central cost-bound argument in D2 does not hold against the actual code** — traced the
  candidate source `computeJoinHints` would draw from (below), cross-checked against
  `schemas/workspace-context.schema.json` (`DataTypeEntry.columns` vs. `columnStats`, lines 144-147 vs.
  166-169) and `helio-mcp/src/context.ts:495` (mirrors the same unbounded pattern), and confirmed there
  is no field-count cap anywhere else in the codebase (`RequestValidation.scala`, `DataTypeService.scala`,
  `SchemaInferenceEngine.scala` — CSV header-driven schema inference imposes no column-count limit).

### Verdict: REFUTE

### Change Requests

1. **D2's cost bound is not actually enforced by construction — the central claim of the design is
   false as written.** (design.md D2; tasks.md 3.1/4.2)

   D2 asserts: "up to `Page.Default` (200) DataTypes × `SampleColumnLimit` (40) identifier candidates
   each (**the SQL-tier bound HEL-373 already enforces on the columns list this draws from**) = 8,000
   candidate columns worst case."

   This is false. `SampleColumnLimit` (40) bounds two things only: the SQL-tier `excludeKeys` fetch and
   `computeColumnStats`'s own enumeration (`WorkspaceContextService.scala:263,317` — both explicit
   `.take(SampleColumnLimit)` calls). It does **not** bound `WorkspaceContextDataType.columns`, which is
   built from `dt.fields.map(...)` over the **entire** declared field list, with no cap
   (`WorkspaceContextService.scala:228`, unchanged by this ticket). The schema itself documents this
   asymmetry: `columnStats`'s description explicitly says "capped at the first 40 in declared order"
   (`schemas/workspace-context.schema.json:169`), while `columns`'s description says nothing of the kind
   (`schemas/workspace-context.schema.json:144-147`).

   `computeJoinHints(dataTypes: Vector[WorkspaceContextDataType])` (task 3.1) has no candidate source
   other than each `WorkspaceContextDataType.columns` — and `classifySemanticRole`'s identifier branch
   (D1 step 5) is purely name-based (`_id`/`uuid`/`guid`/`id`), requiring no `columnStats` presence. So
   **every** declared field, not just the first 40, can be classified `identifier` and enter the
   candidate pool. There is no field-count cap anywhere in the codebase to fall back on — confirmed by
   grepping `RequestValidation.scala`, `DataTypeService.scala`, `DataTypeRepository.scala`, and CSV
   schema inference (`SchemaInferenceEngine.scala`, which derives fields straight from a CSV header row
   with no column-count limit). A wide CSV import (hundreds of `_id`-suffixed columns is an unlikely but
   not implausible case; even a moderately wide table with 100+ fields is ordinary) can blow the "≤40 per
   DataType" assumption arbitrarily, invalidating both the 8,000-candidate figure and the "sub-second
   CPU, independent of how many buckets exist" claim that follows from it.

   This also directly violates the ticket's own **carried finding #2** ("Guard invariants at terminal
   boundaries, not per-intermediate-step — the pattern behind `asNumeric` and
   `WorkspaceContextColumnStats` construction. Follow it for anything new.") — `computeColumnStats` and
   `sanitizeSampleRows` both apply an explicit, independent `.take(SampleColumnLimit)` at their own
   enumeration step, not relying on the SQL-tier bound alone; `computeJoinHints` as specified does not
   apply the equivalent discipline.

   The identical defect exists on the MCP side: `helio-mcp/src/context.ts:495`
   (`columns: t.fields.map(...)`) is the same unbounded pattern, so task 4.2's mirror would inherit the
   same hole.

   **Required revision**: D2 and tasks 3.1/4.2 must add an explicit, code-level cap on the number of
   identifier-role candidates gathered **per DataType**, enforced at the candidate-gathering step itself
   (not inherited from an unrelated bound) — e.g. reuse `SampleColumnLimit` with an explicit
   `.take(SampleColumnLimit)` over each DataType's identifier-role columns before bucketing, or restrict
   candidates to columns present in `columnStats` (which genuinely is capped). Rederive the "8,000
   candidates / 392,000 comparisons" worst-case number from the actual enforced cap, not from
   `SampleColumnLimit`'s unrelated SQL-tier role.

2. **D1 step 5's `uuid`/`guid` substring match is not token-boundary-anchored, contradicting the design's
   own stated defense and creating an undisclosed false-positive class.** (design.md D1 step 5)

   Step 5 is described as "Token-boundary-anchored — `valid`/`paid`/`avoid` do not match (no
   `_`/camelCase boundary before `id`)" — true for the `_id`-suffix check, but the same step also matches
   on "contains `uuid`/`guid`" as a raw substring, with no token-boundary requirement. Real,
   plausible column names containing the literal substring `guid` without any identifier semantics:
   `guide`, `guidance`, `guideline`, `misguided` (e.g. a `guideline_count` or `user_guidance_score`
   column would be misclassified `identifier` purely because its normalized name contains `guid`). This
   is a real false positive the design does not disclose as an accepted limitation, unlike the "sid/cust"
   abbreviated-id miss it does disclose — and it directly undercuts the ticket's own "a wrong role is
   worse than no hint" framing, since an `identifier` misclassification here also feeds directly into
   `joinHints` candidate gathering (D2), potentially producing a spurious cross-DataType join hint on a
   `guidance`/`guideline`-named text column.

   **Required revision**: either (a) make the `uuid`/`guid` check token-exact (a normalized-name token
   equal to `uuid` or `guid`, mirroring the already-token-exact temporal-token approach in step 4), or
   (b) explicitly document this as an accepted, stated limitation alongside the other two already listed
   under "Accepted, stated limitations" in D1.

### Non-blocking notes

- D3's RLS/ownership argument is sound and verifiable as written — confirmed by reading
  `DataTypeRepository.findAll`'s body directly, not just the citation. No change needed there.
- The 0.5 confidence floor for a name+type match with zero value evidence is a defensible, explicitly
  self-flagged tunable (Planner Notes acknowledges this), given `joinHints` is clearly labelled advisory
  and overlap is a boost, not a gate. Not blocking.
- `tasks.md` 5.2 defers the cross-tenant `joinHints` scenario (spec.md's "Join hint search never compares
  across different callers' DataTypes") to a code comment rather than a DB-backed test, reasoning that
  `findAll`'s pre-existing owner-scoping already guarantees it and `computeJoinHints` is provably pure/
  DB-free. That reasoning checks out on this reading, but given the ticket's own "Design-gate attention"
  explicitly flags RLS scoping as a required final-gate verification item, the final-gate skeptic pass
  should re-trace this rather than accept the code comment at face value.
