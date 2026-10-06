## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 0614c979a1007fcb0a4cae3b60b4128b3d8950a5 (main plus the untracked change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.
`openspec validate fix-metric-headline-and-field --strict` → "Change ... is valid". That tool does not detect the
contradictions in CR2.

### What I verified (with evidence)

**Round-1 CRs**
- **CR1 (rows schema): addressed.** Task 1.5 and design D2 now cover it.
  `schemas/outputs/output-rows-response.schema.json` is `additionalProperties: false` and has no `metric` property
  today.
- **CR2 (public wire shape): addressed, and "existing keys unchanged" is achievable.**
  - `PublicDashboardRoutes.resolveRows` (`:131-177`) returns `PagedResult[JsValue]`. It is written by
    `PaginationProtocol.pagedResultFormat` (`:30-38`), which emits exactly `items`, `total`, `offset` and `limit`.
  - A dedicated writer that emits those four keys plus an optional `metric` is purely additive.
- **The schema-drift pairing mechanism exists.**
  - `scripts/check-schema-drift.mjs:133-165` pairs each schema's `title` with a case class of the same name.
  - The case class must be found in `JsonProtocols.scala` or `api/protocols/**`. The check compares the property
    set against the field set, and an unmatched title is an error.
  - So `PublicPanelRowsResponse` must be declared under `api/protocols/` (for example next to
    `OutputRowsResponse` in `api/protocols/pipelines/OutputProtocol.scala:74`), not in the routes file. See N1.
- **CR3 (D4 facts): the facts are now accurate.**
  - `OutputHistoryService.forOutput` (`:89-99`) and `resolveBaseline` (`:106-122`) do no identity check.
  - The client's `baselineStale` (`metricHistoryView.ts`) only fires when the baseline is one of the returned
    `points`.
  - The proposed remedy has a problem. See CR1.
- **CR4 (seams): addressed.**
  - D7 and task 3.1 name the `metricField` category. Today the fixture has only `coerce`, `aggregate` and `group`
    (checked with python).
  - Both `OutputSummaryReducerSeamSpec.scala` and `frontend/src/utils/aggregate.fixture.test.ts` exist.
  - Task 3.5 requires the real thunk → slice → `PanelContent` path. The guards are labelled (C1).
- **N1–N7: addressed** in D2/D3/D5/D6 and tasks.md. The N3 pass criterion is now ≤500 ms median added latency.

**D1 is still correct.** `OutputSummaryReducer.scala:88-92` and `metricHistoryView.ts` `resolveServerMetricField`
both still use the lone-mapping branch.

**D4 guard, the specific question asked.** The justification is only partly true.
- *What the existing spec says.*
  - The scenario "Points from an earlier config are excluded" (`openspec/specs/metric-history-delta-ui/spec.md:29-31`)
    says the delta is hidden "if the baseline is one of them".
  - But the requirement that governs delta rendering scopes this to "the baseline is not a **returned point** whose
    stored metric field/aggregation differs" (`:34-35`). That spec is a UI spec.
  - The server contract is `output-history-api` "Comparison resolution". It says, unconditionally: "`baseline`
    SHALL be the newest point captured at or before (`current` − `w`). When no such point exists, `baseline` SHALL
    be `null` and `availableFrom` SHALL be the earliest point's capture time plus `w`."
  - That is HEL-918 owner ruling D6, quoted verbatim in
    `.claude/worktrees/feature/pipeline-run-scrubber-overlay/HEL-1277/openspec/changes/output-history-scrubber-diff/ticket.md:12`:
    "D6 Baseline = nearest point at or before (latest captured_at − window); none → baseline null + availableFrom".
- *What the guard changes.* It creates a state D6 does not have: `compare` is set and history covers the window, yet
  `baseline: null` AND `availableFrom: null`. That state reaches every consumer of the API, not only the panel.
- *Effect on MCP.*
  - `get_output_history` (HEL-1274) returns the route response unchanged (`openspec/specs/mcp-output-tools/spec.md:144-148`).
  - Its description (`helio-mcp/src/tools/outputs.ts:234-250`) tells agents "`baseline` null with `availableFrom` set
    means the compare window is not yet covered". It does not explain the new both-null-with-compare state, and the
    design plans no change to the MCP description or the MCP spec.
  - An agent would read `7d`, 30 days of history and `baseline: null` with no explanation.
- *Effect on public history.* It also applies to the public route (`PublicDashboardRoutes.resolveHistory` → the same
  `forOutput`). The allow-listing is not affected.
- *Conclusion.* Hiding a cross-config delta *on the panel* enforces an owner-endorsed UI rule, and that is in
  authority. Changing the API's resolved baseline for every consumer modifies an owner-ruled contract (D6). That is a
  semantics call for the owner, or it needs an in-authority alternative. See CR1.
- *Statement budget.* The guard adds no statement: config is already loaded (`read` `:52`; public `:311`), so the
  "Bounded query count" requirement holds.
- *HEL-1277 overlap: none in code.*
  - Branch `feature/pipeline-run-scrubber-overlay/HEL-1277` has 0 commits beyond main (`git log main..` is empty and
    the diff is empty).
  - Its change dir holds only `ticket.md` and `workflow-state.md` (PHASE: Planning, with a pending escalation).
  - Its Touches are frontend scrubber files only.
  - Semantic adjacency: its pending "comparison point" sub-question concerns history comparisons. If the owner rules
    on D4, the driver should keep the two consistent.

**D5 narrowing, the specific question asked.** It is not precise enough to escalate as written.
- `PanelContent.tsx:363-370` ALREADY renders `LoadedScopeDisclosure` ("{match} of {loaded} loaded rows match.",
  `LoadedScopeDisclosure.tsx:53-54`) for EVERY output kind, including metric panels, whenever
  `isCrossFiltered && rowsTruncated`.
  - `rowsTruncated` is `paginationEntry.hasMore` (`usePanelData.ts:270`).
  - That is exactly D5's "remaining" sub-case. So the shipped HEL-588 treatment already labels it today.
  - D5 recommends a new "Computed over N loaded rows" caption as if nothing existed. The owner could approve a
    duplicate caption under the existing one.
- D5's public clause ("public: `total <= rows.length`") describes a case that cannot happen.
  `PublicDashboardViewerPage.tsx:132` passes `crossFilterMode="none"` ("no cross-filter can be set on a public
  dashboard"), so `isEligibleTarget` is always false on public.
- The other D5 sub-cases are sound:
  - Same-column control `eq` (`useCrossFilterServerOps.ts:76`).
  - Fully loaded set: the disclosure is already gated on `rowsTruncated`.

**D2/D3 other facts.**
- `Output` has no config field (`model.scala:901-915`). Both rows paths will need a config read
  (`findConfigById` / `findConfigsByIdsInternal`) for the metric case. The design does not mention this. See N2.
- The D3 measurement (1.7) needs a ≥100k-row node. The design does not say where that runs, and the driver forbids
  the shared dev DB. See CR3.

### Verdict: REFUTE

### Change Requests

1. **D4: do not self-approve a change to the owner-ruled comparison contract (D6).** Choose one:
   - **(a) In authority (recommended).** Leave the resolution semantics unchanged. Additively expose the stored
     metric identity (`metricField`/`metricAgg`, or `metric: {field, agg}`) on the resolved `current` and `baseline`
     points of both history routes. Then extend the client's stale check (`metricHistoryView.ts`, the
     `baselineInPoints`/`pointMatches` logic) to use the baseline's own identity, whether or not the baseline is among
     the returned `points`.
     - This enforces the existing UI scenario literally, for out-of-window baselines, on the authenticated and public
       panels.
     - It changes nothing for MCP/API consumers except one additive key. The public allow-list is unaffected, since
       the stored summary is already public.
     - It needs the history response schema/case class (with schema-drift parity), plus a red RTL test: a window
       baseline outside `points` with a mismatched identity → no delta.
   - **(b) Keep the server guard, but put it in the owner escalation** as an explicit option that modifies D6. If the
     owner rules for it:
     - Write it as `## MODIFIED Requirements` of `output-history-api` "Comparison resolution" (full text), not as an
       ADDED requirement.
     - Define `availableFrom` for the mismatched-baseline case deliberately.
     - Update the `get_output_history` description (`helio-mcp/src/tools/outputs.ts:234-250`) and add a
       `mcp-output-tools` delta explaining the new state.

2. **The spec deltas contradict live requirements. Use MODIFIED, not ADDED.**
   - `metric-history-delta-ui`: the existing "Metric headline uses the server all-rows value ..." (`spec.md:10-15`)
     says "Otherwise the panel SHALL display the value computed from the loaded rows exactly as before". That covers
     the filtered case. The ADDED "Filtered metric headline covers the full filtered set" contradicts it.
     - Modify that requirement (and, if needed, "Active viewer filter hides the comparison", `:78-83`, "headline
       computed from the filtered rows") so the archived spec has one rule.
   - `output-history-api`: if option 1(b) is kept, see above. Under option 1(a), drop the ADDED guard requirement and
     instead MODIFY "Comparison resolution" to add the identity key on resolved points.
   - `openspec validate --strict` passes today, so no tool catches this. It must be fixed by hand.

3. **Fix D5 before it goes to the owner.**
   - State that `PanelContent.tsx:363-370` already shows "N of M loaded rows match." on metric panels in exactly the
     remaining sub-case.
   - Reframe the question: is the existing HEL-588 disclosure sufficient labelling for a metric *value*? Or should a
     metric panel get different or additional wording, and if so, should it replace the disclosure or sit beside it?
   - Remove the impossible public clause (public uses `crossFilterMode="none"`, `PublicDashboardViewerPage.tsx:132`).
   - Task 2.5 must say whether "no new UI" is an acceptable ruling.

4. **Pin the D3 measurement environment.**
   - Task 1.7 must name where the ≥100k-row node lives: the EmbeddedPostgres test harness or a throwaway database.
     The shared dev DB is forbidden by the driver and is known to accumulate gate residue.
   - It must also name the command/harness used to take the 20 samples, so the final gate can reproduce the numbers.

### Non-blocking notes

- N1: In tasks 1.4/1.5, state the pairing rule explicitly:
  - The schema `title` must equal `PublicPanelRowsResponse`, declared under `api/protocols/**`.
  - If the nested `metric` gets its own case class and schema, the same rule applies to it.
  - Keep `metric: Option[...] = None` LAST in the case class. `parseCaseClasses` is not paren-balanced (the HEL-873
    caveat, `check-schema-drift.mjs:45-53`).
- N2: D2's helper needs the Output config (`Output` carries none). Say so, and do the extra read only when
  kind = metric, a filter is resolved and offset = 0, so unfiltered requests issue no new statement.
- N3: Add a guard assertion that an unfiltered public response has exactly the key set
  `{items,total,offset,limit}`. That makes "existing keys unchanged" a tested claim.
- N4: Define "a row filter is applied" as "the resolved filter is defined" (an empty/unparsable `filter` resolves to
  none). This matches the existing "empty control value" semantics.

### Items for the owner escalation (beyond D5 wording and D4 backfill)
- D4 option 1(b) if the planner keeps the server guard: it modifies HEL-918 ruling D6 for all API/MCP consumers.
- D5 reframed per CR3: is the existing "N of M loaded rows match." disclosure sufficient for a metric value?
- Optional FYI: D3's ≤500 ms bar is self-set. Over the bar, the plan escalates before merge (already stated).
