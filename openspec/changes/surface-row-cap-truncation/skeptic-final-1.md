## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `bug/surface-row-cap-truncation/hel-861` @ `61d8d07b`. Every conclusion below is
derived from the diff, the running app, or a command I ran myself. The evaluator's `evaluation-1.md`
was read as a set of claims, not as facts.

### What I verified (with evidence)

#### 1. The core outcome, end to end, against the ticket's real 3,303-row source

Ground truth first — I fetched the ticket's repro URL myself:

```
QB-only  → 355 rows      (my under-cap control)
all pos. → 3303 rows     (the ticket's repro shape)
```

Servers started via `scripts/concertino/start-servers.sh` + `assert-phase.sh servers` → `PASS servers`.
I then created a real connector, two real REST sources, and two real pipelines through the live API
(`localhost:9200`) and ran them.

**Create-time advisory (D6), 3,303-row source** — `POST /api/sources` returned:

> `rowCapNotice`: "This source already holds 3303 rows, more than the 1000-row run cap. Pipeline runs
> over this source will be truncated to 1000 rows."

**Under-cap control (355 rows)** — `rowCapNotice` key absent entirely from the response. No false positive.

**Run over the 3,303-row source** — `POST /api/pipelines/:id/run`:

```json
{"rowCount":1000,"sourceRowCount":1000,"sourceTruncated":true,"sourceAvailableRowCount":3303,
 "truncatedReads":[{"dataSourceName":"HEL861-skeptic-big-all","rowsRead":1000,"availableRowCount":3303}],
 "truncationNotice":"Source \"HEL861-skeptic-big-all\" truncated: this run read the first 1000 rows
 returned, out of 3303 available, because of the 1000-row run cap. Results computed from this run —
 including any filter, sort, or aggregate — describe only that partial population, not the full source."}
```

**Under-cap run (355 rows)** — `sourceTruncated:false`, `truncatedReads:[]`, `truncationNotice` absent.
No false positive.

**MCP surface, driven live** — I built `helio-mcp` and called the real `HelioApi.runPipeline` against
the running backend with a real PAT (not a fixture). Verbatim `RunOutcome` (what `jsonResult`
stringifies for the agent):

```json
truncated: true, availableRowCount: 3303, truncationNotice: "Source \"...\" truncated: this run read the first 1000 rows returned, out of 3303 available, ..."
```
and for the under-cap pipeline: `truncated: false` — present as an explicit `false`, so a truncated run
is genuinely distinguishable from a complete one, not distinguishable-by-absence.

**UI** — ran both pipelines in the browser. The banner renders, reads correctly to a human (names the
source, the rows read, the true total, the cap, and the consequence), and is absent for the under-cap
run. Verified in **both** themes: light `rgb(153,98,30)` on `--app-warning-surface`, dark equivalent —
correct token usage (`--app-warning*`, `--space-*`, `--text-sm`, `--app-radius-sm`; no hardcoded
values), good contrast in both, consistent with the sibling warning surfaces already in the codebase
(`RunHistoryModal.css`, `MetricsPage.css`, `StatusChip.css`). Prominent, above the fold, sensible
rhythm. Design-wise I have no objection.

So: **the primary outcome genuinely works.** A caller can tell the number is partial. The refutation
below is not about that.

#### 2. Wording is behaviour

I read every string this change can emit.

- Known-total branch — verified live above. Names read count, true total, cap, and consequence. Correct.
- Unknown-total (SQL) branch — `PipelineRunService.scala:~770`: "…read the first 1000 rows returned
  because of the 1000-row run cap, and more rows exist (the total is not known)." It implies **no**
  number nobody measured, and `PipelineRunServiceSpec` now pins that with a digit-group assertion
  (`digitGroups.distinct shouldBe Vector("1000")`) — a genuinely strong check.
- `rowCapNotice` — correct and actionable (verified live).
- MCP `run_pipeline` description — correctly warns that `rowCount` is not the source's complete count
  and tells the agent to read `truncationNotice` before trusting a filter/sort/aggregate. An agent
  acting on it reaches the right conclusion.

No "accepted-but-wrong config" class of defect found in any string.

#### 3. The cap is unchanged

`grep maxRunRows|MaxRunRows backend/src/main` → `InProcessPipelineEngine.MaxRunRows: Int = 1000`, with
`private val maxRunRows = InProcessPipelineEngine.MaxRunRows`. Value unchanged, still defined exactly
once, **not** configurable (no env var, no config key, no setter). The only change is visibility, and
both new consumers (`CreateSourceEnvelope`, the notice composer) read it rather than embedding `1000`.
No backdoor substitute for reporting.

#### 4. Test strength of `61d8d07b`

- (a) `include("1000")` → `include("read the first 1000 rows")`. This does pin the read-count clause:
  the cap's own occurrence is `"the 1000-row run cap"`, which does not satisfy the new substring. Real
  strengthening. (Caveat, not a defect: `rowsRead` is structurally always equal to the cap when
  truncated, so no test can distinguish them — nothing the executor could have done.)
- (b) The unknown-total branch is now directly unit-tested, including the digit-group assertion. This
  is the strongest single assertion in the change.
- (c) I checked your read and **it holds**. `truncatedReads.map(_.dataSourceName) shouldBe
  Vector("primary-source","union-secondary","lookup-secondary")` is `shouldBe` on a 3-element
  `Vector[String]` — exact structural equality, so it fails for *all five* other permutations, not just
  the one the old `groupBy(...).values` produced. It is not vacuous: the fold-based dedupe is genuinely
  order-preserving (`acc :+ read` in first-seen order, primary prepended), the three sources are given
  *distinct* names via the new `seedRestDsNamed` helper (the old `seedRestDs` hardcoded `'ds-rest'`,
  which would have collapsed all three into one dedupe key and hidden any regression), and all three
  are over-cap so all three are actually recorded. Your read is correct.

#### 5. Anything else that silently truncates?

I re-derived this independently rather than trusting the design. Enumerating every row-bounding site
in `backend/src/main`: `RestApiConnectorDriver.fetch` and `SqlConnectorDriver.fetch` (both now report),
`SchemaInferenceEngine` 100-row sampling (inference, explicitly out of scope), `SqlConnectorDriver
.inferSchema` 100 / `previewSql` 10 / `SourceService.previewRest` 10 (preview and inference paths, not
run paths), `PipelineRunService:250` `previewRows.take(10)` (a preview whose `rowCount` still reports
the true total, so not misleading), and `DataTypeRowRepository` `LIMIT $n` (a **caller-supplied** limit,
not a hidden cap). Uncapped kinds (static/CSV/text/PDF/image) correctly report
`SourceReadStats(false, None)`. Secondary sources are covered — `join`/`union`/`lookup` all re-enter the
single `loadSource` choke point, which records into the sink, and the step-preview path passes its own
sink (confirmed in the code, and pinned by a test).

**I found no remaining read path that applies a cap and reports nothing.** The backend design is sound.

#### 6. Gates — all four re-run by me, output read

| Gate | Result |
|---|---|
| `sbt test` | `Tests: succeeded 3702, failed 0` / `All tests passed` |
| `npm test` | MCP 213/213, frontend 2947/2947 (run from a throwaway detached worktree outside `.claude/worktrees/`, since the root jest config ignores it) |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |

#### 7. Contract artifacts

There is no JSON Schema file for `RunResultResponse` (`grep sourceRowCount schemas/` → nothing; the
run-result response shape was never schema'd, only the *persisted* `pipeline-run-record`). So the
"schemas/openspec updated" AC is satisfied by the openspec spec deltas, and there is no missing schema
update. Verified, not assumed.

---

### Verdict: REFUTE

Everything above passes. The change is, on the backend and at the API/MCP boundary, genuinely good work
that solves the ticket's actual problem. But there is **one reproduced UI defect that recreates the
ticket's own failure mode in mirror image**: a pipeline that was *not* truncated displays a truncation
warning naming a source it does not use. The whole point of this ticket is that a caller can trust what
the surface tells them about completeness; a false truncation warning is the same trust failure with the
sign flipped, and it fails the ticket's explicit "no false positives" acceptance criterion at the one
surface a human actually looks at.

This is **not** the known/accepted HEL-873 (banner lost on reload). It is the opposite: the banner
persists where it must not.

### Change Requests

1. **Stale truncation banner leaks across pipelines — a false truncation warning on an untruncated
   pipeline.** `frontend/src/features/pipelines/state/pipelinesSlice.ts:370-376`.

   *Reproduction (I ran it twice, from a fresh page load each time — stable, not a flake):*
   run the 3,303-row pipeline, see the banner correctly; then click any other pipeline in the sidebar.
   The banner **remains**, still naming the other pipeline's source and its 3303 rows. I reproduced it
   on `HEL-315 offers pipe` — a `Static` source with **3 rows**, last run a month ago — which then
   displays "Source "HEL861-skeptic-big-all" truncated: this run read the first 1000 rows returned, out
   of 3303 available…". Screenshot:
   `.concertino/runs/HEL-861/evidence/openspec/changes/surface-row-cap-truncation/hel861-stale-banner-repro.png`

   *Probe-confirmed root cause (not a guess):* `PipelineDetailPage.tsx:229-234` already has an effect
   whose cleanup, keyed on `id`, dispatches `clearRunState()` on every pipeline navigation — which is
   precisely why the rows table and status chip *do* clear correctly. But `clearRunState`
   (`pipelinesSlice.ts:370-376`) clears `runId`, `runStatus`, `runError`, `runIsDry`, `runResult` and
   was **not** extended with the three new run-scoped fields this change added. Every sibling field is
   cleared; only the three new ones are not. That asymmetry is the entire bug.

   The change already recognises this hazard and handles it in the *other* place — `submitPipelineRun
   .pending` resets all three with the comment "so a stale notice from a previous run never lingers on
   screen" (`pipelinesSlice.ts:489-496`). The navigation path was simply missed.

   *Required fix:* add `state.runSourceTruncated = false; state.runSourceAvailableRowCount = null;
   state.runTruncationNotice = null;` to the `clearRunState` reducer, so the three new fields are
   cleared on pipeline navigation exactly like every other run-scoped field.

   *Required regression test:* a test that would actually catch this — i.e. one that exercises
   `clearRunState` (not just the `pending` case, which is already green today). Asserting that
   `pipelinesReducer(stateWithTruncation, clearRunState())` yields
   `runSourceTruncated === false` / `runTruncationNotice === null` would be red against the current
   code and green after the fix. The existing `PipelineDetailPage.test.tsx` banner tests seed the store
   directly and therefore cannot catch this; please do not treat them as coverage for it.

### Non-blocking notes

- `rowCapNotice` says the source "already holds 3303 rows". For a REST source that is a point-in-time
  measurement from inference, not a standing fact. A caller still reaches a correct conclusion, so this
  is not blocking, but "held 3303 rows when its schema was inferred" would be strictly more honest.
- The MCP `run_pipeline` description's `Returns { … }` list omits `pipelineId` and `sourceRowCount`,
  which the tool does in fact return. Pre-existing incompleteness, extended rather than introduced by
  this change; harmless, but the list now reads as exhaustive when it isn't.
- `truncationFields` dedupes by `dataSourceName`. Two *distinct* data sources sharing a name would
  collapse into one notice entry. Vanishingly unlikely and strictly better than the ordering
  non-determinism it replaced; noting it only so it is on record.
- Console shows a pre-existing `404 /api/pipelines/:id/schedule` for pipelines with no schedule,
  unrelated to this change.

### Housekeeping

All dev data I created in the shared Postgres (1 connector, 2 sources, 2 pipelines, 4 data types,
1 PAT) was deleted and verified gone. The throwaway jest worktree was removed and pruned. My
screenshots were kept out of the repo root; the evaluator's pre-existing
`hel861-truncation-banner-light.png` was left where I found it.
