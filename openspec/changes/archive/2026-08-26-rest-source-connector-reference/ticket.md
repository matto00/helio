# HEL-822: REST source references a Connector (endpoint, method, params, body) + migration for existing sources

## Description

**Naming settled 2026-08-25:** the entity is a **Connector** (host + credential). Any occurrence of "Connection" below means **Connector**; the field is `connectorId`.

Child 3 of HEL-820. **Depends on child 1 (Connector model) — HEL-821, now on main.** Part of the spine.

Change `RestSource` so the host and credential live on a referenced Connector and the source carries only the request-specific parts that make it invokable.

Today (`backend/src/main/scala/com/helio/domain/model/model.scala`):

```scala
final case class RestApiConfig(
    url: String,
    method: String = "GET",
    auth: RestApiAuth = RestApiAuth.NoAuth,
    headers: Map[String, String] = Map.empty
)
```

Target shape, roughly — refine during design:

* `connectorId` — the credentialed host
* `endpoint` — path appended to the Connector's base host
* `method`
* `queryParams`
* `body` / payload shape (new — see child 5, HEL-826, out of scope here beyond a minimal placeholder field)
* per-source `headers` (merged over the Connector's, with a documented precedence rule)

`auth` moves off the source entirely.

## Migration is the risk in this ticket

Existing REST sources carry inline `url` + `auth` + `headers`. They must keep working. Decide deliberately between:

* **(a)** Auto-create a Connector per existing source from its host+auth, then rewrite the source to reference it. Dedupe by host+credential, or accept duplicates.
* **(b)** Keep the inline shape supported as a legacy variant alongside the new one.
* **(c)** Require manual migration.

(a) is probably right but it means a data migration that moves live credentials between columns while encrypting them — get this reviewed carefully. (b) leaves two code paths forever, which is how the `snapshotId`/`id` fallback in HEL-626 happened.

Whichever is chosen, existing sources must continue to fetch successfully **after** migration — proven by running a real pre-existing source, not by inspecting rows.

## Also in scope

Update the wire contract end to end: `RestApiConfigPayload` and its `toDomain`/`fromDomain` (`DataSourceProtocol.scala`), `DataSourceConfigCodec.decodeRest`/`encodeRest`, and `CreateSourceRequest`.

Note the research found no REST-source JSON Schema under `schemas/` — the wire contract appears to live only in Scala formats plus `openspec/specs/rest-api-connector/spec.md`. Verify that; if true, decide whether this change should add one, since `schemas/` is meant to be the contract source of truth.

## Acceptance Criteria

- [ ] A REST source references a Connector and supplies endpoint/method/params/body
- [ ] No credential remains on the source
- [ ] Every pre-existing REST source still fetches successfully after migration — demonstrated by running real sources, listed by id, not by inspecting the table
- [ ] Header precedence (Connector vs source) is documented and tested
- [ ] The migration is reversible, or its irreversibility is stated explicitly with reasoning
- [ ] Wire contract updated in all four places above; `schemas/` question resolved either way

## Out of Scope

Templating (HEL-823), the Connectors CRUD UI (HEL-824), REST body/response shaping (HEL-826), form parity (HEL-827), and the agent/MCP surface (HEL-828). Record out-of-scope findings for the human to triage; do not fix them, do not file tickets.

## Known Open Item — Do Not Regress

HEL-842 (filed 2026-08-26) covers `RlsPolicyGuardSpec` missing `audit_events` and `connector_credentials` in its allowlist. If this ticket's migration adds any new RLS-protected table, add it to that allowlist in THIS PR — the spec's stated same-PR contract has now been broken twice.

## The dependentCount Seam (Highest-Risk Item)

HEL-821 shipped `ConnectorRepository.delete`/`ConnectorEntityService.delete` with a `dependentCount: ConnectorId => Future[Int]` collaborator, default-stubbed to always return 0 (see `ConnectorRepository.scala:127`, `ConnectorEntityService.scala:19,81`), explicitly as a seam for HEL-822. Delete semantics are **block (409 ConnectorHasDependents)**, not cascade (HEL-821 design.md Decision 4) — a Connector delete must be rejected when a REST source still references it. This ticket must supply the real dependent-source-counting query as the `dependentCount` implementation once the referencing column (`connectorId` on `data_sources`/`RestApiConfig`) exists. A stub that silently stays zero makes this guard permanently unreachable in production.

## Migration Risk — Explicit Requirements

- Existing REST data sources today carry base URL + plaintext API key inline in `data_sources.config` (opaque JSONB, V4 era). Decide deliberately between auto-migrate-to-synthesized-Connectors vs. dual legacy support vs. manual migration; record the reasoning explicitly, including backward-compatibility implications.
- If credentials are migrated, they move from plaintext into the encrypted `connector_credentials` store (HEL-536). This is a data migration touching secrets: must be idempotent, must not lose or corrupt a credential, and must be proven via a real round-trip on real rows (not fixtures only).
- Handle explicitly: a source whose config has no credential, a malformed one, or one already migrated (idempotency / re-run safety).
- Design against the repo's known silent-corruption defect class (see HEL-814, HEL-671): decoders that tolerate a mismatched config and quietly produce wrong values. No silent fallback/default on a shape mismatch — fail loudly or reject explicitly.

## Session Notes

- Model override for this run: concertino-skeptic runs on opus; orchestrator/executor/evaluator/auditor run on sonnet.
- Escalate the auto-migrate-vs-dual-support decision to the human if it resolves to a product question (breaking existing users) rather than a purely technical one.
