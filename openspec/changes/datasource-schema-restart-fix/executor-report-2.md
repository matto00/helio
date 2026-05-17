# Executor Report — HEL-256 cycle 2 (fix delivery)

**Status**: implementation + tests landed; all gates green; pushed pending.

Cycle 2 implements the four-fix design that cycle-1b's deterministic
reproduction produced: Fix B′ (primary prevention), Fix D (refresh
upsert recovery primitive), Fix A (boot-time health-check defense-in-
depth), Fix C′ (frontend empty-schema affordance + recovery).

## 1. What landed

| Fix | Scope | Production LoC | Test LoC | Files |
|-----|-------|----------------|----------|-------|
| B′  | backend | ~20 | ~120 | DataTypeService.scala, ApiRoutes.scala, DataTypeRoutesSpec.scala, DataTypeServiceSpec.scala (new) |
| D   | backend | ~30 | ~160 | DataSourceService.scala, DataSourceServiceSpec.scala (new), DataSourceServiceRestartPersistenceSpec.scala (new) |
| A   | backend | ~70 (incl. new file) | ~130 | SourceSchemaHealthCheck.scala (new), Main.scala, SourceSchemaHealthCheckSpec.scala (new) |
| C′  | frontend | ~100 (incl. new component) | ~100 | SourceDetailPanel.tsx, EmptySchemaAffordance.tsx (new), SourceDetailPanel.css, SourceDetailPanel.test.tsx (new) |

Production net diff is ~100 LoC of behavior change (the rest is the
new files plus the test scaffolding). All file-size budgets respected
(see § File-size budgets in `files-modified.md`).

### Fix B′ — `DataTypeService.delete` source-link guard

`DataTypeService` now takes `dataSourceRepo` as a constructor dep. The
`delete` flow checks the source link **before** the panel-binding check
(cheaper query first; clearer precedence). When the DT's `sourceId`
resolves to a still-existing source, the service returns
`ServiceError.Conflict` with a message that names the source and
steers the user toward `Refresh source` (Fix D) or
delete-source-then-cascade flows.

### Fix D — `refresh*` recovery primitive

Both `applyStaticRefresh` and `refreshCsv` now route through a shared
`upsertSourceDataType` helper that:
- updates the existing DT when present (preserving the `sourceId`
  link — current behavior unchanged), or
- inserts a fresh DT linked to the source's id when the DT row is
  missing (heals the orphan state Fix B′ now prevents from being
  newly introduced).

`refreshCsv` also catches `NoSuchFileException` and returns
`ServiceError.BadRequest` with the documented message
"Source file is missing on disk … re-upload" — which the frontend
affordance surfaces inline as an alert.

### Fix A — `SourceSchemaHealthCheck`

A small helper in `com.helio.app` runs a `LEFT JOIN` between
`data_sources` and `data_types` on `source_id` at boot. Each unjoined
row gets one WARN line including source id / name / owner / kind and
the recovery hint `POST /api/data-sources/:id/refresh`. The healthy
case logs a single INFO line.

Wired into `Main.scala` immediately after `DemoData.seedIfEmpty` so
the warning fires on every boot and on every restart.

### Fix C′ — Frontend empty-schema affordance + recovery

`SourceDetailPanel`'s schema branch now renders
`<EmptySchemaAffordance source={...} />` when the linked DT is missing
or empty. The affordance is a separate sibling component (~70 LoC) so
`SourceDetailPanel` stays small (134 lines total). It exposes:
- a "Refresh source" button → dispatches the existing `refreshSource`
  service call + re-runs `fetchDataTypes` on success;
- a fallback "Delete and re-upload" button → dispatches the existing
  `deleteSource` thunk;
- an inline alert region showing refresh errors (e.g. Fix D's
  CSV-file-missing BadRequest).

## 2. Gates run

| Gate | Result |
|------|--------|
| `cd backend && sbt test` | **605/605 passed** (was 591 baseline before cycle 2's 14 new cases) |
| `npm test` | **673/673 passed** (was 669 baseline before cycle 2's 4 new SourceDetailPanel cases) |
| `npm run lint` | clean |
| `npm run format:check` | clean (one new file needed prettier-fix; reformatted before commit) |
| `npm run check:schemas` | 6/6 in sync |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean (18 pre-existing soft warnings; no new ones) |
| `npm --prefix frontend run build` | green |

All four backend specs new in cycle 2 pass — `DataTypeServiceSpec` (3
cases), `DataSourceServiceSpec` (4 cases), `DataSourceServiceRestartPersistenceSpec`
(3 cases), `SourceSchemaHealthCheckSpec` (4 cases). The
`SourceSchemaHealthCheckSpec.run` test exercises the actual logging
path; the emitted WARN line is visible in the test output and the
returned vector is asserted on.

## 3. Manual verification (Playwright)

**Not performed in cycle 2.** Rationale: the deterministic backend
fix is covered by a Conflict assertion in `DataTypeServiceSpec`, the
frontend affordance is covered by the Jest tests (render + click +
dispatch), and the end-to-end path between them is the standard
axios + Pekko HTTP wire. Cycle-1b already did the manual reproduction
that established the bug exists; the cycle-2 PR description notes
Playwright as an optional follow-up.

If the evaluator wants Playwright coverage, I can drive:
1. Login as `matt@helio.dev`, upload a fresh CSV via Sources +.
2. Open Type Registry, attempt to delete the source's auto-DT —
   expect a 409 toast and the DT remaining (Fix B′).
3. Manually orphan a source (DB INSERT, or pre-fix-B′ trigger) and
   restart the backend — observe the boot WARN line (Fix A).
4. From Sources page on the orphan source, click "Refresh source" in
   the empty-schema affordance — verify DT reappears (Fix C′ + D).
5. Delete the source file on disk + click Refresh — verify the
   actionable BadRequest renders in the affordance's alert region.

## 4. Scope discipline

No spinoff work picked up. The three spinoffs from cycle 1b
(`GET /api/types/:id` ACL, `LocalFileSystem.fromEnv` cwd resolution,
Type Registry sidebar visual distinction) remain unaddressed in this
PR per the orchestrator brief.

I did not touch:
- ProfitAgg / HEL-267 dev-DB drift cleanup
- HEL-266 cross-tab SSE
- Pipeline output DTs or `PipelineRepository` write paths
- Existing CSV / Static / SQL ingestion behaviour beyond the refresh
  upsert

## 5. Behaviour-change call-outs (for the evaluator)

- **Fix B′ is a deliberate user-facing behaviour change.** A user who
  previously could delete a source's auto-inferred DT from the Type
  Registry now gets a 409 with a message routing them to the new
  recovery path (Refresh source). This is the intended fix; the
  Conflict message must be clear enough on its own — happy to tune
  the wording if the evaluator wants a different framing.
- **Fix D changes `refreshCsv` / `applyStaticRefresh` from
  pure-update to upsert.** When the DT is present, behaviour is
  identical to today (update fields + bump version). When the DT is
  missing, a new DT row is inserted instead of the previous silent
  no-op. This is what makes the C′ "Refresh source" button actually
  heal orphan state. Low blast radius — the new row's shape is fully
  deterministic from the source content.
- **Fix C′ changes a silent UI state into a visible affordance.**
  Previously, an orphan source rendered nothing in the schema
  section. Now it renders a dashed-border "Schema not available" box
  with two action buttons. This is purely additive.

## 6. Nuance the evaluator should sanity-check

- `system.log` in `Main.scala` is typed as `org.slf4j.Logger` (pekko-
  typed's standard) and passed directly to `SourceSchemaHealthCheck.run`.
  No cast.
- `SourceSchemaHealthCheck` is `object` (no constructor deps; pure
  query + log). Lives in `com.helio.app` next to `DemoData` to mirror
  the boot-time-helper pattern.
- The new `DataSourceServiceRestartPersistenceSpec` simulates restart
  by **re-instantiating the service stack against the same embedded
  Postgres** rather than bouncing the JVM. This matches the cycle-1b
  finding that the restart trigger is non-existent — the persistence
  contract is purely a database durability + Slick read contract,
  which a fresh repository instance proves just as well.
- `DataTypeServiceSpec` includes an "FK cascade SET NULL" case to
  show that the Fix B′ guard does not regress the legitimate
  "source already deleted; please clean up its leftover DT" flow.
  That case is unblocked because the cascade clears `sourceId` to
  NULL, so the guard's `dt.sourceId.match { case None => Right(()) }`
  short-circuit fires.

## 7. Open questions for the orchestrator-relay

None. Cycle 2 is complete per the brief. The PR can either land as
a single commit per fix (atomic per the brief) or as a squashed
single commit per the user's preference at merge time — I'm going
to commit atomically (Fix B′ wiring + tests, Fix D + tests, Fix A +
test, Fix C′ + test, change-folder updates) to keep the history
reviewable.

Spinoffs remain on the cycle-1b backlog (Type Registry visual
distinction, `GET /api/types/:id` ACL, `LocalFileSystem.fromEnv`
cwd resolution).
