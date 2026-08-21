## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of `279419a6` (on `11ce766b` / `0ea1692b`, base `3d93e82a`). I re-derived the
whole change from ground truth rather than working round 1's CRs as a checklist; every
number below is my own, measured this session in headless Chromium against the running
worktree (5960/8867) with `getBoundingClientRect()` / rAF frame traces. `files-modified.md`,
`evaluation-*.md` and `skeptic-final-1.md` were read as claims only.

### What I verified (with evidence)

**Gates — all re-run by me in the worktree.**

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | `LINT_EXIT=0`, zero warnings |
| Format | `npm run format:check` | `FORMAT_EXIT=0` |
| Tests | `npm test` (worktree) | `TEST_EXIT=0` — root **8 suites / 186 tests** + frontend **236 suites / 2497 tests** (round 1 measured 235/2493; +1 suite = `PanelList.gridWidthSharing.test.tsx`, +4 tests) |
| Build | `npm --prefix frontend run build` | `BUILD_EXIT=0` |
| Hygiene | `node scripts/check-openspec-hygiene.mjs` | `openspec/ is clean`, exit 0 |
| Spec | `openspec validate skeleton-loaders-list-detail-panel --strict` | `Change '…' is valid` (system `/usr/bin/openspec`; `npx openspec` is not resolvable in this worktree) |

No commit body discloses a `git commit -n`, and the clean hygiene run corroborates that
none was needed. `scripts/concertino/assert-phase.sh servers` → `PASS servers`.

**`files-modified.md` diffed against the real diff.** Every path it claims appears in
`git diff --name-only main...HEAD`; every changed non-`openspec/changes` path is covered
by one of its entries (including the `(+ test)` / `(+ .css)` shorthands). No phantom
claims, no unlisted files.

---

#### Blocker 1 (grid arrives 51px too wide) — RESOLVED, reproduced three independent ways

rAF-sampled every frame across the swap, with `/api/dashboards/*/panels` delayed:

| Case | Settled skeleton | **First resolved frame** |
| --- | --- | --- |
| Empty saved layout (`Skeptic Isolation Test`, 2 panels) | `[264,120,450,332] [732,120,450,332] [264,470,450,332]` | `[264,120,450,332] [732,120,450,332]` — **identical**, no 501px frame |
| Fully covered saved layout (`HEL254WideType overview`, lg:3 / 3 panels) | `[264,330,1152,262] [498,120,918,192] [264,610,567,262]` | **byte-identical**, all three |
| Saved zoom 80% (`transform: matrix(0.8,…)`) | `[264,288,1152,209.6] [497.6,120,918.4,153.6] [264,512,568.8,209.6]` | **identical** (task 7.1a) |

Only the placeholder *count* differs (3 → 2 in case 1) — the licensed delta.

**The 0-width path the executor flagged is closed.** Two probes: (a) `clientWidth` of
`.panel-list__zoom-container` sampled every frame across the whole cold-boot sequence took
exactly two values, `null` (pre-mount) then `1152` — never `0`; (b) a direct behavioural
proxy — if width were `0`, `PanelGridSkeleton`/`PanelGrid` would branch to the *phone*
stack — `.mobile-panel-stack` is **never** present at 1440px across bootstrap →
panels-loading → resolved (`mobileStack ever true at 1440: false`), and `.panel-grid-shell`
holds 1152 throughout.

**Bootstrap → panels-loading handoff is continuous.** With both fetches delayed 1200ms,
`[aria-label="Loading panels"]` is present on every one of 383 sampled frames from first
paint until resolve — no frame where neither skeleton exists. Card geometry changes
`3×[…,332]` → `1×[264,120,450,192]` at the handoff (the dashboard's real saved layout
becoming known), and the resolved grid then matches that second skeleton exactly.

#### Blocker 2 (the "0 panels" pill) — RESOLVED

Cold boot with `/api/dashboards` delayed: the pill renders a `Skeleton` for the entire
bootstrap window and the entire panels-loading window; `"No dashboards yet"`,
`"Select a dashboard"`, `"No panels yet"`, `"No data"` and `--` are absent from
`document.body.innerText` on every sampled frame. Pill rect is **pixel-identical** across
the swap for plural counts: skeleton `[1228,75,74,22]` → `"2 panels"` `[1228,75,74,22]`,
and → `"6 panels"` `[1228,75,74,22]`.

I also forced the genuine zero-dashboards path live (stubbed `GET /api/dashboards` to
`{items:[]}`), which round 1 could only cover in Jest: `t=1348` skeleton up, no CTA text;
`t=2859` skeleton gone, `"No dashboards yet"` + the **"New dashboard" CTA** renders at the
top of the main pane. D11's mirror-image case holds in the real app, and the now
always-mounted `.panel-list__zoom-container` does **not** displace it (it collapses to
`height 0` when empty — measured `[264,120,1152,0]` with the `EmptyState` at `[264,120,1152,331]`).

#### Blocker 3 (`PipelineDetailSkeleton` footer) — documented; I accept the carve-out

My measurements reproduce round 1's exactly: page container `[240,48,1200,852]` in **both**
states; header `h31 → h36`; river `y79 h772 → y84 h696.2`; footer region
`y851 h49 → y780.2 h119.8` (+70.8).

I probed the real footer across **four** pipelines to test whether the delta is genuinely
underivable: resolved `__footer-region` = 119.8 / 84.3 / 84.3 / 55.5 px. The variance is
driven by exactly the two facts the addendum names — the `.pipeline-detail-page__meta-bar`
(28.8px, rendered only when `lastRunAt != null`; present in 3 of 4) and the wrapping
schema-chip row (`chips` 0 / 0 / 3 / 15, worth up to +35px). Both are unknowable pre-fetch
and there is no `resolveDashboardLayout`-equivalent to derive them from, so a hand-built
placeholder would be confidently wrong about as often as right. Round 1 explicitly offered
"fix **or** document"; the documentation landed in both `design.md` (a D3-style addendum
with the measured numbers) and `specs/loading-state-pattern/spec.md` (a scoped requirement
plus scenario, keeping the outer container's stability as the binding guarantee). That is
honest and adequately bounded. One residual honesty gap, non-blocking: ~6.5px of the 70.8
is *not* unknowable — the real footer's always-present control row floors at 54.5px against
the skeleton's 48px.

---

#### Acceptance criteria — traced

**AC1 — shape-matched skeleton, no layout shift on resolve.** Measured per surface,
before/after:

| Surface | Skeleton | Resolved | Verdict |
| --- | --- | --- | --- |
| `/registry` stacked sidebar rows | `[12,348,215,43]…`, name-line 18, subtitle-line 15 | row-for-row identical, name 18 / subtitle 15 | **exact** |
| `/sources`,`/pipelines` flat sidebar rows | `[12,359,215,32]` ×5 | `[12,359,215,32]` … | **exact** |
| `DashboardList` sidebar | `[12,378,215,32]` ×5 | `[12,378,215,32]` … | **exact** |
| Panel bodies (table / chart / metric, one dashboard) | `[285,404.4,1110,141.6] [519,192,876,74] [285,684.4,525,141.6]` | identical, all three | **exact** |
| Grid cards | see Blocker 1 | | **exact** (count delta only) |
| Phone stack @430 | `[32,144,366,120] [32,276,…] [32,408,…]` | `x`/`width`/count identical; heights 120 / 200 / 621 | horizontal + count **exact**, height delta = D10 |
| `SourceDetailPanel` preview | `[285,258,1110,248.4]` | `[…,265]` (REST, 10 rows) / `[…,320]` (CSV, 25) | x/y/w exact; +16.6px (was +131.6 in round 1) |
| `SourcesPage`/`PipelinesPage`/`TypeRegistryPage` main | `[264,68,1152,320]` | resolves to real content (e.g. 220px) | 320px `EmptyState --main` floor held, per D3 |
| `PipelineDetailPage` | container `[240,48,1200,852]` | identical | container exact, bands = documented delta |

**The `1lh` mechanism holds in both font conditions — I A/B'd it with the font state held
constant.** Naïve timing gives a false 3px shift (I reproduced that artifact once and
re-ran rather than reporting it): the webfont finishing mid-measurement moves *both* the
skeleton and the real row. Controlled runs, using a canvas advance-width discriminator
(`document.fonts.check('…"Totally Not A Real Font 12345"')` returns `true` here too —
independently reconfirmed):

- webfont applied in both states → skeleton **43 / 18 / 15**, resolved **43 / 18 / 15**
- webfont blocked in both states → skeleton **46 / 19 / 17**, resolved **46 / 19 / 17**

Matching the settled figures exactly, and confirming `DashboardList.css`'s corrected
comments (the user-directed fix) now state the right numbers for the right conditions.

**AC2 — tokens only, reduced motion, light/dark.**
- `grep` over every added CSS line: **zero** literal colours, px, rem or durations (numbers
  appear only inside comments). `--app-skeleton-shimmer: 1.6s` is the one new token, in
  `:root`'s Motion block; `DESIGN.md` §3 and §6 were extended to match.
- Shimmer exists in exactly one place: `.ui-skeleton` / `@keyframes ui-skeleton-shimmer` in
  `Skeleton.css`. The four other skeleton CSS rules are geometry-only (`flex`, `gap`,
  `height: 1lh`, `max-width`). No competing recipe.
- One primitive, `frontend/src/shared/ui/Skeleton.tsx`, exported from `shared/ui/index.ts:14`;
  all eight per-surface placeholders compose it, none hand-rolls a bar.
- Reduced motion, in a real `reducedMotion: "reduce"` browser: `animation-name: "none"`,
  `background-image: "none"`, flat `background-color: rgb(22,21,20)` (= `--app-surface-soft`),
  and `backgroundPosition` sampled 10× over 2s is `"0% 0%"` every time — genuinely
  disabled, no parked highlight. Control run (no preference): `1.6s linear infinite`, ramp
  positions sweeping `191% → -158%`.

**AC3 — spinner still owns in-place refresh.** `usePanelData`'s widened `isLoading` is
`paginationEntry == null || (isLoadingMore && rows.length === 0)` — character-identical to
the old expression once the entry exists, and `refresh()` (the polling callback) only resets
the dedupe key, never deletes the entry, so a poll keeps rows and shows no skeleton. Seen
live: with rows delayed on a cached table panel, the panel keeps its rows and shows
`TableRenderer`'s "Loading…" spinner pill. `PageSuspenseFallback` still renders
`Spinner size="2xl"`; `SourceDetailPanel`'s button label is untouched.

**AC4 — tests.** 236/2497 green, zero new warnings. `Skeleton.css.test.ts` genuinely
brace-matches the `prefers-reduced-motion` block and asserts `animation(-name): none` plus
the *absence* of `animation-duration` (the longhand `theme.css`'s global `!important` rule
would defeat). `StatusMessage.test.tsx` locks D5's narrowing with `@ts-expect-error`.
`PanelList.gridWidthSharing.test.tsx` is honest about what it can lock — it fails on the
old code (the mocked children would receive `width: undefined`), and `PanelGrid.test.tsx`'s
`react-grid-layout` mock exports only `Responsive`, so re-introducing an internal
`useContainerWidth()` there would throw.

#### Iron Laws

- *Verification*: every gate above re-run and read by me; every geometric claim
  independently measured, not inherited.
- *Systematic debugging*: the three fixes carry probe-confirmed root causes recorded in the
  commit bodies and artifacts (two independent `useContainerWidth` calls re-entering
  `initialWidth: 1280`; the ResizeObserver orphaned against a remounted wrapper, caught by a
  live width trace, not assumed; CR3's second skeleton window not covered by the pill gate).
  The width bug is a real-browser ResizeObserver timing defect that jsdom cannot reproduce;
  the unit test locks the fix's mechanism and says so, and I reproduced the *behavioural*
  fix live three times.

#### D11's live edge cases (re-derived, not taken on trust)

- `SidebarBody` passes the same `(idle || loading) && empty` gate at **all five**
  `SidebarItemList` call sites — which initially read like the exact permanent-skeleton
  hazard D11 warns about for the free tier. It is not: `SidebarBody` early-returns one
  section at a time, its effect dispatches that section's fetch when idle, and
  `if (section === "chat" && isFreeTier)` returns the locked notice *before* the chat list
  is ever constructed (HEL-703). The hazard is structurally unreachable.
- `fetchDashboards` has exactly one Redux dispatch site (`App.tsx:120`, mount-once), so
  `DashboardList`'s new error-replaces-list ladder cannot fire with items present.
- Refetch-keeps-content (D4) confirmed live: navigating `/sources → /pipelines → /sources`
  with the sources fetch delayed 2.5s keeps all 52 existing rows rendered, no skeleton.

#### UI / design judgment (my call)

Screenshots taken and **looked at**: dashboard grid, panel bodies, phone stack,
`/registry`, `/sources`, `/pipelines`, `/pipelines/:id`, plus 3× element zooms of the card,
the count pill and the sidebar rows — light **and** dark, at 1440 / 768 / 430, and again
under `prefers-reduced-motion`. Console: **0 app errors** across every trace; the single
network 4xx anywhere is a pre-existing `GET /api/pipelines/:id/schedule` 404 for a pipeline
with no schedule, unrelated to this change.

It looks good. The bars are soft, correctly radiused, and sit inside the real chrome (real
card border/padding, real `<ul>` rhythm, real title/footer meta still rendered on panel
cards) rather than replacing whole surfaces with grey slabs — which is what stops it
reading cheap. Every surface renders the same recipe, so the sidebar rows, grid cards,
panel bodies, preview table and page hero read as one family; the requester's item 7 is met.

I measured the contrast question myself rather than inheriting round 1's answer, and get its
numbers exactly: base-vs-container 1.150 light / 1.030 dark, highlight-vs-container 1.025
light / 1.089 dark, ramp amplitude 1.179 light / 1.122 dark. The polarity is inverted
between themes (light bars read darker than the card and dissolve under the highlight; dark
bars brighten), but both are legible at 1× and the amplitude is comparable. Under reduced
motion the dark flat fill is the weakest case at 1.030 — I looked at it at 2× and the row
and card structure is still discernible, and it is consistent with this app's deliberately
low-contrast dark language. I agree with round 1: keep D1's token pair. Not a finding.

### Verdict: CONFIRM

All three round-1 blockers are genuinely resolved — two by code (verified live, three
independent reproductions for the grid, two orthogonal probes for the 0-width regression)
and one by documentation that round 1 explicitly sanctioned and that my own four-pipeline
probe corroborates as honest. The headline AC — no layout shift when real content arrives —
now holds on the ticket's first-listed surface and on every other surface I could measure,
with each remaining delta named, bounded and written into the spec rather than left
implied. Ships.

### Non-blocking notes

1. **The count pill shifts 7px on singular counts.** Skeleton `w74` → `"1 panel"` `w67`
   (`[1228,75,74,22]` → `[1235,75,67,22]`); plural counts are exact. The pill is
   right-aligned so nothing else moves (`.panel-list__add` is fixed at `[1310,72,106,28]`
   in both). The evaluator's suggestion is the right fix and also closes a pre-existing
   "9 panels" → "10 panels" resize: give `.panel-list__count` a `min-width` in `ch`.
2. **The grid skeleton still "breathes" on its own first mount.** `panelGridConfig.initialWidth`
   is 1280 against a 1152 container, so the *skeleton's* entrance eases 501 → 450 over
   ~180ms. This is pre-existing behaviour (on `main` the real `PanelGrid` did it, and with
   `key={selectedDashboardId}` it did so on *every* dashboard switch); this change strictly
   improves it — the swap itself is now exact and an in-session switch at the same zoom
   mounts the skeleton directly at 450. At real speed the window is ~57ms. It re-appears
   when the measured width changes (e.g. switching between dashboards with different saved
   zoom levels). Closing it properly means a synchronous pre-paint measurement, which is
   `panelGridConfig`'s problem, not this ticket's.
3. **Bootstrap → panels-loading handoff visibly re-shapes the placeholders** (3 generic
   `332px` cards → the dashboard's real saved layout) once `/api/dashboards` resolves —
   ~57ms in practice, seconds if that fetch is slow. Unavoidable given the ticket forbids
   rendering nothing, but worth knowing it exists.
4. **`PipelineDetailSkeleton`'s footer floor is predictable even if the rest isn't.** The
   real footer's control row never measures below 54.5px (all four pipelines) against the
   skeleton's 48px; a `min-height` would remove ~6.5px of the documented 70.8px delta
   without guessing at the meta-bar or the chip count.
5. **`.suspense-fallback__label` (`SuspenseFallback.css:16-20`) is still dead code** — round 1's
   note 5, unaddressed. Its only consumer was the label this change removed.
6. **`aria-label` on role-less `<div>`s** — `PanelGridSkeleton`'s `.panel-grid-shell`,
   `PageContentSkeleton`'s `.ui-empty-state`, `SourcePreviewSkeleton`'s `.ui-data-grid`.
   Round 1's note 6 / evaluation-2's note 6, still unaddressed; `role="status"` would make
   `skeletonAccessibility.test.tsx` lock a name that actually reaches AT.
7. **`PanelGridSkeleton.test.tsx`'s header comment slightly overclaims.** It says both
   suites would fail if either component re-introduced `useContainerWidth`; that holds for
   `PanelGrid.test.tsx` (which mocks `react-grid-layout` with only `Responsive`) but not for
   `PanelGridSkeleton.test.tsx`, which doesn't mock the module at all, so the real hook would
   simply work in jsdom.
8. **`DashboardList`'s ladder is now mutually exclusive**, so a failed fetch replaces the
   list where the old code rendered the error *above* a populated `<ul>`. Unreachable today
   (single mount-once dispatch), but the artifacts still don't mention the behaviour change.
9. **File-size soft budget (`CONTRIBUTING.md:24`).** `PanelList.tsx` 283 → **424** crosses
   ~400 in this change; `DashboardList.tsx` 407 → 421 and `SidebarItemList.tsx` 457 → 471
   were already over. The rule's remedy is "propose a split in the PR description" — that
   needs to land in the PR body. (Much of `PanelList`'s growth is explanatory comment, in
   keeping with the file's existing style; I'd not block on it, but the split proposal is owed.)
10. **`tasks.md` 6.9 is the only unchecked task and is correctly deferred to archive** — but
    it is load-bearing: without it, `shared-status-message` / `frontend-code-splitting` keep
    base `## Purpose` text asserting behaviour this change removes, and the two new specs get
    a literal `TBD - created by archiving change …` placeholder.
11. **`SourcePreviewSkeleton` is still an under-guess**, just a much smaller one after 5 → 10
    rows: 248.4px vs 265px (REST) and vs the 320px cap (CSV `limit=25`). Fine as the
    documented D3 bound.
12. evaluation-2's non-blocking #4 (a *failed* dashboards fetch still renders "No dashboards
    yet" in the main pane) remains open and is correctly HEL-539/HEL-548 territory, not this
    ticket's.

**Housekeeping:** all my screenshots went to my scratchpad, not the project tree. Two live
side effects to be aware of: I exercised the zoom control on the `HEL254WideType overview`
dashboard during the non-default-zoom check and **reset it back to 100%** afterwards
(verified); and the shared scratchpad directory is being written to by at least one other
concurrent agent, so my captures are prefixed `SK2-` where names could collide.
