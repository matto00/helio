## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `0ea1692b` against base `3d93e82a` (76 files, +4668/-362).
All gates re-run independently in the worktree; all UI findings measured with
`getBoundingClientRect()` in the running app on ports 5960/8867, never eyeballed.

**Method note (so findings are reproducible).** To hold real cold-boot and
in-flight frames open for measurement, the app was booted inside a same-origin
iframe authored via `document.write`, with `XMLHttpRequest.send` patched *before*
the app's module scripts ran so selected `/api/*` requests could be delayed
on demand. Frame-by-frame traces were taken with a `requestAnimationFrame`
sampler installed in the same pre-app script. No application code, DB state, or
repo file was modified by any of this.

### Phase 1: Spec Review — FAIL

Ticket AC coverage:

| AC | Verdict |
| --- | --- |
| Each listed surface shows a shape-matched skeleton on initial load | Skeleton present on **every** listed surface (verified live: `PanelList`/`PanelGrid` desktop + phone stack, `SidebarItemList` ×4 sections, `DashboardList`, `PipelineDetailPage`, `SourceDetailPanel` preview, `PanelContent`, `SourcesPage`, `PipelinesPage`, `TypeRegistryPage`) — **PASS** |
| …with no layout shift when real content arrives | **FAIL** — two measured, newly-introduced shifts (CR1, CR2) |
| Token-only styling; shimmer disabled under `prefers-reduced-motion`; correct in light/dark | **FAIL on tokens** — two hardcoded, and *incorrect*, pixel heights (CR1). Reduced motion and light/dark: PASS |
| Refresh-in-place paths keep the accent spinner; no panel-polling regression | **PASS** (verified live) |
| `Skeleton` has a unit/render test; touched views have loading-state tests; lint/test pass, zero new warnings | **PASS** |

Detail:

- **Tasks**: 56/57 checked, 6.9 correctly left unchecked as an at-archive step.
  `check-openspec-hygiene.mjs` run independently → `openspec/ is clean`, confirming
  the executor's "no hook bypass was needed" claim (HEL-657 false-positive avoided).
- **Scope**: including `SourcesPage`/`PipelinesPage`/`TypeRegistryPage` is
  pre-declared in design.md's Planner Notes and is the inherited HEL-539 defect —
  in scope, not creep. Nothing from HEL-548 (empty-state CTAs) or HEL-535 (toasts)
  was pulled forward. The four out-of-scope items the requester enumerated are all
  correctly untouched.
- **Regression check on the D4 generalizations**: `DashboardList`, `SourcesPage`,
  `PipelinesPage` and `TypeRegistryPage` were restructured from "render the list
  unconditionally / gate on `succeeded||idle`" into exclusive if-else ladders. I
  verified this cannot regress the failed-refetch case: `fetchDashboards`,
  `fetchSources` and `fetchPipelines` are each dispatched exactly once from a
  mount effect keyed only on `dispatch`, so `status === "failed"` with items
  already present is unreachable. Behaviour-equivalent in practice.
- **Panel-data error path** (the risk widening `usePanelData.isLoading` creates —
  a permanent skeleton swallowing a failed fetch): checked and safe.
  `fetchPanelPage.pending` (`panelsSlice.ts:196-205`) always creates the pagination
  entry and `.rejected` (`:217-226`) keeps it with `isLoadingMore: false`, so
  `isLoading` returns to `false` and `PanelContent`'s error branch is reachable.
- **Spec-vs-implementation accuracy**: one normative claim is measurably false —
  see CR4.
- **Artifact accuracy**: task 6.3a names **eight** existing test files needing
  updates; only five were touched. `ChartRenderer.test.tsx`,
  `MarkdownRenderer.test.tsx` and `PanelCreationModal.test.tsx` were correctly
  left alone (they assert `getByLabelText("Loading data")` and a local
  "Loading data types…" string, none of which this change removes). Harmless, but
  the task text now overstates what was done.
- **`files-modified.md` diffed against the real diff**: accurate on every file it
  lists; no undeclared production file changed. Its one substantive claim —
  "Re-measured live after the fix: 43px both before and after resolve" — does not
  reproduce (CR1).

### Phase 2: Code Review — FAIL

**Gates (my own fresh run, in `WORKTREE_PATH`, not the executor's report):**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 — clean, zero warnings |
| `npm run format:check` | exit 0 — "All matched files use Prettier code style!" |
| `npm test` | exit 0 — root 8 suites/186 tests + frontend **235 suites / 2491 tests**, all passing (baseline 224/2427 → +11 suites, +64 tests) |
| `npm --prefix frontend run build` | exit 0 — built in 269ms (the >500 kB chunk warning is pre-existing) |
| `node scripts/check-openspec-hygiene.mjs` | exit 0 — `openspec/ is clean` |
| `node scripts/check-schema-drift.mjs` | exit 0 — in sync |

**Canonical-standard compliance:**

- `DESIGN.md` §3 Motion — `--app-skeleton-shimmer` added to `theme.css`'s Motion
  block and documented in §3 and §6. Correct mechanism, not a literal. **PASS**
- `DESIGN.md` §7 — every listed surface now renders a skeleton rather than a bare
  text line, an empty region, or resolved-but-empty content, with the one
  exception in CR3.
- `DESIGN.md` §8 / reduced motion — verified from the **served** CSSOM in the
  running app, not just the source: `@media (prefers-reduced-motion: reduce)
  .ui-skeleton { animation: auto ease 0s 1 normal none running none; background:
  var(--app-surface-soft); }`. The shorthand sets `animation-name: none`, the one
  longhand `theme.css:244-250`'s global `!important` rule does *not* set, so the
  shimmer is genuinely off rather than merely fast, and the gradient is replaced
  by a flat fill. **PASS**
- "Extend, don't compete" — `grep -rl shimmer frontend/src --include=*.css`
  returns only `Skeleton.css` (plus `theme.css`'s token name in a comment). Every
  per-surface placeholder is composed from the shared `Skeleton`. No bespoke
  shimmer anywhere. **PASS**
- Token discipline — **FAIL**, see CR1 (and the non-blocking `64px`/`28px` note).

**Other code findings** (all in Change Requests / Suggestions below): duplicated
zoom-container block, inline `import(...)` type FQNs, one orphaned stale CSS
comment. No `any`, no new TODO/FIXME, no dead code left behind other than that
comment, no security-relevant surface touched.

### Phase 3: UI Review — FAIL

Verified live at 1440 / 768 / 430, both themes. No new console errors in any
tested flow (the only error from port 5960 was a pre-existing
`404 /api/pipelines/<id>/schedule` for a pipeline with no schedule).

**What passed, with measurements:**

- **Grid skeleton, fully-covered saved layout** (`SWEEP-Profit Overview`, 2 entries
  / 2 panels): skeleton and resolved cards **pixel-identical** —
  `(497.6,120,918.4,209.6)` and `(264,344,452,209.6)` before and after. Zero shift.
- **Grid skeleton, empty saved layout** (`Skeptic Isolation Test`, 0 entries /
  2 panels): 3 placeholders at `(264,120,450,332)`, `(732,120,450,332)`,
  `(264,470,450,332)`; the 2 real cards land on the first two **exactly**. Only the
  extra placeholder differs — precisely the licensed count delta. Grid area is
  never empty. D10's premise confirmed against the dev DB: **26 of 42** dashboards
  store a completely empty saved layout.
- **Non-default zoom** (`scale(0.8)`): skeleton and resolved grid identical to the
  pixel, container `1152×518.4` both — the swap is not displaced. D10/task 7.1a
  confirmed.
- **Phone stack at 430px**: skeleton 6 cards at `x=32, w=366`, gap 12; resolved
  7 cards at `x=32, w=366`, gap 12. Horizontal geometry and spacing unchanged;
  only per-card height and count differ, exactly as documented. No overflow at
  430 or 768 (`scrollWidth === clientWidth`).
- **Fragile area (1), panel-body pre-dispatch frame — VERIFIED CLEAN.** rAF trace
  of a switch to a 7-panel dashboard with a bound metric *and* a bound table:
  `t=27ms` grid skeleton (6 placeholders) → `t=106ms` 7 real cards each with
  `.panel-body-skeleton`, `tables=0` → `t=200ms` first real table → `t=421ms`
  resolved. **At no sampled frame** did `--`, "No data", or a ghost table appear.
  The same trace on a cold boot with a bound metric panel: skeleton →
  `10 ALPHA`, never `--`. D13 and the `tableIsLoading` deletion (3.2b) both hold
  live. The detail-modal path is locked by `PanelCardBody.predispatch.test.tsx`
  (it could not be reproduced live because the modal always opens over an already
  populated cache entry).
- **D6**: markdown/chart panels rendered `PanelBodySkeleton` via
  `PanelSuspenseFallback` in the same frames as data-loading panels — chunk-load
  and data-load are indistinguishable, as intended.
- **D7 / no polling regression**: `SourceDetailPanel` reload keeps the resolved
  `DataGrid` at `1110×79` with only the button label changing to "Loading…" — no
  skeleton, no content replacement. First load correctly shows the preview
  skeleton (`1110×133.4`, `aria-label="Loading preview"`); the SQL source
  correctly shows no skeleton (`previewUnsupported`).
- **Page shells**: all three render `PageContentSkeleton` inside
  `ui-empty-state--main` at `1152×320` — the 320px floor is respected, so the
  inherited HEL-539 331px→15px collapse is gone.
- **Sidebar flat rows**: skeleton `32×215 @ x=12`, gap 2 — **identical** to the
  resolved rows. `DashboardList` verified at true cold boot.

**What failed:** CR1, CR2, CR3 below.

### Overall: FAIL

The core of this change is strong and the two "known-fragile" areas both hold up
under live instrumentation. The failures are three measured defects plus one
false normative claim, all narrow and cheap to fix.

### Change Requests

1. **The stacked sidebar skeleton row is 43px against a 46px resolved row — a 3px
   per-row shift that compounds down the list.** This is the exact surface D9
   flagged as "measure first", and `files-modified.md` claims it was fixed and
   "re-measured live afterward (43px both before and after resolve)". That does
   not reproduce. Measured at `/registry`, 1440, dark, fonts loaded:

   | | skeleton | resolved |
   | --- | --- | --- |
   | row 1 | `y=349, h=43` | `y=349, h=46` |
   | row 2 | `y=394` | `y=397` |
   | row 6 | `y=529` | `y=589` |

   Root cause is in `frontend/src/features/dashboards/ui/DashboardList.css:567-585`:
   `.dashboard-list__skeleton-line--name { height: 18px }` (`:569`) and
   `--subtitle { height: 15px }` (`:583`), both commented as "measured: …real rendered
   line-box height". The real line boxes are **19px** and **17px**
   (`getBoundingClientRect()` on `.dashboard-list__name` / `.dashboard-list__subtitle`
   in the running app), so each row is short by 1px + 2px, and `.dashboard-list__button`
   resolves to 46px (`19 + 17 + 8px padding + 2px border`) against the skeleton's 43px.
   The likely reason the executor measured 18/15 is that `line-height: normal` is
   font-metric-derived and those are the *fallback* font's metrics — i.e. measured
   before "Schibsted Grotesk" finished loading.

   **Required change**: replace both literals with `height: 1lh`, keeping the
   existing `font-size: var(--text-sm)` / `var(--text-xs)` on the same rules. I
   verified in the running app that `font-size: var(--text-sm); height: 1lh`
   computes to exactly **19px** and `var(--text-xs); height: 1lh` to exactly
   **17px** — an exact match that also tracks the token and the font instead of
   freezing one machine's measurement, which removes the two hardcoded pixel
   values the ticket's token-discipline rule targets. Re-measure `/registry` after
   the change (row height must be 46px in both states) and correct the claim in
   `files-modified.md`.

2. **The panel-count skeleton (task 6.8a) is not shape-matched and shifts ~10px on
   resolve.** `frontend/src/features/panels/ui/PanelList.tsx:181` renders
   `<Skeleton variant="line" width="4em" height="0.8em" />` inside the real
   `<span className="panel-list__count">`. Measured on a dashboard switch:

   - skeleton: `x=1235.17, w=66, h=15.59`
   - resolved ("6 panels"): `x=1225.56, w=75.61, h=23`

   The pill grows 9.6px wider and 7.4px taller and jumps 9.6px left on resolve.
   This is the *same* defect class the executor correctly diagnosed and fixed for
   the sidebar rows — a `display: block` decorative bar establishes no line box, so
   `.panel-list__count`'s `2px` padding + `--text-xs` line box (17px) + 2px border
   collapses from 23px to 15.6px. **Required change**: size the placeholder to the
   real box — e.g. `height="1lh"` and a width matching the resolved mono text
   (`.panel-list__count` is `font-family: var(--font-mono)` with
   `font-variant-numeric: tabular-nums`, so a fixed `em` width is stable) — and
   re-measure that the pill's rect is unchanged across the swap.

3. **Cold boot paints a false "No dashboards yet" hero over the whole main area
   while the dashboards fetch is in flight.** Frame trace of an undelayed cold boot
   (localhost): `t=367ms` main content renders
   `0 panels … No dashboards yet · Create your first dashboard to start adding
   panels · [New dashboard]` — with the sidebar's five skeleton rows visible beside
   it — until `t=423ms`. ~56ms / 3-4 frames on localhost; proportionally longer
   against the Cloud Run backend in production. Screenshots captured in both
   themes.

   The condition at `frontend/src/features/panels/ui/PanelList.tsx:271-294`
   (`status !== "loading" && status !== "failed" && selectedDashboardId === null`
   → `dashboards.length === 0`) is **unchanged from the base commit**, so this is
   pre-existing rather than a regression — but it is a flash of resolved-but-empty
   content on `PanelList`, the ticket's headline surface, and the requester's
   rule 6 ("never flash empty content before the skeleton — both are findings")
   covers it. It is *not* one of the four items the requester ruled out of scope
   (that list covers `PanelList`'s **post-delete terminal branch**, a different
   branch, which is correctly left alone here).

   D11 conflates "the user has zero dashboards" with "the dashboards fetch has not
   resolved"; the two are distinguishable with state that `PanelList` already
   selects. **Required change**: gate the zero-dashboard bootstrap branch on the
   dashboards fetch having resolved — `PanelList.tsx:30` already destructures
   `state.dashboards`, so this is adding `status: dashboardsStatus` there and
   requiring `dashboardsStatus === "succeeded"` (or rendering the grid skeleton) for
   that branch. The genuine zero-dashboard F-003 / HEL-554 bootstrap path must
   still render its CTA once the fetch resolves — please add a test covering both.
   If you judge this outside the fence, escalate rather than silently leave it: it
   is the app's most-seen loading moment and it tells a user with 42 dashboards
   that they have none.

4. **`specs/loading-state-pattern/spec.md:152-154` asserts something the
   implementation cannot deliver.** It states a bounded difference in placeholder
   **count** is accepted and "per-card geometry SHALL match exactly for the
   placeholders rendered, **in every case**". Measured counter-example
   (`skeptic-output overview`, saved `lg` = 4 entries, 6 real panels):

   - placeholder 4: `(264, 960, 450, 192)`
   - nearest resolved card: `(264, 960, 450, 332)` — same x/y/w, **h differs by 140px**,
     and the saved-position panel is pushed to `y=1310`.

   The same pattern appears on `Helio Roadmap (copy)` (6 saved entries / 7 panels):
   placeholders 5-6 at `y=1520/1870` vs resolved at `y=1800/2500`. Cause is
   inherent and not a code defect: when `saved.length < panels.length`,
   `resolveDashboardLayout`'s `effectiveSaved`/`findNextAvailablePosition` places
   the uncovered panels into free space, displacing saved-position cards. Exact
   matching holds in the two decidable cases — fully-covered (verified pixel-exact)
   and fully-empty (verified pixel-exact for the covered prefix) — but not for a
   partially-covered layout, which is common in the dev DB. **Required change**:
   correct the spec text (and D10's matching claim) to scope the exact-match
   guarantee to the fully-covered and empty cases, and state the partial case's
   position/size delta explicitly, the way D3 already does for
   `SourceDetailPanel`'s preview height. No code change is requested — the
   resolver-derived approach is the right one; the artifact must simply stop
   overclaiming.

5. **Two small code-quality items** (grouped; both mechanical):
   - `frontend/src/features/panels/ui/PanelList.tsx:255-267` and `:308-320` now
     contain two byte-identical copies of the `.panel-list__zoom-container` `<div>`
     and its 6-property inline style object (`--zoom-level`, `transform`,
     `transformOrigin`, `height`, `width`). Extract the style into a single
     `const zoomContainerStyle` (or lift the wrapper so it wraps both branches) —
     as written, any future zoom change has to be made twice.
   - `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx:40` and
     `:53` use `panel: import("../types/panel").Panel` inline. `CONTRIBUTING.md`
     ("Imports & Qualifiers") requires a top-of-file import wherever one would do;
     unlike `DesktopPanelGridSkeleton.test.tsx:19`, these are plain module-scope
     signatures with no `jest.mock` hoisting constraint. Replace with
     `import type { Panel } from "../types/panel";`.

### Non-blocking Suggestions

- `frontend/src/features/pipelines/ui/PipelineDetailPage.css:790-791` still carries
  the orphaned `/* F-132: was bare "Loading…" text … now the shared
  <Spinner size="xl"> primitive */` comment, but the rule it described was deleted
  and that surface no longer uses `Spinner`. It now sits misleadingly above the
  "Save / Cancel actions" block. `PipelinesPage.css` removed its equivalent comment
  correctly — do the same here.
- `PipelineDetailPage`'s skeleton bands don't match their resolved heights: header
  `31px → 37px`, footer region `49px → 122.8px` (river absorbs the difference; the
  page's own `1200×852` box is stable). Not a container-level shift and a clear
  improvement on the previous centred-spinner takeover, but design.md D3 implies
  the bands' geometry is inherited from the real classes. Worth recording the
  delta explicitly, as D3 already does for the preview grid.
- `PageContentSkeleton.tsx:18` hardcodes `width={64} height={64}` duplicating
  `EmptyState.css:20-21`'s `--main` icon-wrap size, and `PipelineDetailSkeleton.tsx:43`
  hardcodes `width={28} height={28}` with no cited source. Every other placeholder
  in the change uses `em`/`%`. Consider a class or an existing control token.
- The new loading wrappers put `aria-label` on role-less `<div>`s
  (`PanelGridSkeleton.tsx:29`, `PageContentSkeleton.tsx:17`,
  `SourcePreviewSkeleton.tsx:24`). `Skeleton.tsx`'s own docblock recommends
  `role="status"` + `aria-label`, but no caller sets the role, and `aria-label` on
  `role=generic` is ignored by real assistive tech (Testing Library's
  `getByLabelText` finds it regardless, so the tests can't catch this). This
  matches the pre-existing `PanelContent` pattern so it is not a regression —
  but adding `role="status"` to these three wrappers would make the spec's
  "announces one loading state" requirement actually true.
  `SidebarRowsSkeleton`'s `<ul aria-label>` is fine (lists accept a name).
- `panelGridSkeletonStubs.ts:57` uses `{ id } as unknown as Panel`. Well justified
  in the comment, but `resolveDashboardLayout` only ever reads `panel.id`, so
  widening its parameter to `readonly Pick<Panel, "id">[]` would delete the double
  cast at the cost of one signature change.
- `DashboardList.tsx` (407 → 421) and `SidebarItemList.tsx` (457 → 471) were both
  already past `CONTRIBUTING.md`'s ~400-line "propose a split in the PR
  description rather than adding to it" line and grew further. Add that note to
  the PR body.
- `shared/ui/SuspenseFallback.tsx:3` imports from `features/panels/ui/…`, a
  shared→feature direction. It matches the existing convention here
  (`SidebarBody.tsx`, `Toast.tsx`, `usePickerSelection.ts` all do it) and D6
  requires the two to share one component, so this is consistent rather than new —
  noted only so it isn't mistaken for an oversight.
- Light-theme shimmer contrast (`#efece6` → `#ffffff`) is visibly subtler than dark
  (`#161514` → `#232019`), as task 7.3a anticipated. Mechanically correct and
  token-only; whether it reads as "cheap" beside the rest of the app is the
  skeptic's [judgment] call, and screenshots of both themes were captured for that
  gate.
- Task 6.3a's "EIGHT existing files" should be corrected to five — the other three
  never asserted copy this change removes.

### Critical Path

Not applicable at cycle 1 (`EXECUTION_CYCLES` not exhausted). For sequencing:
CR1 and CR2 are the two that fail the headline "no layout shift" AC and should be
fixed first, with a fresh `getBoundingClientRect()` re-measurement recorded in the
handoff rather than a restated claim. CR3 is the highest user-visible impact and
is one condition. CR4 and CR5 are documentation/hygiene and can land alongside.
