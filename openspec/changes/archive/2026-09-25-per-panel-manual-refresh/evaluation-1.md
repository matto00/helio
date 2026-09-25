## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All four ticket ACs addressed explicitly: keyboard-accessible Refresh control with accessible
  name (`aria-label={Refresh ${panel.title}}`, native `<button>` via `IconButton`); accent-spinner
  in-flight state with `disabled`/no-op-on-repeat and no duplicate concurrent fetch
  (`inFlightRef` in `usePanelData`); coexistence with interval polling and the HEL-1094 SSE
  fan-out via the single shared `usePanelData` instance; no freshness label was added, and that is
  a deliberately-decided (not silently dropped) scope call documented in design.md Decision 4,
  reasonable given the orphaned `dataAsOf` field it would otherwise have had to reuse. Unit tests
  cover the refresh trigger and the in-flight guard.
- No AC silently reinterpreted. The premise-validation note (three refresh triggers, not two;
  no pre-existing in-flight guard) is explicitly addressed by design.md D2, and the shared-guard
  design closes the gap across all three triggers, not just poll+manual.
- All 15 `tasks.md` items are marked done and match what was implemented — verified item-by-item
  against the diff (see Phase 2).
- No scope creep: the `MobilePanelStack.tsx` change is in-scope necessity (see below), not
  incidental — `PanelCardBody` no longer calling its own `usePanelData` breaks that caller
  otherwise, since it's a second top-level call site design.md/tasks.md didn't foresee.
- No regressions to specs governing existing behavior: `usePanelPolling`/`usePanelRunRefresh` wiring
  inside `PanelCardBody` is untouched (only reads `refresh`/`outputId` from props now); the
  `refreshAnnouncement` sr-only live region for HEL-1094 fan-out refreshes is preserved verbatim.
- No API/schema changes — correctly, since this is a pure frontend addition reusing the existing
  `GET /api/outputs/:id/rows` fetch path.
- Planning artifacts (design.md, tasks.md, spec.md) reflect the final implemented behavior; no
  drift found between the decisions/spec scenarios and the actual diff.
- No non-retired `CONSTRAINTS` entries in `workflow-state.md` for this run (`CONSTRAINTS: []`);
  the tasks.md "Standing Constraints" section's items (Bash `timeout: 600000` on commits, no
  `git add -A`, `files-modified.md` completeness, red-first proof for 1.2, no silent
  DEBUG_ATTEMPTS workaround, migration ledger, HEL-350 lane sequencing) are all either
  procedural (verified via `files-modified.md`'s completeness — see Phase 2) or not implicated
  (no migration was added; no DEBUG_ATTEMPTS exhaustion occurred).

**Verified independently — the two items the executor's own report flagged:**

1. **`MobilePanelStack.tsx` second `PanelCardBody` caller.** Confirmed real: `MobilePanelStack.tsx`
   imports and renders `PanelCardBody` directly (not through `PanelCard`), for the phone read-only
   stack. Since Decision 1 moved `usePanelData` out of `PanelCardBody` and made it a required-props
   component, this caller would have broken without an equivalent single-call-site wrapper. The
   added `MobileStackPanelBody` component mirrors `PanelCard`'s own individual-props threading
   exactly, and deliberately renders no Refresh control (this stack has no header actions region at
   all — confirmed live, see Phase 3). This is a necessary consequence of Decision 1, not scope
   creep.
2. **`PanelGrid.css` circular-radius fix.** Confirmed real and correctly scoped. Before the fix,
   `IconButton`'s base rule (`ui-icon-btn { border-radius: var(--app-radius-sm); }`) would have
   rendered the new button as a rounded square. Its two header neighbors —
   `.panel-grid-card__actions .actions-menu__trigger` (line 70-73) and `.panel-grid-card__handle`
   (the drag handle, line 113-121) — both already override to `var(--app-radius-pill)` at the same
   24px box size. The new `.panel-grid-card__refresh-btn` override matches this exactly, and is
   scoped to only the new button's class (not a broadened `.ui-icon-btn--xs` selector that would
   have silently reshaped the unrelated delete-confirm "×" button in the same file, which is
   deliberately non-circular). Confirmed visually live in both themes (Phase 3).

### Phase 2: Code Review — PASS

Issues: none blocking.

**Fresh gate run (this evaluator's own, not the executor's report):**
- `npm run lint` — clean (zero warnings, zero-warnings policy).
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` — 340/340 frontend suites, 3724/3724 tests, 1/1 snapshot; 28/28 helio-mcp suites,
  271/271 tests. All pass.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size warning only,
  unrelated to this diff).
- `npx openspec validate per-panel-manual-refresh --type change` — valid.

**Design.md Decision 1 (single `usePanelData` call site, individual props) — verified faithfully
implemented, not approximately:**
- `PanelCard` calls `usePanelData(panel)` exactly once (line ~232), reusing the same `outputId`
  already computed for the assertion-status effect.
- `PanelCardBody`'s own `usePanelData(panel)` call and its own `getOutputId(panel)` call are both
  removed; it now destructures `outputId, data, rawRows, headers, isLoading, error, errorKind,
  noData, neverMaterialized, chartAggregate, rowsTruncated, refresh` from props exactly as
  tasks.md 2.2 itemizes (`isRefreshing` is intentionally excluded from `PanelCardBodyProps` via
  `Omit<PanelDataResult, "isRefreshing">` — it's consumed only by the header button, never by the
  body, matching design.md D3).
- The `<PanelCardBody ... />` call site in `PanelCard` passes each field as an individual named
  JSX prop (`data={panelData.data}`, `rawRows={panelData.rawRows}`, ...) — confirmed NOT a
  `{...panelData}` spread, which is exactly the memo-defeating pattern Decision 1 called out.
  `MobileStackPanelBody` (the second call site) follows the identical individual-props pattern.
- Live-verified this doesn't regress `React.memo`'s bail-out: task 2.8's new test
  (`PanelCard.test.tsx`, using the REAL `usePanelData` via `jest.requireActual`, not the file's
  mocked version) asserts `PanelCardBody` does not re-render on an unrelated `PanelCard` state
  change (title-edit keystrokes) — this is the correct proof shape, since a mocked hook would
  return a fresh object every render and could never show real memo stability either way.

**Design.md Decision 2 (synchronous inline `inFlightRef`, no second effect) — verified faithfully
implemented:**
- `usePanelData.ts`: `inFlightRef = useRef(false)`. `refresh()` checks `inFlightRef.current` and
  no-ops first, then sets it `true` as its very first mutation — before `prevFetchKey`/
  `setErrorForKey`/`setRefreshToken` — exactly the ordering design.md specifies. The fetch effect
  sets it `true` at the top of its dispatch branch (covering mount/output-changed dispatches that
  bypass `refresh()`) and clears it in `.finally()`. The early-return branch
  (`!currentFetchKey || !outputId`) also resets it to `false`. No second `useEffect` mirrors
  Redux/pagination state into the ref anywhere in the diff.
- **Live-verified in the running app, not just via unit test**: synchronously firing two native
  DOM `.click()` calls on the Refresh button in the same JS tick produced exactly one additional
  `GET /api/outputs/:id/rows` request (network log, request before: n; after: n+1). This
  independently confirms the same-tick double-activation race design.md's skeptic-round-2 note
  says a naive "two `act()` calls" unit test cannot prove (React batching would mask it either
  way) — the live DOM-click reproduction is not subject to that same false-proof risk, and closes
  the guard exactly by the code's own control flow: `inFlightRef.current` is already `true`
  (synchronously, mid-call) by the time the second `click` handler runs.
- Also live-verified: a delayed-response Refresh click renders `disabled` + `<Spinner size="sm" />`
  in place of the `RotateCw` icon (inspected the live DOM), and reverts correctly once the fetch
  resolves.

**`isRefreshing` (Decision 3)**: new, separate field (`paginationEntry?.isLoadingMore ?? false`),
`isLoading`'s existing definition is untouched. Unit test (task 1.4) and a live spinner check both
confirm `isLoading` stays `false` throughout a refresh of already-loaded data (no skeleton flash).

**CONTRIBUTING.md — [mechanical] checks:**
- No inline FQNs introduced (`check:scala-quality` is Scala-only; this is a frontend-only diff, so
  N/A, but manually scanned the diff and found no fully-qualified-name imports issue either way).
- File-size soft budget: `PanelCard.tsx` grew from 386 → 453 lines, crossing the ~400-line
  "propose a split in the PR description" threshold from CONTRIBUTING.md's General section. This
  is explicitly informational per the Husky pre-commit notes ("File-size warnings ... are
  informational only") — not a gate failure — but flagged as a non-blocking suggestion below since
  the executor's PR description (not yet drafted at this point in the pipeline) should note it per
  the standard's own instruction.
- Comment discipline: HEL-579 comments consistently state the decision inline (never a bare
  ticket-id pointer), matching the "the id must never carry the payload" rule.

**DESIGN.md — [mechanical] checks (frontend/** matched):**
- Icon-only control correctly uses the shared `IconButton` primitive (never a hand-rolled
  `<button className="...">`), with a required, non-optional `aria-label` — §8's mechanical rule.
- `variant="secondary"` + `size="xs"` (24px dense-row exception) — a deliberate, justified choice
  matching the two existing 24px circular neighbors in this header row.
- Spinner: uses the shared `Spinner` primitive (§7's "established spinner pattern"), correctly
  `aria-hidden` per its own contract (the button's own `aria-label` carries the accessible name;
  no separate live-region announcement was added for manual-refresh completion, and none is
  required by spec.md's scenarios or by DESIGN.md — the existing `refreshAnnouncement` live region
  is scoped to the HEL-1094 fan-out trigger only, by pre-existing design, not by omission in this
  diff).
- Focus ring: `IconButton`'s underlying `<button>` inherits the site-wide `:focus-visible` token
  rule; nothing in this diff touches focus-ring CSS.

**DRY / readability / modularity / type safety**: no duplication introduced; `MobileStackPanelBody`
and the two test harnesses (`PanelCardBodyHarness`) are the same small pattern repeated at three
call sites — an acceptable, minimal wrapper rather than a premature shared abstraction, since each
site's surrounding concerns (drag/edit state vs. stack layout vs. test harness) differ. No `any`/
untyped escape hatches. `PanelDataResult`/`PanelCardBodyProps` typing is precise (`Omit<...,
"isRefreshing">`).

**Tests meaningful, no dead code**: task 1.2's in-flight-guard test is explicitly red-first-shaped
(isolates the initial mount fetch, then exercises the "second call while first is pending" race,
then proves the guard clears after settlement) and independently reproduced live in the browser
(above). Task 2.5-2.8 tests exercise the real gating/guard/keyboard/memo behavior, not
implementation details. No leftover TODO/FIXME, no unused imports found in the diff.

**No over-engineering**: the design explicitly rejected an `AbortController`-based
"latest-wins cancellation" alternative as unneeded complexity for what the ticket actually asks
(freshness-on-demand, not lowest-latency-on-demand) — a reasonable, stated trade-off.

### Phase 3: UI Review — PASS

Issues: none.

Servers verified serving THIS worktree before reuse: `readlink /proc/<backend-pid>/cwd` and
`/proc/<frontend-pid>/cwd` both resolved to this worktree's `backend`/`frontend` dirs; `ss -ltnp`
confirmed the same PIDs own ports 8918/6011. `start-servers.sh`/`assert-phase.sh servers` both
reported healthy/PASS.

Live checks performed (created a temporary pipeline/output/panel via the API for testing — an
output-bound table panel — and deleted it, plus the pipeline and its data source, at the end of
the review; confirmed via the in-app audit-history table and a clean `git status` in the worktree
that nothing else was left behind):

- **Happy path**: Refresh control renders on the output-bound panel (`getRole('button', {name:
  'Refresh <title>'})`), absent on the dashboard's pre-existing form panel. Clicking it fires
  exactly one new `GET /api/outputs/:id/rows` request; Enter-key activation (native `<button>`,
  focused then `Enter`) does the same — keyboard accessibility confirmed live, not just via the
  unit test's structural checks.
- **In-flight guard, live**: two synchronous same-tick `.click()` calls produced exactly one new
  request (see Phase 2 for detail) — the strongest available proof of D2's same-tick race closure.
- **Loading feedback**: with the fetch artificially delayed (via a scoped `XMLHttpRequest.send`
  patch targeting only this output's rows URL — a review-only harness, not a code change), the
  button rendered `disabled` with `<span class="ui-spinner ui-spinner--sm">` in place of the
  `RotateCw` icon, in both dark and light themes, and reverted correctly once the delayed fetch
  resolved.
- **Cohesion (both themes)**: the Refresh button renders as a 24px circle (`--app-radius-pill`),
  visually matching its `ActionsMenu`-trigger and drag-handle neighbors in the same header row, in
  both dark and light theme — confirmed by direct visual inspection of screenshots taken in each
  theme (not persisted as evidence files since no claim here rests on them after direct inspection;
  the button's own computed CSS class list — `ui-icon-btn ui-icon-btn--secondary ui-icon-btn--xs
  panel-grid-card__refresh-btn` — was also read directly from the live DOM as corroboration).
- **Non-output panel**: the existing form panel on the test dashboard shows no Refresh control, in
  addition to the unit-tested markdown/image/divider/form fixture coverage.
- **Breakpoints**: 1440 and 1100 render the desktop grid with the Refresh button correctly placed;
  768 and 360 (mobile width) switch to `MobilePanelStack`, which by design (§2's verification, and
  confirmed live) renders no header actions region at all for any panel — not a regression, the
  intended read-only-stack behavior this ticket's design explicitly carved out.
- **No console errors** attributable to the feature: the only console errors observed during the
  session were from this evaluator's own raw setup API calls (a 403 before adding the CSRF header,
  a 400 from guessing an invalid panel `type`, a 404 for an unrelated pipeline's schedule) and one
  pre-existing, out-of-scope observation below — none from the Refresh control's own click/keyboard/
  guard/spinner paths.

**Non-blocking observation (out of this diff's scope)**: while the test panel was mounted, its
`usePanelRunRefresh` SSE subscription (`GET /api/pipelines/:id/run-events`, HEL-1094/1174 code,
unmodified by this diff beyond receiving `outputId`/`refresh` as props) logged one `502` in the
console. This is very likely a Vite dev-proxy long-lived-connection quirk under this evaluator's
own repeated pipeline-run/panel-create API churn during setup, not a regression in this diff — the
manual refresh feature itself does not depend on this SSE channel (it calls `refresh()` directly),
and the fan-out mechanism is pre-existing, untouched logic. Flagged for visibility only, not as a
Change Request.

### Overall: PASS

### Non-blocking Suggestions

- `PanelCard.tsx` is now 453 lines, past CONTRIBUTING.md's ~400-line "propose a split in the PR
  description" threshold (was already at 386 before this ticket). Not a gate failure (file-size
  warnings are informational per the Husky notes), but worth flagging in the PR description or as
  a follow-up decomposition candidate, since the file was already close to that threshold before
  this addition.
