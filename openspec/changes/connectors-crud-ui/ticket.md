# HEL-824: Connectors page: CRUD UI where the raw credential is entered and shown exactly once

## Description

**Naming settled 2026-08-25:** the entity is a **Connector** (host + credential). Any occurrence of "Connection" below means **Connector** — except "connection-test", which refers to the existing HEL-480 affordance and keeps its name.

Child 2 of HEL-820. **Depends on child 1.**

### Scope

A new **Connectors** page — the surface where a user creates and manages saved credentialed hosts (REST: base URL + API key; SQL: host, username, password). REST is the first and only kind at launch; the page must not hardcode that assumption, since SQL, S3, GCS, BigQuery, and Google Sheets connectors are all planned in v1.9.

* List / create / edit / delete Connectors
* Create form driven by connector kind: base host/URL, auth type (none / bearer / api key with header-or-query placement — mirroring the existing `RestApiAuth` union), and the credential itself
* Reuse the existing **connection-test** affordance (HEL-480 shipped `POST /api/sources/test`, and `TestConnectionAffordance.tsx` exists) rather than building a second test mechanism
* Show which sources depend on a Connector — this is what makes deletion safe and is the main reason the page earns its place over a modal
* Nav entry alongside Sources

### The credential UX is the point of this ticket

The raw key is entered **once**. After creation it is never displayed again — no reveal button, no "show" toggle, because the backend genuinely cannot return it (child 1 guarantees this). The UI must make that legible rather than looking broken: show a masked placeholder and a **Replace credential** action, not an empty field that implies the value was lost.

Rotation — replacing the credential on an existing Connector without recreating it and re-pointing every dependent source — must work.

### Design constraints

`DESIGN.md` is binding. Use existing shared primitives (`shared/ui/`) rather than hand-rolling: this is a new page and the temptation to build bespoke chrome is exactly what HEL-440 and HEL-725 exist to undo.

Mobile: interactive controls meet the 44px floor. HEL-813 landed a rendered-geometry guard (`e2e/support/touchTargetProbe.ts`); **add this page to its sweep** rather than leaving it uncovered — a brand-new page not in the sweep is how the eighth touch-target incident happens.

## Acceptance Criteria

- [ ] Connectors can be created, listed, edited, and deleted from the UI
- [ ] The credential is entered once; no read path or UI affordance can reveal it afterwards
- [ ] Credential rotation works without recreating the Connector or breaking dependent sources — demonstrated
- [ ] Dependent sources are visible from the Connector, and deletion behaves per child 1's decision (block or warn), surfaced clearly rather than failing opaquely
- [ ] Connection-test works from this page, reusing the existing endpoint
- [ ] The page is covered by HEL-813's touch-target sweep at 430px and 768px
- [ ] Built from shared primitives; DESIGN.md tokens throughout, no literal px or ad-hoc colors

## Out of Scope

Source authoring against a Connector (child 6). REST source form parity / retiring the dual-support create path (HEL-827), body/response shaping (HEL-826), agent/MCP surface (HEL-828) — all deferred. HEL-829's in-chat credential capture is out but will build on this page's patterns — keep the credential-entry component reusable rather than welded into the page.

## Additional Context (from run brief)

- Backend already on main (verified in premise-validation.md): HEL-536 (encrypted credential storage substrate), HEL-821 (Connector domain model + `/api/connectors` CRUD via `ConnectorEntityRoutes`/`ConnectorEntityService`/`ConnectorRepository`), HEL-822 (sources reference Connectors; real `dependentCount` query blocks deletion; dual-support legacy bare-`url` create path synthesizes a visibly-flagged implicit Connector; `implicit` field confirmed server-owned on both POST and PATCH), HEL-823 (`{{name}}` request templating).
- `/api/connectors` (HEL-821 CRUD) is distinct from `/api/connector-types` (HEL-825, kind metadata).
- Implicit/synthesized Connectors will appear in the list (flagged via `config.implicit: true` in `ConnectorAuthShape`) — must be presented deliberately (hidden vs. visually distinguished vs. plain), reasoning recorded in design.md.
- Deletion conflict surfaces `ServiceError.Conflict("ConnectorHasDependents: ...")` from `ConnectorEntityService.delete` — must be surfaced with a clear explanation, not a bare failure.
- No-auth Connector creation (`authType: "none"`, empty credential) is confirmed supported server-side — the create form must not block this case.
- Follow PAT precedent (`frontend/src/features/settings/ui/ApiTokensSection.tsx`) for the shown-once credential reveal pattern.
- Register any new RLS-protected table in `RlsPolicyGuardSpec`'s allowlist in this PR if applicable (HEL-842) — likely N/A, no new tables expected (pure UI ticket).
- `sbt test` shows ~13 pre-existing failures from missing `CONNECTOR_MASTER_KEY` in a fresh worktree `.env` — environmental, confirm shape, do not let it mask real failures.
