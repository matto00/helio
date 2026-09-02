## Skeptic Report — final gate, BACKEND CORRECTNESS & DATA-INTEGRITY axis (round 1, skeptic-final-1a.md)

Cold review at commit `2913739b`. Every claim below is from my own reading/probe, not
from `evaluation-4.md` (which asserts its backend gate without pasted output — so I
re-ran it myself, see §7). Filename suffixed `1a` per the dimension-split fan-out
instruction, so it cannot collide with the two sibling skeptics' `skeptic-final-1*.md`.

### 1. `LayoutBreakpointScaling` math — read and re-derived independently

`backend/.../services/panels/LayoutBreakpointScaling.scala`:
`scale = target/source`; `w = max(1, min(targetCols, round(w*scale)))`;
`x = max(0, min(targetCols - w, round(x*scale)))`. I compared this character-by-character
against the frontend source of truth `frontend/src/features/dashboards/state/dashboardLayout.ts`
`scaleLayoutItem` — identical formula, identical clamp order, identical treatment of `y`/`h`
as unitless. `breakpointCols` (12/10/6/2) matches the frontend's `dashboardGridCols`.

Adversarial reasoning on the clamps: `scaledW <= targetCols` is guaranteed by the inner
`min`, so `targetCols - scaledW >= 0` and the `x` clamp can never produce a negative bound;
`x + w <= targetCols` holds for every input, including out-of-range/garbage input
(e.g. `x=20,w=6` at lg → xs yields `(1,1)`). A 6-wide `lg` item into the 2-column `xs`
grid yields `w=1` (not 0, not 6) — the `max(1, …)` floor is load-bearing and present.
`scaleWidthAndX` is the same math on raw ints; I diffed the two bodies — no drift.

### 2. Three write sites — each call's inputs checked individually, not just "it compiles"

- `PanelService.placeDefaultLayout` (`PanelService.scala:150-157`): builds ONE `lgItem`,
  appends to each breakpoint's **own existing array** (`dashboard.layout.md :+ …`), scaling
  that single item from `breakpointCols("lg")` to each target. Source breakpoint correct,
  target correct, item correct, existing entries preserved.
- `AutoLayoutService.applyAutoLayout` (`AutoLayoutService.scala:105-107`): source cols is
  `cols` — the width the packer actually packed `items` at — not a hardcoded 12. Correct.
- `DashboardContentsService.remapLayout` (`:133-138`) and
  `DashboardProposalService.applyLayout` (`:133-143`): both scale from `lg` (the breakpoint
  the proposal's coordinates are authored at) into each target; both wholesale-replace, which
  is correct here because every panel id is freshly minted (documented in the scaladoc).

No copy-paste error: each site passes a distinct, correct `(source, target, item)` triple.

### 3. Live end-to-end data-integrity probe (my own, distinct from the evaluator's)

Backend restarted/verified from this commit: JVM start `Wed Sep 2 00:15:23` per `ps -eo lstart`,
after the `00:11:04` commit — checked, not assumed. Probe dashboard
`3c24f150-06e8-4c28-a28e-ee47d22b4f98` ("SKEPTIC-909-probe", deleted afterwards).

1. Created output panel A → layout written `lg w=6 / md 5 / sm 3 / xs 1` (correct scaling).
2. PATCHed a **deliberately divergent** per-breakpoint layout (not the evaluator's shape):
   `lg (6,0,6,4)`, `md (7,9,3,2)`, `sm (4,5,2,7)`, `xs (1,3,1,9)`.
3. Created panel B via the Output-picker create path. Read raw from Postgres: **A's md/sm/xs
   entries are byte-identical to what I wrote** (no clobber), and B is appended per-breakpoint
   as `lg 6 / md 5 / sm 3 / xs 1`. This is the exact defect from evaluation-2 — not reproducible.
4. `POST /dashboards/:id/auto-layout` (cols=12): all four breakpoints independently derived,
   all in-bounds.
5. `PUT /dashboards/:id/contents` with right-edge/overflow-prone items
   (`x=11,w=1`; `x=0,w=12`; `x=7,w=5`) →
   `md [(9,1),(0,10),(6,4)]`, `sm [(5,1),(0,6),(3,3)]`, `xs [(1,1),(0,2),(1,1)]`.
   Every item satisfies `x + w <= cols` at every breakpoint; the right-edge item clamps
   rather than overflowing. Two of the three fixed write paths exercised in one sequence with
   no cross-contamination.

### 4. `panelCount` batching — correct, cross-checked three ways

`PanelRepository.countByOutputIdsInternal` is a single `groupBy(output_id).length` over
`inSet(outputIds)`, returning only non-zero ids; `OutputRoutes.listRoutes` defaults missing
ids to `0`. Cross-checked live: `GET /api/outputs` reported `b81ae5a5→2, 9808a214→1,
c30af54c→0`; `GET /api/outputs/:id/panels` returned exactly 2 / 1 / 0 items; raw SQL
`select output_id, count(*) from panels group by 1` agreed. After my probe added 3 panels and
then swapped one panel's output, counts moved `5→4` and `1→2` in lockstep with SQL. No
undercount, no overcount, no counting of deleted panels (replaceContents' deletions were
reflected immediately).

I also verified the associated `PanelRepository.configColumnsOf`/`configColumnValuesOf`
`output_id` fix live: `PATCH /api/panels/:id` with a new `config.outputId` now actually
persists to the row (`select output_id …` returned the new id), which is the durable fix for
the "swap returns 200 but reads back the old output" defect.

### 5. Migrations / schema

No migration was added and none was needed: the backend diff touches no table DDL
(latest migration is still `V95__dashboard_tag.sql`, unchanged from `main`), and `panelCount`
is a derived response field, not a column. `schemas/outputs/output.schema.json` and
`schemas/panels/panel.schema.json` carry the additive wire fields. Correct.

### 6. RLS / multi-tenant

`OutputService.listAll` is owner-scoped (`findAllByOwner`), so the page only ever contains
the caller's own Outputs; the count is then taken over those ids. `countByOutputIdsInternal`
uses `withSystemContext` (RLS-bypassing), documented with the same contract as the
pre-existing `findByOutputIdInternal` it sits beside. No cross-tenant data is returned — the
only theoretical nuance is noted below as non-blocking. Nothing in this change alters an RLS
policy or an ACL gate.

### 7. Gate re-run (my own, since evaluation-4 only asserted it)

`sbt -batch "testOnly com.helio.services.panels.* com.helio.api.routes.panels.*
com.helio.api.routes.pipelines.OutputRoutesSpec com.helio.services.proposals.*
com.helio.services.dashboards.*"` →
`Total number of tests run: 152 / Suites: completed 15, aborted 0 / Tests: succeeded 152,
failed 0 … All tests passed. [success] Total time: 15 s, completed Sep 2, 2026, 12:29:16 AM`.

### Verdict: CONFIRM

On the backend-correctness / data-integrity axis this ships. The layout fix is genuinely
correct (not merely self-consistent with its own tests), all three write sites are
independently right, `panelCount` is exact against SQL ground truth, and no migration was
skipped.

### Non-blocking notes

- **Cross-breakpoint `y` carry-over can produce overlaps.** In my probe, B was appended at
  `y=4` (computed from the `lg` stack) into `md`/`sm`/`xs`, where A sat at `y=9`/`y=5`/`y=3`
  with heights 2/7/9 — so B visually overlaps A at `sm`/`xs` until the frontend's
  `cleanupOverlaps` (dashboardLayout.ts) resolves it on read. Correct by the documented
  "`y` is unitless" contract and self-healing client-side, but a future per-breakpoint
  `y = max(y+h)` append would remove the reliance on the client's defensive pass.
- **`AutoLayoutService` with `cols != 12`**: `kept` items are read from `existing.layout.lg`
  (a 12-column layout) but scaled as though they were authored at the request's `cols`. This
  is self-consistent with what is written back into `lg`, and is an inherited property of
  allowing a caller-chosen `cols`, not a regression from this change.
- **Auto-layout replaces user-customised `md`/`sm`/`xs` positions** for panels not in the
  request (they are re-projected from `lg`). Defensible for a user-invoked whole-board re-pack,
  but it is a behaviour change worth a line in the ticket's notes.
- **`panelCount` counts every panel bound to the Output, including one created by an editor
  grantee on a dashboard the caller cannot see.** Count-only, about the caller's own Output,
  and identical in scope to the pre-existing `GET /api/outputs/:id/panels`. Not introduced here.
- **Stale error string** `"a <type> panel requires a dataTypeId"`
  (`ProposalPanelSupport.scala:36`) is still surfaced by `PUT /dashboards/:id/contents` — it
  originates from HEL-904 and falls inside design.md's explicit "proposal/patch-set
  `dataTypeId` wire field" out-of-scope boundary. Flagged only so it is not lost.
