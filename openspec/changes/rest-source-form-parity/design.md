## Context

Verified against main `f73cee3a` (see `.concertino/runs/HEL-827/evidence/premise-validation.md`,
and skeptic round-1 report `skeptic-design-1.md`): HEL-826 already added
method/body/bodyContentType/rootSelector to `RestApiForm.tsx`. Client `RestApiConfigBody`
(`dataSourceService.ts:32-44`) declares `url?`, `connectorId?`, `method?`, `headers?`, `rootSelector?`,
`body?`, `bodyContentType?`, `auth?` — it does **not** yet declare `endpoint`, `queryParams`, or
`parameters`, all three of which the backend already accepts. Backend
`RestApiConfigPayload`/`RestApiConfig` supports `connectorId`, `endpoint`, `queryParams:
Map[String,String]`, `headers`, `body`, `bodyContentType`, `rootSelector`, `parameters` — confirmed
via `DataSourceProtocol.scala`/domain `model.scala`. No backend work is expected; this is a UI-only
change, but the client wire type must be extended to carry `endpoint`, `queryParams`, and
`parameters` — it cannot express the composed request as-is today.

**`connectorId` and `url` are mutually exclusive server-side, and the path travels as `endpoint`,
not `url`, on the `connectorId` path.** `SourceService.createRest` (`:80-88`) hard-400s if both
`connectorId` and `url` are present, or if neither is; `RestApiConfigPayload.toDomain`
(`DataSourceProtocol.scala:356`) reads the path from `p.endpoint.getOrElse("")` only on the
`connectorId` branch. Once a Connector is selected, the "URL" input becomes a relative **endpoint
path** field (label: "Endpoint path", placeholder `/v1/accounts`), with the selected Connector's
`baseUrl` shown as a read-only prefix beside it so the composed URL stays legible. `url` remains
sent, unchanged, only for the (now UI-unreachable but still backend-supported) bare-`url` shape.

**Three call sites independently build the REST config today**, not one:
`RestApiForm.buildConfig()` (test-before-save), `AddSourceModal.handlePreview` (`:110-144`,
schema inference), and `AddSourceModal.handleSubmit`/`handleCreate` (`:148-170`, create). All three
duplicate the same field list. This change must introduce one shared composer used by all three, or
"Preview schema" and "Create" silently keep emitting the old bare-`url` shape while only "Test
connection" is updated.

**`AddSourceModal.tsx` is already 534 lines**, already past `CONTRIBUTING.md`'s ~250-line soft
budget (`:24`) before this change adds Connector/queryParams/headers/template-parameter state to it.

**There is no REST source edit form.** `grep -rl RestApiForm frontend/src` returns only
`AddSourceModal.tsx` (+ its test) — `RestApiForm` is create-only. Any retirement-verification step
must exercise create/fetch/pipeline-run, not "open the edit form."

**`CreateConnectorModal` cannot currently return the Connector it creates.** Its props are
`{ onClose }` only (`CreateConnectorModal.tsx:18-22,64-69`); on success it dispatches
`createConnector`, toasts, and calls `onClose()` with no created-entity handback.

**The MCP tool's `auth` field is already dead on the server.** `SourceService.createRest:80-81`
400s on any REST create carrying `auth`, regardless of caller — this predates this ticket (HEL-822).
So the surviving reason to keep backend bare-`url` acceptance is the MCP tool's *no-auth* bare-`url`
call shape only, not its `auth` shape (see Decision 3).

**The boot-time migration does not cover every legacy row.** `RestSourceConnectorMigration`
(`:14-34`) converts legacy rows to `connectorId` rows on every boot, but its own header comment
enumerates four branches: only branch 2 (legacy + owned) actually migrates; branch 3 (ownerless,
`owner_id IS NULL`) and branch 4 (malformed) are logged at `error` and skipped, remaining
legacy-shaped indefinitely.

`RestSourceConnectorMigration` (HEL-822) runs at boot and idempotently converts every legacy
bare-`url`/`auth`/`headers` `rest_api` row into a `connectorId`-referencing row, synthesizing a
1:1 Connector per source. This means **every existing source in a running deployment is already
migrated to the `connectorId` shape by the time this ticket's UI ships** — the retirement risk is
not "will old rows break" (the migration already handles that, and is independent of this ticket)
but "will the *create* path still work for whatever still calls it with a bare `url`."

**Enumeration — MCP/agent surface vs. UI surface (acceptance criterion 1):**

| Field | MCP tool (`create_rest_data_source`, verified in-repo at `helio-mcp/src/tools/write.ts:132-139`) | Backend model (`RestApiConfig`, verified) | UI form (pre-this-change) | UI form (post-this-change) |
|---|---|---|---|---|
| name | yes | n/a (source-level) | yes | yes |
| url (bare) | yes | yes (legacy path) | yes (only path) | no (retired from UI) |
| connectorId | no | yes | no | yes (new) |
| endpoint | no | yes (required on the `connectorId` path) | no | yes (new — replaces "URL" input once a Connector is selected) |
| method | yes | yes | yes (HEL-826) | yes |
| queryParams | via URL only | yes, `Map[String,String]` | no | yes (new) |
| headers | yes | yes | no | yes (new) |
| auth (bearer/api_key/none) | accepted by the tool's schema, but **rejected by the server with a 400 on any REST create since HEL-822** (`SourceService.createRest:80-81`) — already dead on main, not something this ticket changes | via Connector credential | no (never — moved to Connector) | no (by design — Connector) |
| body/bodyContentType | no | yes | yes (HEL-826) | yes |
| rootSelector | no | yes | yes (HEL-826) | yes |
| template parameters (`{{name}}`, wire field `parameters: Record<string,string>`) | no | yes (HEL-823) | no | yes (new) |

Net: after this change the UI covers strictly more than the MCP tool as currently documented
(queryParams-as-fields, template parameters, Connector reuse), and everything the MCP tool covers
via inline `auth` is covered structurally via Connector selection instead. The one thing the UI
will no longer offer that the *legacy* MCP tool's bare shape offers is direct inline auth entry —
intentional, per ticket scope ("Auth is not a field here any more").

## Goals / Non-Goals

**Goals:**
- Add Connector picker (+ inline create via `CreateConnectorModal`, extended with an `onCreated`
  callback) to REST source authoring.
- Add an `endpoint` path field (replacing "URL" once a Connector is selected), queryParams, headers,
  and template-parameters editors, reusing shared primitives.
- Introduce one shared REST-config composer used by all three existing call sites (test, preview,
  create) so every save path emits the same, current shape.
- Stop the UI from creating sources via the bare-`url` (no-`connectorId`) shape.
- Keep both `RestApiForm.tsx` and `AddSourceModal.tsx` under `CONTRIBUTING.md`'s file-size budget by
  splitting deliberately, including lifting REST field state out of `AddSourceModal.tsx`.

**Non-Goals:**
- No backend changes: `connectorId`/`endpoint`/`queryParams`/`headers`/`parameters` are already
  accepted server-side (HEL-822/823). This ticket extends the *client wire type* and the UI to use
  fields the backend already accepts — it does not change backend behavior.
- No removal of backend bare-`url` acceptance (see Decision 3 below) — MCP-side changes are child 7
  (HEL-828), explicitly out of scope here.
- No change to `RestSourceConnectorMigration`'s boot-time behavior.
- No fix for `splitUrl`'s duplicate-query-key collapse or spray-json's silent-unknown-field-drop —
  both confirmed still present, both being filed as separate follow-up tickets (per ticket text).
- No REST source edit form — none exists today (`RestApiForm` is create-only); out of scope to add
  one. Retirement verification (Decision 4) is proven via create/fetch/pipeline-run, not editing.

## Decisions

**Decision 1 — Connector picker component.** Reuse `frontend/src/features/connectors` state
(`connectorsSlice`) and `connectorEntityService.fetchConnectors()` to list Connectors. Extend
`CreateConnectorModal` with an optional `onCreated?: (connector: Connector) => void` prop
(backwards-compatible — `ConnectorsPage`'s existing usage passes nothing and is unaffected), called
just before `onClose()` on successful creation, so the picker can select the new Connector without
a racy re-read of `connectorsSlice`. Because `AddSourceModal` is itself a `Modal`, launching
`CreateConnectorModal` from inside it is a modal-over-modal stack — per DESIGN.md, the inner modal
takes focus and traps it; on close (`onCreated` then `onClose`), focus returns to the Connector
picker control that opened it, and all other REST form field values already entered are preserved
(state lives in the lifted `useRestSourceForm` hook, Decision 5, not remounted by the child modal).
No new credential-entry UI is built — `ConnectorCredentialField`'s shown-exactly-once contract is
inherited as-is via `CreateConnectorModal`, never reimplemented.

**Decision 2 — queryParams/headers as key/value list editors.** Represented client-side as
`{ key: string; value: string }[]` (ordered array, not a plain object) to avoid the exact
duplicate-key collapse `splitUrl` has server-side — converted to `Map[String,String]` only inside
the single shared config composer (Decision 1a below), mirroring HEL-826's design.md invariant:
decode/collect stays total and lossless in the UI layer; validation/lossy-collapse happens only
where a request is actually built. A duplicate key entered by the user is visually flagged
(non-blocking) rather than silently dropped in the editor itself — the collapse still happens
server-side (deferred, filed separately) but the UI does not compound it by pre-collapsing.

**Decision 1a — single shared REST-config composer.** `RestApiForm.buildConfig()` (test),
`AddSourceModal.handlePreview` (`:110-144`), and `AddSourceModal.handleSubmit`/`handleCreate`
(`:148-170`) each independently rebuild the REST config today. Introduce one function —
`buildRestSourceConfig(formState): RestApiConfigBody` — owned alongside the lifted
`useRestSourceForm` hook (Decision 5) and used by all three call sites, so `endpoint`, `connectorId`,
`queryParams`, `headers`, and `parameters` reach every one of test/preview/create identically. No
call site is left emitting the old bare-`url`-only shape.

**Decision 3 — retire only the UI's bare-`url` create path; leave backend acceptance in place.**
Self-approved (not escalated). Corrected rationale (round-1 skeptic CR7: the MCP tool's `auth` field
is already dead — `SourceService.createRest:80-81` 400s on any REST create carrying `auth`,
regardless of caller, since HEL-822, independent of this ticket): the surviving reason to keep
backend bare-`url` acceptance is the MCP tool's still-live **no-auth** bare-`url` call shape
(`create_rest_data_source` posts `url`/`method`/`headers` inline, no `connectorId` — that tool is
unmodified by this ticket per its explicit "MCP-side changes are child 7" scope line), not its
`auth` shape, which the server already rejects. Removing backend bare-`url` acceptance would still
be a genuine breaking API-shape change with unverified blast radius on HEL-828 (MCP integration, not
yet built). The UI-only retirement is low-risk and fully reversible (a form change, no data-shape or
API-contract change) and satisfies the ticket's actual ask ("the UI can currently author less than
an agent can" — an authoring-surface parity problem, not an API-surface removal problem). If a
future ticket (likely HEL-828 or a v1.8 cleanup) wants to remove backend bare-`url` acceptance
entirely, that is its own escalation-worthy call once the MCP tool itself is migrated to
`connectorId` — out of scope here.

**Decision 4 — proving no orphaned sources.** No REST source edit form exists (Non-Goals) — the
verification is create/fetch-based, not edit-based. Against a dev DB with at least one pre-existing
legacy-created source: (a) confirm `RestSourceConnectorMigration` has already converted it to a
`connectorId` row (true today, independent of this change, for **owned, well-formed legacy rows**
only — the migration's own four-branch design skips ownerless (`owner_id IS NULL`) and malformed
rows, which remain legacy-shaped and un-authorable from the updated UI; acceptable, since those rows
were already un-migrated and inert before this ticket, and this ticket does not touch migration
behavior); (b) confirm that source's schema preview and an actual pipeline run against it still
succeed after this change ships, proving the now-`connectorId`-shaped row is unaffected by retiring
the UI's *create* path. No new migration code needed — this is a verification task.

**Decision 5 — file-size budget.** Both `RestApiForm.tsx` (137 lines) and `AddSourceModal.tsx`
(534 lines, already over `CONTRIBUTING.md`'s ~250-line soft budget before this change) need
splitting. Introduce a `useRestSourceForm` hook (`frontend/src/features/sources/hooks/`) that owns
all REST field state (url/endpoint/connectorId/method/queryParams/headers/body/bodyContentType/
rootSelector/parameters) plus `buildRestSourceConfig()` (Decision 1a) — `AddSourceModal` calls the
hook and passes its state/setters to `RestApiForm`, removing that state from `AddSourceModal.tsx`
directly rather than growing it further. `RestApiForm.tsx` itself splits into an orchestrating
component plus extracted `ConnectorSelectField.tsx`, `KeyValueListField.tsx` (shared between
queryParams and headers), and `TemplateParametersField.tsx` under
`frontend/src/features/sources/ui/forms/`. `KeyValueListField` is written generically enough to be a
genuinely shared primitive, not a one-off.

## Gate-Chain Implications Checklist

Not applicable — this change touches only `frontend/src/features/sources/**` and
`frontend/src/features/connectors/**` (consumption only, no modification) React/TS source. No
`.husky/**` file or script a pre-commit hook invokes is touched.

## Risks / Trade-offs

- **Risk:** an ownerless or malformed legacy `rest_api` row (migration branches 3/4, Decision 4) is
  never converted and has no UI path to become authorable again. **Mitigation:** this is pre-existing
  behavior, unrelated to this ticket's retirement of the *create* path — those rows are already
  inert today, and this ticket does not change their status. No user-visible regression is
  introduced by this change; if these rows need remediation, that is a separate ticket.
- **Risk:** template parameters typed into the endpoint/queryParams/headers before a Connector is
  selected are not resolved (`RestApiConnectorDriver.scala:336-342`: templating only resolves on the
  `connectorId` path) — sent literally if a save were somehow possible without a Connector.
  **Mitigation:** Decision 1/Non-Goals already require a Connector before save is enabled (tasks
  3.3), so this state is unreachable; the spec (Requirement 2) states this explicitly so a reviewer
  can verify the UI actually disables save, not just that the backend would reject it.
- **Trade-off:** Decision 3 leaves an asymmetry (UI stricter than API) — accepted as the smaller risk
  given HEL-828 is unbuilt and its dependency on the legacy no-auth bare-`url` shape is unverified
  from here.
