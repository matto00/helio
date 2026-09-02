# Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed at commit `be3c2633`. All gates re-run fresh by this evaluator in the
worktree; all live UI evidence gathered against servers restarted from this
commit.

> **Concurrency note (flagged as requested).** A second evaluator process was
> observed running against this same worktree concurrently with mine: gate logs
> `c2-tsc.log` / `c2-lint.log` / `c2-fmt.log` / `c2-test.log` / `c2-misc.log` /
> `c2-sbt.log` were written to the shared scratchpad at 23:24–23:27, and a
> second `sbt test` JVM (PID 2136164, started 23:24:34) plus a watchdog
> (`sleep 90; tail c2-sbt.log`) were live in `ps` while I ran. No
> `evaluation-2*.md` existed in the change dir when I started or when I wrote
> this file, so nothing was overwritten — but two evaluators did race on this
> worktree and on the shared dev database. Both are read-only reviews, so no
> code corruption risk; worth the orchestrator's attention regardless.

## Gate results (my own runs, not the executor's report)

| Gate | Result |
| --- | --- |
| `cd frontend && npx tsc --noEmit` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm test` (root + frontend) | PASS — 252 suites / 2587 tests |
| `cd backend && sbt test` | PASS — 236 suites / 3546 tests, incl. all 7 `PanelServiceDefaultLayoutSpec` cases |
| `openspec validate output-picker-nav-onboarding --type change` | PASS |
| `check:openspec` / `check:schemas` / `check:spec-structure` / `check:scala-quality` | PASS |

The executor's self-reported numbers reproduce exactly.

**Servers**: restarted via `scripts/concertino/start-servers.sh` before any UI
evidence. Backend JVM start 23:26:59, **after** the 23:22:26 commit — verified
in `ps`, not assumed. No stale server this cycle.

## Change-request verification (cycle-1's 7, each verified live)

| CR | Verdict | Evidence |
| --- | --- | --- |
| CR1 default sizes | **PASS at `lg`, FAIL at `md`/`sm`/`xs`** | see finding 1 |
| CR2 pipeline grouping | PASS | live picker shows real names ("skeptic-repro-5", "EVAL908 pipeline", …), 69 distinct headings, **0** literal `"Pipeline"`; aria-labels read `"My chart (skeptic-repro-5)"` |
| CR3 de-blinded test | PASS | new case starts `pipelines: {items: [], status: "idle"}` and mocks `getPipelines`; against pre-fix code there was no `fetchPipelines()` dispatch at all, so `screen.getByText("Revenue Pipeline")` could never resolve — genuinely red-capable |
| CR4 service layering | PASS | `await import(".../httpClient")` is gone from `OutputPicker.tsx` (grep: no hits); `panelService.patchPanelOutputId` + `swapPanelOutput` thunk own it. **Live swap re-verified**: exactly one `PATCH /api/panels/85451a77-…`, sheet updated `Total col_16` → `Raw rows`. Cycle-1's `PanelRepository` fix is not reintroduced or broken. |
| CR5 error surfacing | PASS | forced a real failure in-browser (XHR rewrite of `POST /api/panels` to a 404 path): `role="alert"` renders **"Failed to add panel. Please try again."**, modal stays open, no blank screen. The `hasPlacementCountError` notice also renders live. |
| CR6 spec/reality | PASS | `specs/output-picker/spec.md` now says "kind, its name, and its current placement count" — matches the shipped cards exactly; the thumbnail deferral is reasoned, not reworded away |
| CR7 task 10.4 | PASS | `tasks.md` 10.4 walks all 20 deltas with per-file reasoning. Spot-checked 4 myself: `frontend-panel-creation` ("error rather than failing silently" — now true, verified live via forced failure); `panel-detail-modal` (verified live: title/appearance/Output link/Swap output/placements note, no binding controls); `nav-section-registry` (verified live: `/registry` and `/metrics` both render the shared **Page not found**, 5 nav destinations); one REMOVED delta (`panel-creation-modal` — `find` confirms the files are deleted, not unreachable). |

Also verified: **"Used on N dashboards"** now dedupes correctly, on a
deliberately discriminating case I constructed live (5 panels bound to one
Output across 4 distinct dashboards) → sheet reads **"Used on 4 dashboards"**,
and after the swap **"Used on 1 dashboard"** (singular fix confirmed too).

Cycle-1 PASSes re-verified and still true: HEL-937 deletions (`find` returns
nothing for `dataTypes/`, `metrics/`, `PanelCreationModal*`, `BindingEditor*`,
`MetricPicker*`, `DataTypePicker*`); `/registry` + `/metrics` 404 with no shim;
exactly 5 nav destinations desktop and at 375px (54px targets, no horizontal
overflow, `scrollWidth === 375`); the AC-grep exception set is **unchanged and
has not grown** (28 hits: `dataTypeId` proposal mirror, 2 historical doc
comments, 5 negative-assertion nav-test literals).

## Phase 1: Spec Review — FAIL

Ticket AC 1 ("panel is on the grid with the chart's default size") is now met
**at the `lg` breakpoint only**, and meeting it introduced a regression to
existing per-breakpoint layout behavior (finding 1). All other spec items pass;
`tasks.md` accurately reflects what was implemented; no scope creep beyond the
7 CRs plus the sanctioned non-blocking dedupe fix.

## Phase 2: Code Review — FAIL

Verified PASS: no dynamic-import layering violation remains; `swapPanelOutput`
follows the Component → thunk → service flow; the schema delta for
`PanelResponse.layout` is present and consistent with the Scala protocol
(`jsonFormat9` → `jsonFormat10`); `PanelServiceDefaultLayoutSpec` is genuinely
red-first-capable, not merely present — `create`'s return type changed from
`Panel` to `(Panel, Option[DashboardLayoutItem])` and `placeDefaultLayout` /
its `dashboardRepo.update` call did not exist before, so the
`captor.getValue.layout` assertions could not have compiled, let alone passed,
against pre-fix code.

**Blocking findings:**

1. **CR1's implementation destroys the user's `md`/`sm`/`xs` layouts on every
   Output placement, and writes `lg`-sized items into narrower grids without
   scaling.**
   `backend/src/main/scala/com/helio/services/panels/PanelService.scala:141-143`
   builds `nextLayout` from `dashboard.layout.lg` only and then assigns that one
   array to all four breakpoints:
   `DashboardLayout(lg = nextLayout, md = nextLayout, sm = nextLayout, xs = nextLayout)`.
   `frontend/src/features/panels/state/panelThunks.ts:97-104` does the identical
   thing client-side (`{lg: nextLg, md: nextLg, sm: nextLg, xs: nextLg}`).

   **Probe-confirmed live** (dashboard `b4e43008-dde1-4369-a0aa-0367a51c75d7`,
   `HEL909-EVAL2-clobber`). I PATCHed a deliberately divergent per-breakpoint
   layout, then placed **one** Output:

   | breakpoint | before | after |
   | --- | --- | --- |
   | lg | `4x5@8,0` | `4x5@8,0 \| 3x2@0,5` |
   | md | `7x9@3,1` | `4x5@8,0 \| 3x2@0,5` |
   | sm | `5x3@1,2` | `4x5@8,0 \| 3x2@0,5` |
   | xs | `2x7@0,0` | `4x5@8,0 \| 3x2@0,5` |

   The md/sm/xs arrangements are gone — persisted, so a reload does not recover
   them. This is not a hypothetical: real dashboards in the dev DB carry
   genuinely divergent per-breakpoint layouts (`Helio Roadmap`, `skeptic-output
   overview`, `Evaluation Dashboard`, …), which is exactly the state this code
   overwrites.

   The second half of the same defect: the columns differ per breakpoint
   (`frontend/src/features/dashboards/state/dashboardLayout.ts:10-15` — lg 12,
   md 10, sm 6, **xs 2**), and nothing clamps. Confirmed on
   `1e7cf0a9-cfce-421f-b179-5f889f404098`: a `table` Output persists as `w=6`
   in **all four** arrays, i.e. 3× the width of the 2-column `xs` grid; the
   clobber case above wrote `x=8, w=4` into a 2-column `xs`.
   `resolveBreakpointLayout` (`dashboardLayout.ts:224-226`) returns saved items
   verbatim once every panel has an entry — it only `Math.max`es, never clamps
   to `colCount` — and filling all four arrays also permanently bypasses
   `projectLayout` (`dashboardLayout.ts:139-150`), the existing helper built to
   scale `w`/`x` between column counts. The correct shape is to compute the
   `lg` item from `OutputPanelDefaultSize` and derive md/sm/xs through
   `projectLayout`-equivalent scaling (or a backend counterpart), appending to
   each breakpoint's **own** existing array.

   `PanelServiceDefaultLayoutSpec` cannot catch this: every assertion reads
   `captor.getValue.layout.lg` only (`:107-109`). The regression test needs an
   arm that seeds a dashboard with distinct md/sm/xs layouts and asserts they
   survive with correctly-scaled items appended.

2. **The picker's N+1 placement-count fetch now blows the rate limit on a
   realistic dataset and puts a persistent error banner on the primary flow.**
   With 84 Outputs, a single "Add panel" open fired 84 ×
   `GET /api/outputs/:id/panels`, and I recorded **56 console errors, all
   `429 (Too Many Requests)`**, plus the new (CR5) live banner *"Some placement
   counts could not be loaded and may be shown as 0."* rendered on a completely
   normal open — so the visible placement counts are simply wrong for most
   cards. This trips Phase 3's "no console errors during any tested flow" and
   "errors visible / states correct" checks.
   I am raising it now rather than repeating cycle-1's non-blocking note
   because CR5 changed its status: it is no longer silent, it is a user-facing
   error state on the happy path. The remedy is the one both
   `useOutputPickerData.ts`'s own comment and evaluation-1 already name —
   serve the count as a field on `GET /api/outputs` instead of N+1.
   `frontend/src/features/panels/hooks/useOutputPickerData.ts:70-90`.
   *(If the orchestrator prefers to keep the accepted N+1 and spin this out as
   its own ticket, that is a defensible call — but it should be a recorded
   decision, not left as-is.)*

3. **Inline fully-qualified name — mechanical CONTRIBUTING violation.**
   `backend/src/test/scala/com/helio/services/panels/PanelServiceDefaultLayoutSpec.scala:155`
   — `verify(dashboardRepo, org.mockito.Mockito.never()).update(any())`, while
   line 10 already has `import org.mockito.Mockito.{mock, verify, when}`.
   CONTRIBUTING.md:70 ("Always import at the top of the file; never inline a
   fully-qualified name when an `import` would do"). Add `never` to the
   existing import. `check:scala-quality` does not flag it only because its
   prefix list covers `com.helio`/`spray.json`/`java.util`/`org.apache.pekko`,
   not `org.mockito` — the rule still binds.

## Phase 3: UI Review — FAIL

Ran live against the freshly restarted servers at 1440-ish, 1150, and 375px.

Working:
- Add panel → picker → place: happy path works; all six decision-15 sizes
  render correctly at `lg`. Measured on `HEL909-EVAL2-sizes` (grid 1152px,
  `rowHeight` 52, margin 18): metric `333×122` = **3×2**, chart `684×262` =
  **6×4**, table `684×402` = **6×6**, collection `684×262` = **6×4**, timeline
  `450×402` = **4×6**, markdown `450×262` = **4×4**. Matches the spec exactly.
  The API confirms the same values both on the `POST` response and on an
  independent re-read of `dashboards.layout`.
- Swap output end-to-end (see CR4 above); panel sheet content correct.
- Forced-failure error state renders visibly (see CR5 above); no blank screen,
  no unhandled exception.
- `/registry` and `/metrics` → shared **Page not found**; 5 nav destinations
  at desktop and 375px, 54px touch targets, no horizontal overflow.

Failing:
- 56 console `429` errors and a persistent error banner on the picker's primary
  flow (finding 2).
- Placed panels carry `lg`-shaped, unscaled geometry at md/sm/xs, and placing
  one destroys any customized layout there (finding 1).

Not exercised (noted, not blocking): the first-run onboarding checklist —
requires a fresh account; its Jest coverage was reviewed in cycle 1 and is
unchanged.

## Overall: FAIL

## Change Requests

1. Fix the per-breakpoint layout handling in CR1's implementation. In
   `PanelService.scala`'s `placeDefaultLayout` (`:141-143`), append to **each**
   breakpoint's own existing array rather than replacing all four with `lg`'s,
   and scale `w`/`x` to that breakpoint's column count (lg 12 / md 10 / sm 6 /
   xs 2) instead of copying `lg` dimensions verbatim — mirroring
   `frontend/src/features/dashboards/state/dashboardLayout.ts:139-150`'s
   `projectLayout`. Apply the identical fix to
   `frontend/src/features/panels/state/panelThunks.ts:97-104`. Extend
   `PanelServiceDefaultLayoutSpec` with an arm that seeds a dashboard holding
   **distinct** md/sm/xs layouts and asserts (a) those items are unchanged
   afterward and (b) the appended item is scaled per breakpoint — proven red
   against today's code (it will fail today; I confirmed the behavior live on
   dashboard `b4e43008-dde1-4369-a0aa-0367a51c75d7`).
2. Stop the picker's N+1 placement-count fetch from rate-limiting itself:
   return the placement count as a field on the `GET /api/outputs` list
   response and drop the per-Output `listOutputPanels` loop in
   `frontend/src/features/panels/hooks/useOutputPickerData.ts:70-90`. Target: a
   single "Add panel" open produces **0** console errors and no
   `hasPlacementCountError` banner on a dataset of ~85 Outputs. (Alternative,
   if the orchestrator rules this out of scope: record the decision in
   `design.md` and file the spinoff — do not leave the flow shipping a visible
   error banner with silently wrong counts on normal use.)
3. Replace `org.mockito.Mockito.never()` with a `never` added to the existing
   `import org.mockito.Mockito.{mock, verify, when}` at
   `backend/src/test/scala/com/helio/services/panels/PanelServiceDefaultLayoutSpec.scala:155`
   (CONTRIBUTING.md:70).

## Non-blocking Suggestions

- CR1 asked for the layout write to happen "in the same transaction as the
  panel insert". It does not: `PanelService.scala:113-116` chains
  `panelRepo.insert(...).flatMap { … placeDefaultLayout(…) }`, and
  `placeDefaultLayout` itself does a read-modify-write
  (`dashboardRepo.findByIdInternal` → `dashboardRepo.update`) over the whole
  `Dashboard`. A failure between the two leaves a panel with no layout entry,
  and the full-object update is last-write-wins against the grid's own 250ms
  debounced layout PATCH. Worth tightening, or at least documenting as an
  accepted race.
- `OutputPanelDefaultSize` lives in `PanelPacker.scala` (`:129-151`) — a file
  named for an unrelated concern whose own doc comment now has to explain it is
  *not* `PanelPacker.Bounds`. Its own small file would read better.
- The `outputRepo != null` guard (`PanelService.scala:130`) propagates the
  HEL-477 nullable-DI pattern into a new code path. Not new debt, but each
  additional site makes the eventual `Option` conversion larger.
- `PanelDetailModal.tsx` is now 448 lines (419 on `main`, 441 last cycle), past
  CONTRIBUTING's ~400-line "propose a split" threshold and still growing.
  `OutputPanelSection` remains the natural extraction.
- Picker arrow-key navigation still moves only a visual `--focused` class, with
  no DOM focus and no `aria-activedescendant` (unchanged from cycle 1).
- Test-data cleanup: this review created `HEL909-EVAL2-sizes`
  (`1e7cf0a9-…`), `HEL909-EVAL2-clobber` (`b4e43008-…`) and one extra panel on
  an existing dashboard in the shared dev DB.
