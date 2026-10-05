## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fba0d78f88db1523b4afbe957fa363d4994047ae (change dir untracked; spec unmodified).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/orphan-repair-e2e-flake/HEL-1289`.
- **Baseline failure count (10/20):** I counted `error-context.md` files under
  `scratchpad/probe1/results/*/`. light: repeat3, 4, 5, 7 (4). dark: base, repeat1 to 5 (6). Total 10/20, which matches the claim.
- **Correlation, re-derived with my own classifier** (`scratchpad/skeptic_classify.py`). It compares each repair POST's
  `resource-snapshot._monotonicTime` (ms) with the `startTime` of the `before` action for `goto /dashboards/<id>`:
  - All 10 FAILs have exactly one repair POST, starting 4.9 to 23.7 ms **before** the goto. All are page-frame requests from `/`.
  - All 10 passes have exactly one repair POST after the goto. Every run has exactly one POST. No run has zero, and no run has two.
  - So the 20/20 split by "before vs after goto" holds, and the root cause holds. The listener is attached at line 71,
    after the API seeding. Meanwhile the live `/` page (App.tsx:175 `fetchDashboards` → auto-select → `fetchPanels` →
    `PanelList` → `PanelGrid` → `useStoredLayoutRepair`) observes the orphan and sends the one repair. The product
    CAS-applied it in every run, including runs where the request shows `-1` (aborted client-side by the navigation).
    No failing run shows a second POST after the goto, so the server had already applied the repair.
- **Correction to the probe's mechanism narrative (finding, not blocking):** the table in `probe-root-cause.md` implies
  that in passing runs "the repair fired only after the goto" from the explicit open. That is true only for **2 of 10**
  passes (light base and repeat1, at +842 and +843 ms, a genuine post-navigation load). In the other **8 passes**
  (light r2/r6/r8/r9, dark r6/r7/r8/r9), the counted POST starts **+0.7 to +29.8 ms** after the goto action began.
  A new document cannot load, fetch dashboards and panels, and then POST in 1 ms. Most of these POSTs are `-1`
  (aborted by unload). So they came from the old `/` page, and the test counted them only because the listener happened
  to be attached already. In fact `/` sent the repair in **18/20** runs. The current spec almost never tests the explicit
  owner open. This strengthens the root cause and the case for D1 rather than weakening it. But the recorded root-cause
  artifact misstates the pass mechanism and should be corrected (see notes).
- **Parser hazard:** `probe-parse-trace.py` prints `_monotonicTime*1000` next to action `startTime` in ms. The two
  columns use different scales, so a naive numeric comparison inverts the conclusion. My first classifier pass did
  exactly that. The sort still orders correctly only because every resource-snapshot sorts after the actions. Not
  blocking, but D5/task 2.5's isolation parse must compare in one unit.
- **Product intent (auto-select repair on `/` is not a second bug):** the HEL-1233 ticket ruling reads "When the
  dashboard owner opens a dashboard…" (archive `2026-10-04-repair-stored-bad-layout-breakpoints/ticket.md:14,23`).
  D4 (design.md:76) places the trigger in `PanelGrid`, and its only gates are owner, panels loaded, repairable, and
  once per mount. It is route-independent by design (it is even documented as width-independent).
  `AppRoutes.tsx:108` renders `PanelList` at `/`, and `PanelList.tsx:15` mounts `PanelGrid`, so the owner viewing their
  most-recent board on `/` has opened it. HEL-1260 D5 (`2026-10-04-place-every-created-panel/design.md:98-105`)
  widened the repair to orphans and kept the same hook guards. The server is owner-only and compare-and-set (409 on a
  stale `expectedLayout`), so a repair from `/` is idempotent and safe. I agree with the design: this is intended
  behaviour, not a second product bug.
- **D1 (about:blank before seeding) closes the race:** a just-registered user owns no dashboards (HEL-1210 retired boot
  seeding, and the trace shows the `/` page fetched only `dashboards`), so nothing on `/` can repair before seeding.
  `about:blank` unloads the app before the first seeding request. After that, the explicit `goto` is the only app load
  that can see the orphan. The session cookie lives in the context and `addInitScript` re-applies. The rejected
  alternatives are argued correctly. The "listener-before-login only" rejection is right on its own terms: a `/` read
  that straddles the clear can produce a 409'd stale repair followed by a second real one.
- **D2/D3/D4 vs owner rulings:** no quarantine; no assertion loosened (whole-lifetime counting is strictly stronger;
  the PATCH filter broadens from `/api/dashboards/<id>/` to any `/api/dashboards/`); no timeout lengthened; the single
  POST's URL is pinned to the seeded id; "exactly one repair POST, all breakpoints stored" is preserved.
  Scope is one file. No `playwright.config.ts`/`ci.yml` edit, and HEL-1294 is excluded. AC "fix the test and explain why
  the product is correct" is covered by D1 plus the D4 intent argument. AC N>=20 green is covered by task 2.4, and AC
  repro/root cause by the probe.
- **D5 proof is red-capable:** mutation (a) inert hook → poll red; (b) double dispatch → exactly-one red; (c) old ordering
  → flake. Every acceptance signal is concrete.
- Placeholders/contradictions: none found. Tasks match the design one-to-one.

### Verdict: CONFIRM

### Non-blocking notes

1. Correct `probe-root-cause.md`, or supersede it in `verification.md` (task 2.6). Its "pass x10: repair after goto"
   row should say that 8 of the 10 passing runs counted a POST sent by the old `/` page 0.7 to 30 ms after the goto
   began (aborted `-1` or same-frame), and that only 2 runs exercised the explicit open. That makes `/` the repairer in
   18/20 runs, not 10/20.
2. In task 2.5, compare `_monotonicTime` and action `startTime` in the same unit (both ms). Also assert that the
   counted repair POST starts after the post-goto page-frame `GET dashboards/<id>/panels`, not merely after the goto
   action. That is the measurement that separates "explicit open" from "old page, in flight at navigation".
3. The test-2 listener's `endsWith("/layout/repair")` is fine. Keep it whole-lifetime per D3.
