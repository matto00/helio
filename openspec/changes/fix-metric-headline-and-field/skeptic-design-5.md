## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 835b57d939972f908c528629910ad32cada7a331, which equals `origin/main` after a fresh fetch. The change
dir is untracked on top of it.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.
`openspec validate fix-metric-headline-and-field --strict` → "Change 'fix-metric-headline-and-field' is valid".

### What I verified (with evidence)

**Fast-forward impact (0614c979 → 835b57d9)**
- I ran `git diff --stat 0614c979a..HEAD`, excluding openspec. The only non-openspec changes are `.github/workflows/ci.yml`
  and `frontend/src/features/pipelines/**`.
- No file the design cites was touched.
- I re-derived the citations on the new HEAD:
  - `OutputSummaryReducer.scala`: the `metric` function is at :87-103 (the design says 88-102). It still has
    `if (mapping.size == 1) mapping.headOption`.
  - `metricHistoryView.ts`: `resolveServerMetricField` is at :21-34 and still has `strings.length === 1 ? strings[0]`.
  - `OutputBindingSpec.scala:64-67`: Metric slots are `{value, label?, unit?}`. `validateFieldMapping` (:158-172)
    rejects only UNKNOWN keys and never enforces `requiredSlots`. So `{label}` + `aggregation.value` is a storable
    config, and D1's claim holds.
  - `usePanelData.ts`: pageSize 200 at :160/:187. `usePanelSortFilter.ts`: pageSize 200 at :139.
  - `useCrossFilterServerOps.ts:84`: `mode: "client-fallback"`.
  - `PanelContent.tsx`: the client narrowing is at :230-247, `isCrossFiltered` at :254, and `LoadedScopeDisclosure` at
    :363-370. The round-4 note is fixed.
  - `crossFilterRows.ts:114-126`: `isPanelFilterableByDimension` uses the fieldMapping values.
  - `PublicDashboardViewerPage.tsx:132`: `crossFilterMode="none"`.
- Methods and files the design names, all present:
  - `PublicDashboardRoutes.resolveRows` (:131) returns `PagedResult[JsValue]`, as D2 says.
  - `OutputRepository.findConfigById` (:144) and `findConfigsByIdsInternal` (:156).
  - `NodeSnapshotRepository.listRowsPaged` (:326).
  - `OutputHistoryService` :118 uses `nearestAtOrBefore` with no identity check, as D4 says.
  - Present on disk: `HelioRouteTest`, `OutputSummaryReducerSeamSpec`, `aggregate.fixture.test.ts`,
    `shared-test-fixtures/output-summary-reducer.json`, both history schemas (title `OutputHistoryResponse`,
    `additionalProperties: false`), and `output-rows-response.schema.json`.

**Round-4 CRs**
- **CR1 (option i): addressed.** The rule is the same in all four places:
  - Spec: "A cross-filter applied client-side to the loaded rows SHALL use the loaded-rows value".
  - D5: "Every `client-fallback` narrowing keeps the loaded-rows value (no same-column carve-out …)".
  - D6: "Under a server-applied filter with no client-fallback narrowing …".
  - Task 2.4: "every client-fallback narrowing keeps the loaded-rows value (D5)".
  - I grepped design/tasks/spec for "equal values" and "same-column-eq case". Nothing remains except D5's explanation
    of why there is no carve-out. Because the rule keys on `isCrossFiltered`, the reference-inequality quirk from
    round 4 only ever yields the loaded value, which is correct when the loaded rows are the source.
- **CR2: addressed.** proposal.md "What Changes" now reads "how it is labelled is pending an owner ruling (design.md
  D5)". Nothing pre-decides option (a).
- **Notes: addressed.** The line citation is fixed, and tasks 2.5/2.6 are back in order.

**Whole-design pass**
- AC coverage:

  | AC | Covered by |
  |---|---|
  | Filtered headline over the full filtered set | D2/D3/D6, tasks 1.2-1.4, 2.2-2.4, red 3.5 |
  | Labelling escalation | D5, task 2.6 |
  | Never pick a non-metric field; null on both sides | D1, tasks 1.1/2.1, reds 3.1/3.4 |
  | Failing-first tests: server unit + route | 3.1, 3.2, 3.3 |
  | Failing-first tests: client RTL | 3.5 |
  | History backfill or note | D4, task 1.6, red 3.3/3.4 |

- Contract deltas are planned for every surface the design touches:
  - the rows schema;
  - a new public rows schema, with title pairing (task 1.5);
  - both history schemas (task 1.6);
  - spec deltas for the 4 capabilities.
- The spec MODIFIED blocks are unchanged since round 4, when I diffed them against `openspec/specs/` and found no
  dropped text.
- I found no placeholders or TBDs beyond the two deliberately pending owner rulings. Execution is parked on those.

### Verdict: CONFIRM

### Non-blocking notes

- D3 says the opt-in `HELIO_MEASURE=1` mechanism follows `OutputHistoryCostMeasurementSpec`'s pattern. That spec has no
  env gate: grepping it for env/assume/cancel finds nothing, and it runs in `testFull`. Only the measurement style
  carries over; the executor must add the opt-in gate itself (e.g. `assume(sys.env.get("HELIO_MEASURE").contains("1"))`).
- The spec sentence "labelled as computed over the loaded rows when not every row is loaded" is normative. If the owner
  rules (a), task 2.6's guard (the HEL-588 disclosure renders on a metric panel) is what the evaluator will hold up
  against that sentence. The ruling should say explicitly that the disclosure satisfies it.
- The headline requirement says "SHALL NOT aggregate only the loaded rows". Its "when field/agg equal" qualifier plus
  the trailing "Otherwise … as before" clause cover the in-flight or older-server fallback in D6. That works, but it
  reads tightly. The evaluator should apply it with D6 alongside.
- The design touches more than the driver's "metric headline and reducer code" constraint: the public route, the
  repository, and the history schemas. Every addition traces to an AC (the filtered aggregate on both paths; the
  history check). The expansion is justified, but the PR should state it.

### Items for the post-gate owner escalation (beyond D5 labelling and D4 backfill)

- **Frame D4 as a bundle, not a yes/no on backfill.** "No backfill" relies on the additive `current/baseline.metric`
  identity plus the client guard. A V117 null-out would need a selection heuristic, because the config may have
  changed since the row was written. For example: null `summary.metric` where the stored `field` equals that row-time
  config's `fieldMapping.label`/`unit`. That heuristic is itself something the owner should see. Also say that under
  "no backfill", raw `current`/`points` on the API/MCP keep reporting spurious stored values until retention ages them
  out.
- Under option (a): confirm that the existing disclosure satisfies the spec's "labelled as computed over the loaded
  rows" sentence (see the note above).
