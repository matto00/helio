## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `b10eecb5` on `feature/error-state-components/HEL-539`.
Review surface: `git diff b048364a..HEAD` (61 files) — note the branch is based on
`origin/main` `b048364a` (HEL-705), not the local `main` at `7e11b620`, so a naive
`git diff main...HEAD` folds in HEL-705's unrelated files. Confirmed 61 files, matching
`files-modified.md`, with zero `backend/**` entries.

### Phase 1: Spec Review — PASS

Issues: none.

**Ticket acceptance criteria** — all four addressed explicitly and verified in the running
app (see Phase 3), not just by reading the diff:

- *"Every listed view renders a visible intent-error state on fetch failure; Retry re-runs
  the fetch and recovers on success."* — driven live end-to-end on `PanelContent` (both
  `PanelCard` grid and `PanelDetailModal` consumers), `PanelList`, `SourcesPage`,
  `SourceDetailPanel`, `PipelinesPage`, `PipelineDetailPage`, `TypeRegistryPage`,
  `TypeDetailPanel`, `ProposalReviewPage`. Every Retry recovered.
- *"403/404 render a distinct permission-denied/not-found state with no infinite retry."* —
  verified against a **real** backend 404 (`/pipelines/00000000-…`), and against injected
  403/404 in tests. No Retry rendered; suppression is structural in `InlineError`
  (`kind === "error" && onRetry !== undefined`) and by omitted `cta` in `EmptyState`.
- *"Intent tokens + §5 button recipe; accessible; correct in light/dark."* — verified by
  computed style (§5 Primary `--control-md`/`--text-sm`/`--app-radius-sm`/accent+accent-ink;
  §5 Secondary `--control-sm`/`--text-xs`/hairline) and by screenshot in both themes.
- *"Tests simulate fetch failure + retry for representative views and the 403 path; lint/test
  pass with zero new warnings."* — re-run by me, see Phase 2.

**Tasks** — all 33 checked items spot-verified against the implementation; each maps to real
code. No task marked done without a corresponding change.

**Design-critical points explicitly requested for verification — all confirmed:**

- **D5a (SourceDetailPanel preview split)** — `SourceDetailPanel.tsx:44-52` genuinely splits
  into `previewError`/`previewErrorKind` and `previewUnsupported`; `:255-271` renders two
  mutually-exclusive banners, and the `previewUnsupported` one is **never** passed `onRetry`.
  Verified in the running app: selecting the `sql` source and clicking Preview renders
  "Preview is not supported for SQL sources." with a DOM-level assertion of zero buttons
  inside the banner. The retryable sibling (CSV source, injected preview failure) does render
  Retry and recovers. Regression test `SourceDetailPanel.test.tsx` covers both.
- **D6 (`usePanelData` clears on refresh *and* on background-refetch fulfillment)** — both
  paths implemented (`usePanelData.ts:83-86` eager clear; `:126-132` `.then()` keyed clear).
  Two dedicated tests exist and pass. I confirmed the test is a *genuine* guard: `currentFetchKey`
  (`:64-66`) does **not** include `refreshToken`, so a `markDataTypeRowsStale`-driven refetch
  keeps the same key — without the `.then()` the stored error would survive, and test (b)
  would fail.
- **D3/D2 ownership split** — `EmptyState` never generates retry copy: `EmptyStateCta.disabled`
  only disables, and all five callers pass `label: retrying ? "Retrying…" : "Retry"`.
  `InlineError.retrying` and `StatusMessage.retrying` are component-owned and swap their own
  visible label (or `aria-label`/`title` for `retryVariant="icon-only"`). No mixing.
- **D4 (`StatusMessage` keeps its own box metrics)** — `.status-message--error` adds only
  `display/align-items/gap/border-color/background/color`. Confirmed *live* by computed style:
  `failed` and `loading` are identical at `padding 12px 16px`, `font-size 14px`,
  `border-radius 9px`. Also guarded by a static CSS assertion in `StatusMessage.test.tsx:84-96`.
- **D1 (`classifyRequestError` delegates)** — `classifyRequestError.ts:33` calls
  `extractErrorMessage` and adds only `kind`. `classifyRequestError.test.ts:37-51` asserts the
  message equals `extractErrorMessage`'s output and never falls through to `err.message`. The
  per-slice local helpers of the same name are untouched.

**Scope** — no scope creep, and none of the sibling tickets were pulled forward: zero skeleton
loaders (HEL-528), zero toast changes (HEL-535), zero empty-state CTA *content* changes
(HEL-548) beyond the `intent`/`secondaryCta`/icon-widening plumbing the proposal declares
in-scope. The one pre-existing "Failed to load panels." toast visible alongside `PanelList`'s
new error state is untouched by this diff (HEL-535's territory).

**Regressions** — `InlineError variant="text"` (~30 form sites) is byte-identical; `StatusMessage`
`loading`/`idle`/`succeeded` unchanged; `EmptyState` neutral default keeps `aria-label` and no
`role`. The two untouched `banner` sites (`SourceDetailPanel`'s rename error,
`EmptySchemaAffordance`) gain the icon pairing — a strict §8 improvement, as D2 anticipated.
`StatusMessage`'s `failed` element changed `<p>` → `<div>`, which is required (a `<p>` cannot
legally contain a `<button>`) and does not disturb `DashboardList`'s shared slot.

No API/schema surface touched (`npm run check:schemas` clean). Planning artifacts match the
implemented behavior.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates re-run by me, fresh, in `WORKTREE_PATH` (not trusting the executor's report):**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 — `eslint . --max-warnings=0`, zero warnings |
| `npm run format:check` | exit 0 — "All matched files use Prettier code style!" |
| `npm test` | exit 0 — root 8 suites / 186 tests; frontend **224 suites / 2425 tests** |
| `npm --prefix frontend run build` | exit 0 (PWA precache generated) |
| `cd backend && sbt test` | **N/A** — `git diff --name-only b048364a..HEAD` contains zero `backend/**` paths |

**`-n` commit-bypass claim independently re-verified.** I ran `npm run check:openspec` myself:
its only output is `change "error-state-components" is complete (33/33) but not archived`.
`npm run check:schemas` passes cleanly. So the bypass was for the known Phase-3-owns-archiving
ordering conflict, not to hide a real gate failure, and the commit body calls it out explicitly
with precedent — which is exactly what `CONTRIBUTING.md`'s AI-collaborator rule requires.

**Canonical standards (`CONTRIBUTING.md`, `DESIGN.md`) — mechanical rules:**

- **Token discipline [DESIGN.md §3, mechanical] — clean.** Every added CSS line was scanned for
  hex/rgb/literal type/spacing. The *only* literals introduced are: `1px solid var(--app-border-subtle)`
  (the hairline recipe), `@media (max-width: 768px)` (a canonical §4 breakpoint), and
  `min-height: 44px` (the explicitly ratified mobile tap-target floor). Intent styling comes
  from `--app-error` / `--app-error-surface` / `--app-danger-surface` and `color-mix` against
  `--app-surface`. Zero contribution to the HEL-652/680/677 token-drift backlog.
- **Icons [mechanical] — clean.** No `size={N}` prop anywhere in the diff; all lucide glyphs are
  sized by CSS `width:1em;height:1em` (`InlineError.css:21-25`/`:61-64`, `StatusMessage.css:20-24`,
  `EmptyState.css:176-179`/`:197-200`). Confirmed at runtime: 24×24 on the `main` hero
  (`--text-2xl`), 12×12 inline (`--text-xs`).
- **Button recipes [§5] — clean.** Confirmed by computed style, not by reading: `EmptyState` cta
  = Primary at 32px/14px/6px/accent+accent-ink; `secondary-cta` = Secondary hairline;
  `.inline-error__retry` and `.status-message__retry` = Secondary at 28px/12px/6px. Icon-only
  retry uses the shared `IconButton` (`ui-icon-btn--secondary ui-icon-btn--xs`), not a
  hand-rolled square.
- **Shared components [§6] — clean.** The change extends `StatusMessage`, `InlineError`,
  `EmptyState`, and reuses `IconButton`. No parallel/competing error component was introduced.
- **Fraunces on `main`-variant titles [§6]** — preserved under `intent="error"` (verified
  computed `font-family: Fraunces…`).
- **No inline FQNs / no `style={{}}` / no `any` / no TODO-FIXME / no `console.*`** — grep over all
  added TS/TSX lines returns nothing.
- **File-size budgets** — no new file is oversized; the largest touched source,
  `PipelineDetailPage.tsx` (761 lines), was already ~741 before this change and gained ~20 lines
  it genuinely needed. See non-blocking note 5.

**Other review dimensions:**

- **Type safety** — `rejectValue` widened from `string` to a typed `{message, kind}` at every
  touched thunk; `RequestErrorKind` is a closed union. The one loose spot is `usePanelData.ts:133`
  typing the `.catch` param as `{ message?; kind? } | undefined` with fallbacks; that is a
  defensible narrowing of `unwrap()`'s payload-or-SerializedError union, and the fallbacks are
  correct.
- **Security** — no new trust boundary. Messages come from the backend body via
  `extractErrorMessage` (which only accepts `data.error`/`data.message` strings) and render as
  React text children, so no injection surface. The deliberate policy of never surfacing raw
  `err.message` is now applied to `TypeDetailPanel`/`SourceDetailPanel` previews, which
  previously leaked transport strings — a small improvement, correctly scoped.
- **Error handling** — no silent failures; every touched rejection site classifies and stores.
  `ProposalReviewPage`'s previously-unresettable `loadError` now clears on retry start.
- **Tests meaningful** — the new tests would catch real regressions: D6 test (b) fails without the
  `.then()`; the D5a test fails if `previewUnsupported` were merged back into `previewError`; the
  403/404 tests fail if `kind` gating were removed; the D4 CSS test fails if `--error` redeclared
  box metrics; `classifyRequestError.test.ts` fails if message extraction were reimplemented.
- **Dead code** — the now-orphaned `.sources-page__error`, `.pipelines-page__error`,
  `.type-registry-page__error`, `.pipeline-detail-page__error`, and
  `.panel-content--error .panel-content__state-label` rules were all removed; grep confirms no
  dangling references. `.type-detail-panel__error` correctly stays (still used by the untouched
  save-mutation error at `TypeDetailPanel.tsx:202`).
- **Behavior-preserving where expected** — the untouched default paths of all three primitives
  are unchanged; no drive-by behavior changes found.
- **Worktree hygiene** — only `workflow-state.md` (orchestrator-owned) is modified/uncommitted.

### Phase 3: UI Review — PASS

Servers: `scripts/concertino/start-servers.sh` → `READY`; `assert-phase.sh servers` → `PASS`.
Failures were induced two ways: (a) a **real** backend 404 via a nonexistent pipeline id, and
(b) an in-page XHR fault injector returning `{"error": …}` with a chosen status for a chosen URL
pattern — so both the classified-`error` and classified-`not-found` paths were exercised against
the actual running app.

Issues: none blocking.

- **Happy path / recovery loop — PASS.** Fail → error state → click Retry → clears and recovers,
  verified individually on: `TypeRegistryPage` (full-surface), `SourcesPage` (full-surface),
  `PipelinesPage` (full-surface), `ProposalReviewPage` (full-surface, Primary Retry +
  Secondary "Back to dashboards" side by side), `TypeDetailPanel` preview (inline banner),
  `SourceDetailPanel` preview (inline banner), `PanelCard` (icon-only retry),
  `PanelDetailModal` (labeled retry), `PanelList` (`StatusMessage` retry). Nine surfaces, nine
  recoveries.
- **Unhappy paths — PASS.** No blank screens, no unhandled exceptions. The real-404
  `PipelineDetailPage` renders `SearchX` + "Couldn't load this pipeline" + D7's copy and, as
  required, **no Retry**. `ProposalReviewPage`'s previously-permanent stale error genuinely
  clears on a successful retry.
- **Loading / empty / error states — PASS.** Errors are visible everywhere; loading branches
  untouched; empty states still use the shared component.
- **Console — PASS.** Across the whole session the only console errors are browser-level HTTP
  status logs from my own deliberate 404/401/502 injections. Zero JS exceptions, zero React
  warnings.
- **Entry points — PASS.** Panel error checked from both the grid card and the detail modal;
  full-surface errors checked from sidebar nav and from bottom-nav (mobile shell).
- **Accessibility — PASS.**
  - Exactly one `role="alert"` per error surface. `PanelContent`'s wrapper keeps its role and
    the nested `InlineError` correctly suppresses its own (`announced={false}`) —
    `document.querySelectorAll("[role=alert]").length === 1` at runtime.
  - `EmptyState intent="error"` root carries `role="alert"` and **no** `aria-label` (verified),
    per D3 — and, per the design, `role="alert"` is deliberately *not* paired with a redundant
    `aria-live`.
  - Icon + text always paired; every icon is `aria-hidden="true"`. Colour is never the sole
    signal.
  - Icon-only Retry carries both `aria-label="Retry"` and `title="Retry"` (§5 requirement),
    swapping to "Retrying…" while in flight.
  - Keyboard: Retry is tab-reachable and its focus ring resolves to
    `outline: rgb(249,115,22) solid 2px` at `outline-offset: 2px` — exactly §8's rule.
  - `prefers-reduced-motion` respected via `theme.css:240`'s global rule; this change adds no
    animation, only `--app-transition` colour/background transitions.
- **Breakpoints 1440 / 1100 / 768 / 430 — PASS.** No overflow, no clipped copy, no layout
  breakage at any width. Tap-target floor measured, not assumed: labeled Retry = **44px** at
  768 and 430; icon-only Retry = **44×44** at 430 (from `IconButton.css`); both are 32/28/24px
  at desktop as intended. A deliberately long (150-char) error message wraps cleanly inside a
  small grid `PanelCard` with the icon and icon-only Retry staying aligned.
- **Light and dark — PASS.** Checked both themes on a full-surface state and an inline banner.
  The error chip (`color-mix(--app-error 16%, --app-surface)`, solid — no translucency violation)
  and the `--app-error` glyph read unambiguously as an error against both the paper and stone
  surface ramps, and against the light user-set panel surface inside a dark-theme dashboard.
- **Cross-surface consistency — PASS for the surfaces this ticket owns.** Side-by-side, the four
  full-surface states are visually identical bar the resource noun, and the four inline banners
  are identical bar the icon. That is the ticket's premise, met. One adjacent, out-of-scope
  inconsistency is recorded as non-blocking note 7.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. **DRY across the five full-surface call sites.** The ~20-line
   `kind → title / description / cta` ternary is repeated near-verbatim in `SourcesPage.tsx:52-74`,
   `PipelinesPage.tsx:43-63`, `TypeRegistryPage.tsx:22-45`, `PipelineDetailPage.tsx:597-620`, and
   `ProposalReviewPage.tsx:170-196`. Notably this duplicates D7's *user-facing copy* five times, so
   a future wording fix needs five edits and can silently drift. `design.md` does say each site
   follows "one D5 recipe verbatim", so this is defensible as written — but a small
   `buildErrorStateProps(resourceLabel, kind, message, onRetry, retrying)` helper next to
   `classifyRequestError` would collapse it without changing behavior. Worth a follow-up rather
   than a cycle-2 churn.
2. **Two props ship with no consumer.** `PanelContent.retrying` (`PanelContent.tsx:40`) is never
   passed by either consumer (`usePanelData` exposes no in-flight retry flag), and
   `EmptyState.secondaryCta.disabled` is never used. Both are spec'd by tasks 1.6/4.1 so this is
   not a divergence; just note them so they don't calcify as permanent unused surface.
3. **`ERROR_KIND_ICON` placement.** It is exported from `shared/chrome/InlineError.tsx` and
   imported by five *feature pages*. Reusing one map is right; a neutral home (e.g. next to
   `classifyRequestError`, whose `RequestErrorKind` it is keyed on) would avoid pages depending on
   a chrome component purely for an icon lookup.
4. **Stale docblock.** `services/extractErrorMessage.ts:15` still reads "Not yet adopted by any
   call site in this batch" — as of this change it is adopted by `classifyRequestError` and, through
   it, by every touched thunk.
5. **`PipelineDetailPage.tsx` is 761 lines.** `CONTRIBUTING.md` asks that a file crossing ~400 lines
   get a split *proposed in the PR description* rather than grown. The growth here (~20 lines) was
   unavoidable and correct; please carry the split proposal into the PR body.
6. **Test name over-promises.** `EmptyState.test.tsx`'s "cta.icon accepts a ReactNode alongside the
   existing FontAwesome IconDefinition" only exercises the `IconDefinition` branch (`faPlus`); the
   `ReactNode` cta-icon branch of `renderCtaIcon` is untested. (The root `icon` prop's ReactNode
   branch *is* covered.)
7. **Adjacent surface still hand-rolls its error (out of this ticket's design scope).**
   `shared/chrome/SidebarItemList.tsx:281-284` renders a bare
   `<p className="dashboard-list__status" role="alert">{error}</p>` — no icon, no retry, muted
   type. It is the sidebar list used by Dashboards/Sources/Pipelines/Types, so on a failed
   sources/pipelines/types fetch it renders *on the same screen* as the new canonical
   `EmptyState intent="error"` (clearly visible in this cycle's screenshots as the small unstyled
   line under the sidebar search box). `design.md`'s Context enumerated the six hand-rolled sites
   and did not include this seventh one, so the executor implemented the confirmed design
   faithfully and this is **not** a divergence — but it is the one remaining place where the
   ticket's "one consistent treatment" premise is observably broken next to its own output.
   Recommend a spinoff ticket in the HEL-349 epic rather than widening scope now.
