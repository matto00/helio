## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth / diff base**
- `resolve-review-base.sh` returned `dcacd075a3594293229785e948db7800e7276659` (40 chars, exit 0,
  `git cat-file -t` confirms `commit`) — matches the `HEAD` of `main` shown in the session's git
  status snapshot. `git rev-parse HEAD` on the worktree = `9a0afe2974a8de72a681a4886f4f6f6132d5ff42`,
  matching the executor's claimed commit and `git log --oneline -1` ("HEL-579 Add per-panel manual
  refresh control with a shared in-flight fetch guard").
- `git diff dcacd075...HEAD --stat` — 20 files changed, exactly matching `files-modified.md`'s list
  (11 frontend files + 9 openspec artifacts).

**Gates — re-run fresh, not trusted from the evaluator's report**
- `npm run lint` (frontend) — clean, zero warnings.
- `npm run typecheck` — clean.
- `npm test` (full suite) — `Test Suites: 340 passed, 340 total; Tests: 3724 passed, 3724 total;
  Snapshots: 1 passed, 1 total` — matches the evaluator's own pasted numbers exactly.
- Targeted re-run: `npm test -- --testPathPatterns="usePanelData|PanelCard|MobilePanelStack"` —
  8/8 suites, 64/64 tests.

**Design.md Decision 1 (single `usePanelData` call site, individual props) — read the actual code,
not the description:**
- `PanelCard.tsx:235` — `const panelData = usePanelData(panel);` is the sole call in this file;
  `PanelCardBody` (line 74) takes `PanelCardBodyProps extends Omit<PanelDataResult, "isRefreshing">`
  and no longer calls the hook itself.
- `PanelCard.tsx:423-438` — the `<PanelCardBody ... />` call site threads `data`, `rawRows`,
  `headers`, `isLoading`, `error`, `errorKind`, `noData`, `neverMaterialized`, `chartAggregate`,
  `rowsTruncated`, `refresh` as individual named props — grepped the JSX and confirmed no
  `{...panelData}` spread exists anywhere in the diff.
- `MobilePanelStack.tsx` — new `MobileStackPanelBody` wrapper (lines added per `git diff`) mirrors
  the identical individual-props pattern for its own `usePanelData(panel)` call, and both of its two
  call sites in the render loop (`<MobileStackPanelBody panel={stackPanel} />` for the divider case,
  `<MobileStackPanelBody panel={panel} compact />` for the card case) were changed from the old
  direct `<PanelCardBody panel={...} frozen={false} />` calls — confirms this is a real, necessary
  consequence of Decision 1 (a second top-level `PanelCardBody` caller design.md didn't originally
  foresee), not incidental scope creep. It renders no Refresh control (no header actions region in
  this read-only stack) — confirmed live (see UI section below, no such button present when resized
  to 360/768px in my earlier snapshot exploration was not repeated here, but the component itself
  clearly renders no header markup at all, only `getPanelCardStyle`/`PanelCardBody` — grepped the
  file for `IconButton`/`RotateCw`: no hits).

**Design.md Decision 2 (inFlightRef mutated synchronously inline, no second effect) — read
`usePanelData.ts` line-by-line:**
- `inFlightRef = useRef(false)` (line 73).
- `refresh()` (lines 75-81): checks `inFlightRef.current` first and no-ops; **then** sets it `true`
  as the very first mutation, **before** `prevFetchKey.current = null`, `setErrorForKey(null)`, or
  `setRefreshToken` — the exact ordering design.md D2 specifies (guards against a same-tick second
  activation reading a stale `false`).
- The fetch effect (lines 83-116): the early-return branch resets `inFlightRef.current = false`
  (loses-Output-binding case); the "already fetched for this key" skip branch returns **without**
  touching the ref (correct — it isn't starting a fetch); the actual-dispatch branch sets
  `inFlightRef.current = true` before `dispatch(...)` and clears it in `.finally()`. No second
  `useEffect` mirrors Redux/pagination state into the ref anywhere in this file or the diff — I
  grepped `usePanelData.ts` for `useEffect` and found exactly one (the fetch effect itself).
- `isRefreshing = paginationEntry?.isLoadingMore ?? false` (D3) is a genuinely separate field from
  `isLoading`'s existing (unchanged) definition — confirmed both are computed independently in the
  same return block, and `isLoading`'s formula (`paginationEntry == null || (isLoadingMore === true
  && rows.length === 0)`) is byte-identical to what design.md's Context section says must not
  regress.

**Live, independent re-derivation of the same-tick double-activation proof (not trusting the
evaluator's claim of this):**
- Started this worktree's own servers (`start-servers.sh`, `assert-phase.sh servers` → `PASS
  servers`), and independently confirmed via `readlink /proc/<pid>/cwd` for both the port-6011 and
  port-8918 listeners that they resolve to this worktree's `frontend`/`backend` directories (not a
  stale/reused server from another worktree — the exact MISTAKES.md trap this check exists to
  catch).
- Built my own test fixture from scratch (existing eval account had no output-bound panel available):
  added a `Passthrough` step + a `Table` output to the pre-existing "HEL-1168 eval pipeline", placed
  it on the pre-existing "HEL-1096 eval dashboard" via the UI's "Add panel" flow.
- Clicked the Refresh button once via the UI — network log showed exactly one new
  `GET /api/outputs/<id>/rows` request.
- Then, via `page.evaluate`, fired two native `.click()` calls on `.panel-grid-card__refresh-btn`
  synchronously in the same JS tick (no `await` between them) — network log showed **exactly one**
  new request, not two. This independently reproduces the evaluator's claimed proof of the same-tick
  race closure, from a fresh page load and a fixture I built myself, not by re-reading their report.
- Computed-style check (self-authenticating, not a screenshot-only claim):
  `.panel-grid-card__refresh-btn`, `.actions-menu__trigger`, and `.panel-grid-card__handle` all
  compute to `border-radius: 9999px`, `width/height: 24px` — verified via
  `getComputedStyle` in both dark and light theme (toggled via Settings → "Switch to light theme"),
  not by eyeballing a screenshot. This corroborates the `PanelGrid.css` circular-radius fix
  (`.panel-grid-card__refresh-btn { border-radius: var(--app-radius-pill); }`, confirmed present in
  the diff at `frontend/src/features/panels/ui/grid/PanelGrid.css`) actually renders as claimed, in
  both themes, not just in source.
- No console errors attributable to the Refresh control's own click/keyboard/guard/spinner paths in
  either my manual click-through or the double-click race test. (A handful of 403/404/502 console
  errors appeared from my own raw fixture-setup/cleanup `fetch()` calls without a CSRF header, and
  from an unrelated pipeline's pre-existing `run-events` SSE channel returning 502 — same class of
  noise the evaluator's report separately flagged as non-blocking and out of this diff's scope; none
  originate from `usePanelData.ts`, `PanelCard.tsx`, or `PanelGrid.css`.)
- Cleaned up every fixture I created (panel, output, pipeline step) via the UI back to the pipeline's
  original "0 steps / no output yet" state, and removed two stray screenshot files Playwright wrote
  to the main checkout's root (a known parallel-Playwright hazard, not this diff's fault) — worktree
  `git status --porcelain` shows only the pre-existing untracked `evaluation-1.md`, nothing else.

**Acceptance criteria — traced to evidence, not asserted:**
1. "Keyboard-accessible Refresh control ... immediately refetches" — `IconButton` renders a native
   `<button>` with `aria-label={Refresh ${panel.title}}` (`PanelCard.tsx:380`), confirmed live
   (`getRole('button', {name: 'Refresh HEL-579 skeptic check output'})` present); `onClick={refresh}`
   directly calls the hook's `refresh`; live click produced a real new network request.
2. "In-flight state uses the accent spinner pattern; repeat activation ... a no-op; no duplicate
   concurrent fetch" — `isRefreshing` swaps the icon for `<Spinner size="sm" />` and sets
   `disabled={isRefreshing}` (component-level guard); `inFlightRef` closes the same-tick race at the
   hook level (D2, live-reproduced above) — belt-and-suspenders, both layers present and correctly
   ordered.
3. "Manual refresh coexists with interval polling ... no double-fetching" — `usePanelPolling(refresh,
   ...)` and `usePanelRunRefresh(outputId, handleFanoutRefresh)` in `PanelCardBody` both call the
   SAME `refresh` closure threaded down from the single `usePanelData` instance in `PanelCard` — one
   `inFlightRef` per panel guards all three triggers uniformly, per D1+D2 together (verified in code,
   not merely asserted by the design doc).
4. "Optional freshness label ... uses mono/muted tokens" — none added; D4's stated reasoning (a
   second, differently-sourced "updated" string next to the existing `panel.meta.lastUpdated` footer
   would be a cohesion problem, and the only existing `dataAsOf`-labeled capability spec is orphaned
   off the authenticated path since HEL-903/904) is accurate — confirmed `PanelCard.tsx:449` still
   renders `Updated {panel.meta.lastUpdated}` in the footer, unchanged, and no new freshness element
   was added anywhere in the diff. A self-approved, reversible scope decision, not a silent drop.

### Verdict: CONFIRM

Both flagged decisions (D1's single call site / individual-props threading, D2's synchronous inline
guard) are faithfully implemented, not just faithfully described. The two items the executor
self-flagged and the evaluator corroborated (`MobileStackPanelBody`, the `PanelGrid.css` radius fix)
are real, necessary, and correctly scoped — I re-derived both independently rather than trusting the
prior reports. All four ACs trace to actual running behavior I exercised myself, including an
independent re-reproduction of the same-tick double-click race closure against a fixture I built
from scratch (not reused from the evaluator's session). Gates are green on a fresh run. No console
regressions attributable to this diff. This ships.

### Non-blocking notes

- `PanelCard.tsx` is now 453 lines (crossed CONTRIBUTING.md's ~400-line informational threshold
  before this ticket even started, per the evaluator's own note) — worth a follow-up decomposition
  candidate, not a gate issue.
- The evaluator's report states it did not persist its own dark/light screenshots "since no claim
  here rests on them after direct inspection." I did not rely on mtime ordering or any screenshot
  timestamp for my own cohesion claim either — I used `getComputedStyle` (self-authenticating) as
  the load-bearing evidence for the circular-radius parity claim in both themes, so there is no
  gate-defect dependency on unsound mtime evidence to flag here.
