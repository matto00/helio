# Scripts

Repo-tooling scripts: pre-commit quality gates (`check-*.mjs` — OpenSpec
hygiene, repo integrity, Scala quality, schema drift, spec structure),
`agent/` (agent-facing helper scripts), `concertino/` (the ticket-delivery
orchestration procedure scripts), `lib/` (shared script helpers).

**Belongs here:** Node/shell tooling that supports development or CI, not
the application itself.
**Does not belong here:** application source — see `backend/` and
`frontend/`.
