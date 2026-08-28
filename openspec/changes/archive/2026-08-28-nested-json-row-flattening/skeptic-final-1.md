## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth read, not narrative.** `git diff main...HEAD` (26 files, commit `f0870495`), full
reads of `JsonFlattener.scala`, `PipelineRowJson.scala`, `SchemaInferenceEngine.scala`,
`RestApiConnectorDriver.scala`, `SourceService.scala`, all five test files, ticket/design/tasks
and the four spec deltas.

**Gates re-run by me, in the worktree:**
- `sbt -batch test` → `Total number of tests run: 3649 / succeeded 3649, failed 0` (199 s).
  Independently reproduces the evaluator's number.
- `sbt -batch "testOnly JsonFlattenerSpec NestedJsonFlatteningSymmetrySpec PipelineRowJsonSpec
  RestApiConnectorSpec RestApiConnectorDriverTemplatingSpec"` → 58/58 green.

**Fixture genuineness (the ticket's named trap) — verified myself, not trusted.**
I re-fetched `https://api.sleeper.app/projections/nfl/2026?...position[]=WR` (HTTP 200,
1,271,558 bytes, 1364 rows) and compared it against
`backend/src/test/resources/hel599/sleeper-wr-projections-slice.json` by `player_id`:
all three fixture rows (`9493` Puka, `7564` Ja'Marr, `9488` Jaxon) are **byte-equal to the live
rows in full** (`l == f` → `True` for each). The fixture is genuinely nested: `stats` is a
32-key object, `player.metadata` is a real third level. So the flatten assertions cannot be
faked by an already-flat fixture. Evaluator's claim confirmed.

Also confirmed on live data: `0` rows have a null `stats`/`player`, and `stats` key count is
32 in row 0 vs 34 across the first 50 rows — matching design D8's stated residual exactly.

**Behavioural probe (mine, via a throwaway spec run then deleted; worktree left clean —
`git status --porcelain` shows only the pre-existing untracked `evaluation-1.md`):**

```
PROBE path=top.n.n.n.n.n.n.n.n.n     segs=10   leafIsObject=true
PROBE rowVal={"n":{"n":{"n":{"n":...       PROBE schema=top.n.(...):StringType
PROBE mergeResidualSchema=id,stats          (nested-null row → stats.* not advertised)
PROBE mergeResidual2=stats.a                (later-row-only stats.b not advertised)
PROBE collision=List((a.b,2), (a.b,1))  schema=List(a.b, a.b)  row=Map(a.b -> 1.0)
PROBE emptyNested=Map(a -> 1.0)
```

**AC trace:**
1. *Dotted columns populated/typed, verified live* — MET. Code path: `jsRowToRow` →
   `JsonFlattener.leaves` (`PipelineRowJson.scala:94`), reached from
   `InProcessPipelineEngine.loadRows` REST/SQL arms (`:138`, `:143`). Live probe transcript is
   internally consistent and its payload shape matches my own live fetch.
2. *Shared traversal + symmetry test over nested input* — MET, structurally (one `leaves` call
   feeds both projections; a second implementation cannot drift) and by
   `NestedJsonFlatteningSymmetrySpec` with a real negative control (no `{`-prefixed values, no
   bare `stats`/`player` alongside dotted children).
3. *Array behaviour decided/documented/tested* — MET (D2; four `JsonFlattenerSpec` cases).
4. *Depth bound defined and tested* — **NOT MET as tested** (CR 2). Implementation is correct —
   I measured exactly 10 path segments, object-at-bound → compact JSON text → `StringType` — but
   no test asserts any of that.
5–7. *Selector pins + curated error* — MET; `toRowsEither` `Left` only on supplied-and-failed,
   `Right(Vector.empty)` for genuinely empty, `BadGateway` at `previewRest`, loud run failure at
   `loadRows`, no body/credential in the message (all four covered by tests I ran green).
8. *Non-nested rows byte-identical* — MET (`leaves` on a flat object is the identity pair list;
   `toRows` is a literal wrapper over `toRowsEither`). Sole shape change: an empty nested object
   now contributes no column instead of `"{}"` — spec'd deliberately and it *increases* symmetry.
9. *Image connector `Map` case (HEL-216)* — MET. `anyToJsValue`'s `Map` branch
   (`PipelineRowJson.scala:47`) is untouched in the diff, `loadImageRowFromBytes` never routes
   through `jsRowToRow`, and the pre-existing `PipelineRowJsonSpec` coverage still passes.
10. *Test repair not weakening* — MET. `RestApiConnectorDriverTemplatingSpec`'s changed
    assertion is strictly stronger (`headers.X-Custom shouldBe "custom-header-value"` replacing a
    substring match on JSON text).

**D8 boundary honoured** — `mergeObjects` is byte-unchanged (`git diff` on
`SchemaInferenceEngine.scala` touches only `flattenObject`), and both residuals are real and
disclosed (I reproduced both above). `pipeline-run-execution/spec.md`'s snapshot requirement is
worded honestly and its `AND` clause names the residual rather than papering over it.

### Verdict: REFUTE

The fix is real, end-to-end, and I could not break it on the ticket's own use case. Both change
requests below are instances of the exact failure mode this ticket names — a spec/task claim
whose test does not actually exercise it. Neither is a behaviour bug; both are cheap.

### Change Requests

1. **The dotted-key collision requirement is not satisfied by the code, and its test cannot
   detect that.** `openspec/changes/nested-json-row-flattening/specs/nested-json-flattening/spec.md`
   ("Deterministic dotted-key collision resolution") requires that "exactly one `a.b` column
   exists, the inferred schema and the materialised row select the same one of the two values."
   Measured on `{"a.b": 1, "a": {"b": 2}}`: `leaves` returns `List((a.b,2), (a.b,1))`, the row
   folds to one column (`a.b -> 1`), but **`SchemaInferenceEngine.fromJson` emits the field
   `a.b` twice** (`List(a.b, a.b)`) — a duplicate-named field in the `InferredSchema`/registered
   `DataType`. The schema projection does *not* fold to a `Map`, so "exactly one column" is false
   on that side. `JsonFlattenerSpec`'s collision test hides this precisely because it asserts on
   `JsonFlattener.leaves(obj).toMap` — the `Map` fold is what makes it pass, and the schema path
   never performs it. Design D4's claim that the path sort makes last-wins "deterministic" is also
   overstated: `sortBy` is stable, so among two equal `a.b` paths the winner is inherited from
   `JsObject`'s own field iteration order, not from the sort.
   Fix either way, but make code and spec agree: (a) dedupe by path (last-wins) inside
   `SchemaInferenceEngine.flattenObject` — or in `leaves` — and assert the schema side directly
   (`fromJson(coll).fields.map(_.name) shouldBe Seq("a.b")` plus same-value agreement with the
   row); or (b) amend the spec requirement and D4 to state the actual behaviour and drop the
   "exactly one column" promise. Note this duplicate also exists on `main`, so it is not a
   regression — what is new is a shipped spec requirement asserting it is fixed.

2. **AC "the bound's behaviour at the limit is defined and tested" is defined but not tested.**
   `JsonFlattenerSpec` "treat an object at the depth bound as a leaf rather than recursing
   further" asserts only `result should not be empty` and `result.head._1 should startWith("n")`
   — it would pass unchanged for `MaxDepth = 1`, `MaxDepth = 100`, or an implementation that
   silently truncated the path. Task 5.1 nevertheless claims "object at `MaxDepth` becomes a
   leaf" is covered, and the spec scenario promises "a single leaf whose row value is its compact
   JSON text and whose inferred type is the string type, and no deeper path is generated."
   I confirmed by probe that the code does exactly that (10 segments, `JsObject` leaf,
   `StringType`, compact-JSON row value), so this is purely a missing assertion. Strengthen that
   test to pin: the leaf path has exactly `MaxDepth` segments, the leaf `JsValue` is still a
   `JsObject`, `jsRowToRow` yields its compact JSON text as a `String`, and `fromJson` types it
   `StringType`.

### Non-blocking notes

- `scripts/concertino/next-report-number.sh` and `persist-evidence.sh` do **not** exist in this
  worktree's `scripts/concertino/` (only `assert-phase/cleanup/setup-worktree/start-servers`);
  I used the main-tree copies. Not environmental for this ticket, but the worktree's script set
  is stale relative to `main`.
- No UI surface changed (backend-only diff), so no design-standard review applies; servers were
  not started.
- The live-probe transcript's `rowCount: 1000` vs my live fetch's 1364 rows is upstream data
  drift, not a discrepancy in the evidence — the committed regression fixture is frozen and I
  verified it verbatim.
