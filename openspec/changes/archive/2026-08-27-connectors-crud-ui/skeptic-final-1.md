## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Ground truth: worktree HEAD `55d37572`, live app at `http://localhost:6256` /
backend `9163` (`assert-phase.sh servers` → `PASS`). All findings below were
derived from the running app, the raw diff, and measured geometry — not from
`evaluation-1.md` / `evaluation-2.md`, which I read only as claims.

### What I verified (with evidence)

**Gates re-run fresh by me**

- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npx eslint src/features/connectors src/shared/chrome src/features/sources/ui/TestConnectionAffordance.tsx --max-warnings=0` → exit 0.
- `npx jest --testPathPatterns="connectors|chrome"` → `Test Suites: 262 passed`, `Tests: 2865 passed`.
- `sbt "testOnly ...ConnectorRepositorySpec"` → `Tests: succeeded 16, failed 0`, `[success]`.
- HEL-813 surface 7, run **twice** (it was flaky in cycle 1, so a single green was not enough):
  `DEV_PORT=6256 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts -g "surface 7"`
  → `2 passed` at 430px and 768px, both runs. **Stable — the cycle-2 fix holds.**

**The credential contract (the security core of this ticket) — HOLDS**

Created a connector through the UI with canary `SKEPTIC-CANARY-SECRET-9f3a2b`, then
probed every read and write path's raw response body from the page context:

| Path | Result |
| --- | --- |
| `GET /api/connectors` (list) | 200, canary **absent**; keys are exactly `baseUrl/config/createdAt/dependentCount/id/kind/name/ownerId/updatedAt` — structurally no credential field |
| `GET /api/connectors/:id` | 200, canary **absent** |
| `POST /api/connectors` (201) | create credential **not echoed** in the response body |
| `PUT /api/connectors/:id/credential` (200) | rotated credential **not echoed** |
| list re-read after rotation | none of the three canaries present |
| `PATCH /api/connectors/:id` with `credential` | **400** `"Credential rotation is not supported via update; got forbidden field(s): credential"` |
| `PUT .../credential` with `"   "` | **400** `"credential is required"` |

Also confirmed `implicit` is genuinely server-owned: I POSTed `config: { implicit: true }`
and the stored/returned config came back `"implicit": false`.

UI side: create field is `type="password"` (never rendered); the Edit modal shows a
masked `••••••••` + "Replace credential" with hint "The credential is never shown after
creation" — no reveal affordance anywhere (screenshots `hel824-03`, `hel824-04`).

**Rotation — WORKS.** Rotated live through the UI (`SKEPTIC-UI-ROTATE-5b2e`) → success
toast, returns to the masked state, `updatedAt` advanced (`hel824-05`). The backend
integration evidence is **real, not tautological**: `ConnectorRepositorySpec`'s rotation
tests assert a *specific new plaintext* through `decryptForUse`, assert the *old*
credential id is unresolvable, and include a fail-closed no-master-key case and a
cross-owner not-found case. It would fail if rotation didn't actually repoint.

**Dependent count** is shown proactively on every row ("0 sources" / "1 source"),
independent of any delete attempt — confirmed in the live list.

**Implicit connectors** are badged "Auto-created" via `StatusChip` and never hidden.

**Connection-test** appears only on saved rows, never in the create form (verified
visually, `hel824-01`), and returned 200 live. Note: it posts the REST config *flat*
(`{ connectorId }`), not `{ type, config }` — that is the pre-existing HEL-480
convention documented at `dataSourceService.ts:228-238`, and is correct as implemented.
(My first hand-built `{ type, config }` probe 400'd; that was my error, not the code's.)

**DESIGN.md 44px claim — verified true.** `DESIGN.md:200` explicitly documents a literal
`44px` min-height tap-target floor as the sanctioned exception, with precedent in
`PanelDetailModal.mobile.css` and `PanelList.css`. Everything else in the two new
stylesheets uses `--space-*`/`--text-*`/`--app-*`/`--control-md` tokens; no ad-hoc colors.

**Light/dark parity** is clean — toggled to light at 1440px, all tokens resolve, nothing
hardcoded-dark (`hel824-10`).

**Console** — the only errors present were from my own deliberate 403/400 probe requests;
the app itself produced none.

### Verdict: REFUTE

The security contract — the thing this ticket exists for — is genuinely sound. What
fails is the layout, and it fails in a way that defeats one of the ticket's own
acceptance criteria. I reproduced each item below at least twice, at more than one
viewport, with measured geometry rather than screenshot impressions.

### Change Requests

1. **The mobile stacked-card layout never actually applies — it is dead CSS, and the
   page overflows 397px horizontally at 430px.**
   `frontend/src/features/connectors/ui/ConnectorsPage.css:182-188` sets
   `.connectors-page__table tr { display: block; }` (specificity 0,1,1), which **overrides**
   `.connectors-page__row { display: flex; flex-direction: column; }` at `:194-200`
   (specificity 0,1,0). No rule anywhere sets `.connectors-page__td { display: block; }`.
   Probe-confirmed via computed style at 430px:
   `{ rowDisplay: "block", rowFlexDirection: "column", tdDisplay: "table-cell" }` —
   the row is not a flex container and the cells are still `table-cell`, so they lay out
   side-by-side in an anonymous table row instead of stacking.
   Measured: `#app-main-content` `scrollWidth 827` vs `clientWidth 430` (**397px overflow**),
   with `thead` hidden so the horizontally-overflowing values are also unlabelled.
   See `hel824-09-mobile-430-overflow.png` — name/kind/URL/credential run off the right
   edge with large empty vertical gaps between rows.
   Fix: raise the specificity of (or restructure) the row rule and add an explicit
   `display: block` for `.connectors-page__td` inside the 768px query, then re-verify the
   stacked layout by asserting `main.scrollWidth === main.clientWidth` at 430px, not by
   eye. Note the HEL-813 sweep will *not* catch this — it measures button geometry only,
   and it passes today on a one-short-row fixture.

2. **The blocked-delete explanation is rendered off-screen and cannot be read.**
   `ConnectorsPage.tsx:166-170` renders the `InlineError` inside
   `.connectors-page__td--actions`, which is `white-space: nowrap`
   (`ConnectorsPage.css:68-73`). The 81-character message becomes a single 476px
   non-wrapping block. Measured, on the same blocked delete:
   - 1440px: error rect `right: 1472` vs viewport `1440` — clipped past the viewport edge.
   - 1100px: error rect `right: 1472`, `#app-main-content` overflow **384px**; the entire
     actions column is off-screen (`hel824-08-overflow-1100.png`).
   - 430px: overflow **734px**.
   This directly contradicts the AC "deletion … surfaced clearly rather than failing
   opaquely" — the user sees a delete do nothing and the reason is literally not on
   screen. Fix: allow the error to wrap (don't inherit `nowrap`), and render it outside
   the nowrap actions cell — e.g. a full-width row beneath, or a toast — so its width
   can never drive table width.

3. **The blocked-delete message ignores the dependent count and leaks a raw internal
   identifier.** The text actually shown is
   `"ConnectorHasDependents: this Connector is still referenced by a dependent resource"` —
   the backend's raw error-code prefix, and a generic "a dependent resource" rather than
   the count the row already displays. The ticket requires the blocked delete "explains
   why using that same count". `connectorsSlice.ts:99-104` has a good fallback
   ("This connector is still referenced by a dependent source.") but `extractErrorMessage`
   prefers the server string, so the fallback never renders. Fix: on a 409, construct the
   user-facing message client-side from `connector.dependentCount`
   (e.g. "Still referenced by 1 source. Repoint or delete it first."), and never surface
   the `ConnectorHasDependents:` token.

4. **"delete anyway?" is a false affordance — the override it offers does not exist.**
   `ConnectorsPage.tsx:131-133` labels the confirm
   `` `Referenced by ${n} source${…} — delete anyway?` ``, but
   `ConnectorEntityService.delete` returns `ServiceError.Conflict` **unconditionally**
   whenever `dependentCount > 0` — there is no force path. Confirmed live: clicking
   Confirm on a 1-dependent row returns 409 every time. Fix: when `dependentCount > 0`,
   don't offer a confirm that cannot succeed — either disable Delete with an explanatory
   tooltip/label, or change the copy to state up front that it must be unreferenced first.

5. **Row actions are off-screen at the canonical 1100px breakpoint even in the ordinary
   list state (no error involved).** Freshly loaded at 1100px:
   `#app-main-content` `scrollWidth 1058` vs `clientWidth 860` (**198px overflow**), first
   Delete button `right: 1286` vs viewport `1100` → not visible without horizontal
   scrolling. `DESIGN.md:264` lists **1440 / 1100 / 768 / 430** as the canonical
   breakpoints and the page has no styling at all between 768 and 1440. At 1440 it is
   clean (0 overflow), so this is specifically the untreated mid-range. Fix: add a
   1100px treatment (drop/collapse a column, allow the Base URL cell to wrap, or move row
   actions into an overflow menu) and verify no overflow at each canonical breakpoint.

### Non-blocking notes

- `ConnectorCredentialField.tsx:115` builds the rotate label via
  `credentialLabel.toLowerCase()`, producing **"New api key value"** — the acronym gets
  lowercased. Visible in `hel824-04`. Use a distinct label string per mode.
- The create-form hint "Shown once. It won't be displayed again after saving." is
  slightly inaccurate: the input is `type="password"`, so the value is never *shown* at
  all. "Entered once" would be truthful and equally reassuring.
- The rotate modal states the irreversibility twice in near-identical words (the Modal
  `description` and the field `hint`). One is enough.
- `ConnectorRepositorySpec`'s "dependent rest_api source resolves the NEW plaintext" test
  inserts the source but then resolves via `repo.findByIdInternal(connector.id)` directly,
  never reading the source row's own `connectorId` back. It proves the connector-side
  repoint (which is the real risk) but stops one hop short of traversing the source.
  Reading `connectorId` off the persisted source would close that gap cheaply.
- The "Auto-created" chip sits inside the Name cell and squeezes long names to three
  lines while a wide empty gap sits between Dependents and the actions column — the table
  has spare horizontal room it isn't using (visible in `hel824-06`/`hel824-10`).

Screenshots referenced above are in this session's scratchpad / `.playwright-mcp/`
(gitignored); none were written to the repo root.
