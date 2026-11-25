## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `53ee75d9868b01cfd27e5f85f01c0b0fc5ee84e8`. The base was resolved live as `95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c`, giving 3 commits on the branch. The round-2 delta (`6e580521f..53ee75d98`) is frontend and e2e only; the backend has not changed since round 1.

Evidence directory: `<ev>` = `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.concertino/scratch/HEL-1587/`.

### What I verified (with evidence)

**Setup and lane constraints**
- The spawn-cwd guard returned READY.
- I followed `lane-constraints.md`:
  - lane DB `helio_hel1587`, with `DATABASE_URL` and `DB_USER` exported in the same command as the servers, sbt and Playwright;
  - an empty `ANTHROPIC_API_KEY`;
  - jest with 3 workers, sbt with `-J-Xmx3g`, `nice -n 19`;
  - no `.env` access.
- I used an isolated headless Playwright browser, not the shared MCP browser, on port 7019 only.

**Gates (all run fresh by me)**

| Gate | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `lint` | exit 0 |
| `typecheck` | exit 0 |
| `format:check` | exit 0 |
| jest, `src/features/dashboards` and `src/features/panels` | 352 suites, 3,956 tests, all pass, exit 0 |
| sbt `testOnly com.helio.api.routes.dashboards.*` | 259 tests succeeded, 0 failed; includes `PublicLayoutAndFormSchemaRoutesSpec`, `PublicFormSchemaRlsSpec` and both `PublicRouteOwnerIdLeak*` specs |
| Playwright `e2e/hel1587-public-viewer-layout.spec.ts` (dev project, DEV_PORT=7019) | 2 tests passed (light and dark), exit 0 |

**Red-first.** `red-run-cycle3-frontend.txt` shows the two new tests failing before the fix ("2 failed, 14 passed"):
- the stack-order test;
- the title-row provenance test.

They pass now.

**Round-1 change requests, re-verified against ground truth**

1. **Phone stack order (CR1): fixed.**
   - `PublicDashboardViewerPage.tsx` now orders the stack with `orderPanelsForMobileStack(panels, resolveDashboardLayout(panels, layout).xs)`, the same call `MobilePanelStack` makes.
   - Live result at 375 px: the API order is `Rule, Plain, Intake, Photo, Story, Orders` (newest first). The public stack renders `Orders, Story, Intake, Photo, Plain, Rule`. That matches the stored xs order and the signed-in phone stack. It holds in every context: anonymous and owner, light and dark (`<ev>/sk2-visual-log.json`).
   - Screenshots: `<ev>/sk2-shots/public-anon-light-375.png` against `<ev>/sk2-shots/signedin-light-375.png`, and the dark pair `public-anon-dark-375.png` / `signedin-dark-375.png`.
2. **Provenance placement (CR2): fixed.**
   - Placement: `PublicPanelTitleRow` puts the `ProvenanceTrigger` at the trailing end of the title row, beside the heading and not inside it.
     - grid card: `h2.panel-grid-card__title`;
     - stack item: the existing span.
     - Only output panels get the trigger.
   - The old row is gone: `.public-dashboard-viewer__provenance-row` has a count of 0.
   - Live measurement: the title row is 24 px tall. The button is flush right (0 px gap), with its top aligned to the title at 1440 px and vertically centred against it at 375 px.
   - It sits in the same place as the signed-in phone header's (i) (see the 375 px screenshot pair above).
   - The fixed-height output cell no longer spends its own row on the icon (`<ev>/sk2-shots/public-anon-light-1440.png`).

**Anonymous API probe** (live backend on port 9926; seeded by `sk2-seed.mjs`; output in `<ev>/sk2-anon.json`):

| Request | Result |
| --- | --- |
| Panel list, top-level keys | exactly `items, layout, limit, offset, total` |
| Panel list, `layout` | breakpoints exactly `lg, md, sm, xs`; every item exactly `h, panelId, w, x, y` |
| Stale `ghost-deleted` id | dropped |
| Owner uuid, `ownerId` key, `layoutVersion` | none present in the body |
| Form-schema | 200, `{"fields":[{"name":"note","required":false,"type":"string"},{"name":"quantity","required":true,"type":"integer"}]}`; no `default`, no source id, no owner id; the unbound declared field `secret_unbound` is absent |
| Form-schema for a non-form panel, another dashboard's form via this token, or an unknown panel | `404 Panel not found` |
| Form-schema with no token or a bad token | `404 Dashboard not found` |
| Foreign dataset | I re-pointed the form's `form_config.dataSourceId` to user B's dataset with SQL. Result: `404 Panel not found`. After restoring it: 200 again. |
| Anonymous `POST /api/panels/:id/submit?token=…`, `POST …/layout/repair?token=…`, `PATCH …/update?token=…` | 401 each |

The panel list still carries the form config's `dataSourceId`. That exposure is pre-existing, and the design records it as a follow-up; it is not new in this change.

**The public page never writes, even in the owner's session.** Across all 4 contexts (anonymous and owner, light and dark):
- Non-GET requests:
  - anonymous: none;
  - owner: only the app-wide `PATCH /api/users/me/preferences` theme sync and `POST /api/events`.
- I saw no layout PATCH, no `layout/repair` and no `/submit`.
- API reads were only the panel list, the public form-schema, and the public output-meta and rows reads.
- The form controls Note and Quantity are `disabled`. Forced click, typing and Enter sent nothing.
- There are no `<form>` elements and no submit buttons on the public page.
- The resize-handle spans are present but hidden (`display:none`), as round 1 measured. The `noCompactor` grid has drag and resize disabled.
- The code agrees: `PublicPanelGrid` imports no layout-save or repair hook, and `PublicFormPreview` imports no submit function.

**Hostile content**
- `<script>window.__p=1</script>` renders as literal text, as it does on the signed-in card.
- There is no `a[href^=javascript]` element.
- `window.__p` stays undefined in every context.

**Console:** no errors or warnings in any of the 4 contexts.

**Design D3 grid key (changed after the design gate).** `Responsive` is keyed by `dashboardId` only. I judge this sound:
- the layout and the width arrive in the same render;
- `measureBeforeMount` means nothing mounts until the real width is known;
- a breakpoint key would reset `useProcessedWidth` on a breakpoint change.

**Visual cohesion** (desktop at 1440 px, which resolves md, and phone at 375 px, in both themes; I compared against the RUNNING signed-in grid and phone stack):

*Desktop*
- The public cells sit at the stored md positions:
  - Orders and Story share the top row;
  - Intake and Photo are under them;
  - Plain and Rule are short cards.
- That is the same arrangement as the signed-in grid (`<ev>/sk2-shots/signedin-light-1440.png`, `signedin-light-1440-bottom.png`).
- The cards use the same `.panel-grid-card` surface, border, radius and title type. Short cards take the tighter title rhythm, and the vertically centred plain-text body matches the signed-in text card.

*Phone*
- The stack items are tokenised cards with the same order and the same trailing (i) placement as the signed-in phone stack.

*Both themes:* light/dark parity holds (`public-anon-dark-1440.png`, `public-anon-dark-375.png`).

**Cleanup**
- Test users `dc61b9c3-3590-4a4e-9e1f-9a8b42c7605e` and `ce740dc4-5a00-4fc3-8e02-c200ca2a4133` were deleted by exact id with `buildUserDeleteSql`; a count afterwards was 0.
- The e2e users were removed by the spec's own cleanup.
- The servers were stopped with `stop-servers.sh` (`STOPPED ports=7019,9926`).

### Verdict: CONFIRM

### Non-blocking notes
- **Gate chain:** `events.jsonl` shows `phase.enter Evaluation cycle 3`, followed directly by this skeptic spawn. There is no evaluator verdict for `53ee75d98`; `evaluation-2.md` reviewed `6e580521f`. I re-ran the mechanical gates for the changed areas myself (above), so this CONFIRM does not rest on an evaluator PASS. The orchestrator should still confirm that merge readiness does not require an evaluator verdict on this exact head.
- **Phone stack title weight:** the title is regular weight, while the signed-in phone header is semibold. This is the pre-existing `.public-dashboard-viewer__panel-title` span and is a polish candidate only.
- **Follow-ups still owed at Delivery** (carried from round 1):
  - the pre-existing public form `config.dataSourceId` exposure;
  - `ImagePanel`'s empty state, "Open panel settings to configure.", shown to anonymous viewers.
- No mtime-ordering claim is relied on anywhere in this report.
