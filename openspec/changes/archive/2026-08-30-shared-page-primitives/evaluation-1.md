## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: 6ee4e8b4 on `feature/page-shell-header-status-primitives/HEL-725`.

### Phase 1: Spec Review — PASS

- Decision 0 honored: `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, `MetricDetailPage`
  and `MetricsPage.css`/`MetricDetailPage.css` are untouched (verified with
  `git diff --name-only main...HEAD`).
- Decision 3a honored: `SettingsPage.tsx` renders three independent `PageStatus` instances
  (preferences :77, agent memory :88, api tokens :114); no page-wide collapse; F-047 per-section
  gating preserved.
- Decision 4 honored: `PageHeader` appears only in `SourcesPage`, `PipelinesPage`, `SettingsPage`.
  `ChatPage`, `PipelineDetailPage` and all four review routes gained `PageShell`/`PageStatus` with
  no `PageHeader` (confirmed in the DOM at `/chat` and `/pipelines/:id` — `.page-header` absent).
- In-scope CSS deletions verified: `.chat-page__loading`/`__error` and
  `.settings-page__loading`/`__error`/`__title` are gone; nothing else deleted.
- All four review routes migrated (`ProposalReviewPage`, `PatchSetReviewPage`,
  `PipelineProposalReviewPage`, `CombinedProposalReviewPage`).
- Tasks 1.1–5.2 and 5.4 marked done and match the diff; 5.3 correctly left for this pass.
- No scope creep, no API/schema surface touched.

### Phase 2: Code Review — FAIL

Gates re-run independently in `WORKTREE_PATH` (fresh, not the executor's report):

| gate | result |
|---|---|
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 274 suites / 2958 tests |
| `npm --prefix frontend run build` | PASS |

Issues:

1. **Behavior regression — `PatchSetReviewPage.tsx:154` and `:162` dropped the only escape action.**
   On `main` both the `loadError` and `previewError` branches rendered an `EmptyState` with
   `cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}`. The migrated `PageStatus`
   calls pass neither `onRetry` nor `secondaryCta`, so both error screens now render with **no
   action at all** — the user is stranded on a dead-end route. `ProposalReviewPage` preserved the
   same affordance via `secondaryCta`; `PatchSetReviewPage` did not. design.md's Goals explicitly
   require preserving "every route's existing behavioral nuance"; this is a presentational
   consolidation that silently removed a navigation action.

2. **Layout regression — `PipelineDetailPage` lost its full-bleed geometry.** On `main`,
   `.pipeline-detail-page` declares no `padding` and no `gap` (`height: 100%; overflow: hidden`),
   so `PipelineDetailHeader`'s chip bar and `.pipeline-detail-page__footer-region` render as
   full-bleed strips flush to the content area's edges — which is exactly the design HEL-719
   established (see the comment at `PipelineDetailPage.css:9-15`: the footer "shares that region's
   background/border-top instead of owning its own (that would still read as a separate strip)").
   Measured live at `/pipelines/555f4bae-…`: `.page-shell.pipeline-detail-page` now computes
   `padding: 20px 24px; gap: 32px`, insetting the header bar and footer region by 24px horizontally
   and detaching them with 32px gaps — both bordered strips now float as separate cards. Verified by
   before/after screenshots (`hel725-pipeline-detail.png` vs the same page with
   `padding:0;gap:0` re-applied, which reproduces `main`'s appearance exactly). `PageShell`'s
   standard section-overview geometry was applied to a route that never had it and whose CSS does
   not neutralize it.

3. **Section-scale error states rendered at page scale — `SettingsPage.tsx:79, 90, 118`.** Driven
   live (XHR redirected to a 404 so each section's fetch fails): a single failed section now renders
   a ~350px-tall centred hero (`EmptyState intent="error"`, large icon glow, Fraunces
   "Something went wrong") inside the 720px settings column, replacing what was a one-line inline
   message. Three failures would produce three stacked heroes. Decision 3a's *structure* (three
   independent instances) is correct and must stay; the *treatment* needs a compact/inline form —
   `PageStatus` currently has no way to render anything but the full page-level hero, and the
   generic default title also drops the "which fetch failed" context the old inline copy carried
   next to its section heading.

4. **Dead CSS left behind — `SourcesPage.css:9` (`.sources-page__header`) and `PipelinesPage.css:9`
   (`.pipelines-page__header`).** Both `<header className="…__header">` elements were replaced by
   `PageHeader`; the rules are now unreferenced (grep confirms zero `.tsx` references). Task 5.1
   ("delete any that remain dead") was not carried through for these.

5. **Duplicated container geometry defeats the primitive's stated purpose.** `.chat-page`
   (`ChatPage.css:1-7`), `.sources-page` (`SourcesPage.css:1-7`) and `.pipelines-page`
   (`PipelinesPage.css:1-7`) still declare the byte-identical
   `display:flex; flex-direction:column; gap:var(--space-7); padding:var(--space-5) var(--space-6);
   min-height:100%` that `.page-shell` now provides, on the very same element (both classes are on
   the `PageShell` div). This is the duplication the ticket exists to remove, it re-opens exactly the
   per-route drift the spec forbids ("without requiring the consumer to redeclare the container's own
   padding/gap"), and the winner is decided only by stylesheet import order. Delete the duplicated
   declarations, keeping only genuinely route-specific properties (e.g. `.settings-page`'s
   `max-width: 720px` and its deliberate `gap: var(--space-5)` override — that one is fine, but it
   should be written as an intentional override, not a full re-declaration).

6. **`PageHeader` back affordance is a defective shipped API — `PageHeader.tsx:28-43`.** It renders
   a raw `<a href={backTo ?? "#"}>` whose entire accessible name is the glyph `←` (no `aria-label`,
   no visible label), and when `backTo` is used with no `onBack` it performs a **full document
   navigation**, not a react-router transition — a hard page reload in an SPA. No call site uses
   `backTo`/`onBack` yet (grep: zero consumers), and `PageHeader.test.tsx` only covers the `onBack`
   path, so the `backTo` path ships untested and broken for HEL-908/909 to inherit.

Non-blocking observations (see below) cover the remaining minor points.

### Phase 3: UI Review — FAIL

Servers: `start-servers.sh` READY, `assert-phase.sh servers` → `PASS servers` (dev 6157 / backend 9064).
Task 5.3 executed — routes driven live in the running app.

| route | loaded | loading | error |
|---|---|---|---|
| `/sources` | PASS — `page-shell sources-page`, padding 20/24, gap 32, `<h1 class="page-title">` Fraunces 24px/600 | PASS (skeleton passthrough) | not re-triggered (code path identical to Pipelines) |
| `/pipelines` | PASS — same geometry/title metrics as Sources | PASS | n/a |
| `/pipelines/:id` | **FAIL — issue 2** (full-bleed layout lost) | PASS (skeleton) | PASS — error hero renders, correct not-found copy, no CTA expected for `not-found` kind |
| `/chat` | PASS — geometry unchanged from `main` | n/a | n/a |
| `/settings` | PASS — title now matches Sources/Pipelines exactly (Fraunces 24px/600), `max-width: 720px` and `gap: var(--space-5)` preserved | PASS | **FAIL — issue 3** (page-scale hero for a section-scale state) |
| `/proposals/review` | PASS — content is a modal overlay, `PageShell` wrapper harmless | PASS | not re-triggered |
| `/patch-sets/review` | — | — | **FAIL — issue 1** (no action on either error branch) |
| `/pipeline-proposals/review` | PASS | PASS | n/a (no fetch-error branch exists) |
| `/combined-proposals/review` | PASS | PASS | n/a (no fetch-error branch exists) |

Other checks:
- Console: only expected `404` network errors when deliberately requesting a non-existent pipeline;
  no unhandled exceptions, no React errors on any route.
- Header consistency AC verified by computed style, not by eye: Sources / Pipelines / Settings all
  render `Fraunces … | 24px | 600` for `.page-title`.
- Breakpoints 1440 / 1100 / 768 / 390 on `/sources`: no horizontal overflow, no layout breakage.
- Error states retain `role="alert"` (via `EmptyState intent="error"`), so the `role="alert"` that
  `ChatPage`/`SettingsPage` had inline is not lost.

### Overall: FAIL

### Change Requests

1. `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx:154` and `:162` — restore the lost
   navigation action on both error branches, e.g. add
   `secondaryCta={{ label: "Back to dashboards", onClick: () => navigate("/") }}` to each
   `PageStatus` (same pattern `ProposalReviewPage.tsx:186-193` already uses).
2. `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` / `PipelineDetailPage.css:1-8` —
   restore the full-bleed layout. Either neutralize the shell geometry for this route
   (`.pipeline-detail-page { padding: 0; gap: 0; }` alongside the existing
   `height:100%; overflow:hidden`), or drop `PageShell` from the resolved-content return and keep it
   only for the loading/error returns. Re-verify against the pre-change appearance: the chip header
   and `__footer-region` must sit flush to the content area's left/right/top/bottom edges with no
   32px inter-child gap.
3. `frontend/src/shared/ui/PageStatus.tsx` + `SettingsPage.tsx:79,90,118` — give `PageStatus` a
   compact/inline error treatment (e.g. `size?: "page" | "section"`, default `"page"`) and use the
   section form for `SettingsPage`'s three instances, so a failed section renders at section scale
   rather than as a page-scale hero. Keep Decision 3a's three independent instances. Also pass a
   section-specific `title` (e.g. "Couldn't load preferences") instead of the generic default.
4. `frontend/src/features/sources/ui/SourcesPage.css:9` and
   `frontend/src/features/pipelines/ui/PipelinesPage.css:9` — delete the now-unreferenced
   `.sources-page__header` / `.pipelines-page__header` rules (task 5.1).
5. `ChatPage.css:1-7`, `SourcesPage.css:1-7`, `PipelinesPage.css:1-7` — delete the
   `display/flex-direction/gap/padding/min-height` declarations that `.page-shell` now owns; keep
   only route-specific properties. (`.settings-page` may keep `max-width` and its deliberate
   `gap: var(--space-5)` override, but should not re-declare `display`, `flex-direction` or
   `padding`.)
6. `frontend/src/shared/ui/PageHeader.tsx:28-43` — fix the back affordance before it ships to
   HEL-908/909: give it a real accessible name (`aria-label="Back"` plus an icon, not a bare `←`
   text node), and render `backTo` through react-router's `Link` (or `useNavigate`) so it performs
   an SPA transition instead of a full document load. Add a `backTo` case to `PageHeader.test.tsx`.

### Non-blocking Suggestions

- `PageStatus` with `variant="skeleton"` and no `loadingLabel` (the Sources/Pipelines call sites)
  renders `<>{children}</>` — a literal no-op wrapper. It satisfies the "one shared implementation"
  AC only nominally at those two call sites; consider whether the skeleton variant should at least
  own the `role="status"`/label contract so the shared component carries some behavior everywhere.
- Class-name inconsistency: `PageShell`/`PageHeader` use unprefixed `.page-shell`/`.page-header`
  while `PageStatus` uses `.ui-page-status`. Pick one convention across the three new primitives.
- `PageHeader.tsx:12-15` documents that `onBack` takes precedence over `backTo`; that precedence is
  untested. A one-line test would pin it.
