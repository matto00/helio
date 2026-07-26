## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established (not trusted from evaluator/executor prose)**
- Read `ticket.md`, `proposal.md`, `design.md` (4-round-confirmed), `tasks.md` (32/32
  done), both spec deltas, `evaluation-1.md` (treated as claims only).
- `git diff main...HEAD --stat`: 48 files, backend + MCP + schemas/openspec only.
  No `frontend/**` touched, no trace of HEL-367/368/369/624. Confirms scope
  discipline.

**Danger-critical guard semantics — read the actual code, not the design doc's
description of it**
- `WorkspaceTeardownRepository.scala:107,130,156` — all three guards
  (`sourceDependentPipelineConflict`, `outputTypeDependentPipelineConflict`,
  `sourceLinkConflict`) use `tag IS DISTINCT FROM $tag` in the raw SQL, verbatim —
  not a bare `IS NULL`/`.isEmpty` check. This is the exact class of bug the design
  gate spent two rounds closing (a DataSource tagged `T` with a dependent Pipeline
  tagged `U` would otherwise cascade-delete `U`'s pipeline).
- Live-reproduced this guard end-to-end against the real dev backend (not just
  reading the code or trusting a unit test): created a tagged DataSource, created
  an **untagged** dependent Pipeline on it, called real (non-dry-run) teardown —
  got `{"blocked":true,"committed":false,...,"reason":"has a dependent pipeline
  ... that is not in this tag batch"}`, then confirmed via `GET
  /api/data-sources?tag=` that the source was still present. This is the specific
  scenario the ticket's danger framing exists to prevent, reproduced live.

**Transaction / pool discipline**
- `WorkspaceTeardownRepository.scala` has exactly one `ctx.*Context` call in the
  whole file: `ctx.withUserContext(user.id.value)(action.transactionally)` at
  line 93. `grep -n withSystemContext` on the repository, service, and route files
  returns only a doc-comment hit (explaining why it must NOT be used), zero actual
  calls.
- `DbContext.scala` confirms `withUserContext` runs the whole composed action on
  the non-privileged app pool with `SET LOCAL app.current_user_id`, so RLS applies
  uniformly to every read/write inside the transaction, including the raw
  `sql"""..."""` guard queries (which deliberately carry no explicit `owner_id`
  predicate — they rely entirely on RLS, matching design.md's stated posture).
- `DataTypeRepository.existsBoundToAnyOwnedPanelAction` (line 202) is confirmed to
  be a bare `DBIO[Int]`, with the original `existsBoundToAnyOwnedPanel` call site
  (line 193-194) unchanged (still wraps it in its own `withUserContext`) — the
  "one query, two callers, zero duplicated logic" claim holds.
- The `checkSourceLink`/`sourceLinkConflict` cross-reference comments exist in
  both directions (`DataTypeService.scala:143-149` ↔
  `WorkspaceTeardownRepository.scala:141-150`), as design.md Decision 6 requires.

**The reported 84003cc7 dry-run bug fix**
- Confirmed structurally correct: `clean = conflicts.isEmpty` (line 64) gates the
  three `*Deleted` counts (lines 81-83), while `committed` (line 66-76, `false`
  whenever `!clean || dryRun`) gates only `deletedSources` (line 89-90, the
  file-cleanup input). A clean dry run therefore reports true would-be counts with
  `committed: false` and triggers no file deletion.
- Live-reproduced: `POST /api/workspace/teardown {tag, dryRun:true}` on a clean
  tagged source returned `sourcesDeleted:1, typesDeleted:1, committed:false`; a
  follow-up `GET ?tag=` showed the resource still present. Then a real call
  deleted it, and a repeat call returned all-zero counts (idempotency).
- `WorkspaceTeardownServiceSpec` 6.8 exercises both the clean-dry-run and
  blocked-dry-run cases and asserts dry-run conflicts equal real-call conflicts —
  a real test that would catch a regression of this exact bug, not a
  pass-without-exercising-the-fix test.

**All-or-nothing**
- The DELETE `andThen` chain only executes on the `clean && !dryRun` branch;
  the blocked branch is `DBIO.successful(false)` with zero DELETE statements
  issued. `WorkspaceTeardownServiceSpec` 6.4/6.5/6.6 assert not just that the
  blocking resource survives but that the *unblocked* dependent (e.g. a
  differently-tagged pipeline) is left completely untouched, tag unchanged.

**Cross-owner isolation (the highest-stakes check)**
- Read `WorkspaceTeardownServiceSpec.beforeAll` in full: it builds a genuine
  non-superuser `helio_app_test` Postgres role (`NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOLOGIN`), routes the app pool through `SET ROLE helio_app_test`
  on every connection, and keeps the privileged pool on a separate `SET ROLE
  helio_privileged` connection — this is the real dual-pool RLS harness
  (`RlsOwnerTablesSpec`'s pattern), not the simplified same-superuser-pool
  shortcut most ACL specs use. This matters specifically because the guard
  queries in `WorkspaceTeardownRepository` have no explicit `owner_id` predicate —
  a same-pool-superuser harness would make 6.9/6.12 pass for the wrong reason
  (BYPASSRLS would let every query see every owner's rows regardless of
  correctness).
- 6.9 asserts via **direct DB queries as user B** (`sourceExists(bSrc.id, userB)`,
  `typeExists`, `pipelineExists`) that B's same-tagged resources survive — not
  just trusting A's response shape.
- 6.12 is a genuinely adversarial test: it constructs (via the privileged pool,
  since no real create path can produce this state) a DataType owned by A whose
  `sourceId` points at a DataSource owned by B, and confirms the source-link
  guard treats it as "no linked source" under RLS (rather than leaking B's
  source's existence/name to A, or wrongly blocking).
- Re-ran the full `WorkspaceTeardownServiceSpec` fresh, independently, outside any
  agent: `sbt "testOnly com.helio.services.WorkspaceTeardownServiceSpec"` →
  **15/15 passed**, including 6.9 and 6.12.

**Post-commit file cleanup**
- `WorkspaceTeardownService.cleanupFiles` runs strictly after
  `teardownRepo.teardown` resolves (outside any `DBIO`), using
  `.recover { case _ => () }` per file — matches `DataSourceService.delete`'s
  existing posture exactly. `deletedSources` (its only input) is empty for both
  blocked and dry-run outcomes (gated on `committed`), so it is provably a no-op
  in both cases.

**MCP surface**
- `helio-mcp/src/tools/write.ts:626-662` — `teardown_resources`' description
  accurately states the refuse-semantics (untagged AND differently-tagged both
  block identically, all-or-nothing, dry-run-first recommended, idempotent,
  owner-scoped) — read the full text, not a summary; it matches design.md
  verbatim in substance.
- `helio-mcp/src/helioApi.ts:670-672`, `schemas/workspace-teardown-{request,
  response}.schema.json` consistent with the Scala protocols and the live curl
  responses I captured.

**Fresh re-run of the full verification gate (not evaluator's pasted output)**
- `npm run lint` → clean (0 warnings).
- `npm run format:check` → clean.
- `npm run check:schemas` → "schemas in sync ... (27 checked)".
- `npm run check:openspec` → only the expected "complete but not archived"
  hygiene note.
- `npm run check:scala-quality` → clean (soft file-size warnings only,
  pre-existing pattern).
- `cd backend && sbt test` → **2134/2134 passed** (fresh, ~83s), migrations
  applied cleanly through V73.
- `npm test` (frontend) → **137 suites / 1423 tests passed**.
- `cd helio-mcp && npm run typecheck` → clean.

**Live endpoint verification (dev servers, DEV_PORT=5539, BACKEND_PORT=8446)**
- `assert-phase.sh servers` → PASS.
- Logged in as the dev account, exercised the real HTTP surface directly (no
  frontend UI exists for this feature — backend/MCP-only change, correctly
  reflected in the diff):
  - Created a tagged source → tag round-tripped on the create response.
  - `GET /api/data-sources?tag=` → returned exactly the tagged set.
  - Dry run → correct would-be counts, resource still present afterward.
  - Real teardown → deleted, counts matched; repeat call → all-zero
    (idempotency).
  - Constructed the out-of-batch-dependent scenario (tagged source + untagged
    dependent pipeline) → real teardown call correctly `blocked:true`,
    `committed:false`, zero deletes, source and pipeline both survived.
  - No errors in backend server logs across the whole session.
- Migration V73 confirmed free of collision against `origin/main`'s latest
  migration set (V72 is main's current max).
- Cleaned up all live test data created during this verification; `git status`
  confirms no stray artifacts from this review.

### Acceptance criteria traced
All 7 ticket ACs map to concrete, evidenced code + passing tests + live repro
above: tag persistence/read (create-path grep + live curl), bulk teardown
exact-set + dependency-safe + counts (guards + 6.3/6.4/6.5/6.6 + live repro),
idempotent + owner-scoped (6.7/6.9/6.12 + live repro), list/filter by tag
(`?tag=` on all three endpoints + live curl), migration applies cleanly /
existing rows unaffected (V73 nullable, fresh `sbt test` migrates through V73
with 2134/2134 green), ScalaTest coverage matching the ticket's list (present,
all passing), MCP tools updated (`teardown_resources` + `tag` on create/read/
context tools, verified in `write.ts`/`helioApi.ts`/`context.ts`).

### Verdict: CONFIRM

### Non-blocking notes
- None of substance. The design's "accepted drift risk" on the duplicated
  source-link existence check (Decision 6) is mitigated by cross-referencing
  comments in both directions, confirmed present.
