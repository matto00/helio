# HEL-366: Add resource tagging / namespacing with one-call bulk teardown for a workflow's resources

## Context

`helio-news` identifies and tears down each run's resources by **string-prefix scanning names** — brittle, and it leaks Helio implementation details into the client. `HelioClient.cleanup_news_resources()` (`~/Development/helio-news/news/helio_client.py`) walks the whole workspace context, matches data sources whose name starts with `news-` and contains `-src-`, deletes each, then re-reads and deletes DataTypes whose name starts with `news_out_` **or** matches the `news-…-src-` companion pattern. The `_type_name()` helper in the same file even bakes a `news_out_` prefix into every output DataType name purely so cleanup can find it later, and stamps a board prefix in to avoid cross-board name collisions. This is a naming convention doing the job a first-class grouping primitive should.

We want to group a workflow's sources / pipelines / DataTypes (and optionally dashboards) under a tag or namespace, and tear them all down in one call — no name scanning.

## Scope

* **Tag / namespace model** — add an optional `tags` (or single `namespace`) attribute to the resources an agentic workflow creates: data sources, pipelines, DataTypes (and consider dashboards). New Flyway migration (next is V60+, `backend/src/main/resources/db/migration/`) adding the column(s)/join table. Owner-scoped, respecting RLS.
  * Accept tags/namespace on the create paths: `DataSourceService`, `PipelineService`, `DataTypeService` (and their protocols under `backend/src/main/scala/com/helio/api/protocols/`). Additive optional field.
* **Filtered list + bulk teardown** —
  * list/filter resources by tag (extend the list endpoints or `get_workspace_context` to carry tags so an agent can see groupings), and
  * a bulk-delete endpoint, e.g. `DELETE /api/workspace/resources?tag=<t>` (or `POST /api/workspace/teardown {tag}`), that deletes all resources carrying the tag in dependency-safe order (pipelines/types before sources as appropriate), returning a summary `{ sources, pipelines, types, dashboards }` count — mirroring what `cleanup_news_resources` returns today. Reuse existing delete/cascade semantics (see the delete tools' cascade notes in `helio-mcp/src/tools/write.ts`).
  * New route under `backend/src/main/scala/com/helio/api/routes/`; logic in a service; wire into `ApiRoutes.scala`. Never inline fully-qualified names.
* **MCP surface** — accept `tags`/`namespace` on the create tools and add a `teardown_resources` (by tag) tool in `helio-mcp/src/tools/write.ts` + `helio-mcp/src/helioApi.ts`; expose tags in the read/context tools.
* Update `schemas/` + `openspec/` for the tag field and teardown endpoint.

## Acceptance criteria

- [ ] Data sources / pipelines / DataTypes can be created with one or more tags (or a namespace); the tag persists and is returned on reads and in `get_workspace_context`.
- [ ] A single bulk-teardown call deletes exactly the resources carrying a given tag, in dependency-safe order, and returns per-kind counts; resources without the tag are untouched.
- [ ] Teardown is idempotent (a second call deletes nothing and returns zeros) and owner-scoped (cannot delete another user's tagged resources; RLS enforced).
- [ ] Listing/filtering by tag returns exactly the tagged set.
- [ ] Flyway migration applies cleanly; existing untagged resources are unaffected (tag nullable/empty).
- [ ] ScalaTest coverage: tag persistence, filtered list, bulk teardown order + counts, idempotency, cross-owner isolation.
- [ ] MCP tools updated; helio-news could replace `cleanup_news_resources` + the `news_out_` / `-src-` naming convention with tag-based create + one teardown call.

## Out of scope

* Deleting dashboard **panels** as part of teardown — panel/board contents are handled by the idempotent-rebuild ticket (HEL-363). This ticket targets sources/pipelines/types (dashboards optional).
* A general-purpose labeling/organization UI in the frontend (this is an agent-facing grouping primitive; a UI is a possible follow-on).
* Automatic garbage-collection of orphaned resources.

## Dependencies

* Relates to HEL-363 (idempotent dashboard rebuild) — together they give a workflow a clean create-then-replace-then-teardown lifecycle.
* No hard blockers. Requires a Flyway migration; coordinate version number with other v1.6 backend tickets to avoid a collision (next free is V60+).

## Backward compatibility

Additive: tag columns are nullable, all create paths keep working without tags, and existing resources remain untagged and fully functional. Name-prefix cleanup in helio-news keeps working until it migrates to tags.

---

## Orchestrator pre-brief constraints (from human, binding for this run)

### Danger framing

This is a **bulk delete** feature running against a production app with real user dashboards. A tagging mistake or scoping miss doesn't produce a wrong pixel — it destroys user data. Treat that as the defining constraint.

The design gate must settle, explicitly, on:

1. **Owner scoping is non-negotiable.** Every tag lookup and every delete must be owner-scoped under RLS. A bulk-delete-by-tag that can reach another tenant's resources is a catastrophic bug. Require explicit cross-user tests proving a foreign-owned resource with a matching tag is never touched. (Precedent: HEL-384 cross-tenant ACL gap; HEL-363's 403-vs-404 existence leak caught mid-implementation.)
2. **Dependency/cascade semantics.** DataSource → Pipeline → DataType → Panel chain. Decide deliberately (refuse / cascade / orphan) for tagged-vs-untagged dependents and state it — no silent cascading deletion.
3. **Preview / dry-run.** Strongly consider making dry-run mandatory rather than optional — highest-value safety affordance, lets an agent verify scope before destroying anything.
4. **Idempotency and partial failure.** Follow HEL-363's real-transaction precedent: validate everything before deleting anything; be concrete about all-or-nothing semantics.
5. **Tag model.** Column vs join table, cardinality, free-form vs namespaced, set-at-create vs retrofit. If a Flyway migration is needed, re-confirm the max V-number at write time AND again pre-push (migrations contend across branches).

### Scope discipline

Queued behind this ticket: HEL-367 (auto-pack layout), HEL-368 (panel id key reconciliation), HEL-369 (external-run hooks), HEL-624 (pie/scatter aggregation). Do not absorb them — note dependencies in the proposal instead.

### Process notes

- Design-gate escalation criterion: a round-N REFUTE that is an incomplete application of an already-decided fix, or a pure consistency nit, is NOT new grounds for escalation — continue iterating. Escalate only genuinely-new substantive design flaws. Exception: any data-loss or cross-tenant concern the orchestrator cannot fully resolve in-loop must be escalated to the human rather than decided alone.
- Merge policy: never `gh pr merge --auto`. Poll checks to completion (backend job lags ~4 min), then manual `--squash` merge on green.
- Do NOT close the HEL-344 epic or touch sibling ticket statuses. Set only HEL-366 to Done.
