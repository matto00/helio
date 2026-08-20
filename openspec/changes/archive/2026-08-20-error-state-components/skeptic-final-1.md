## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold, independent review of `feature/error-state-components/HEL-539` @ `b10eecb5`.
I did not read `evaluation-1.md`. Everything below is derived from the diff, the
source files, and the running app at `http://localhost:5971` / `:8878`.

Base is clean: `git merge-base main HEAD` = `7e11b620`, and the branch's only
non-HEL-539 commit (`b048364a`, HEL-705) is already `origin/main`. Reviewed scope
is therefore `b048364a..b10eecb5` (61 files, +3391/−154).

### What I verified (with evidence)

**Gates — re-run by me, not taken from any report.**

```
##### LINT #####   > eslint . --max-warnings=0        LINT_EXIT=0
##### FORMAT ##### > prettier . --check
                     All matched files use Prettier code style!  FORMAT_EXIT=0
##### BUILD #####  > vite build   ✓ built in 272ms    BUILD_EXIT=0
##### TEST #####   Test Suites: 224 passed, 224 total
                   Tests:       2425 passed, 2425 total   TEST_EXIT=0
```
(helio-mcp suite in the same run: 8 suites / 186 tests passed.)

Servers: `assert-phase.sh servers …` → `PASS servers`. (It emits a harmless
`emit-event.sh: No such file or directory` line — those helper scripts are
untracked in git and so absent from every worktree; pre-existing, not this
ticket, and the script still exits PASS.)

**Acceptance criteria — traced live, each one.**

| AC | Evidence |
| --- | --- |
| Every listed view renders a visible intent-error state; Retry re-runs the fetch and recovers | Drove all nine named surfaces in the browser. `SourcesPage`, `PipelinesPage`, `TypeRegistryPage`, `PipelineDetailPage`, `ProposalReviewPage` → `EmptyState intent="error"`; `PanelContent` (both `PanelCard` and `PanelDetailModal`), `SourceDetailPanel`, `TypeDetailPanel` → `InlineError variant="banner"`; `PanelList` → `StatusMessage`. Retry→recovery confirmed end-to-end on Sources, Pipelines, PanelList, PanelDetailModal, SourceDetailPanel preview, and ProposalReviewPage (the last is the task-2.8 stale-error regression: after Retry the proposal renders, not the stale error). |
| 403/404 render a distinct state with no retry-spam | **Real 404** (`/pipelines/00000000-…`, actual backend 404): `SearchX` glyph, "Couldn't load this pipeline", copy "We couldn't find this pipeline. It may have been deleted, or you may not have access to it.", `buttons: []` — D7-correct, does not assert deletion. **403** (forced response): `ShieldOff`, "You don't have access to these types.", no CTA. |
| Intent tokens + §5 button recipe; accessible; light/dark correct | `.inline-error__retry` / `.status-message__retry` = Secondary `--control-sm`/`--app-radius-sm`/`--weight-medium`/`--text-xs`; `.ui-empty-state__cta` Primary `--control-md`, `__secondary-cta` Secondary `--control-md`. Icon-only retry uses the shared `IconButton` (`variant="secondary"`, `size="xs"`), `aria-label`+`title` = "Retry". Measured focus: `:focus-visible` → `2px solid rgb(249,115,22)` at `outline-offset: 2px`; Enter activates and recovers. `PanelContent` wrapper keeps `role="alert"`, `InlineError` correctly omits its own (`announced={false}`) — no nested live regions. Both themes checked (see below). |
| Tests simulate failure+retry and the 403 path | Read the test bodies, not just names: `usePanelData.test.ts` D6 (a) and (b), `SourceDetailPanel.test.tsx` "preview error/unsupported split (D5a)", `PanelContent.test.tsx` forbidden/not-found + icon-only, `PipelineDetailPage.test.tsx:1374/1390` 403+404, `classifyRequestError.test.ts`. `StatusMessage.test.tsx` includes a real D4 guard that reads `StatusMessage.css` and asserts `.status-message--error` never redeclares padding/font-size/border-radius. |

**D5a — verified in the running app, not from the diff.** Selected the `sql`
source "HEL-758 Eval SQL Source" → Preview → banner reads "Preview is not
supported for SQL sources." and `banner.querySelectorAll("button")` returns
`[]`. Selecting the `csv` source with the preview endpoint failing renders
"Failed to fetch preview." **with** a working Retry that recovers. The
capability branch can structurally never carry Retry (`SourceDetailPanel.tsx:259`
passes no `onRetry`; `InlineError` also gates on `kind === "error"`).

**D6 — verified in the running app.** Failed a panel's `/rows` fetch → error
state; then cleared the failure and dispatched `panels/markDataTypeRowsStale`
(the real post-pipeline-run invalidation) **without touching Retry**. The panel
re-rendered as `panel-content--metric` with its value and
`document.querySelectorAll(".panel-content--error").length === 0`. The
button path (`refresh()`) was verified separately, including via keyboard Enter.

**Mobile / viewports.** 1440, 768, 430 all checked, no overflow
(`scrollWidth === clientWidth`), no clipped copy. 44px floor measured live at
430: `.inline-error__retry` 56.4×44, `.ui-empty-state__cta` 69.5×44,
`.ui-empty-state__secondary-cta` 164.9×44, `ui-icon-btn--xs` 44×44.

**Light/dark parity.** Dark: icon-wrap `color(srgb 0.236 0.152 0.133)`,
glyph `rgb(240,117,97)`. Light: icon-wrap `color(srgb 0.958 0.867 0.850)`,
glyph `rgb(199,58,42)`. Both **opaque** (mixed against `--app-surface`, per the
spec), border `color-mix(--app-error 30%)`. Inline banner reads correctly as an
error in both. `main`-variant title is Fraunces in both
(`fontFamily: Fraunces, "Iowan Old Style", Georgia, serif`) — §6 satisfied.

**Token discipline.** No hardcoded hex/rgb/px introduced. The only literals are
the sanctioned `44px` mobile floors. New lucide icons are all sized by CSS
`width:1em;height:1em` — no `size={N}` prop anywhere in the diff. The ticket
*removes* drift (`PipelineDetailPage.css`'s `padding: 24px`). All four replaced
CSS classes (`sources-page__error`, `pipelines-page__error`,
`pipeline-detail-page__error`, `type-registry-page__error`) are fully deleted
with no orphans left.

**Extend-don't-compete.** Confirmed: no new parallel error component. The three
required primitives were extended in place, and `ERROR_KIND_ICON` is shared
between the inline and full-surface paths so a kind reads identically either way.

**Scope.** No skeletons (HEL-528), no empty-state CTA copy (HEL-548), no toast
changes (HEL-535). `files-modified.md` matches the diff exactly.

**Things I checked that turned out fine:** `fetchPanelPage`'s "Panel is not bound
to a data type." guard is now classified as `"error"` (Retry-eligible), which
would be a D5a-class defect — but it is unreachable from the UI:
`usePanelData` returns early when `currentFetchKey` is `null` (unbound), and
`PanelCard.handleLoadMore` only fires when a pagination entry already exists.
`fetchPipelines`'s `condition` correctly still permits a retry from `failed`.
Console shows only the expected browser-level 404 network lines, no JS errors.
Global `prefers-reduced-motion` rule covers the new transitions; nothing in the
new CSS overrides the global focus ring.

### Verdict: REFUTE

The engineering is genuinely good — every Decision including the two hard ones
(D5a, D6) is correctly implemented and I confirmed both in the running app, not
just in the diff. Two visual/consistency defects block it, both in or adjacent
to the surfaces this ticket owns, and both cheap to fix.

### Change Requests

1. **`frontend/src/shared/ui/EmptyState.tsx:44-49` — the new ReactNode icon path
   renders the glyph 3px above the centre of the icon-wrap; the pre-existing
   FontAwesome path centres exactly.** Measured twice (reproduced), both themes:
   error state → `svgOffsetFromWrapCenter: -3` (`wrapH 64`, `spanH 30`,
   `svgH 24`); neutral FontAwesome state ("No memory stored yet", same 64px
   wrap) → `offsetY: 0`. Root cause: `renderIcon`'s `<span className="ui-empty-state__icon">`
   is a **block** flex item (`display: block`) whose line box is 30px tall,
   while the lucide `<svg>` inside is `display: inline` — the 6px of descender
   space below the glyph pushes it optically high. Because every full-surface
   error state this ticket adds (Sources, Pipelines, PipelineDetail,
   TypeRegistry, ProposalReview) uses the ReactNode path and every existing
   neutral empty state uses the FontAwesome path, the app now renders the *same
   primitive's* hero icon two different ways — visible side by side, and
   amplified by `TriangleAlert`/`SearchX` being bottom-heavy glyphs.
   Fix: make the wrapper centre its child, e.g. in `EmptyState.css` near the
   existing rule at `:197` —
   `.ui-empty-state__icon { display: flex; align-items: center; justify-content: center; }`
   (or `.ui-empty-state__icon svg { display: block; }`). Please re-measure the
   offset to `0` on both the `main` error state and an existing FontAwesome
   neutral state before calling it done. The same wrapper is used by
   `renderCtaIcon` (`:52-62`), so fix both wrappers even though no caller passes
   a ReactNode CTA icon yet.

2. **`frontend/src/shared/chrome/SidebarItemList.tsx:282` still renders the exact
   `<p role="alert">{error}</p>` anti-pattern this ticket exists to remove — for
   the *same* `sources.error` / `pipelines.error` / `dataTypes.error` the new
   `EmptyState intent="error"` renders, simultaneously on the same screen.**
   Measured live on `/sources` with `fetchSources` failing: the main pane shows
   the new hero treatment while the sidebar shows
   `p.dashboard-list__status` — `color: rgb(155,148,138)` (`--app-text-muted`,
   i.e. *identical* to the adjacent "Loading sources…" line), `font-size: 12px`,
   `hasIcon: false`. On the 403 run it renders the raw backend string
   "Forbidden" the same muted way. This violates DESIGN.md §7 ("Error: visible,
   human-readable, **intent-error styled**") — there is no error signal at all,
   not even colour — and it is the literal markup shape design.md's own Context
   set out to eliminate; the design's file survey simply missed this component
   (it enumerated `SourcesPage:48`, `PipelinesPage:35`, `PipelineDetailPage:596`,
   `TypeRegistryPage:20`, `TypeDetailPanel:193/223` and `DashboardList:265`, but
   never `SidebarItemList`). It is not a documented Non-Goal.
   The divergence is now *inside one component*: the Dashboards sidebar section
   (`DashboardList.tsx:265`) renders `StatusMessage`, so it picks up this
   ticket's error tint + `TriangleAlert` + `role="alert"`, while the five
   `SidebarItemList` sections (Sources, Pipelines, Data Types, Metrics,
   Assistant) stay bare muted text. I have a single sidebar screenshot showing
   the tinted, icon-paired Dashboards failure directly above untinted sibling
   sections.
   Minimal fix: render that branch through an existing primitive — e.g.
   `<InlineError error={error} variant="banner" />` (it already carries the icon
   + `role="alert"` and `announced` defaults to `true`), or `StatusMessage
   status="failed"` to match `DashboardList` exactly. **Retry is not required
   here** and should not be added speculatively; the requirement is only that
   the same failure reads as an error in both halves of the screen. If the
   orchestrator judges this outside HEL-539's boundary, it needs an explicit
   Non-Goal in design.md plus a filed spinoff — not silence, because the ticket's
   headline claim is "one canonical, visibly-consistent error pattern".

### Non-blocking notes

- `SourceDetailPanel`: the hint "Click **Preview** to load a sample of this
  source." still renders directly beneath "Preview is not supported for SQL
  sources." — contradictory copy. Pre-existing (the old single `error` state read
  the same way), but D5a now makes the capability message a first-class state, so
  suppressing the hint when `previewUnsupported` is set would finish the thought.
- `ProposalReviewPage`'s fallback copy "Could not load DataTypes for this
  workspace." uses camel-cased internal jargon; the app's own label is "Data
  Types". Pre-existing string, untouched by this ticket.
- `TypeDetailPanel` now has two error treatments in one panel: the preview error
  is a banner, the save-mutation error at `:202` is still a bare
  `<p class="type-detail-panel__error">`. Deliberate per D5 (mutations out of
  scope) and its sibling `SourceDetailPanel` already banners its rename error —
  worth a follow-up so the two detail panels match.
- `TypeDetailPanel` passes `retrying={previewLoading}` to its `InlineError` while
  `SourceDetailPanel` passes nothing. Both are no-ops (the error clears at the
  top of the retry handler, unmounting the banner), so neither ever shows
  "Retrying…" — harmless, but the asymmetry is arbitrary.
- `PanelDetailModal`'s compact banner looks small adrift in a full-screen modal.
  Deliberate per D5 (`retryVariant="button"` on the shared `PanelContent`), so
  not a defect — flagging only as a future polish thought.
- `--app-error` on `--app-error-surface` computes ≈4.27:1 in the light theme at
  `--text-xs`, just under WCAG AA 4.5:1. Inherited from the pre-existing token
  pair (this ticket correctly used the intent tokens as required), so it belongs
  with the token-drift backlog (HEL-652/677/680), not here.
- `usePanelData.ts:131` types the `.catch` parameter as a concrete shape rather
  than `unknown` + narrowing. Runtime-safe via optional chaining and defaults;
  noted only against CONTRIBUTING's "prefer `unknown` with narrowing".
