## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold, independent re-derivation. I did not treat `skeptic-final-1.md`'s change requests
as a checklist to tick — I re-verified the whole ticket from ground truth (files, diff,
running app) as if this were round 1, then separately reproduced the two round-1 findings.

Base for the change is **`b048364a`** (`git merge-base main HEAD` is `7e11b620`; the local
`main` ref is stale relative to the branch point, so `main...HEAD` folds in the unrelated
HEL-705 backend commit). All diffs below are `b048364a..HEAD` — 49 frontend files + the
openspec change dir, zero backend files.

---

### What I verified (with evidence)

#### 1. Gates — all four re-run fresh by me, not trusted from any report

| Gate | Command | Result |
| --- | --- | --- |
| lint | `npm run lint` | `eslint . --max-warnings=0` → **exit 0**, no output |
| format | `npm run format:check` | `All matched files use Prettier code style!` → **exit 0** |
| test | `npm test` | root `8 passed / 186 tests`; frontend **`Test Suites: 224 passed, 224 total` / `Tests: 2427 passed, 2427 total`** → **exit 0** |
| build | `npm --prefix frontend run build` | `✓ built in 271ms` + PWA precache → **exit 0** |

The `-n` (skip-hooks) commit on `d82789bc` is justified and self-limiting — I ran the rest of
the husky chain myself: `check:schemas` → `schemas in sync with JsonProtocols (66 checked…)`
exit 0; `check:scala-quality` → `clean (128 soft warning(s))`, all pre-existing backend test
files, exit 0; `check:openspec` → the **only** issue is
`change "error-state-components" is complete (33/33) but not archived`, i.e. the documented
Phase-3 ordering conflict (archiving happens after this review), exactly as the commit
message claims. Nothing else was bypassed.

#### 2. Round-1 CR1 — ReactNode (lucide) icon centering, **measured, not eyeballed**

`getBoundingClientRect()` centre-delta between `.ui-empty-state__icon-wrap` and the painted
`<svg>`, on the running app at `localhost:5971`:

| Surface | Icon path | Theme | offsetY | offsetX |
| --- | --- | --- | --- | --- |
| `SourcesPage` full-surface error (`TriangleAlert`) | ReactNode (wrapped) | light | **0** | **0** |
| `PipelineDetailPage` real-404 state (`SearchX`) | ReactNode (wrapped) | dark | **0** | **0** |
| Settings → "No memory stored yet" (`faBrain`) | FontAwesome (direct `<svg>`) | light | **0** | **0** |
| same, after theme toggle | FontAwesome (direct `<svg>`) | dark | **0** | **0** |

Both paths now measure to exact centre, in both themes — four independent readings, so this
is reproduced, not a single sample. The fix is correctly scoped: `.ui-empty-state__icon svg`
/ `.ui-empty-state__cta-icon svg` are **descendant** selectors, and `FontAwesomeIcon` renders
the class onto its own `<svg>` with no nested one, so the FontAwesome path provably cannot
match — confirmed live (that path still reports `glyphDisplay` unchanged and centres at 0).

#### 3. Round-1 CR2 — `SidebarItemList` failure now reads as a genuine error, side by side

`SidebarItemList.tsx:281-290` no longer renders `<p role="alert">{error}</p>`; both the
loading and failed branches route through `StatusMessage`, exactly as `DashboardList.tsx:265`
does. I drove **both** sidebar sections into their failed state in the same theme and
diffed their computed styles:

```
SidebarItemList (aria-label="data sources")  vs  DashboardList (aria-label="dashboards")
tag DIV / role "alert" / padding 12px 16px / margin 0px 0px 16px / border-radius 9px
font-size 14px / color rgb(199,58,42) / bg error-surface 10% / border 1px solid error 30%
display flex / gap 8px / icon "lucide lucide-triangle-alert status-message__icon" 14x14
width 215
→ differingKeys: []           (light theme; dark theme measured identical earlier)
```

Zero differences. Screenshotted in both themes: `/sources` (light) shows the pink bordered
`⚠ Failed to load sources.` box under the filter field while the main pane shows the
`EmptyState intent="error"` hero; `/registry` (dark) and `/` (dark) show the same box for
Data Types and Dashboards. The CR2 fix also lifts the other three `SidebarItemList` callers
(metrics, assistant conversations) to the same treatment — a strict §7/§8 improvement, no
regression.

#### 4. D5a re-verified in the running app (the design-round's most severe finding)

`SourceDetailPanel.tsx` was touched again in the fix commit, so I re-derived this end to end
rather than assuming:

- Selected the real `sql` source **HEL-758 Eval SQL Source** → clicked **Preview**. DOM probe
  of `.source-detail-panel__preview`:
  `banners: [{ text: "Preview is not supported for SQL sources.", role: "alert",
  hasRetryButton: false, retryLabels: [], icon: "lucide-triangle-alert" }]`,
  `sectionButtons: []` — **zero** buttons in the section, so no Retry can be reached.
  `hintPresent: false` — the contradictory "Click **Preview** to load a sample" hint is
  correctly suppressed for this branch (the folded-in non-blocking note).
- Selected the `csv` source **SWEEP-csv-upload-test**, failed `GET …/preview` at the XHR
  layer, clicked Preview → banner reads "Failed to fetch preview." **with** a labeled Retry
  (`.inline-error__retry`, 56.4×28 = `--control-sm`); cleared the failure and clicked Retry →
  preview rows rendered, banner gone.

No regression. Structurally enforced too: `InlineError` renders Retry only when
`kind === "error" && onRetry !== undefined`, and `previewUnsupported` is never passed an
`onRetry` (`SourceDetailPanel.tsx:262`).

#### 5. D6 re-verified in the running app (file untouched by the fix commit — confirmed, not assumed)

On a real metric panel bound to a real DataType:

- **Background refetch path (the one `refresh()` never covers):** armed a failure on
  `/api/types/:id/rows`, dispatched `panels/markDataTypeRowsStale` → error banner rendered.
  Cleared the failure, dispatched `markDataTypeRowsStale` **again** and did **not** touch
  Retry → probe returned `errorStillVisible: false`, `panelBodyText: "10Alpha"`, `rows: 2`.
  The stored error cleared purely via the `.then()` on fulfilment.
- **Retry-button path:** re-armed, then clicked the icon-only Retry with the failure cleared.
  MutationObserver frame trace: `panel-content--state :: Loading...` → `panel-content--metric ::
  10Alpha`. No stale error, and no "No data" flash between the eager `setErrorForKey(null)`
  and the pending reducer.
- The `"Panel is not bound to a data type."` rejection site is unreachable from `usePanelData`
  (the effect early-returns when `currentFetchKey` is null, and the hook returns `error: null`
  in that case), so classifying it doesn't create a retry-spam surface.

#### 6. Acceptance criteria — every listed view traced to observed behaviour

| AC | Evidence |
| --- | --- |
| Every listed view renders a visible intent-error state on fetch failure | Drove all nine live: `PanelContent` via **`PanelCard`** (icon-only Retry) and **`PanelDetailModal`** (labeled Retry), **`PanelList`** (`StatusMessage` + Retry), **`SourcesPage`**, **`SourceDetailPanel`**, **`PipelinesPage`**, **`PipelineDetailPage`**, **`TypeRegistryPage`**, **`TypeDetailPanel`**, **`ProposalReviewPage`**. Screenshotted each. |
| Retry re-runs the fetch and recovers on success | Verified live on `SourcesPage`, `TypeRegistryPage`, `SourceDetailPanel`, `TypeDetailPanel`, `PanelCard`, `PanelDetailModal`, `PanelList`, `ProposalReviewPage` — each returned to rendered data with the error gone. `ProposalReviewPage` specifically re-rendered the proposal (task 2.8's stale-`loadError` regression). |
| 403/404 render a distinct state with no retry-spam | **Real 404**: `/pipelines/00000000-…` → `SearchX` glyph, "Couldn't load this pipeline", *"It may have been deleted, or you may not have access to it."*, `buttons: []`. **403**: `ShieldOff`, "You don't have access to these sources.", no cta. D7 copy never asserts deletion — matches `CONTRIBUTING.md`'s existence-not-leaked semantics. |
| Intent tokens + §5 button recipe; accessible; light/dark | See §7–§9 below. |
| Tests cover failure+retry and the 403 path; lint/test pass, zero new warnings | 224/2427 green; read the new `SourceDetailPanel` D5a tests, `usePanelData` D6 (a)/(b) tests, and `PipelineDetailPage` 403/404 tests — all would genuinely fail if the behaviour regressed (e.g. D6(b) asserts `error` is null after `markDataTypeRowsStale` with no `refresh()` call). |

#### 7. Design-standard judgment (DESIGN.md is binding)

- **§7 states.** Every named view now has a visible, human-readable, intent-error state; none
  swallow a failed fetch. Consistent recipe across all five full-surface views ("Couldn't load
  X" / message / Retry) and all inline banners.
- **§6 Fraunces on `main` titles.** Measured: `font-family: Fraunces…`, `font-size: 24px`
  (`--text-2xl`) on the error hero — identical to the neutral variant. Not regressed by `intent="error"`.
- **§5 button recipes.** `.ui-empty-state__cta` Primary (`--app-accent` / `--app-accent-ink`,
  `--control-md`); `.ui-empty-state__secondary-cta` Secondary (hairline + muted, `--control-md`);
  `.inline-error__retry` / `.status-message__retry` Secondary at `--control-sm`. The icon-only
  Retry uses the shared **`IconButton`** (`ui-icon-btn ui-icon-btn--secondary ui-icon-btn--xs`),
  not a hand-rolled square, with `aria-label="Retry"` **and** `title="Retry"` per §5. No new
  button style was invented.
- **§3 token discipline.** Scanned every added CSS line: the only literals are `1px` hairlines,
  the sanctioned `44px` mobile tap floor, and the canonical `768px` breakpoint. **Zero** hardcoded
  colours, font-sizes, weights, or spacing. No `size={N}` on any lucide icon added by this change
  (`Pencil size={13}` in `SourceDetailPanel.tsx:209` is pre-existing on `b048364a`); all new icons
  are sized `width:1em;height:1em` in CSS. `TriangleAlert` used throughout — the deprecated
  `AlertTriangle` alias appears nowhere in the tree.
- **Extend, don't compete.** No new error component. `EmptyState` / `InlineError` / `StatusMessage`
  gained additive props; `classifyRequestError.ts` is a service helper delegating message
  extraction to the existing `extractErrorMessage` (verified by reading both files) — it does not
  reimplement it and never falls through to a raw `err.message`. The per-slice local helpers of the
  same name are untouched.
- **Visual quality.** Reviewed screenshots, not the a11y tree. The full-surface hero (tinted
  rounded-square glyph → Fraunces title → muted description → Primary Retry) is genuinely on-brand
  and reads as a first-class state, not a bolted-on message. The inline banner is compact enough
  for a grid cell and doesn't crowd the panel chrome. Nothing here looks off-pattern beside its
  sibling screens.

#### 8. Light / dark parity

Toggled the real theme switch and re-shot every surface. Light: `SourcesPage` hero + sidebar box,
`SourceDetailPanel` unsupported + failed banners, `PipelineDetailPage` 404, `PanelList`
`StatusMessage`, `PanelCard` banner. Dark: `TypeRegistryPage` hero + sidebar box, `PipelinesPage`,
`PipelineDetailPage` 404 and the `Retrying…` disabled state, `ProposalReviewPage`,
`PanelCard`/`PanelDetailModal` banners, `TypeDetailPanel` banner, the 403 state. All colours resolve
through `--app-error` / `--app-error-surface` / `--app-border-*`, so both themes read correctly with
no washed-out or over-saturated tint in either.

#### 9. Responsive + accessibility

- **1440 / 768 / 430** all clean: `documentElement.scrollWidth === clientWidth` (430), no clipped
  copy, no overflow out of the mobile panel card.
- **44px floor measured at 430** on every retry control this ticket introduces:
  `.ui-empty-state__cta` 69.5×**44**, `.ui-empty-state__secondary-cta` 164.9×**44**,
  `.inline-error__retry` 56.4×**44**, `.status-message__retry` 56.4×**44**, icon-only
  `IconButton` **44×44** (inherited from `IconButton.css`'s own `@media (max-width: 768px)`,
  as `InlineError.css`'s comment claims — verified, not taken on faith). No regression of
  HEL-745/747/314/319.
- **§8.** `EmptyState intent="error"` carries `role="alert"` and correctly drops `aria-label`
  (measured `role: "alert"`, `ariaLabel: null`); the neutral variant is unchanged
  (`role: null`, `aria-label` present — measured on an untouched FontAwesome empty state).
  `PanelContent`'s wrapper keeps `role="alert"` and its nested `InlineError` renders with
  `announced={false}` → probe returned `nestedAlertCount: 0`, so there is exactly one live
  region, not two. Colour is never the sole signal — every error surface pairs a lucide glyph
  with its text.
- **Console:** zero JS/React errors across the whole session. Every console entry is a network
  failure I deliberately induced (`ERR_UNSAFE_PORT` from my XHR shim, or the real 404s).

#### 10. Scope discipline (HEL-528 / HEL-548 / HEL-535)

Grepped the whole diff for `skeleton|shimmer|pushToast|toastsSlice` in added lines: **no matches**.
No neutral empty state gained a CTA (HEL-548 untouched); `secondaryCta`/`disabled` are primitive-level
props required by `ProposalReviewPage`'s error state, not new empty-state copy. Toast wiring is
untouched — none of the widened thunks (`fetchSources`/`fetchPipelines`/`fetchPipelineById`/
`fetchDataTypes`/`fetchPanelPage`) are in `toastListeners.ts`'s wired set (they are all in its
documented "Silent" list), so the `rejectValue` widening breaks nothing there. Dead CSS
(`.sources-page__error`, `.pipelines-page__error`, `.pipeline-detail-page__error`,
`.type-registry-page__error`) is removed; `.type-detail-panel__error` correctly survives because
it still serves the out-of-scope save-mutation error.

#### 11. Code quality (`CONTRIBUTING.md`)

No `any` in any added line. File sizes well inside budget (`EmptyState.tsx` 123,
`InlineError.tsx` 100, `StatusMessage.tsx` 40, `classifyRequestError.ts` 39,
`usePanelData.ts` 245). No inline FQNs (frontend; `check:scala-quality` clean anyway).
`files-modified.md` is accurate — I diffed its claims against `b048364a..HEAD` and found no
overstatement or omission.

---

### Verdict: CONFIRM

Both round-1 change requests are genuinely fixed and independently reproduced with measurements
(offsetY 0 on four readings; `differingKeys: []` between the two sidebar sections). D5a and D6 are
both intact in the running app. All nine named views render a real, consistent, token-driven,
accessible error state with a Retry that provably recovers; 403/404 render distinct, honest,
non-retryable copy. Four gates green on my own runs. This ships.

### Non-blocking notes

1. **The in-flight "Retrying…" / disabled affordance is unreachable on 4 of 5 full-surface views.**
   `SourcesPage.tsx:47`, `PipelinesPage.tsx:23`, `TypeRegistryPage.tsx:20` all compute
   `isRetrying = status === "loading"`, but their error branch is gated on `status === "failed"`,
   so the two are mutually exclusive — the branch unmounts the instant Retry is clicked.
   `ProposalReviewPage`'s `handleRetryLoad` clears `loadError` for the same net effect. Only
   `PipelineDetailPage` reaches it (D1a's preserve-on-`pending` is exactly what makes it work — I
   verified the label swaps to `Retrying…` and the button disables there). Harmless dead code, but
   worth knowing it isn't exercised. Related: a frame-by-frame trace of a failing retry on
   `/sources` shows the 331px error hero collapse to the 15px `<p>Loading sources…</p>` line and
   back. That's the pre-existing loading treatment, which is **HEL-528**'s scope — flagging it
   rather than asking for it to be pulled forward.
2. **`SidebarItemList` shows the raw slice `error` string, not the kind-aware copy.** On a 403 the
   main pane reads "You don't have access to these sources." while the sidebar shows the server's
   raw message. The sidebar wasn't in the ticket's scope at all (it arrived via CR2), and the string
   is server-derived, so this is cosmetic — but a future `errorKind` prop on `SidebarItemList` would
   close it.
3. **`DashboardList`'s failed `StatusMessage` still has no Retry** (D5 wired retry to `PanelList`
   only), so a dashboards-list fetch failure has no in-app recovery other than a reload. Pre-existing
   and outside the enumerated views; a one-line `onRetry` would fix it whenever that section is next
   touched.
4. **`DataTypeSelectStep.tsx:162-172`** (panel-creation modal) still hand-rolls
   `InlineError variant="text"` + a separate retry `<button>` instead of the new
   `variant="banner" onRetry` recipe. Not an enumerated view and it already satisfies §7, but it is
   now the one remaining error+retry surface off the canonical pattern.
5. **Toast + inline double-signal.** `fetchPanels.rejected` fires a toast *and* the new inline
   `StatusMessage` error, so a panels-load failure is announced twice. Pre-existing wiring;
   **HEL-535**'s scope.
6. **A capability limitation is styled as an error.** `previewUnsupported` renders red with a
   `TriangleAlert`, identical to a real failure. The locked design (D5a) specifies `kind="error"`
   and the spec explicitly permits "both otherwise use the same visual treatment", and the base
   commit rendered the same string through the same banner — so this is neither new nor a spec
   violation. A future neutral/info intent would read better.
7. **Minor copy drift:** `DashboardList` says "Loading dashboards..." (three periods) while
   `SidebarItemList` says "Loading data types…" (ellipsis). Both pre-existing strings, now
   rendered by the same component and therefore adjacent enough to notice.
