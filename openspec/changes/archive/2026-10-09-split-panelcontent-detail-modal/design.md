## Context

Base: origin/main bcde936d. All paths are under `frontend/src/features/panels/`.
- `ui/PanelContent.tsx` (536 lines): imports L1-48, `PanelContentProps` L50-137, the private `OutputPanelContent`
  L139-398, and the exported `PanelContent` L400-536.
- `ui/detailModal/PanelDetailModal.tsx` (589 lines):
  - imports L1-47
  - `padSeriesColors` + `buildInitialChart` L49-70 (HEL-1378 edited L58-61)
  - private `OutputPanelSection` L72-146
  - props interface L148-155
  - `EMPTY_CONTROLS` L157-160
  - `PanelDetailModal` L162-589: data wiring L166-217, `useNavigate` L218, edit state L220-292, keydown effect
    L294-314, handlers L316-377, `renderSubtypeEditor` L379-421, JSX L423-588
- Nothing moved is exported today, so no test imports a moved symbol. Tests `jest.mock` modules by resolved path
  (`../../hooks/usePanelData`, `../editors/AppearanceEditor`, `outputService`). Those mocks keep applying when the
  importer moves.
- Precedent: HEL-1365 (0ebc784b). It used a whitespace-stripped byte-identity transcript and kept hook order unchanged.

## Goals / Non-Goals

**Goals:**
- Every touched or new source file is under 400 lines.
- Moved code is byte-identical modulo whitespace.
- The hook call sequence of `PanelDetailModal` and `OutputPanelContent` is unchanged.
- DOM output is unchanged.

**Non-Goals:**
- Any behaviour change or bug fix.
- HEL-1395 item 3 (dead chart-type section).
- Test-file comment edits other than the D5 nits.
- New tests beyond the D5 nits.

## Decisions

**D1 — PanelContent split.** Create `ui/OutputPanelContent.tsx` holding L139-398 verbatim. The only token change is
the `export ` prefix on the `function OutputPanelContent({` line. `PanelContent.tsx` keeps L50-137 and L400-536
verbatim and imports `OutputPanelContent`. Each file imports exactly what it uses. Lint does NOT catch unused imports here: no `@typescript-eslint` rules are active (skeptic-design-2 note 1). So verify with `npx tsc --noEmit --noUnusedLocals -p tsconfig.json`, filtered to the touched/new files, which MUST show zero hits. The
`./PanelContent.css` import stays in `PanelContent.tsx`, the only parent of `OutputPanelContent`, so CSS load order is
unchanged. Renderer modules (ChartOutputPanel, renderers/*) may inject their own stylesheets. To keep evaluation order
closest to the original, place the `./OutputPanelContent` import where the first moved renderer import sat. The live
before/after comparison (tasks 1.2/5.3) is the check. Rejected: a barrel re-export.

**D2 — PanelDetailModal split** (new files live in `ui/detailModal/`; each body is verbatim):
- (a) `panelDetailChartState.ts`: L49-70. Only the `function buildInitialChart` line gains `export `.
- (b) `OutputPanelSection.tsx`: L72-146. Only the function line gains `export `. It is still a separate component
  mounted at the same JSX position (L551), so the tree is unchanged.
- (c) `usePanelDetailData.ts`: L157-160 (`EMPTY_CONTROLS` + comment) at module level. `export function
  usePanelDetailData(panel: Panel)` has a body of L166-217 verbatim, plus a trailing `return { … }` of every
  identifier the host still reads:
  - `controls`, `controlValues`, `setControlValue`, `clearControlValue`, `controlFilterOps`, `hasVisibleControls`,
    `fetchDistinctValues`
  - `viewOutputId`, `viewOutput`, `crossFilterMode`
  - `data`, `rawRows`, `headers`, `isLoading`, `error`, `errorKind`, `noData`, `neverMaterialized`,
    `paginationRows`, `rowsTruncated`, `refresh`, `totalRowCount`

  The host calls it between `useTheme()` (L164) and `useNavigate()` (L218).
- (d) `usePanelDetailEditState.ts`: `export function usePanelDetailEditState(panel: Panel, initialMode: "view" |
  "edit")` has a body of L220-314 verbatim (edit state plus the keydown `useEffect`; skeptic-design-1 CR1), plus a trailing `return { … }` of every identifier the host still reads:
  - `modalMode`, `setModalMode`, `initialTitle`
  - `title`, `setTitle`, `background`, `setBackground`, `color`, `setColor`, `transparency`, `setTransparency`,
    `chartAppearance`, `setChartAppearance`
  - the six editor refs, `activeEditorRef`
  - `isSaving`, `setIsSaving`, `subtypeDirty`, `handleSubtypeDirtyChange`, `showDiscardWarning`,
    `setShowDiscardWarning`, `isAnyDirty`, `resetFormToPanel`

  The host calls it right after `useNavigate()`. The `eslint-disable-next-line` inside `resetFormToPanel` moves with
  it unchanged. The keydown effect (L294-314) has to move too, for this reason. Its deps `[modalMode]` omit
  `setModalMode`. That passes `react-hooks/exhaustive-deps` only while the setter comes from a `useState` in the same
  function; destructured from a custom hook, the rule warns, and lint runs with `--max-warnings=0`. No hook call sits
  between L292 and L298, so the order is unchanged. General rule: no verbatim host code may keep a deps array that
  names an identifier the host now receives from a hook.
- (e) `renderSubtypeEditor.tsx`: `export function renderSubtypeEditor({ panel, markdownEditorRef, textEditorRef,
  imageEditorRef, dividerEditorRef, formEditorRef, handleSubtypeDirtyChange }: {…})` has a body of L380-420 verbatim.
  It is a plain function called during render at L559's position, not a component, so no tree layer is added. The
  parameters are named exactly as the identifiers the body uses, so the moved body needs zero token changes.
- The host keeps the props interface, `handleDiscard`/`attemptClose`/`handleEditSubmit` and the
  JSX verbatim. The only change is at L559, where `renderSubtypeEditor()` becomes `renderSubtypeEditor({ … })`.
- Hook sequence is preserved by construction. (c) and (d) each wrap a contiguous run of hook calls and sit in that
  run's original slot. No hook moves across another.
- Rejected seams:
  - Extracting the view body or edit form JSX as components. That adds a tree layer and needs 20+ props.
  - Splitting (c) further, e.g. a separate `useViewerControls` wrapper. It gives no size win.

**D3 — Byte-identity proof (Commit 1 is the pure move).** For every moved range, compare `git show
bcde936d:<old file> | sed -n 'a,bp'` with the corresponding range in the new file. Strip ALL whitespace from both
(`tr -d '[:space:]'`) and also strip the permitted `export ` prefix. Record char counts and sha256 per block. The host
remnants (PanelContent L1-137 non-import lines and L400-536; PanelDetailModal L148-155, L162-165, L218, L316-589 minus the
L559 call) are compared the same way. Any non-identical block is a defect. Code that is permitted to be new:
- import lines
- the `export` prefixes
- the hook/function signatures and their `return { … }`
- the two hook call sites (destructuring)
- the `renderSubtypeEditor({ … })` argument list

The transcript is persisted as evidence.

**D3b — Hook-sequence transcript.** List, in order, every hook call executed by base `PanelDetailModal` (L163-314)
and by the branch host with (c)/(d) inlined at their call sites. The keydown `useEffect` is now inside (d). The two
lists MUST be equal. Do the same for
`OutputPanelContent`. Persist alongside D3.

**D4 — Comment touch-ups (Commit 2, comment text only).**
- Run `git grep -nE "PanelContent\.tsx|PanelDetailModal\.tsx|OutputPanelSection|OutputPanelContent" -- frontend/src`
  and read every "above"/"below" pointer inside the moved blocks (e.g. base L196 "`OutputPanelSection` below",
  L243-244 "see `OutputPanelSection` above").
- Classify each hit as `fixed`, `still-correct`, or `test-file (not edited)`. Historical provenance stays as written.
- Non-test source fixes only. Test-file stale hits (e.g. `PanelCard.filterEmptyState.test.tsx:5`,
  `TableRenderer.test.tsx:1028`) are listed as follow-ups. HEL-1395 item 4 already owns
  `PanelCard.crossFilter.test.tsx`.
- `openspec/specs/write-path-audit/spec.md:191` cites a long-dead `frontend/src/components/PanelDetailModal.tsx`. It is
  pre-existing and out of scope, so it is listed as a follow-up.

**D5 — HEL-1378 test nits (Commit 3, the only non-import test change).** In
`PanelDetailModal.chartTypeDefault.test.tsx`:
- Add `listOutputPanels: jest.fn(() => Promise.resolve([]))` and
  `getDistinctValues: jest.fn(() => Promise.resolve({ values: [] }))` to the `outputService` mock.
- Replace `return actual.AppearanceEditor(props);` with `return <actual.AppearanceEditor {...props} />;`.

Evidence:
- the ECONNREFUSED/AggregateError console-error count for the suite, before and after (expect >0, then 0)
- the suite green
- a mutation proving the test still bites: temporarily restore a `chartType: "line"` default in `buildInitialChart`,
  observe red, then revert

## Risks / Trade-offs

- [Large destructures in the host] → accepted. They are mechanical and greppable, and are the cost of moving hooks
  without reordering them.
- [HEL-1395 later deletes `buildInitialChart`/`chartAppearance`] → the code moves to `panelDetailChartState.ts` and
  `usePanelDetailEditState`, which HEL-1395 edits instead. A note is posted on HEL-1395.
- [A test asserting render counts] → no tree layer is added (D2 b/e), so counts are unchanged. The suites must pass
  untouched.
- [Shared dev DB / shared Playwright browser] → own throwaway user; record every created id.

## Planner Notes

- Self-approved: module names and locations. `usePanelDetailData`/`usePanelDetailEditState` sit next to the modal in
  `ui/detailModal/` because they are modal-specific, not panel-wide hooks.
- Self-approved: (d) and (e) beyond the ticket's suggested seams, because (a)-(c) alone leave the host at ~450 lines.
  If the host is still ≥ 400 after D2, the executor stops and reports; it does not invent another seam.
- Driver correction: HEL-1394 did not touch either file (premise-validation.md).
