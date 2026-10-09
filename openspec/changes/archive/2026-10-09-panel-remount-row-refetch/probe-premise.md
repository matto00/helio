# HEL-1392 premise probe (measurement, running app, dev server :6824 / backend :9731)

Setup: 8 output-bound panels (4 table, 4 chart/bar) on one dashboard, one pipeline, one static source.
Counter: XHR.open + fetch wrapper installed via addInitScript on a dedicated tab (a shared Playwright
tab was navigated to another worktree's :6820 by a concurrent session mid-probe; the table below is from
the dedicated :6824 tab only). Remount = tagged DOM nodes under `.panel-grid-shell` did not survive.

KEY FACT: the grid swaps on the _container_ width, not the viewport. Container = viewport - 288px
(sidebar). Phone stack (MobilePanelStack) when container < 768, i.e. viewport < ~1056. A "tablet
rotation" at a 768-1056 viewport is ALWAYS the phone stack; the real crossing is ~1056 viewport.

| Scenario                                                                                        | GET /api/outputs/:id/rows                                  | other GET /api/outputs/:id  | remount                                 | layout writes |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------- | --------------------------------------- | ------------- |
| Cold load, 1400 vp (8 panels)                                                                   | 16 (2 per panel)                                           | 48 + 8 assertion-status     | n/a                                     | 0             |
| lg->md->sm within desktop (vp 1900->1700->1400->1100->1900->1100; container 1612/1412/1112/812) | 0                                                          | 0                           | NO (8/8 grid items survive)             | 0             |
| Cross 768 container, down (vp 1400 -> 1000)                                                     | 8                                                          | 32                          | YES (0/313 nodes survive)               | 0             |
| Cross 768 container, up (vp 1000 -> 1400)                                                       | 8                                                          | 48 (+8 assertion-status)    | YES (0/777 survive)                     | 0             |
| Burst: 3 crossings in ~7.5s (1400->1000->1400->1000)                                            | 24                                                         | total 148 requests in burst | YES                                     | 0             |
| Burst result                                                                                    | 3 of 8 panels render "Rate limit exceeded" (limit 120/60s) |                             |                                         |               |
| Theme toggle x4 at desktop (command palette)                                                    | 0                                                          | 0 (only 3 background polls) | NO (773/777 survive; 4 = palette nodes) | 0             |
| Theme toggle x4 at phone stack                                                                  | 0                                                          | 0                           | NO (309/313 survive)                    | 0             |

Per-request URLs, one crossing (down): 8 x `GET /api/outputs/<id>/rows?offset=0&limit=200` (one per output
id 32ca0dd4..., 958a5b2d..., c5650859..., e818de90..., 02be9dcd..., 525911a0..., 74ac5301..., 4b5c3a1c...)
plus 32 `GET /api/outputs/<id>` (4 per panel), plus `GET /api/pipelines/<id>/runs/latest` and
`/run-events` (fetch). Crossing up adds 8 `/assertion-status` and 48 `GET /api/outputs/<id>` (6 per panel).

Verdicts on the static hypothesis:

- CONFIRMED: crossing the 768 container boundary remounts every panel and re-dispatches rows fetch for all.
- CONFIRMED: lg<->md<->sm resizes within desktop do not remount or refetch.
- REFUTED: theme toggle does not remount or refetch (desktop or phone).
- NEW: cold load already fetches rows twice per panel (16 for 8 panels; second batch lacks assertion-status,
  so a second mount of the panel cards happens during initial load).
- NEW: a crossing costs ~40-64 requests/8 panels; the 120/min /api limiter is exhausted by 3 crossings
  -> panels show "Rate limit exceeded" (screenshot evidence/probe-burst-rate-limit.png).
- No PATCH/POST/PUT layout or dashboard writes in any scenario.

Created and deleted by exact id (user row not deletable via API, left):
user a4d418f0-ec0f-49d7-a982-32f5051a580a (hel1392-probe-1791525763@example.test),
source 9e99f1aa-a95d-425d-8369-d60702ad4c3c, pipeline ea5572a3-c95f-45f4-89e5-b2f78d4a13f8,
dashboard f02ef49f-294b-40ec-b429-0c5ce1ea4c09 (8 panels cascaded: 6fe1e722-99c7-4048-813f-3db60682050e,
8bb7919c-6efd-4631-9f56-c2ebe1fe866a, 5ce849b9-2c6f-43bc-ab52-b96127061d7a, 36f957ec-c665-45be-8f5d-ebe26f2c86db,
5dc9c362-aebf-4238-8c35-04eff726a947, 8e213fbb-ce7e-4ef7-bc82-08a52cfba559, 8880b679-0827-4ae9-8513-3db425056103,
84c82cb0-0db9-4d1d-8b6c-28563f4b3657), outputs 32ca0dd4-9d19-4b82-90bf-b70aa46d3a79,
958a5b2d-3ab1-4d65-92dd-e90a86cad33c, c5650859-05d3-456b-8986-344a5d2cb6c9, e818de90-40f7-4f50-b829-27eda5d9b603,
02be9dcd-cbaf-43d3-b137-ce828c8c0046, 525911a0-41a2-473b-a799-518e2551249d, 74ac5301-708e-4b40-a283-d358651ef04b,
4b5c3a1c-8039-443c-962e-be45469dc3c4. Post-delete GET lists for dashboards/outputs/data-sources are empty.
