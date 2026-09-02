# Evaluation Report — Cycle 2 (evaluation-3.md)

Reviewed at commit `be3c2633`. All gates re-run fresh by me in the worktree; all
live evidence gathered against servers whose start times I checked against the
commit timestamp in `ps`.

> **Duplicate-evaluator note.** A second evaluator reviewed this same cycle
> concurrently and wrote `evaluation-2.md` (23:35). I did not see that file until
> after my own gate runs and live probes were complete. Our conclusions converge;
> where they overlap I re-derived the evidence myself rather than adopting it —
> in particular I independently reproduced the breakpoint-clobber defect below
> with my own probe before reading theirs. Two evaluator processes also raced on
> the shared browser session and dev database during this cycle (I watched the
> page navigate itself mid-action several times). Worth the orchestrator's
> attention as a process issue; it did not corrupt any measurement I report here,
> each of which was captured atomically.

## Gate results (my own runs)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm test` (root + frontend) | PASS — 252 suites / 2587 tests |
| `cd backend && sbt test` | PASS — 236 suites / 3546 tests |
| `openspec validate output-picker-nav-onboarding --type change` | PASS |
| `check:schemas` / `check:openspec` / `check:spec-structure` / `check:scala-quality` | PASS |

The executor's self-reported numbers reproduce exactly.

**Servers**: backend JVM PID 2157306 started 23:27:02, after the 23:22:26 commit
(verified in `ps`, not assumed); frontend Vite serves from disk. No stale server
in any evidence below.

## Change-request verification (cycle-1's 7)

| CR | Verdict | My evidence |
| --- | --- | --- |
| CR1 decision-15 sizes | **Partially — correct at `lg`, breaks `md`/`sm`/`xs`** | see finding 1 |
| CR2 pipeline grouping | PASS | live picker: 51 group headings, real names (`skeptic-repro-5`, `EVAL908 pipeline`, `HEL-254 Wide Table Pipeline`, …), **zero** literal `"Pipeline"` placeholders; aria-labels read `Raw rows (Final Pipeline 1788300547488)` |
| CR3 de-blinded test | PASS | new case starts from `pipelines: {items: [], status: "idle"}`; pre-fix code dispatched no `fetchPipelines()` at all, so the name assertion could not have resolved — genuinely red-capable |
| CR4 service layering | PASS | `await import(".../httpClient")` gone; `panelService.patchPanelOutputId` + `swapPanelOutput` thunk own the PATCH. **Live swap re-verified end-to-end**: sheet `Total col_16` → `Raw rows`, persisted on an independent `GET /api/dashboards/:id/panels`, **and the panel's layout entry was unchanged (`3x2 @ y=10`)** — the spec's "position/size preserved" clause holds. Cycle-1's `PanelRepository` fix is intact. |
| CR5 error surfacing | PASS | verified on a *real* backend failure, not a mock: a `429` during swap produced the `role="alert"` message **"Failed to swap output. Please try again."**, the picker stayed open, and the sheet correctly did **not** change. The `hasPlacementCountError` notice also renders live. |
| CR6 spec/reality | PASS | the delta now describes the shipped kind/name/placement-count cards; the thumbnail deferral is reasoned against the N+1 cost, not silently reworded |
| CR7 task 10.4 | PASS | `tasks.md` 10.4 walks all 20 deltas with per-file reasoning; I spot-checked the REMOVED deltas against `find` (files genuinely deleted) and `panel-detail-modal` against live UI |

Non-blocking suggestion also fixed: "Used on N dashboards" now dedupes by
`dashboardId` and pluralizes correctly (`Used on 5 dashboards` live).

**Decision-15 sizes at `lg`, verified live for all six kinds** (my own placements
against a scratch dashboard, response `layout` and persisted `dashboards.layout`
agreeing, then confirmed in rendered pixel sizes):

| kind | returned/persisted | rendered |
| --- | --- | --- |
| chart | 6×4 | 684×262 |
| table | 6×6 | 684×402 |
| metric | 3×2 | 333×122 |
| collection | 6×4 | 684×262 |
| timeline | 4×6 | 450×402 |
| markdown | 4×4 | 450×262 |

## Phase 1: Spec Review — FAIL

Ticket AC 1 is met at `lg` only, and the way it was met regresses existing
per-breakpoint layout behavior (finding 1). Everything else from cycle 1 remains
true and re-verified: HEL-937 deletions are real; `/registry` and `/metrics`
render the shared **Page not found** with no shim; exactly 5 nav destinations on
desktop and at 375px (54px targets, `scrollWidth === 375`); the AC-grep exception
set has not grown. `tasks.md` accurately describes what was built; no scope creep
beyond the 7 CRs.

## Phase 2: Code Review — FAIL

Verified PASS: the layering violation is gone; `swapPanelOutput` follows
Component → thunk → service; `PanelResponse.layout` is consistent between the
Scala protocol (`jsonFormat9` → `jsonFormat10`), `schemas/panels/panel.schema.json`
and the TS type, with `check:schemas` green; `OutputPanelDefaultSize` keeps the
six constants in exactly one place with no frontend copy;
`PanelServiceDefaultLayoutSpec` is red-first-capable by construction (the
`placeDefaultLayout` branch and its `dashboardRepo.update` call did not exist
before, so its captor assertions could not have compiled against prior code).

**Blocking finding:**

1. **Placing an Output destroys the dashboard's `md`/`sm`/`xs` layouts and writes
   `lg`-scaled items into narrower grids.**
   `backend/.../services/panels/PanelService.scala:141-143` builds `nextLayout`
   from `dashboard.layout.lg` alone and assigns that same array to all four
   breakpoints (`DashboardLayout(lg = nextLayout, md = nextLayout, sm = nextLayout,
   xs = nextLayout)`); `frontend/src/features/panels/state/panelThunks.ts:97-104`
   mirrors it client-side.

   **My own probe** (scratch dashboard, PATCHed to deliberately divergent
   per-breakpoint layouts, then **one** Output placed, then read back and the
   dashboard deleted):

   | breakpoint | before | after |
   | --- | --- | --- |
   | lg | `4x5 @ 8,0` | `4x5 @ 8,0` + `3x2 @ 0,5` |
   | md | `7x9 @ 3,1` | `4x5 @ 8,0` + `3x2 @ 0,5` |
   | sm | `5x3 @ 1,2` | `4x5 @ 8,0` + `3x2 @ 0,5` |
   | xs | `2x7 @ 0,0` | `4x5 @ 8,0` + `3x2 @ 0,5` |

   The md/sm/xs arrangements are overwritten and persisted — a reload does not
   recover them. Real dashboards in the dev DB carry genuinely divergent
   per-breakpoint layouts, so this is data loss on existing user state, not a
   hypothetical.

   Second half of the same defect: column counts differ per breakpoint
   (`frontend/src/features/dashboards/state/dashboardLayout.ts:10-15` — lg 12,
   md 10, sm 6, **xs 2**) and nothing clamps or scales. My probe wrote `x=8, w=4`
   and `w=3` into the **2-column** `xs` grid. `resolveBreakpointLayout`
   (`dashboardLayout.ts:218-226`) returns saved items verbatim once every panel
   has an entry, so those out-of-bounds items are what actually renders on
   mobile; filling all four arrays also permanently bypasses `projectLayout`
   (`dashboardLayout.ts:139-150`), the helper that exists precisely to scale
   `w`/`x` between column counts.

   `AutoLayoutService` does write all four breakpoints the same way, and the
   executor's comment cites it as precedent — but that is an explicitly
   user-invoked re-layout of the whole board, whereas this now fires silently on
   every single panel placement. The precedent does not carry.

   `PanelServiceDefaultLayoutSpec` cannot catch this: every assertion reads
   `captor.getValue.layout.lg` only.

2. **The picker's N+1 placement-count fetch degrades the primary flow on a
   realistic dataset.** Opening "Add panel" fires one
   `GET /api/outputs/:id/panels` per Output (~200 in this workspace), which
   exceeds the app's own per-principal rate limit (`RATE_LIMIT_REQUESTS_PER_WINDOW`,
   default 120/min). Observed live, repeatedly: dozens of `429` console errors,
   the new "Some placement counts could not be loaded and may be shown as 0."
   banner on an ordinary open (so the counts the spec requires are simply wrong
   for most cards), and — because the budget is then exhausted — the *next*
   action failing too: my swap attempt returned `429` and surfaced "Failed to
   swap output." The error handling is correct; the load pattern that provokes
   it is not. This was a non-blocking note in cycle 1; I am raising it because
   CR5 turned it from invisible into a permanent user-facing error banner on the
   flow this ticket exists to build, and because it makes a shipped MUST
   (placement counts) demonstrably wrong.

## Phase 3: UI Review — FAIL

Working (all re-verified live this cycle): Add panel → search → Enter places a
panel at the correct per-kind size; group headings show real pipeline names;
Panel sheet shows title/appearance/Output link/Swap output/placements note with
no field-mapping or aggregation control; Swap output works end-to-end and
preserves position/size; failures surface a visible `role="alert"` message with
the modal kept open; 5 nav destinations and no horizontal overflow at 375px.

Failing: mobile/`md`/`sm` layouts are wrong after any placement (finding 1 — the
persisted `xs` entries are wider than the 2-column `xs` grid); and "no console
errors during the tested flow" fails on the picker's `429` storm (finding 2).

## Overall: FAIL

## Change Requests

1. Stop collapsing all four breakpoints onto `lg`. In
   `PanelService.placeDefaultLayout` (`PanelService.scala:141-143`), append the
   new item to **each breakpoint's own existing array**, scaling `w`/`x` to that
   breakpoint's column count (lg 12 / md 10 / sm 6 / xs 2) — the frontend's
   `projectLayout` (`dashboardLayout.ts:139-150`) is the existing reference for
   the arithmetic; port it or call an equivalent server-side. Apply the same fix
   to the client-side merge in `panelThunks.ts:97-104`. Extend
   `PanelServiceDefaultLayoutSpec` with an arm that seeds distinct md/sm/xs
   layouts and asserts (a) they survive with only the new item appended and
   (b) the appended item fits its breakpoint's column count — proven red against
   today's code first.
2. Address the picker's N+1 placement-count fetch: serve the count as a field on
   the `GET /api/outputs` list response (the option `useOutputPickerData`'s own
   comment and the amended spec delta both already name) so one open costs one
   request. If the orchestrator instead rules this a deferral, it must be a filed
   follow-up ticket plus an explicit note in the spec delta that placement counts
   are best-effort above N Outputs — not left as an error banner on the default
   flow.

## Non-blocking Suggestions

- `PanelService.placeDefaultLayout` guards on `outputRepo != null`; the file's
  other nullable-optional DI is cited as precedent, but a `null` check in new
  code is worth replacing with an `Option[OutputRepository]` while the surface is
  still small.
- Comment typo in `PanelDetailModal.tsx:73-78`: the example reads
  `must read "Used on 1 dashboards"` — the code (correctly) renders the singular.
- Every placement appends at `x=0` on a fresh row, so a 3-wide metric never sits
  beside anything. Decision 15 says "next free slot"; a simple shelf-fill (which
  `PanelPacker` already implements) would match the mockup more closely.
