## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **D2's central claim — "the frontend does not receive the MAP/STRUCT classification" — is TRUE.**
  `SchemaInferenceEngine.inferJsonType` (`backend/.../engine/SchemaInferenceEngine.scala:200-211`)
  ends `case _ => (DataFieldType.StringType, false) // arrays, objects at leaf`, and
  `DataFieldType.asString` (`model.scala:682-689`) has no object/map/json member at all. A
  map-classified leaf therefore reaches the wire as `type: "string"` on
  `OutputSchemaField` (`frontend/src/features/pipelines/types/output.ts:16-19`), which is what
  `useOutputMeta` fetches. There is no signal the frontend could use to identify a map column, so
  option (b) ("refuse to filter map columns") really would require a second, weaker,
  `typeof value === "object"` classifier. D2's justification stands, and the reasoning ("the filter
  matches what the cell shows", with clipping named as a legibility limit) is defensible.
- **`formatCell` is genuinely exported and reusable** — `DataGrid.tsx:128-132` (design cites
  `108-112`; off by ~20 lines, see note 1).
- **Empty-state early return confirmed** — `DataGrid.tsx:229-231`,
  `if (rows.length === 0) return <p className={emptyClasses}>{emptyText}</p>;`, before the `<table>`.
  D5's premise is accurate.
- **HEL-448 pipeline confirmed as described** — one pre-branch normalization (`normalizedRows`,
  `TableRenderer.tsx:186-200`), one `useSortedRows` call (`:212-216`), `canWrite` at
  `TableRenderer.tsx:159` (design says `:157` — off by 2, note 1), flush-on-unmount effect
  (`:230-240`), activation-only persist in `handleSort` (`:249-268`), minimal-patch
  `persistColumnSort` with the deliberate commented `.catch` (`:129-133`). D3/D6 extend rather than
  duplicate these correctly.
- **Sort qualifier is correctly described as NOT approved** — `TableRenderer.tsx:283-288` carries the
  "pending owner confirmation" comment; design D4 and tasks 4.6 both say pending, nowhere approved.
- **HEL-1027 verified live** via Linear: status `Backlog` (open), title
  "Server-side sort, filter and counts for Output rows...", body explicitly owns the filter
  parameter, the filtered total, and removal of this ticket's disclosure. Deferral is real.
- **Gate-scanning caveats are correctly encoded** — tasks 6.2 names the root-`npm test`
  `--passWithNoTests` trap; 6.4's paths match `.gitignore`.

### Verdict: REFUTE

The design is strong and most of the attacked claims survive. It fails on one thing, and it is the
ticket's central obligation: **the disclosure trigger `truncated = usingPagination && paginationHasMore`
is false on the surface the persistence AC exercises, so D4's matrix will render its "complete
answer" states over a set that is in fact truncated.**

### Change Requests

1. **D4's `truncated` predicate is wrong in the panel detail modal — the honesty guarantee inverts
   there.** `PanelDetailModal.tsx:400-410` renders `PanelContent` with `rawRows`/`headers` only —
   it passes NO `paginationRows`, NO `paginationHasMore`, NO `onLoadMore`. Meanwhile
   `usePanelData.ts:87-95` derives `rawRows` from the SAME paginated `paginationEntry.rows` (initial
   page 200, appended by "Load more"). So in the modal, `TableRenderer` takes the `rawRows` branch
   (`usingPagination === false`) over a row set that is genuinely truncated, and D4 computes
   `truncated = false`. The matrix then renders, per design D4 and per
   `specs/table-panel-column-filtering/spec.md` ("A complete filtered result carries no scope
   caveat", "Complete empty results do not offer to load more"):
   - an **unqualified match count**, described in D4 as "it is a complete answer — every row is
     loaded". It is not; it is a count over a 200-row sample.
   - the **non-truncated empty state** ("No rows match your filter." + Clear filters only) in exactly
     the case workflow-state.md calls "the sharpest": a confidently wrong "no results".

   This is not the settled counts ruling being re-argued — the restated AC ("counts and Load more
   describe the LOADED row set, and the UI must not imply otherwise") is precisely what this breaks.
   Revise D4 and the spec's fourth requirement to define truncation from something true on BOTH
   branches, and state what the modal does. Note the modal has no `onLoadMore` handler at all, so
   "offer Load more" is not implementable there — the design must say what the truncated-empty state
   renders when no load-more affordance exists (e.g. disclosure text without the action), rather
   than leaving the executor to discover the undefined prop.
   Also add the corresponding Jest case: the five-state matrix exercised on the `rawRows` branch,
   not only the pagination branch (tasks 4.5 currently says "all five states" with no branch named,
   while 2.3 correctly insists on both branches for sort composition).

2. **D5's restructure is under-specified in exactly the class of defect tasks 6.3 warns about.**
   D5 says only "the empty-state branch can no longer short-circuit the whole render when filtering
   is active"; tasks 3.4 restates the same sentence. Neither says WHAT renders: whether the empty
   message becomes a full-width `<tr><td colSpan={n}>` inside the existing `<tbody>`, or a sibling
   `<p>` after a header-only `<table>`, or the message stays outside the `role="region"` scroll
   wrapper (`DataGrid.tsx:246`). These produce visibly different geometry, alignment and scroll
   behaviour, and the choice is the exact "no source text carries it" case lane B's 40px
   misalignment came from. Specify the markup shape in D5 and commit tasks §3/§6 to measuring the
   rendered result (filter row baseline vs. header row, empty-message alignment against the first
   column) rather than asserting token compliance.

3. **Task 3.3's "renders EXACTLY as before" needs a named consumer to check against.** The empty
   state is shared (`emptyText` defaults to "No data to preview.", `DataGrid.tsx:146`) and D5
   changes the branch every consumer passes through. Enumerate the existing `DataGrid` empty-state
   consumers in tasks 3.3 (at minimum `OutputPreviewPane` and the `preview` variant call sites) and
   require the no-action path to be asserted for one of them, so "no regression" is evidence rather
   than a claim.

### Non-blocking notes

1. Two file:line citations are stale: `formatCell` is `DataGrid.tsx:128-132` (design says 108-112);
   `canWrite` is `TableRenderer.tsx:159` (design/tasks 5.5 say :157). Correct them so the executor
   does not edit the wrong region.
2. Per-column filter keys on the `rawRows` branch with no `headers` are positional
   (`TableRenderer.tsx:180`: `String(i + 1)`), so a persisted `columns: { "3": "emea" }` binds to a
   position, not a field. `columnSort` inherits the same weakness, so this is precedent rather than
   a new defect — but D1 should say so explicitly rather than leave it to be rediscovered.
3. No baseline screenshots captured: no implementation exists, the servers were not running, and
   starting them for chrome that this change has not yet touched is not the cheap capture the brief
   contemplated. The final gate should capture the HEL-448 sort header / HEL-1022 list-table
   comparison fresh.
