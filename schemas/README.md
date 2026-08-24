# Schemas

JSON Schema (2020-12) contracts that are the source of truth for
request/response wire shapes shared between frontend and backend, grouped
into one subdirectory per domain capability: `agent-memory`, `alerts`,
`assistant`, `auth`, `authoring`, `dashboards`, `data-types`, `hooks`,
`metrics`, `panels`, `patch-sets`, `pipelines`, `shared`, `workspace`.

Each domain subdirectory holds that domain's schema files directly — they
are pure JSON Schema groupings with no code and no internal slice
convention, so one README here covers all 14 rather than duplicating the
same four lines in each.

**Belongs here:** JSON Schema files defining wire contracts, one domain per
subdirectory.
**Does not belong here:** the OpenAPI specs that reference these schemas,
which live in `openspec/`; the TypeScript/Scala types generated or
hand-written to match them, which live in `frontend/src/features/*/types`
and `backend/src/main/scala/com/helio/domain`.
