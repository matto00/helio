# Evaluation Report — Cycle 3 (evaluation-4.md)

Reviewed at commit `2913739b`. Every gate re-run fresh by me in the worktree;
every live probe run against servers restarted from this commit (backend JVM
start **00:15:23**, after the **00:11:04** commit — verified in `ps`, not
assumed). No stale server in any evidence below.

## Gate results (my own runs, not the executor's report)

| Gate | Result |
| --- | --- |
| `cd frontend && npx tsc --noEmit` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm test` | PASS — 252 suites / **2589** tests (+2 vs. cycle 2, the new CR1 arms) |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | PASS — 236 suites / **3548** tests, 0 failed |
| `openspec validate output-picker-nav-onboarding --type change` | PASS |
| `check:schemas` / `check:openspec` / `check:spec-structure` / `check:scala-quality` | PASS |

Working tree clean (`git status --porcelain` empty); no unchecked task boxes.

## CR1 — per-breakpoint layout clobbering — **FIXED, live-verified**

Diffs read in full (`967ebe41` PanelService/panelThunks/dashboardLayout;
`2913739b` LayoutBreakpointScaling/AutoLayoutService/DashboardContentsService/
DashboardProposalService).

**Live probe, same shape as evaluation-2's** (dashboard
`7f5c7bf9-8b0e-4999-b0e7-fe86748efc0d`, `HEL909-EVAL4-clobber`): PATCHed a
deliberately divergent per-breakpoint layout, then placed one chart Output via
the API and one table Output via the **real picker UI**:

| bp | before | after chart place | after table place (UI) |
| --- | --- | --- | --- |
| lg | `4x5@8,0` | `4x5@8,0 \| 6x4@0,5` | `… \| 6x6@0,9` |
| md | `7x9@3,1` | `7x9@3,1 \| 5x4@0,5` | `… \| 5x6@0,9` |
| sm | `5x3@1,2` | `5x3@1,2 \| 3x4@0,5` | `… \| 3x6@0,9` |
| xs | `2x7@0,0` | `2x7@0,0 \| 1x4@0,5` | `… \| 1x6@0,9` |

The pre-existing md/sm/xs items survive **byte-identical**; the appended item is
scaled per breakpoint (6 → 5 / 3 / 1) and every item is within its own grid
(md ≤ 10, sm ≤ 6, xs ≤ 2). Confirmed in the `POST /api/panels` response, in the
persisted `dashboards.layout` (independent `GET …/export` re-read), **and in the
DOM** — measured rendered geometry at three container widths, all matching the
persisted per-breakpoint values exactly:

- md grid (1152px, 10 cols, cu 117): appended item `567px` = w 5 ✓, anchor
  `801px @ x 351` = 7@3 ✓, table `402px` tall = h 6 ✓
- sm grid (812px, 6 cols, cu 138.3): appended `397px` = w 3 ✓, anchor `674px` =
  w 5 ✓, `document.scrollWidth === 1100` (no overflow)
- 768 / 375 fall to the mobile stack; `scrollWidth` equals the viewport at both

Second commit's paths spot-checked as instructed. The three specs are genuinely
red-first-capable, verified by reasoning against the pre-fix code:
`AutoLayoutRouteSpec` replaced `md/sm/xs shouldBe lg` with
`should not be lg` + `maxW(md/sm/xs) <= 10/6/2` — the old assertions were the
literal inverse of the new ones, so the new test could not have passed before;
`DashboardApplyProposalSpec` / `DashboardContentsReplaceSpec` assert
`xs w <= 2` on a proposal authored at `w=4`, which the pre-fix verbatim copy
would have failed. `PanelServiceDefaultLayoutSpec`'s new arm seeds distinct
md/sm/xs layouts and asserts both survival and per-breakpoint scaling; its
`buildServiceWithDashboard` helper and `persisted.md.head shouldBe seeded…`
assertions could not have passed against `md = nextLayout`.

I independently re-ran the executor's own completeness audit:
`grep -rn "DashboardLayout(\|DashboardLayoutPayload(" backend/src/main/scala/`
returns 18 sites; every one not fixed here (`DashboardSnapshotRepository` x3,
`PatchSetUndoInverse`, `PatchSetApplyRollback`, `DashboardProtocol`,
`DashboardServiceValidation`, `DemoData`, `model.scala` defaults) copies each
breakpoint **from its own source array**, so none carries the defect class. The
audit is complete as claimed.

The corrected `AutoLayoutService` precedent comment
(`PanelService.scala:120-125`) now reads accurately — it states plainly that a
single-item append has nothing in common with the whole-board re-pack and that
`placeDefaultLayout` does not lean on it as precedent.

## CR2 — picker N+1 / 429 storm — **FIXED, live-verified**

Opening "Add panel" against the dev DB's **84** Outputs fired exactly **3** API
requests (`/api/pipelines`, `/api/outputs?offset=0&limit=200`, one prefetch) —
**zero** `GET /api/outputs/:id/panels`, **zero** console errors of any kind
(`browser_console_messages level=error` returned 0 across the whole session),
and **no** `hasPlacementCountError` banner. `panelCount` is populated on all 84
list items. Counts cross-checked independently: `Raw rows` reads
"2 placements" in the UI and `GET /api/outputs/46da5ac7-…/panels` returns 2;
`My chart` read 1 before my placement and "2 placements" after it.

Wire contract verified end to end, not just in Scala: `jsonFormat10 →
jsonFormat11`, `schemas/outputs/output.schema.json` gained a documented
`panelCount` (`["integer","null"]`, `minimum: 0`) under `additionalProperties:
false`, the TS `Output.panelCount?: number` matches, and `check:schemas` +
`openspec validate` are green. The batched query
(`PanelRepository.countByOutputIdsInternal`) is a single grouped `inSet` query,
empty-input short-circuited, with its ACL-bypass contract documented in the
same terms as the adjacent `findByOutputIdInternal`.

## CR3 — inline FQN — **FIXED**

`PanelServiceDefaultLayoutSpec.scala:10` now imports
`org.mockito.Mockito.{mock, never, verify, when}`; `grep -n "org\.mockito\.Mockito\."`
returns only that import line — no inline FQN remains.

## Phase 1: Spec Review — PASS

Ticket AC 1 ("panel is on the grid with the chart's default size") now holds at
**all four** breakpoints, without regressing existing per-breakpoint behavior.
Decision-15 sizes re-confirmed live (chart 6×4, table 6×6 at lg, correctly
projected downward). `tasks.md` has zero unchecked items and matches what
shipped; `design.md`'s new "Cycle 3" section documents the audit accurately
(I re-derived its central claim myself). No scope creep: the second commit's
extra fixes are the same defect class as CR1, which is fix-the-class, not
drive-by. Cycle-2 PASSes re-verified live: 5 nav destinations desktop and at
375px (54px targets, `scrollWidth === 375`), panel sheet shows
title/appearance/Output link/Swap output/"Used on N dashboards" with no binding
controls, and the AC-grep exception set has **not grown** —
`git grep -cE "dataType|metricId" -- frontend/src` returns the identical **80**
at `be3c2633` and at `HEAD`.

## Phase 2: Code Review — PASS

`LayoutBreakpointScaling` is a genuine de-duplication: one column-count map and
one scale/clamp formula now serve four call sites that previously each
re-derived (or omitted) it, and its scaladoc pins the frontend mirror
(`projectLayout`) it must agree with. The frontend side extracts
`scaleLayoutItem` out of `projectLayout` rather than copying the math, so the
two-sided mirror is one formula per side, not four. Naming is clear, no magic
numbers, no `any`/untyped escape hatches, no new dead imports, no TODO/FIXME.
Error handling unchanged at boundaries; the removed `try/catch` went away with
the loop it guarded. Tests are meaningful, not decorative — each of the four
fixed paths has an assertion that fails against its own pre-fix code.
`check:scala-quality` green and no new inline FQNs (`LayoutBreakpointScaling` is
properly imported at both new call sites).

## Phase 3: UI Review — PASS

Live walk at 1440 / 1100 / 768 / 375, servers freshly restarted from `HEAD`:

- Add panel → picker opens (89 cards, real pipeline group names, `On this
  board` marker on the already-placed Output, accessible names like
  `"My chart (skeptic-repro-5), already on this board"`) → search "Raw rows"
  narrows to 9 matches → click places the panel at its decision-15 size and
  closes the modal.
- Panel sheet: title/appearance/`Output: Raw rows`/`Swap output`/`Used on 2
  dashboards`. Swap output → picker scoped to the panel → exactly **one**
  `PATCH /api/panels/:id`, sheet updates to `My chart` and `Used on 1
  dashboard` (singular correct).
- Loading/empty/error states present; **0 console errors** across the entire
  session (picker open, place, sheet, swap, four resizes).
- No layout breakage or horizontal overflow at any of the four widths;
  `document.scrollWidth` equals the viewport at 1100 / 768 / 375.
- Mobile 375px: 5 nav destinations, 54px touch targets, mobile panel stack.

Not exercised (noted, not blocking, unchanged from cycle 2): the first-run
onboarding checklist requires a fresh account; its Jest coverage was reviewed in
cycle 1 and is unchanged.

## Overall: PASS

No change requests. This ticket is in good shape to ship.

## Non-blocking Suggestions

- **`hasPlacementCountError` is now dead code.**
  `useOutputPickerData.ts:110` returns a hardcoded `false`, so the interface
  member (`:32`), the destructure (`OutputPicker.tsx:46`) and the entire
  `role="alert"` banner branch (`OutputPicker.tsx:193-197`) are unreachable.
  Its doc comment justifies keeping it "for backward compatibility with
  existing consumers", but the only consumer is `OutputPicker` in this same
  repo. Delete the field and the banner (CONTRIBUTING's no-dead-code rule).
  Zero user impact, which is why this is not a change request.
- **The appended item's `y` is `lg`-derived at every breakpoint.**
  `placeDefaultLayout` computes `y` from `dashboard.layout.lg` only and reuses
  it for md/sm/xs, so on a dashboard whose md layout is taller than its lg one
  the new item can land inside an existing md/sm/xs item's rows. This is not
  data loss — `resolveDashboardLayout`'s existing `cleanupOverlaps` pass bumps
  the collision at render (I observed the md anchor render at row 9 instead of
  row 1 on my probe board), and no `PATCH` fires on mount, so nothing is
  persisted — but the visual reflow displaces the *existing* panel rather than
  the new one. A one-line improvement: compute `y` per breakpoint as
  `max(i.y + i.h)` over that breakpoint's own array. Out of scope for CR1 as
  written, worth a follow-up.
- `LayoutBreakpointScaling.scaleItemToBreakpoint` and `scaleWidthAndX` duplicate
  the same four lines of arithmetic on different argument shapes; the former
  could delegate to the latter so the formula lives in exactly one place.
- Carried forward from evaluation-2 and still true: `placeDefaultLayout`'s
  read-modify-write is not transactional with the panel insert and is
  last-write-wins against the grid's 250ms debounced layout PATCH;
  `OutputPanelDefaultSize` still lives in `PanelPacker.scala`; the
  `outputRepo != null` nullable-DI guard; `PanelDetailModal.tsx` is past
  CONTRIBUTING's ~400-line threshold; picker arrow-key navigation still moves a
  visual class with no DOM focus / `aria-activedescendant`.
- `GET /api/outputs?limit=200` is capped at `Page.MaxLimit`; a workspace with
  more than 200 Outputs would silently show only the first page in the picker.
  Pre-existing, not introduced here, but now the sole source of the counts too.
- Test-data cleanup: this review created dashboard `HEL909-EVAL4-clobber`
  (`7f5c7bf9-8b0e-4999-b0e7-fe86748efc0d`) with 3 panels in the shared dev DB,
  on top of evaluation-2's `HEL909-EVAL2-*` boards.
