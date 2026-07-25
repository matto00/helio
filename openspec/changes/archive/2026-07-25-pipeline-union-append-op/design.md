## Context

`JoinStep` (`backend/src/main/scala/com/helio/domain/steps/JoinStep.scala`) is the only existing
async / repo-touching pipeline step: its `evaluate` resolves a second `DataSource` via
`ctx.dataSourceRepo.findByIdInternal` (privileged at RUNTIME — bypasses the caller's ACL; see
Correction below for the separate creation/update-time ACL check that HEL-278 added) and loads its
rows via `ctx.loadSource`, then combines them with the left-side rows. `union` needs the identical
resolution shape but a different combination: stacking rows
(union/append) instead of joining columns on a key. `JoinStep` also has no case in
`PipelineAnalyzeService.inferOutputSchema` — an unregistered op there falls through to
`case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`, i.e. join pipelines get a
(currently unaddressed) `validationError` from `analyze_pipeline`. The ticket requires `union` NOT
inherit that gap: it must get its own passthrough case.

**Correction (post skeptic design-gate round 1):** HEL-278 ("Restrict JoinStep right-source to
caller-owned data") is **DONE** (2026-05-24, PRs #171/#173) — this doc's original claim that join's
resolution is fully unscoped was stale. `PipelineService.addStep`/`updateStep`
(`backend/src/main/scala/com/helio/services/PipelineService.scala`) run a pre-flight
`dataSourceRepo.findByIdOwned` check for `case jc: JoinConfig`, 404 on cross-user, falling through
to `case _ => Right(())` for everything else. Runtime `evaluate` still uses privileged
`findByIdInternal` (HEL-278's chosen "pre-flight + runtime internal" model). **`UnionConfig` has NO
arm in that match, so it would inherit the `case _` fallback — a real, unmitigated cross-tenant ACL
gap `join` no longer has.** Fixed via Decision 9.

Separately, `join` stays out of `stepNarrowing.ts`'s `OP_TYPES` picker — comment references
HEL-278, but HEL-264 (2026-05-17, its origin) actually cites "not yet fully implemented... showing
it leads to confusion," and ground truth confirms **no `JoinConfig.tsx` editor exists anywhere in
`frontend/src/features/pipelines/ui/`** — that's the real, still-current reason, unrelated to the
now-fixed ACL gap. `union` has neither reason once this change ships (ACL check + full editor), so
it should NOT mirror `join`'s exclusion — see revised Decision 7.

## Goals / Non-Goals

**Goals:**
- Define `UnionStep`'s config shape, both stacking modes' column-reconciliation semantics, and
  execute-time error behavior, precisely enough to write scenario-level spec requirements.
- Define the analyze/infer passthrough behavior and justify it as intentional, not a gap.
- Decide `union`'s `OP_TYPES` picker exposure and document the rationale.

**Non-Goals:**
- Resolving the second source's live schema at analyze time (would require an extra repo round
  trip inside `PipelineAnalyzeService`, which today is pure schema-math with no repo access —
  out of scope; passthrough is the documented, intentional limitation).
- Restricting the RUNTIME `findByIdInternal` lookup in `evaluate` to caller-owned/shared sources —
  HEL-278 deliberately kept this privileged at evaluation time for both `join` and (per Decision 9)
  `union`, so already-authored steps keep working; only the creation/update-time pre-flight is
  ownership-scoped (Decision 9 IS in scope for this change — corrected from the initial, stale
  "union inherits join's unscoped posture" framing this design doc originally had).

## Decisions

**Decision 1 — Config shape.** `UnionConfig(otherDataSourceId: String, mode: String)`, mirroring
`JoinConfig`'s shape (`rightDataSourceId`, `joinKey`, `joinType`) but with no join-key concept.
Tolerant `decode` defaults: `otherDataSourceId -> ""`, `mode -> "byPosition"` (missing mode assumes
the simpler, no-reconciliation mode — matches `JoinConfig.decode`'s `joinType -> "inner"` default
pattern, defaulting to the least-surprising behavior).

**Decision 2 — `byPosition` mode: no column reconciliation.** Rows from the other source are
appended to the current row set as-is, with no column-name checking or alignment. If the two
sources have different columns, the resulting row set is heterogeneous (later panel/type binding
sees the union of whatever keys appear per row, exactly like today's engine already tolerates
heterogeneous rows — no new invariant introduced). This mirrors `JoinStep`'s `leftRow ++ rightRow`
pattern of trusting the caller's config over validating cross-source shape. Rationale: `byPosition`
is the "I know both exports have identical columns" fast path — validating would defeat its
purpose and there's no key to validate against structurally.

**Decision 3 — `byName` mode: union of columns, missing → null.** Compute the column set as the
union of keys present in the current rows' first row and the other source's first row (or, if
either side is empty, the non-empty side's key set; if both are empty, the empty set). For every
row from either side, keys present in the union but absent from that row are filled with `null`
before the row is emitted — this is a per-source, per-key backfill (not a per-row backfill;
current-side rows only get other-side-only keys added, and vice versa, since rows within a source
are already assumed uniform, matching how the engine treats row shape elsewhere: no per-row
column-set introspection exists today). Rationale: mirrors "outer" semantics without needing an
actual outer-join key — `byName` is `union` semantics from SQL (`UNION` unifies columns; mismatched
schemas backfill nulls, matching common ETL-tool `byName` union behavior), while `byPosition` is a
raw append.

**Decision 4 — no type reconciliation.** Neither mode attempts type coercion across sources (e.g.
one source's `age` as string, the other's as int). This matches the engine's existing looseness —
row values are `Map[String, Any]` throughout, and no other op validates cross-row type consistency.
Column-name mismatches in `byPosition` mode are the caller's responsibility (documented in the
step's scaladoc and the spec, not enforced).

**Decision 5 — execute-time errors.** Missing/invalid `otherDataSourceId` (empty string default, or
an id that doesn't resolve via `findByIdInternal`) fails with
`IllegalArgumentException("DataSource not found for union: " + otherDataSourceId)`, matching
`JoinStep`'s `"DataSource not found for join: " + rightDsId"` message shape. An unrecognized `mode`
value fails with a descriptive error naming the value and the two supported modes, matching
`JoinStep`'s unsupported-`joinType` error shape.

**Decision 6 — analyze passthrough is a first-class dispatch case, not the unknown-op fallback.**
Add `"union"` alongside `"filter" | "limit" | "sort" | "dedupe" | "fillnull"` in
`PipelineAnalyzeService.inferOutputSchema`'s passthrough case (`(inputSchema, None)`) — a real,
documented case, not falling through to `case unknown => ... Some("Unknown op: ...")`. This
satisfies the acceptance criterion ("no false validationError") and is intentionally NOT parity
with `join`'s current unregistered state (which DOES emit that validationError today) — `union`
gets it right from day one; fixing `join`'s gap is out of scope for this change.

**Decision 7 (REVISED) — expose `union` in the `OP_TYPES` picker.** Unlike `join`, `union` ships
with (a) a creation/update-time `findByIdOwned` ACL check (Decision 9) closing the cross-tenant
exposure, and (b) a full `UnionConfig.tsx` frontend editor (this change, task group 4) — the two
things `join` still lacks (see corrected Context above). Neither of `join`'s real exclusion
reasons applies to `union` once this change ships, so hiding it would be over-cautious precedent-
matching against a comment that was already stale. `stepNarrowing.ts` adds `union` directly to
`OP_TYPES` (not a separate internal-only lookup entry like `JOIN_OP_TYPE`), with `defaultConfigFor`
returning `{"otherDataSourceId": "", "mode": "byPosition"}`.

**Decision 9 — mirror HEL-278's ACL pattern for `UnionConfig.otherDataSourceId`.** Add a
`unionCheckF` pre-flight (parallel to `joinCheckF`) in both `PipelineService.addStep` and
`updateStep`: `case uc: UnionConfig => dataSourceRepo.findByIdOwned(DataSourceId
(uc.otherDataSourceId), user).map { case None => Left(NotFound(...)); case Some(_) => Right(()) }`,
falling through to the existing `case _ => Right(())` default. A cross-user `otherDataSourceId`
returns `404 Not Found` at creation/update time, identical to `join`. Runtime `evaluate` still uses
`findByIdInternal` (Decision 1 / HEL-278's "pre-flight + runtime internal" choice). Test parity:
mirror `PipelineStepRoutesSpec.scala`'s join 404/201 test pair for `union`.

**Decision 8 — `jsonFormat6` for `UnionStepResponse`.** Fields: `id, pipelineId, position,
createdAt, updatedAt, config` — identical shape to `JoinStepResponse`.

## Risks / Trade-offs

- [Risk] `byName` mode's "first row" column-set heuristic misses columns that only appear in later
  rows of a source with genuinely heterogeneous rows → Mitigation: documented limitation in the
  step's scaladoc and spec; matches the engine's existing lack of per-row schema introspection
  elsewhere (e.g. `dedupe`, `fillnull` also don't introspect beyond declared config). Not a
  regression relative to today's engine guarantees.
- [Risk] Without Decision 9's ACL check, `union` would ship a REAL cross-tenant `DataSource` read
  via the generic `case _ => Right(())` fallback in `addStep`/`updateStep` (worse than `join`,
  which HEL-278 already closed) → Mitigation: Decision 9 adds a symmetric `findByIdOwned` pre-flight
  check + a mirrored 404/201 test pair (tasks.md 2.6, 6.7).
- [Risk] Flyway V-number collision — three v1.6 op-expansion lanes may land migrations
  concurrently → Mitigation: tasks.md includes an explicit "re-confirm max migration number" task
  both at scheduling time and immediately before the delivery push (per orchestrator instructions).

## Planner Notes

- Self-approved: Decision 7 (picker inclusion, revised after skeptic design-gate round 1 caught a
  stale HEL-278 claim) — `union` has neither of `join`'s real exclusion reasons once this change
  ships, so exposing it is the accurate call, not a new architectural direction.
- Self-approved: Decision 9 (ACL parity for `union`'s second-source ref) directly mirrors HEL-278's
  already-shipped, already-reviewed pattern for `join` — not a new architectural call.
- Self-approved: Decision 6 (union gets analyze support join currently lacks) is explicitly called
  for by the ticket's acceptance criteria ("no false validationError"); fixing `join`'s parallel gap
  is out of scope.
- No ESCALATION raised — no new external dependency, no breaking API change, scope matches ticket;
  the ACL gap the skeptic caught is closed via a direct mirror of existing shipped precedent.
