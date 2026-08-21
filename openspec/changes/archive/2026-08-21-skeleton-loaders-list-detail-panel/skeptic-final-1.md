## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `11ce766b` (on `0ea1692b`, base `3d93e82a`). Every number below is my
own, measured this session. I read `evaluation-1.md`/`evaluation-2.md` and
`files-modified.md` as claims and re-derived each one.

### What I verified (with evidence)

**Gates — all re-run by me in the worktree, not read from a commit message.**

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | `LINT_EXIT=0`, zero warnings |
| Format | `npm run format:check` | `FORMAT_EXIT=0`, "All matched files use Prettier code style!" |
| Tests | `npm test` (worktree, **not** the root suite) | `TEST_EXIT=0` — root 8 suites/186 tests + frontend **235 suites / 2493 tests**, matching the claim exactly |
| Build | `npm --prefix frontend run build` | `BUILD_EXIT=0` |
| Hygiene | `node scripts/check-openspec-hygiene.mjs` | `openspec/ is clean`, exit 0 — corroborates "no hook bypass was needed" |
| Spec | `openspec validate skeleton-loaders-list-detail-panel --strict` | `Change '…' is valid` |

Commit bodies for both commits disclose no `git commit -n`; the clean hygiene run
confirms none was needed.

**Structural rules (requester's items 2 and 3).**
- One shared primitive: `frontend/src/shared/ui/Skeleton.tsx`, exported from
  `shared/ui/index.ts:14`. Every per-surface placeholder composes it; none
  hand-rolls a bar.
- `grep -rniE "shimmer|skeleton" frontend/src --include=*.css` returns only
  `Skeleton.css` (the recipe), `theme.css` (the token), and four *geometry-only*
  rules (`PanelBodySkeleton.css`, `PanelGrid.css:95`, `DashboardList.css:533-593`).
  **No shimmer keyframes or shimmer background exist outside `Skeleton.css`.**
- Token discipline: `Skeleton.css` is token-only (`--app-surface-soft`,
  `--app-surface-raised`, `--app-radius-*`, `--control-md`, `--text-sm`,
  `--app-skeleton-shimmer`); `linear` is a keyword with no token, correctly not
  treated as drift. Per-surface sizes are relative units (`1lh`, `em`, `ch`, `%`),
  not literals. The single literal is `PipelineDetailSkeleton.tsx:44`'s `28`/`28`
  circle — see judgement below. `DESIGN.md` §3 and §6 were extended to match.

**Reduced motion (requester's item 5) — verified in a real reduced-motion browser,
not by reading CSS.** Chromium launched with `reducedMotion: "reduce"`:
`matchMedia("(prefers-reduced-motion: reduce)").matches === true`, and on a live
`.ui-skeleton`: `animation-name: "none"`, `background-image: "none"`,
`background-color: rgb(22, 21, 20)` (= `--app-surface-soft`). `backgroundPosition`
sampled 8× over 1.6 s: `"0% 0%"` every time. **Genuinely disabled, flat fill, no
parked highlight** — D2's reasoning about the global `!important` rule holds.

**Font-dependent measurement (the trap the orchestrator flagged).** Confirmed
independently: `document.fonts.check('14px "Totally Not A Real Font 12345"')`
returns **`true`** in both a webfont-loaded and a webfont-blocked context — it is
unusable as a discriminator. I used a canvas advance-width probe plus
`document.fonts.size`, and measured the top-level page (headless Chromium, real
`index.html`) rather than a hand-authored iframe.

`/registry` stacked sidebar rows, A/B on the Google Fonts `<link>` only:

| | skeleton row | resolved row | `.__name` | `.__subtitle` | probe |
| --- | --- | --- | --- | --- | --- |
| webfont loaded | **43px** | **43px** | **18px** | **15px** | `fonts.size 34`, Schibsted 308 ≠ system-ui 315.489 |
| webfont blocked | **46px** | **46px** | **19px** | **17px** | `fonts.size 0`, family falls back |

So: the executor's `18/15/43` is right for the webfont case, the evaluator's
cycle-1 `19/17/46` is the fallback case (its retraction is correct), and **`1lh`
holds in both conditions with zero shift** — the rationale for keeping it is sound.
Whole-sidebar row histogram `{32: 44, 43: 37}` confirms D9's flat-vs-stacked claim.

**No-layout-shift measurement (requester's item 4) — `getBoundingClientRect()`
before/after resolve, per surface.**

| Surface | Skeleton (settled) | Resolved | Verdict |
| --- | --- | --- | --- |
| `/registry` sidebar rows (×5) | `x12 y348/393/438/483/528 w215 h43`, gap 2 | identical, row-for-row | **exact** |
| `PanelContent` body | card `[264,120,450,192]`, body `[285,192,408,74]` | identical | **exact** |
| `SourcePreviewSkeleton` | `[285,636,1110,133.4]` | `[285,636,1110,265]` | x/y/w exact, **+131.6px height** (documented delta, see notes) |
| `SourcesPage` main | section `[264,68,1152,320]` | `[264,68,1152,247]` | 320px floor held, −73px on resolve (deliberate per D3) |
| `PipelineDetailPage` | page `[240,48,1200,852]`; header h31; footer `y851 h49` | page identical; header h36; footer **`y780.2 h119.8`** | container exact, **bands shift** — CR3 |
| `PanelGrid` (empty saved layout) | card `[264,120,450,192]` | first resolved frame **`[264,120,501,192]`** | **51px shift** — CR1 |

**Cold-boot frame traces (requester's item 6).** `/registry`: nothing →
sidebar skeleton + `PageContentSkeleton` (t≈358 ms) → resolved (t≈491 ms). `/`:
nothing → grid skeleton (t≈386 ms) → resolved (t≈461 ms), with `"No dashboards
yet"`, `"Select a dashboard"`, `"No panels yet"`, `"No data"` and `--` all absent
from every sampled frame. **No blank frame and no flash of empty content
anywhere.** CR3's bootstrap gate does what it claims.

**Visual sweep (requester's item 5).** Screenshots taken and looked at, both
themes, 1440/768/430: dashboard grid, phone stack, `/sources`, `/pipelines`,
`/registry`, `/pipelines/:id`, panel body, source preview. Console: **0 app
errors** across the whole sweep (only a 404 for a static resource).

**Consistency (requester's item 7).** Every surface renders the same
`.ui-skeleton` recipe — same two-stop ramp, same 1.6 s linear sweep, same radius
tokens. Side by side, the sidebar rows, grid cards, panel body, preview table and
page hero read as one family. This premise is met.

**Light-theme shimmer — the call assigned to me.** Measured contrast against the
*containing* surface, not the page:

| | base vs container | highlight vs container | ramp amplitude |
| --- | --- | --- | --- |
| light, sidebar (`--app-surface` #fdfcfa) | 1.150 | 1.025 | **1.179** |
| light, main pane (#f4f2ed) | 1.054 | 1.119 | **1.179** |
| dark, sidebar (#1a1816) | 1.030 | 1.089 | 1.122 |
| dark, main pane | 1.034 | 1.161 | 1.122 |

**I am not failing the gate on this.** The concern is real but inverted from how it
was framed: light's ramp amplitude is *higher* than dark's (1.179 vs 1.122), and its
peak visibility is comparable. What differs is polarity — in light the bar is
darker than the surface at rest and dissolves where the highlight passes; in dark it
brightens. At 4× zoom that reads as a travelling erasure rather than a travelling
highlight, but at 1× (see `dash-light-1440`, `sources-light-1440`) the bars are
clearly legible and sit comfortably inside this app's deliberately low-contrast
language. It does not look cheap next to the rest of the app. Keep D1's token pair.

**`PipelineDetailSkeleton`'s hardcoded 28px circle — acceptable.** I checked
`PipelineDetailFooter.tsx`'s `__footer-right` row: there is genuinely no circular
resolved element to borrow a class from, so the "no grounded substitution exists"
reasoning is sound, and inventing one would risk a real regression for a cosmetic
gain. Not a finding.

**Panel-polling / spinner division (AC 3).** `usePanelData.ts:240-250`'s widened
condition is `paginationEntry == null || (isLoadingMore && rows.length === 0)` —
character-identical to the old expression once the entry exists, so refresh and
load-more paths are untouched. `TableRenderer`'s load-more spinner,
`SourceDetailPanel`'s "Loading…" button label (seen live in
`sourcepreview-skel-dark.png`) and `PageSuspenseFallback`'s `Spinner size="2xl"`
are all still spinners. No regression.

### Verdict: REFUTE

Three things block. Everything mechanical is green and most of the work is
genuinely good — the panel body and the sidebar rows are pixel-exact, reduced
motion is properly disabled, and the cold-boot traces are clean. But the ticket's
headline acceptance criterion — *no layout shift when real content arrives* — does
not hold on the ticket's first-listed surface, and this change's own spec delta
writes a scenario that my measurement contradicts.

### Change Requests

**1. `PanelGrid`: the resolved grid arrives 51px too wide and animates back, so the
swap is a visible layout shift. (blocking)**

Reproduced 4/4 — three times through the MCP browser and once in headless
Chromium with Playwright route interception on the top-level page (no iframe).
On a dashboard whose saved layout for the active breakpoint is **empty** — one of
the two cases `specs/loading-state-pattern/spec.md` promises is exact:

```
skeleton (settled)   cards: [264,120,450,332] [732,120,450,332] [264,470,450,332]
first resolved frame cards: [264,120,501,332] [783,120,501,332]     <-- +51px w, +51px x
settled  (~170ms later)    [264,120,450,332] [732,120,450,332]
```

and on the single-panel default dashboard, twice in a row:
`skeleton [264,120,450,192]` → `first real frame [264,120,501,192]` →
`settles [264,120,450,192]`.

This violates two things this change itself wrote:
- `specs/loading-state-pattern/spec.md` — *"#### Scenario: No layout shift in
  per-row geometry when content resolves … **THEN** the per-row geometry — height,
  gap, padding, radius and **horizontal position** — is unchanged by the swap"*;
- the same file's *"An empty saved layout still renders placeholder cards at the
  resolver's own default geometry … **AND** each placeholder's width and position
  match what the grid's own layout resolution would assign"*.

Root cause (deterministic, not a guess): `PanelGridSkeleton.tsx:20` and
`PanelGrid.tsx:44` each call `useContainerWidth({ initialWidth:
panelGridConfig.initialWidth })` independently, and `panelGridConfig.ts:36` sets
`initialWidth: 1280` against a real container of 1152. `1280 / 1152 = 1.111` and
`501 / 450 = 1.113`. The skeleton, having been mounted long enough, has already
measured 1152; the resolved `PanelGrid` mounts fresh at 1280 and re-measures one
frame later, so RGL transitions the cards from the wrong size back to the right
one. (The skeleton's own mount does the same 501→450 ease, so the card currently
"breathes" twice per load.)

Why this is in scope even though `initialWidth` predates the change: before, the
grid painted from an empty area, so there was no established geometry to shift
*from*. The whole point of this ticket is that the placeholder holds the eventual
geometry — and it does, correctly, right up until the content arrives at the wrong
size.

Fix direction (contained — `PanelList.tsx` is the only consumer of both
components, and both already render inside `.panel-list__zoom-container`): hoist
the single `useContainerWidth` measurement into `PanelList` and pass `width` down
to `PanelGridSkeleton` and `PanelGrid`, so the two branches share one measured
width and neither re-enters the 1280px initial state. Add a regression assertion
that the first resolved frame's card rects equal the settled skeleton's.

**2. `PanelList.tsx:215`: the "0 panels" pill still renders during the CR3 bootstrap
skeleton. (blocking)**

Measured live with `GET /api/dashboards` gated open:
`{ countText: "0 panels", countHasSkeleton: false, gridSkeletonUp: true }`, and
visible top-right in `dash-dark-1440.png` / `dash-light-1440.png` / `dash-dark-430.png`
sitting above a three-card skeleton grid.

Task 6.8a exists precisely to stop this — *"Suppress or placeholder
`PanelList.tsx`'s 'N panels' count while the skeleton is up — it reads '0 panels' on
cold boot"* — and the pill's own in-code comment calls it "the same premature-data-claim
class D13 rejects". CR3 added a second window in which the skeleton is up
(`showBootstrapSkeleton`, `PanelList.tsx:83`) without extending the pill's gate at
`:215`, which is still `showPanelGridSkeleton` alone. So the defect 6.8a closed on
the panels-loading path is open again on the bootstrap path — and the bootstrap
path is *every* cold boot.

Fix: gate the pill on `showPanelGridSkeleton || showBootstrapSkeleton` and extend
the existing count-skeleton test to the bootstrap case.

**3. `PipelineDetailSkeleton`: the footer band shifts ~71px on resolve, and no
artifact carves out this delta. (blocking — fixing *or* documenting it is
acceptable)**

Measured on `/pipelines/c2c4b648-…`, page container identical
(`[240,48,1200,852]`) in both states, but:

```
header  h31    -> h36        (+5)
river   y79  h772 -> y84 h696.2
footer  y851 h49 -> y780.2 h119.8   (+70.8 tall, moves up 70.8)
```

Cause is nameable: `PipelineDetailFooter.tsx:111-130` renders a conditional
`.pipeline-detail-page__meta-bar` inside `__footer-region` that
`PipelineDetailSkeleton.tsx:35-46` omits entirely, and its `__footer` row is
shorter than the real one (multi-line output name + schema chips + `--control-md`
buttons vs. two `Skeleton` lines).

The design carves out an accepted delta for `SourceDetailPanel`'s preview (D3) and
for the grid/phone stack (D10), but says nothing about this surface — so the
artifacts currently imply a parity that the code does not deliver on a surface the
ticket enumerates by name. Either bring the skeleton's footer close to the resolved
band (e.g. a min-height matching the no-meta-bar footer, plus a meta-bar-shaped
placeholder), **or** add an explicit, measured "accepted delta" paragraph to `design.md`
and a scenario to `specs/loading-state-pattern/spec.md`, the way D3 does. Do not
leave it silent.

### Non-blocking notes

1. **`DashboardList.css:555-560` and `:572-576` state the fallback-font numbers as
   the webfont numbers.** My independent figures, for the queued correction:
   webfont → name **18px**, subtitle **15px**, stacked row **43px**; fallback →
   **19px / 17px / 46px**. The `1lh` rationale as the orchestrator stated it is
   correct — 43/43 with the webfont and 46/46 on the fallback, i.e. `1lh` converts a
   configuration-dependent match into an unconditional one, whereas the superseded
   `18px`/`15px` literals were right only in the first column.
2. **`11ce766b`'s commit body cites `document.fonts.check` as its verification
   method.** That method is unsound (I reproduced the vacuous `true`), even though
   the conclusion it reached was right. Worth not enshrining in the history a second
   time.
3. **`SourcePreviewSkeleton` under-shoots by 2×** (133.4px vs 265px resolved).
   Documented as an accepted delta by D3, so not blocking, but `PREVIEW_SKELETON_ROWS
   = 5` against a REST preview that returned 10 rows (and a CSV preview requesting
   `limit=25`) is a systematically low guess. Bumping to ~10 would roughly halve the
   growth for free.
4. **The pipeline river's three ribbons fuse into one block.**
   `.pipeline-detail-page__river-inner` sets `gap: 0`, so three adjacent 50px
   `__ribbon` skeletons with identical fills render as a single undifferentiated
   148px rectangle (see `pipedetail-dark-1440.png`) rather than three steps. Cosmetic.
5. **`.suspense-fallback__label` (`SuspenseFallback.css:16-20`) is now dead.** Its
   only consumer was the label this change removed from `PanelSuspenseFallback`;
   `PageSuspenseFallback` renders no label. The change correctly deleted four other
   orphaned loading rules — this one was missed.
6. **`aria-label` on role-less `<div>`s.** `PanelGridSkeleton`'s `.panel-grid-shell`,
   `PageContentSkeleton`'s `.ui-empty-state` and `SourcePreviewSkeleton`'s
   `.ui-data-grid` carry `aria-label` with no role, which many screen readers do not
   expose — so `skeletonAccessibility.test.tsx` locks a name that may not reach AT.
   `SidebarRowsSkeleton` (on a `<ul>`) is fine. Adding `role="status"` would make the
   existing tests honest. Already flagged by the evaluator; still worth doing.
7. `SourcesPage`/`PipelinesPage`/`TypeRegistryPage` shrink 320→247px on resolve. That
   is D3's deliberate `EmptyState --main` floor doing its job (it replaced an inherited
   331→15px collapse), so it is working as designed — recorded only so the number is
   on file.
8. `DashboardList`'s new ladder replaces the list with the error branch on a failed
   fetch, where the old code rendered the error *above* a still-populated `<ul>`.
   Unreachable in practice today (a failed first fetch has no items), but it is a
   behaviour change the artifacts do not mention.
