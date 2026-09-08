## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**Ground truth read, not narrative:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both
spec deltas, plus the shipped `frontend/src/shared/ui/useSortedRows.ts` (full file),
`SortableTh.tsx`/`SortableTh.css`, `DataGrid.tsx:108-112,225-255`,
`TableRenderer.tsx:1-130`, `PanelContent.tsx:95-145`, `outputConfigTypes.ts:66-118`,
`types/output.ts`, `useOnboardingHost.ts:32`, `PipelineListTable.tsx:151`,
`outputsSlice.ts:117`. HEAD = `6b081b86`.

**1. Round-4 blank-string fix, executed as specified against the shipped hook.** I implemented D3's
exact `getValue` rule plus the real `compareValues`/`compareNonNull`/memo body from
`useSortedRows.ts:38-93` in node and ran the full matrix:

```
num            ['1.25','1.5','1.9','2','10']                      (decimals correct)
blank asc      ['-5','3','10','',' ',null,undefined]              (all four blank forms last)
blank desc     ['10','3','-5','',' ',null,undefined]              (last in BOTH directions)
zeros          ['2','007','10']
dates          [..12:00:00Z, ..12:00:00.123456Z, ..12:00:00.900Z] (ISO path still reached)
mixed          ['2','10','abc','']                                (numerics first, blank last)
bool           [false,true,true]
obj            [{a:1},'5']
coercions      0x10->16, 1e3->1000, "Infinity"->str, "NaN"->str, " "->null, " 12 "->12
```

The fix holds and I found **no new adjacent defect**. Specifically checked that it did not break the
three things it sits next to: `Number("")===0` no longer reachable; the blank no longer bypasses
`useSortedRows.ts:58-62`; and ISO strings still fall through to `ISO_DATE_PATTERN`
(`Number("2026-…Z")` is `NaN`). `Number(v)` vs `Number(v.trim())` in the guard vs the coercion is
harmless — `Number` already trims (`" 12 "` -> `12`), so guard and value can never disagree.

**2. CONFIRM bar — could an executor build this without improvising?** Every decision I probed for is
made in the artifacts, with a real citation behind it: the hook-reuse/two-state ruling (D1), the
sentinel and its mutation-failable guard (D2 / 2.3 / 2.4), the coercion rule per value (D3 / 2.1),
the specific `SortableTh` incompatibilities — verified real: `SortableTh.tsx:34` puts `children`
inside the `<button>` and exposes no `style`, while `DataGrid.tsx:237` needs `style={{width}}` on the
`<th>` and `:240-250` renders an interactive `role="separator"` inside it (D4), the storage key name
(`TimelineOutputConfig.sort` confirmed present in the same module) and flat-sibling rationale (D5),
the minimal-patch/activation-only/flush-on-unmount write rules (D6, 3.3/3.3a/3.3b), the required
pre-branch restructure with the correct branch line numbers (D6a, verified against the real file),
and the non-owner pre-check with working idiom citations (`state.auth.currentUser?.id`,
`Output.ownerId`, `PipelineListTable.tsx:151` — all confirmed to exist as cited). `updateOutput`
exists at `outputsSlice.ts:117`. I could not find a decision an executor is forced to invent.

**3. Cross-artifact consistency.** Proposal, design, tasks and both specs agree on: the storage key
and shape, two-state, sentinel-never-written, minimal patch, blanks-last incl. empty strings,
loaded-rows-only, silent non-owner degrade, and the D9a provenance disclaimer. Spec scenarios map
1:1 onto tasks 2.5a/2.5b/2.6/3.4/3.4a/3.5/3.6/3b.5. No drift found after four rounds of edits.

**4. D10 / §5 / 3b.6 (UI-cohesion commitment).** These commit the executor to a *path-referenced*
comparison, not a narrative: 5.1 requires a BASELINE captured before the change (both the panel
chrome and a list table's sort), 5.2 the matching post-change pair in both themes with an explicit
judgement against BOTH neighbours, 5.3 an escalation rather than a third variant if the neighbours
disagree, and 3b.6 pins the riskiest surface (small dashboard-grid panel, both themes) by name.
3b.3's escalation trigger is objective (wrap / clip / displace), not self-assessed budget. This is
judgeable by the final gate.

### Verdict: CONFIRM

### Non-blocking notes
1. `getValue`'s fallback says "stringify, matching `DataGrid`'s `formatCell`", but `formatCell`
   (`DataGrid.tsx:108-112`) uses `JSON.stringify` for objects while a bare `String(v)` yields
   `"[object Object]"`. Either is defensible (object columns tie and stable-sort holds); prefer
   reusing `formatCell`'s semantics so the sort key matches the rendered text.
2. Task 2.1 requires `columns` and `defaultSort` to be `useMemo`-stable but not `rows`. The
   `rawRows` branch rebuilds its record array every render (`TableRenderer.tsx:107`), so the hook's
   `[rows, columns, sortState]` memo will recompute on every render. Cheap at 50-500 rows, but
   memoizing the normalized `rows` in the D6a pre-branch step is free.
3. Task 3.5 specifies the ownership pre-check but not where `ownerId` reaches `TableRenderer`
   (a prop from `PanelContent`'s `useOutputMeta` output, or an auth selector in the renderer).
   Either works; worth one sentence so it isn't re-decided at review time.
4. Line-number nits: D5 cites `outputConfigTypes.ts:71-74` for `TimelineOutputConfig.sort`; it is at
   `:66-69` on this HEAD. Ticket text says `panelThunks.ts:296`, design says `:295`.
