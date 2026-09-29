## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Spawn-cwd guard**: `pwd -P` = `/home/matt/Development/helio`; `assert-cwd.sh` returned
   `READY ambient=/home/matt/Development/helio branch=feature/output-filter-capability/HEL-1188`.
2. **HEAD matches the brief**: `git log --oneline -1` = `a4dbd83c HEL-1027 ...`, worktree clean
   except the untracked `openspec/changes/output-filter-capability-contract/` dir — Execution has
   not started, confirming design.md's own citations are checkable against this exact commit.
3. **D1 (capability contract does not extend `capabilitiesAtNode`)** — read
   `PipelineService.scala:1228-1331` directly. Confirmed: `capabilitiesAtNode` is keyed on
   `(pipelineId, stepId)`, resolves via `projectedSchemaAtNode` → `PipelineAnalyzeService.analyzeNodes`
   (pure schema projection from `dataSourceRepo.findByIdOwned(...).inferredSchema`), and never
   touches `node_snapshots`. `buildNodeCapabilities` only reads the projected `Vector[SchemaField]`.
   Design.md's characterization is accurate; D1's reasoning is sound and correctly derived from
   ground truth rather than the ticket's own "driver claim, verify" language.
4. **HEL-1027 ground truth** — read `OutputRowsQuery.scala` (73 lines) and
   `NodeSnapshotRepository.scala` (305 lines) in full. `sortCastForColumn`/`resolveFilter`,
   `nodeFilterFragment`, `sortCastExpr` (`safe_numeric`/`safe_timestamptz`), `quickTermFragment`,
   `filterWhereFragment`, and `hasAnyRow` all match design.md's citations line-for-line (module
   docstrings even cite the same design decision letters, e.g. D2/D4/D6). `DataFieldType`/
   `FieldTypeCategory` in `domain/model/model.scala:658+` match the Structured/Content split cited.
5. **`PublicDashboardRoutes.scala`** — read lines ~70-110: confirmed `outputRepo.findByIdInternal`
   (not `findById(id,user)`) followed by a direct `nodeSnapshotRepo.listRowsPaged` call, matching
   D4's citation and its "different ACL proof" claim.
6. **Archived HEL-1027 design.md D2** — read the full decision, including the round-3 correction
   where a pure-SQL `safe_timestamptz` was found (via live-Postgres testing) to throw on
   calendar-invalid-but-digit-shaped values, forcing a `plpgsql`/`EXCEPTION` rewrite. This confirms
   the "one-bad-row-500" bug this ticket's D3 cites is real and was previously caught the same way
   this design claims to guard against it (casting both sides via the safe_* functions).
7. **Live-Postgres verification of D7's central performance claim** (PostgreSQL 18.4, matching
   `psql --version` on this machine, the same major version the archived HEL-1027 design used for
   its own live verification) — this is the load-bearing check for skeptic-brief item 4:
   - Built a 200k-row temp table with a `jsonb` column shaped like `node_snapshots.data`, 5000
     distinct values in one field, **no index** (mirroring D7's "no new index" decision).
   - Ran the exact query shape design.md D2 specifies: `SELECT COUNT(*) FROM (SELECT 1 FROM t
     WHERE data ->> 'col' IS NOT NULL GROUP BY data ->> 'col' LIMIT 51) t`.
   - `EXPLAIN (ANALYZE, BUFFERS)` shows a `Seq Scan` with **`actual rows=200000`** feeding the
     `HashAggregate` — i.e. the *entire* row set was scanned and grouped before the `LIMIT 51` ever
     trimmed the output. Execution time 37ms for 200k rows.
   - For contrast, added `CREATE INDEX ON t_bench ((data ->> 'col'))` and re-ran the identical
     query: the plan switched to `Index Scan` + streaming `Group`, and the `Seq Scan`'s `actual
     rows` dropped to 2001 (early-stopped), execution time 0.5ms — 70x faster.
   - **This directly contradicts design.md D2/D7's claim**: "Postgres's `GROUP BY` + `LIMIT` here
     still requires building the grouped result up to the limit, **not a full scan short-circuit**,
     but **bounds the WORK to `capPlus1` distinct groups, not the full distinct set**" (D2, lines
     98-103) and D7's conclusion that "No new index" is needed because the `LIMIT $capPlus1` bound
     "additionally caps the WORK." Without a functional index on `data ->> $col` — which D7
     explicitly declines to add — Postgres's planner uses `HashAggregate`, a blocking operator that
     must consume the **entire** filtered row set to build its hash table before any output (let
     alone the `LIMIT`) is emitted. The early-stop behavior the design describes only exists **with**
     an index it deliberately doesn't add.
8. **Traced `in`'s value-side casting through tasks.md/design.md/spec.md** for skeptic-brief item 2.
   Design D3 explicitly reasons through `eq`'s value-side cast (`safe_numeric(data ->> $col) =
   safe_numeric($value)`, not `data ->> $col = $value::numeric`) to avoid reintroducing the
   value-side one-bad-row-500 bug. Task 2.3 states: *"eq/gte/lte cast BOTH sides via
   safe_numeric/safe_timestamptz for numeric/timestamp columns ... `in` as a bound IN (...) list
   capped at 100"* — `in` is conspicuously left out of the explicit cast instruction. spec.md's
   generic sentence ("Every `ops` value is compared using the same value-typed cast...") plausibly
   covers `in`'s list elements too, but neither design.md nor tasks.md ever spells out the SQL form
   for `in` on a numeric/timestamp column the way it does for `eq`/`gte`/`lte`. Since D2 grants
   `eq`/`in` together off the *same* cardinality gate for *every* Structured type — explicitly
   including "a pre-bucketed low-cardinality timestamp or an enum-like small-int status column" — a
   real `in` filter against a numeric/timestamp eq/in-eligible column is squarely in scope, not an
   edge case.
9. Confirmed `openspec/changes/archive/2026-09-28-server-side-sort-filter-output-rows/specs/output-routes-api/spec.md`'s
   unmodified requirements (sort scenarios, error behavior) are preserved byte-for-byte in the new
   spec delta — the `filter` section is extended additively, nothing pre-existing was silently
   reworded (skeptic-brief item 6).
10. Checked D5's shared-primitive claim (skeptic-brief item 1): `buildContract` (full-schema) and
    `eqInEligibleColumn` (single-column) are both specified to route through the same
    `distinctValueCountCapped` + `cardinalityEligible` primitives and the single
    `MaxDropdownCardinality` constant, rather than two hand-maintained lists — concrete enough that
    an implementation literally can't duplicate the check without deliberately hardcoding a second
    value somewhere. Task 7.2's mutation ("hand-edit one side's cardinality cap") is consistent with
    testing that a *future* regression introducing exactly such a duplicate would be caught, not
    evidence that two such duplicates currently exist by design.

### Verdict: REFUTE

The overall shape of the design is sound — D1's non-extension of `capabilitiesAtNode` is correctly
argued from ground truth, D2's cardinality gate genuinely satisfies the owner's "derive from actual
data, not type alone" ruling, D4's deferral to HEL-1190 is structurally non-blocking, and the spec
delta is internally consistent. But two concrete, verified gaps need to be closed before execution:

### Change Requests

1. **Correct D7's (and D2's) performance claim about `GROUP BY ... LIMIT` — verified false on a live
   Postgres 18.4 instance (see evidence #7 above).** Without the new functional index D7 declines to
   add, `distinctValueCountCapped`'s cardinality check does a **full sequential scan of the Output's
   entire matching `node_snapshots` row set for every column checked** — the `LIMIT $capPlus1` only
   trims the *output*, not the *work*. This means `/filter-capabilities`'s `O(columns)` fan-out is
   actually `O(columns × Output-row-count)` scan work, not the bounded-per-column cost D7 claims.
   Required revision: either (a) rewrite D7's rationale to honestly state the true cost (a full
   Output-row scan per Structured column, same per-query order as the `listRowsPaged`/`hasAnyRow`
   queries HEL-1027's D9 already accepted, multiplied by column count) and re-affirm "no new index"
   as a decision made *with* that true cost in view — explicitly weighing that `/filter-capabilities`
   will be called on every dashboard load once HEL-1190 lands (D6's own stated future trigger), not
   just at panel-authoring time — or (b) revisit the "no new index" decision given the corrected
   cost model. Either is acceptable; leaving the current, empirically-false justification in place
   is not, since it's the ticket's own required AC ("performance of range/in... stated, index needed
   or not") and this skeptic gate's explicit item 4.
2. **Specify the value-side cast for `in`'s list elements on numeric/timestamp columns**, mirroring
   the explicit treatment already given to `eq`/`gte`/`lte` in design D3 and task 2.3. D2 grants
   `eq`/`in` together off the identical cardinality gate for every Structured type, including
   numeric/timestamp — so a real `in` filter against, e.g., a low-cardinality integer status column
   or a bucketed timestamp column is in scope, not hypothetical. As written, an implementer following
   task 2.3 literally would have no instruction for whether `in`'s bound list should compare via
   `safe_numeric(data ->> $col) IN (safe_numeric($v1), safe_numeric($v2), ...)` (consistent with
   `eq`, and preserving the "malformed value degrades to no match" guarantee for each individual
   list element) or a plain-text `IN (...)`. The latter would silently reintroduce two distinct
   problems already solved for `eq`: (a) text-representation mismatches for numeric/timestamp values
   (e.g. `"1000"` vs `"1000.0"` failing to match despite being numerically equal — a correctness
   regression `eq` doesn't have), and (b) no protection if a future edit ever tried a raw
   `::numeric`/`::timestamptz` cast on the list instead of `safe_*`, reintroducing HEL-1027 D2's
   original one-bad-row-500 bug on this specific path. Required revision: add an explicit sentence
   to design D3 and task 2.3 stating the SQL form for `in` on numeric/timestamp columns, and add a
   test (folding into or alongside task 7.5) asserting a malformed value *within* an `in` list
   degrades that element to no-match rather than 500ing the whole request.

### Non-blocking notes

- D6/D7's framing of the new cardinality-check cost as strictly "O(columns)" elsewhere in
  proposal.md/design.md is technically correct as a *query count* but easy to misread as "cheap" —
  once CR1 is resolved, consider tightening that phrasing project-wide (proposal.md's Impact section
  included) to make the row-scan-per-column cost explicit rather than implied only in D7.
- Task 7.2's mutation instruction ("hand-edit one side's cardinality cap") is slightly under-specified
  about which two call sites to touch to simulate drift, given both are meant to share one constant
  by construction — a one-line clarification (e.g. "temporarily hardcode a divergent literal at one
  call site only") would remove any ambiguity for whoever executes it, but this is not blocking.
