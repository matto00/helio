## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Read skeptic-design-1.md in full** to establish exactly what CR1 required: an explicit
  conversion strategy for `TableRenderer`'s raw-rows path (`rawRows: string[][]` + optional
  `headers`) into `DataGrid`'s `rows: Record<string, unknown>[]` / `columns: ColumnDef[]`
  contract, consistent with the rigor given to the `SqlTab` and `SourceDetailPanel` conversions
  elsewhere in the same documents.
- **HEAD unchanged**: `git log -1` → `83ee240 HEL-218 ...`, matching the design's claimed base.
  Worktree status shows only the untracked `openspec/changes/unified-datagrid-primitive/` dir —
  no source files touched, this is still the design gate.
- **`openspec validate unified-datagrid-primitive --strict`** → `Change 'unified-datagrid-primitive' is valid`.
- **Decision 7 added to design.md (lines 89-106)** and **tasks.md 3.3 expanded (lines 50-62)**:
  both now specify the exact conversion — `cols = headers ?? rawRows[0].map((_, i) => String(i + 1))`,
  `columns = cols.map((key) => ({ key }))`, `rows = rawRows.map((row) => Object.fromEntries(cols.map((key, i) => [key, row[i]])))`.
- **Verified this against the actual current source**, not the design doc's paraphrase:
  - `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:70-94` — read in full. Line 71 is
    verbatim `const cols = headers ?? rawRows[0].map((_, i) => String(i + 1));` — the design's
    "preserves the current positional-label fallback" claim is exact, not approximate.
  - Reference `DataGrid.tsx` (scratchpad path) — re-read in full. `columns?: ColumnDef[]` with
    `{key, header?, render?, width?}`; when `columns` is provided it's used verbatim
    (`resolvedColumns = columns ?? deriveColumns(rows)`); cell lookup is `row[col.key]`. Traced the
    proposed conversion against this: `cols[i]` becomes both the column's `key` and the row's
    object key at position `i` via `Object.fromEntries`, so `row[col.key]` correctly recovers
    `rawRows[ri][i]` for every `i`. The conversion is mechanically correct against DataGrid's
    actual contract, not just superficially plausible.
  - **`PanelContent.test.tsx` — read tests 2.3 and "PanelContent — live table data" directly**
    (lines 140-200), the exact tests CR1 named as the gating evidence:
    - Test 2.3 (`rawRows={[["A"], ["B"], ["C"]]}`, no `headers`): under the proposed conversion,
      `cols = ["1"]` (from `rawRows[0].map(...)` since `rawRows[0]` has length 1), producing three
      one-key row objects `{"1":"A"}, {"1":"B"}, {"1":"C"}` → three `tbody tr` — matches the
      test's `expect(rows.length).toBe(3)`.
    - "live table data" test (`headers={["Revenue", "Region"]}`): `cols = headers` verbatim, so
      `columns = [{key:"Revenue"}, {key:"Region"}]`; header cell text is `col.header ?? col.key` =
      `"Revenue"` — matches `expect(screen.getByText("Revenue")).toBeInTheDocument()`.
    - Both currently-passing assertions the migration must keep green are satisfied by the
      specified conversion, confirmed by tracing the actual code paths rather than trusting the
      design doc's own characterization.
- **No new contradictions introduced by the edit**: re-read design.md and tasks.md end-to-end.
  Decision 7's code block is byte-identical between design.md and tasks.md 3.3 (no drift between
  the two artifacts). The Migration Plan, Risks, and Planner Notes sections are otherwise
  unchanged from round 1's already-verified content and still internally consistent.
- **Round-1 non-blocking items handled correctly, not botched**:
  - Line-citation fix: tasks.md 2.2 now cites `SourceDetailPanel.tsx:127-131`; re-read the file —
    line 126 is the ternary condition (`{previewRows !== null ? (`), 127-131 is the `<PreviewTable
    ... />` JSX exactly as now cited. Fixed correctly.
  - Risks-section "moot upstream noData check" note: the current Risks bullet now states the
    `PanelContent` upstream `noData` check "already intercepts the bound-but-empty case ... before
    `TableRenderer` renders at all — `DataGrid`'s empty state remains reachable for other callers,
    just not exercised by this particular call site today." This is the corrected framing
    requested — not a functional claim that needed re-verification (informational only), and it
    reads accurately.
- **Re-spot-checked the rest of the artifact set fresh** (not just the CR1 delta), since a cold
  spawn shouldn't selectively trust the round-1 report either: re-read `StepCard.tsx:225-264`,
  `SqlTab.tsx:195-234`, `TypeDetailPanel.tsx:193-200`, `PipelinePreviewModal.tsx:30-44`,
  `PreviewTable.tsx` in full, and `PipelineDetailPage.css`'s `step-preview` selectors (grepped:
  `-table-wrapper`, `-table`, `-th`, `-td`, `tbody tr:hover` at lines 462-493) — all match the
  design/tasks docs' claims verbatim. `DataGrid`'s `formatCell`/`deriveColumns`/empty-state logic
  (reference `DataGrid.tsx`) matches Decisions 2/3/3a and the `specs/data-grid/spec.md` scenarios.
  No placeholders/TBDs found in proposal.md/design.md/tasks.md (the one "later HEL-240 tickets"
  deferral is a legitimate out-of-epic-scope non-goal, not in-ticket hand-waving).

### Verdict: CONFIRM

CR1 is concretely and correctly resolved: Decision 7 (design.md) and the expanded tasks.md 3.3
specify an exact, traced-and-verified conversion for `TableRenderer`'s raw-rows path, consistent
in rigor with the `SqlTab`/`SourceDetailPanel` conversions elsewhere in the document, and
confirmed against the actual `DataGrid` contract and the actual `PanelContent.test.tsx` assertions
it must keep green. No new contradictions were introduced, and both round-1 non-blocking notes
were handled correctly.

### Non-blocking notes

- Design.md's Context section cites the `StepCard.tsx` table markup as lines `237-259`, while
  tasks.md 3.1 cites `236-260` (236 is the ternary's opening paren, 260 is the wrapper `</div>` —
  both readings are defensible depending on whether the ternary punctuation is included). Cosmetic
  only, same class of nit as round 1's line-citation note; not worth its own revision round.
