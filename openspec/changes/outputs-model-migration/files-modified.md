Cycle 3 delta (this executor turn — evaluation-2.md follow-up: real `pg_dump` fixture, markdown-
binding fix, tasks.md bookkeeping). For prior cycles' file lists (cycles 1-31), see
`execution-progress.md`'s per-cycle sections. The cumulative diff is
`git diff main...HEAD --name-only`.

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — evaluation-2.md's markdown-
  binding fix: every place the migration special-cased `type = 'text' AND type_id IS NOT NULL` to
  mean "data-bound, becomes an Output" now also matches `type = 'markdown' AND type_id IS NOT
  NULL` — the `panels.kind` backfill (section 4), the task 2.9(b) bound-panel-selection predicate
  (section 9's loop `WHERE` clause), the orphan-type "remaining bound panel" check (section 13,
  both the count-logging query and the loop query), and the Output-kind derivation (`out_kind`)
  which now maps BOTH `text` and `markdown` to the `markdown` Output kind, matching
  `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:76`'s explicit statement
  that the `markdown` Output kind covers "today's data-bound text AND markdown panels."
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — full rewrite per the human coordinator's explicit, non-negotiable cycle-3 ruling: the fixture
  is now the REAL `pg_dump --data-only` dump (loaded verbatim, replacing — not supplementing — the
  previous ~800-line hand-built fixture), plus generic, data-driven assertions computed from the
  real data (not fixed hand-picked expected values) for every required migration behavior: the
  markdown-binding fix end-to-end, the full stranded-panel predicate (count derived from the real
  data, not hardcoded), aggregation/metric tail-step config for every surviving real
  aggregation/metric panel, invalid-fieldMapping-slot dropping on a real chart panel, companion-type
  schema folding, orphan-pipeline-output-type Output creation, alert-rule resolution (two rows
  seeded on top of the dump, since the dev DB carries zero), row-for-row `node_snapshots` equality
  for EVERY live pipeline that had `data_type_rows` (not just 1-2 hand-picked ones), and the RLS
  smoke tests (re-targeted at real pipelines/owners instead of synthetic ones, with a
  `resource_permissions` grant seeded on top for the sharing-branch proof).
- `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` — NEW. The real `pg_dump
  --data-only --inserts --disable-triggers --no-owner --no-privileges` snapshot of the shared dev
  DB (2026-08-30, schema version V93) for `users`, `data_sources`, `data_types`, `pipelines`,
  `pipeline_steps`, `panels`, `dashboards`, `metrics`, `binary_refs`, `data_type_rows`, and
  `patch_set_applications`. The dump's psql-only `\restrict`/`\unrestrict` meta-commands were
  stripped (not valid SQL, unrecognized by a raw JDBC statement) and the `SET
  transaction_timeout = 0;` line was stripped (the embedded-Postgres test dependency's server
  version predates that GUC). Otherwise loaded byte-for-byte.
- `openspec/changes/outputs-model-migration/tasks.md` — task 2.11 marked genuinely complete (was
  `(partial)` while checked `[x]`, the fourth instance of that bookkeeping defect on this ticket);
  text rewritten to describe the real-fixture replacement and the defects it surfaced.

Cycle 3 delta, second pass (URGENT security fix — same turn):

- `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` — **scrubbed** the real `pg_dump`
  fixture landed above: the coordinator/evaluator confirmed 594 `users` rows carrying live bcrypt
  password hashes and real email addresses (including the repo owner's own personal address),
  plus one `data_sources` row embedding a real local Postgres host/user/database triple. See
  `execution-progress.md`'s "Cycle 3 — fixture credential scrub" section for the exact scrub
  transformation, verification commands, and mutation-testing proof that the scrub did not weaken
  either of `V94OutputsMigrationSpec`'s two defect-catching assertions.
- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — fixed a stale comment
  (section 4, `panels.kind` backfill) that said "markdown/image/divider map straight through
  (content panels, never data-bound)" even though the very next lines special-case `markdown`
  exactly like `text` for a data-bound row. No SQL/behavior change — comment only. (Also confirmed,
  not changed: all five `type IN ('text', 'markdown')` call sites, including line 560's `out_kind`
  derivation, are already symmetric — no further code fix needed there.)
