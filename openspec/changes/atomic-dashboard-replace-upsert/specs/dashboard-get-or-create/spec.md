## ADDED Requirements

### Requirement: Idempotent get-or-create-by-name
`POST /api/dashboards` SHALL accept an opt-in `ifExists: "return"` field. When set, the server SHALL look up
an existing dashboard by case-insensitive, trimmed name (`lower(trim(name))`, matching
`RequestValidation.normalizeDashboardName`) scoped to the caller (owner) and return it instead of creating a
duplicate; when no match exists, it creates as normal. This is an app-level check-then-insert with no backing
DB uniqueness constraint (see design.md D3) — it makes SEQUENTIAL repeated calls idempotent, which is
`helio-news`'s actual usage pattern; see the "Concurrent race" scenario below for the explicitly accepted
exception. When `ifExists` is absent, behavior is unchanged from today's unconditional create.

#### Scenario: First call creates
- **WHEN** the caller POSTs `{ name: "AI News", ifExists: "return" }` and owns no dashboard named "AI News"
- **THEN** the response is 201 with a newly created dashboard

#### Scenario: Repeated sequential calls are idempotent
- **WHEN** the caller POSTs the same `{ name: "AI News", ifExists: "return" }` again, after the first call
  has completed
- **THEN** the response is 200 with the SAME dashboard id as the first call, and no second dashboard is
  created

#### Scenario: Case-insensitive match
- **WHEN** the caller POSTs `{ name: "ai news", ifExists: "return" }` and already owns a dashboard named
  "AI News"
- **THEN** the response is 200 with the existing "AI News" dashboard, not a new one

#### Scenario: Lookup is owner-scoped
- **WHEN** a different owner already has a dashboard named "AI News" but the calling owner does not
- **THEN** the calling owner's request creates a new dashboard scoped to them; the other owner's dashboard is
  never returned or affected

#### Scenario: Omitting ifExists is unchanged
- **WHEN** the caller POSTs `{ name: "AI News" }` with no `ifExists` field
- **THEN** the server always creates a new dashboard, exactly as before this change, even if a same-named
  dashboard already exists for that owner

#### Scenario: Concurrent get-or-create race (accepted v1 behavior)
- **WHEN** two concurrent `ifExists: "return"` requests for the same owner+name both observe no existing match
  (a true race, not the sequential case above)
- **THEN** both may create a dashboard, resulting in two same-named dashboards for that owner — this is a
  named, accepted trade-off for v1 (no DB uniqueness constraint backs this path; see design.md D3/D4), not a
  bug to be silently prevented. `helio-news`'s actual usage issues one serial call per rebuild, so this race
  does not occur in practice today.

#### Scenario: Plain create, duplicate, and rename are unaffected
- **WHEN** a caller uses `POST /api/dashboards` without `ifExists`, `POST /api/dashboards/:id/duplicate`, or
  `PATCH /api/dashboards/:id` to rename
- **THEN** behavior is byte-for-byte unchanged from before this change — no new uniqueness check, no new
  failure mode, even if the resulting name collides with another dashboard the same owner already has
