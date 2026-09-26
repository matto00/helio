## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **HEL-572 design.md D1 citation (ticket.md/design.md Context claim).**
   Read the archived `openspec/changes/archive/2026-09-25-chart-click-drilldown/design.md`
   in full. The quoted phrase this design's Context attributes to "D1" —
   `"HEL-588 needs to read a panel's selection independent of whether ANY inspect view
   is open"` — is not a verbatim D1 sentence. The two real supporting sentences are:
   - D1 itself: *"HEL-588 needs to read `interactionState` across panels while any
     number of inspect views are open or closed, so nothing here clears one panel's
     entry as a side effect of interacting with a different panel."*
   - The "Alternative considered" paragraph (a different subsection): *"Rejected —
     HEL-588 needs to read a panel's selection from outside that panel's own subtree
     (dashboard-level cross-filter), so it must be lifted to Redux now rather than
     re-plumbed later."*
   The **substance** this design draws from those two sentences (state lives in Redux,
   keyed per panel, specifically anticipating HEL-588 reading the same click) is
   accurate and well-supported. The **citation format** (quotation marks around a
   synthesized paraphrase, attributed to "D1" alone) is not verbatim. Non-blocking,
   but should be corrected to quote (or clearly paraphrase without quotation marks)
   the actual text, split across the two sections it actually comes from.

2. **`chartAggregate` is always `null`.** Read
   `frontend/src/features/panels/hooks/usePanelData.ts` in full: the return type
   declares `chartAggregate: null` (line 34, doc comment: "the Output itself now owns
   any groupBy aggregation, so this is always `null`"), and both the early-return
   branch (line 145) and the normal-return branch (line 174) literally return
   `chartAggregate: null`. Confirmed: **D5's premise is correct.** Also traced the
   metric recompute path: `PanelContent.tsx`'s `OutputPanelContent` (`kind === "metric"`
   branch, lines 164–182) derives `value` from the `rawRows`/`headers` props it is
   given via `computeAggregate(rowsAsRecords, valueColumn, cfg.aggregation.agg)` or
   `firstRow[valueColumn]` — both fresh per render from whatever `rawRows`/`headers`
   reach it. D5's claim that feeding filtered `rawRows`/`headers` upstream (D4) makes
   metric recompute "for free" is accurate, confirmed against the live code, not
   asserted.

3. **D4's origin-panel exemption vs. the ticket's "filters the OTHER panels" wording.**
   Ticket Scope (line 10) says "apply a client-side filter to sibling panels..."; AC
   (line 16) says "filters sibling panels sharing that dimension." "Sibling" is a
   reasonable textual basis for excluding the originating panel, and the design
   explicitly self-flags this as a judgment call for skeptic review (design.md Risks).
   I find the exemption **defensible**: without it, a panel's own click would
   collapse that same panel's chart to a single matching slice/bar, which is neither
   what "cross-filtering" plainly means nor what any AC scenario in `spec.md`
   describes (the spec's own scenario "The originating panel is not filtered by its
   own selection" states this outcome directly). No revision required here.

4. **Header-name-match filterable-panel criterion vs. the ticket's literal "field
   mapping references a column" wording.** This is where I found real problems —
   see Change Requests 1 and 2 below.

### Verdict: REFUTE

### Change Requests

1. **`filterRowsByDimension`'s planned plain string-equality match will silently
   under-match numeric columns cross-filtered from a scatter-chart click — a real,
   previously-solved-and-now-regressed correctness gap.**
   Read `frontend/src/utils/chartClickSelection.ts` in full. HEL-572's own
   `filterRowsForSelection` (lines 130–159) explicitly does **not** use raw string
   equality for scatter-originated selections — it does
   `parseFloat(row[xCol] ?? "") !== target` specifically because, per its own
   comment: *"`selection.value` was stringified from a parsed float... compare
   numerically rather than as raw strings, or formatting differences (e.g. "3" vs
   "3.0") could mismatch."* `mapChartClickToSelection`'s scatter branch (line 104)
   produces exactly this stringified-float `value` (`String(params.value[0])`), and
   that is the **same** `SelectionDescriptor.value` HEL-588's `crossFilter` is keyed
   on (design.md D2/D3 reuse the identical descriptor).
   HEL-588's design.md D4, however, specifies a **new**, simpler util,
   `filterRowsByDimension(rawRows, headers, dimension, value)`, that "returns rows
   whose column value equals `value`" — no numeric parsing, no mention of the
   "3" vs "3.0" hazard at all. `tasks.md` 3.1/6.1 likewise only test "matching
   dimension narrows correctly; missing dimension is a no-op; empty/zero matches" —
   nothing exercises numeric-format equality.
   **Concretely:** a scatter-chart click at x=3 produces `crossFilter.value === "3"`.
   A sibling table/metric panel bound to the same numeric column, if that column's
   loaded string representation differs at all in formatting (a very plausible case
   given values flow through independent pipeline/serialization paths per Output —
   e.g. `"3.0"`, `"3.00"`), will silently match **zero** rows even though the values
   are numerically identical — a quiet violation of "sibling panels ... filters ...
   to the matching subset" that a reviewer would not notice without specifically
   testing scatter-originated cross-filters against a differently-formatted sibling
   column.
   **Required:** either (a) reuse/extend the existing numeric-aware comparison
   (`parseFloat` fallback when both sides parse as finite numbers) inside
   `filterRowsByDimension`, mirroring `filterRowsForSelection`'s established
   handling, or (b) explicitly document in design.md why this hazard does not apply
   to cross-filtering (I could not find a basis for that — the underlying data and
   descriptor are identical), and add a task 6.1 case that exercises exactly this
   scenario (scatter-originated numeric selection cross-filtering a sibling panel
   whose column values have different string formatting) so the gap is provably
   closed rather than assumed away.

2. **The header-based "filterable panel" criterion diverges from the ticket's
   literal "field mapping references a column" wording, and design.md's own
   justification overclaims certainty.**
   Ticket Scope (line 10, `ticket.md`) is specific: "apply a client-side filter to
   sibling panels **whose field mapping references a column** matching that
   dimension (by column name)." I verified that "field mapping" is not vague or
   inconsistently defined across output kinds, as design.md's Planner Notes claims
   ("each shape 'field mapping' differently") — reading
   `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` in full
   shows every `*OutputConfig` (`Chart`, `Table`, `Metric`, `Markdown`, `Collection`,
   `Timeline`) declares an identically-typed `fieldMapping: Record<string,string>`,
   read via a uniform `safeRecord` helper in every `read*Config` function. The one
   real wrinkle is `TableOutputConfig.fieldMapping`, which I confirmed (via
   `TableRenderer.tsx`'s props and `PanelContent.tsx`'s table branch) is read but
   never actually consumed for column selection — a table's visible columns are
   governed by `columnOrder` instead. That is a genuine, narrow ambiguity for table
   panels specifically, but it does **not** extend to chart/metric/collection/
   timeline, which all have a real, currently-used `fieldMapping` (chart's
   `xAxis`/`yAxis`/`series`, metric's value/label/unit columns, etc.) that a
   literal reading of the ticket would scope matching to.
   Design.md's Planner Notes asserts the broader header-based criterion "never
   [gets it] wrong (a header-absent panel is provably unaffected, satisfying the
   'non-matching panels are unchanged' AC exactly)" — this only proves the
   **non-matching** direction. It does not establish that a panel whose loaded data
   happens to contain a same-named column, but whose own configured field mapping
   never references it (e.g., a chart plotting `revenue` by `region`, on an Output
   that also happens to carry an unrelated `quarter` column), is correctly
   "matching" under the ticket's literal intent — a plain reading of "field mapping
   references a column" says it should not be. This also cuts against the
   proposal's own explicit goal of a "legible" cross-filter (proposal.md): a chart
   whose x/y/series never touch the filtered dimension will still narrow, with no
   visual cue tying the row-count change to the indicator's stated dimension beyond
   trusting the indicator text.
   Note also that `specs/panel-cross-filtering/spec.md`'s ADDED requirement already
   hard-codes the same headers-only criterion — this is not just an implementation
   detail under discussion, it is already locked into the spec text this design
   gate is meant to review.
   **Required, one of:**
   (a) Change the criterion to match each output kind's actual `fieldMapping` (or,
   for table specifically, its effective displayed-column set — `columnOrder` when
   present, else all natural columns) rather than the full loaded header set; or
   (b) if the broader, simpler header-based criterion is kept as a deliberate v1
   scope decision, revise design.md's Planner Notes to (i) drop the "never wrong"
   overclaim and state plainly that it is a broader-than-ticket-literal-text
   interpretation, (ii) give it the same explicit "flagged for the design-gate
   skeptic" treatment D4's origin-exemption risk already gets (it currently is not
   flagged with that prominence, despite being the more material textual
   divergence), and (iii) add a task/test that specifically exercises "a sibling
   panel has the column in its loaded headers but its own field mapping never
   references it" so whichever behavior ships is provably intentional, not
   incidental.

3. **Minor: `crossFilter` has no clear-on-origin-panel-delete case, unlike its
   sibling `interactionState`.** `panelsSlice.ts` (lines 178–182) clears
   `interactionState[panelId]` in `deletePanel.fulfilled` specifically so a deleted
   panel's selection "must not linger as an orphaned entry." Design.md D2 only
   specifies clearing `crossFilter` on the existing dashboard-switch case
   (`fetchPanels.pending`), with no equivalent for `deletePanel.fulfilled`. If the
   panel that originated the active cross-filter is deleted, the filter would
   persist (harmlessly clearable via the indicator's clear-all button, but silently
   inconsistent with the precedent this same slice just established one field over).
   **Required:** add a `deletePanel.fulfilled` case clearing `crossFilter` when
   `action.payload === state.crossFilter?.panelId`, or explicitly justify in
   design.md why this asymmetry with `interactionState` is acceptable.

### Non-blocking notes

- Fix the D1 citation in design.md's Context section per verification item 1 above
  — synthesize-and-quote is easy to mistake for a literal citation on a later,
  colder read.
- Consider whether the `LoadedScopeDisclosure` re-use in D7 needs any special
  wording when a panel is filtered by header-match-but-field-mapping-mismatch (CR2)
  — out of scope to resolve now, but worth a follow-up thought once CR2 is settled.
