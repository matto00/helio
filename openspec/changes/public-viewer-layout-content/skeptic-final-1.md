## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `6e580521fd7d8ddaf270522ef8faf523f17fd78c`. The base was resolved live as `95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c`, giving 2 commits on the branch.

### What I verified (with evidence)

**Setup**
- The spawn-cwd guard returned READY.
- I worked under every rule in the lane constraints:
  - lane DB `helio_hel1587` exported in the same command as each DB-touching run;
  - empty `ANTHROPIC_API_KEY`;
  - jest with 3 workers;
  - `sbt -J-Xmx3g`;
  - one isolated headless Playwright browser of my own, not the shared MCP browser, so no other lane's localhost session cookie was touched.
- Scratch files are in `.concertino/scratch/HEL-1587/sk-*`.

**Gates (run fresh by me)**

| Gate | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| jest, public-viewer, form-control, grid and layout suites | 49 suites, 355 tests, all pass |
| sbt `PublicFormSchemaRlsSpec`, `PublicLayoutAndFormSchemaRoutesSpec`, `PublicRouteOwnerIdLeakApiSpec`, `PublicRouteOwnerIdLeakSpec` | 24 succeeded, 0 failed; hel1468 guard reports `failed=0 aborted=0` |

**Backend diff, read in full.** It matches design D1/D2:
- `storedLayoutFor` reads through `findByIdInternal` only inside the sharing gate, projects `panelId/x/y/w/h`, and filters to the panel ids in the response.
- `PublicFormSchemaResolver` finds the panel within this dashboard's panels and reads `getDeclaredSchemaOwnedBy`, which uses `withUserContext(owner)` plus an explicit `owner_id` predicate.
- `POST /api/panels/:id/submit` is untouched.

**Anonymous API probe** (live backend on port 9926, seeded by `sk-probe.mjs`):

| Request | Result |
| --- | --- |
| Panel list, top-level keys | exactly `items, layout, limit, offset, total` |
| Panel list, layout items | exactly `h, panelId, w, x, y`; a stale `ghost-deleted` id stored in lg was dropped; no `ownerId`, no owner uuid, no `layoutVersion` anywhere in the body |
| Form-schema | `{"fields":[{"name":"note","required":false,"type":"string"},{"name":"quantity","required":true,"type":"integer"}]}`, 200; no `default`, no source id; the unbound declared field `secret_unbound` is absent |
| Form-schema for a non-form panel, another dashboard's panel through this token, an unknown panel, or a form whose dataset was re-pointed (via SQL) to another user's dataset | `404 Panel not found` in each case |
| Form-schema with no token or a bad token | `404 Dashboard not found` |
| Anonymous `POST /submit` with the token, or `PATCH /update` | 401 |

The only source id that is public is the pre-existing `dataSourceId` in the form config. The design records it as a follow-up.

**UI.** I ran isolated Playwright contexts, anonymous and owner (session cookie added), in light and dark, at 1440 px and 375 px. Evidence is in `sk-visual-log.json` and the screenshots below.

- **Desktop grid:** it rendered with a processed width of 1408 px, which is md. The cells sit at the stored md positions:
  - Orders (16,24) and Story (726,24) share a row;
  - Intake and Photo sit under them;
  - Plain and Rule are short cards.
- **Read-only:** a drag of the Orders cell left its box unchanged. The `.react-resizable-handle` spans exist but are `display:none`, the same as the signed-in grid in view mode. There is no `.panel-grid-card__handle`.
- **Owner opening their own link:** non-GET requests were only `PATCH /api/users/me/preferences` (from the app-wide theme sync) and `POST /api/events`. There was no layout `PATCH`, no `layout/repair` and no `/submit`.
- **Form preview:** Note and Quantity are `disabled`. Forced clicks plus typing plus Enter produced no request.
- **Hostile markdown:** `<script>` renders as literal text, exactly as on the signed-in card. There are no `javascript:` hrefs and `window.__p` stays undefined.
- **Console:** no errors or warnings in any of the 4 contexts.
- **Light/dark parity:** good. The cards use the `.panel-grid-card` surface, border and radius tokens in both themes.
- **Grid key (executor's post-gate D3 change):** keying `Responsive` by `dashboardId` only is sound. Layout and width arrive in the same render here, unlike the signed-in late-layout case that motivated the HEL-1835 breakpoint key. The md→lg resize was covered by the evaluator's and e2e's 1700 px pass.

### Verdict: REFUTE

### Change Requests

1. **The phone stack still ignores the stored arrangement, the ticket's core complaint, and diverges from the signed-in phone stack.**
   - **Where:** `PublicDashboardViewerPage.tsx`, in the `<ul className="public-dashboard-viewer__panel-list">` branch of `PublicDashboardContent`. It maps `panels` in API order.
   - **What I saw at 375 px:** the API returns `divider, text, form, image, markdown, output`, newest first. The public phone therefore shows Rule, Plain, Intake, Photo, Story, Orders: the exact reverse of the owner's arrangement.
   - **What the signed-in phone does:** it shows Orders, Story, Intake… in stored xs order, because `MobilePanelStack` orders through `orderPanelsForMobileStack(panels, resolveDashboardLayout(panels, layout).xs)` (`MobilePanelStack.tsx:151-153`).
   - **Evidence:** `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.sk-ev/public-anon-light-375.png` versus `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.sk-ev/signedin-light-375.png`.
   - **Why it blocks:** the ticket says "every shared dashboard loses its arrangement", and AC1 says "from the dashboard's stored layout at each breakpoint, matching the signed-in grid". The signed-in "phone stack" that phones keep is layout-ordered. The xs breakpoint is now in the client's hands and still ignored, so a shared news board on a phone reads bottom-up.
   - **Fix:** order the stack's panels with the same `orderPanelsForMobileStack` over the resolved xs layout. Keep the `<ul>` markup and `PublicPanelBody`. Add a jest case asserting the stack order follows xs `y`/`x` and not API order, and show it red first. Add a 375 px order assertion to `e2e/hel1587-public-viewer-layout.spec.ts`.
2. **Output-panel provenance should sit in the card's title row, not on a row of its own** (the open judgment call).
   - **What the public viewer does now:** both the grid card and the stack item put a lone `(i)` icon on its own full-width row between the title and the table, `.public-dashboard-viewer__provenance-row` in `PublicPanelBody.tsx`. That spends about 30 px of every fixed-height output cell on one right-aligned icon; see `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.sk-ev/public-anon-light-1440.png`, the Orders cell.
   - **What the signed-in app does:**
     - the phone stack puts provenance at the right end of the title row (`signedin-light-375.png`, the "Orders" header);
     - the desktop card puts it in the footer.
   - **Why the current placement no longer fits:** it came from HEL-1207 A1, "no card/footer exists here". This change now introduces a card with a title row whose right side is empty.
   - **Fix:** render the `ProvenanceTrigger` at the trailing end of the public card's title row, in both the grid card and the stack item. That mirrors the signed-in phone header. Keep the title as the `h2`, with the trigger beside it and not inside it.
   - **No footer:** I accept the public card having no footer. The kind label and "Updated" stamp are owner-facing metadata, and dropping them is reasonable for a viewer.

### Non-blocking notes
- `ImagePanel`'s empty state reads "Open panel settings to configure." That is an edit instruction shown to anonymous viewers. It is a follow-up candidate; the evaluator noted it too.
- The pre-existing public `config.dataSourceId` exposure should still be filed at Delivery, as the design commits.
- Test users I created (`1e94fb95-…`, `a34e32a9-…`) were deleted by exact id with `buildUserDeleteSql`; a count afterwards was 0. The lane servers were stopped with `stop-servers.sh` (`STOPPED ports=7019,9926`).
