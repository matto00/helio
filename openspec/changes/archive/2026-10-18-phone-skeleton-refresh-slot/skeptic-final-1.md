## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `f77cba7099938ce21ae2862a5a87bfecec5b7d51`, diffed against the live-resolved base
`49021293b96c55fc9d80a6ed79b5b55d925fb6b7` (`resolve-review-base.sh`, origin/main, exit 0).
Evidence dir (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1646/evidence/.concertino/scratch/HEL-1646/`.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/phone-skeleton-refresh-slot/HEL-1646`.

**Diff read in full** (backend, schema, helio-mcp, frontend, e2e).
- Backend:
  - `DashboardRepository.pipelineFedDashboardIds` is one `inSet` query per page under `withUserContext`. It
    filters `kind = 'output' AND output_id IS NOT NULL`, with an early return on an empty page.
  - It is called only from the list route, via `DashboardService.findAllWithPipelineFedFlag`.
  - `DashboardResponse.hasPipelineFedPanels: Option[Boolean] = None` is appended last, with `jsonFormat9`.
  - I confirmed `findAll` is owner-only (`DashboardRepository.scala:57-68`), so the list carries no grantee dashboards.
- Frontend:
  - `withKnownFlag` is applied at upsert, appearance, both layout branches including `keepLocalLayout`, repair, and
    rename.
  - `panelsSettledFor` is a byte-equivalent extraction of App's old expression. `panelsKnownFor` adds the
    stale-empty disjunct.
  - `DashboardRefreshLine` reads panels only when they are known, and otherwise falls back to the list flag.
  - `usePipelineFedFlagSync` dispatches only when the panels are known and the observed value differs from the flag.
  - The line mounts only in `PanelList.tsx:316`, the phone branch. Desktop has no consumer of the flag.

**AC1: pipeline-fed placeholder top equals real-card top across the swap, both themes.**
- The executor's e2e, run by me fresh on HEAD at 7078/9985 (2 workers, nice 19, e2e lock, trace
  retain-on-failure): **11 passed**.
  - Fed: skeleton 155 / card 155, chip row 103, layout-shift 0, at 375 and 430, light and dark.
  - Markdown-only: 128 / 128, no slot.
  - Both switch cases and delete-last pass. Delete-last logged `fetches:1`, so the slowed reopen was real.
- Independent probe (my own spec, `skeptic-probe/skeptic-probe.spec.ts`, persisted):
  - It differs from the executor's spec in one way that matters: the sampler is installed with `addInitScript`, so it
    records **every frame from document start**, not from "skeleton visible".
  - The executor's spec skips the earliest frames, because the deep link can briefly paint the most recent dashboard.
    I made the *other* dashboard the most recent in every case, to catch a flag-driven slot flicker on that frame.
  - Results, 375 and 430, light and dark (`skeptic-probe/run1.log`):
    - fed: skeleton top {155.2} in every skeleton frame, slot `reserved` throughout. The card settles at 155.2
      (`filled`).
    - md: skeleton top {128}, slot `none` in every frame. The card is at 128.
    - The first painted skeleton was already the target dashboard. There was no frame showing the other dashboard's
      slot state.
    - The only layout-shift entry was a tiny (≤0.002) `app-command-bar__right@dy0` horizontal entry at shell first
      paint, in both fed and md. It is unrelated to this change.
  - Live `GET /api/dashboards` from the running backend returned `[["SK Fed",true],["SK Plain",false]]`.
- The red baseline is the evaluator's pasted log (`eval-c1-e2e-red-baseline.log`): 4 failed on "a slot exists in
  every skeleton frame", and 4 markdown-only cases passed. This is unambiguous pasted output, so I accepted it.

**AC2: markdown-only unchanged.** No slot in any frame from document start (probe above). The same holds in the
executor's md and fed->md switch cases.

**AC3: schema and contract.**
- `schemas/dashboards/dashboard.schema.json` declares an optional boolean with a description.
- `helio-mcp/src/types.ts` adds the field.
- Backend route test `DashboardPipelineFedFlagSpec` runs on the NOBYPASSRLS app pool. Its 3 cases, including "omit on
  create/rename" and the cross-user case, appear passed in the evaluator's pasted `sbt testFull` log, lines
  12016-12018, with `succeeded 9203, failed 0`.

**Gates re-run by me:**
- Targeted jest (pipelineFed, panelsSettled, DashboardRefreshLine, usePipelineFedFlagSync, PanelList, App,
  dashboardMeta, dashboardsSlice), 2 workers: 18 suites, 253 tests passed, exit 0.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.

**Desktop unchanged.**
- The line's only mount is the phone branch.
- The evaluator's 1280 box dumps (HEAD vs base, both themes) are content-based measurements. They are not
  mtime-based, so I accepted them.

**Visual judgment (DESIGN.md).**
- Persisted screenshots I looked at:
  - `skeptic-final-fed-skeleton-375-dark.png`
  - `skeptic-final-fed-loaded-375-dark.png`
  - `skeptic-final-fed-skeleton-430-light.png`
  - `skeptic-final-md-skeleton-430-light.png`
- The reserved slot is the existing HEL-1583 `aria-hidden` empty `<p>`, with unchanged markup and CSS. It reads as a
  quiet gap above the chip row, and the skeleton cards sit exactly where the loaded cards land.
- There are no new tokens, components or hardcoded values.
- Light and dark show parity. The markdown-only skeleton has no gap.
- Nothing is off-pattern.

**Mtime discipline.** No claim here rests on mtime or directory ordering. The evaluator's report states its
evidence is content-based.

### Verdict: CONFIRM

### Non-blocking notes
- `DashboardRefreshLine.tsx`: `panelsKnownFor` is evaluated in two selectors. Deriving `panels` from `panelsKnown`
  would remove the duplication. The evaluator noted this too.
- `dashboardMeta.ts` `feedingOutputIds` now tolerates a config-less panel. That only exists in malformed test
  fixtures, so the fixtures could be fixed and the cast dropped.
- The switch cases now show a ±27px chip-row shift when the switch commits, not at the skeleton swap. It coincides
  with the content change and is the intended effect of the flag.

Test data: my probe registered 8 throwaway users (`skeptic1646-*`). The executor-spec run I did registered 11
(`hel1646-*`). The HEL-1301 global teardown deleted both sets by recorded id ("deleted 8 recorded throwaway
user(s)", "deleted 11 recorded throwaway user(s)"). Their dashboards, pipelines and sources are owned by those users.
