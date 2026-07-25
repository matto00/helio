## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**1. Cross-tenant ACL check — independently re-verified live (highest priority)**

Started fresh servers via `scripts/concertino/start-servers.sh` (ports 5557/8464), confirmed with
`assert-phase.sh servers` → `PASS servers`. Registered two brand-new users (`skeptic-a@helio.dev`,
`skeptic-b@helio.dev`) via `POST /api/auth/register`, created data sources owned by each
(`A-source`/`A-source2`/`A-source3` owned by A, `B-source` owned by B) and a pipeline owned by A.

- (a) `POST /api/pipelines/:id/steps` with `type: "union"`, `config.otherDataSourceId` = B's
  source id, called as user A → **`404 {"message":"Data source not found: <B-source-id>"}"`**.
  Immediately re-fetched `GET /api/pipelines/:id/steps` → `[]`, confirming no step row was
  persisted.
- (c) Same request with `otherDataSourceId` = A's own second source → **`201 Created`** with a
  typed `UnionStepResponse`.
- (b) `PATCH /api/pipeline-steps/:id` on that persisted step, changing `otherDataSourceId` to B's
  source id → **`404`**. Re-fetched `GET /api/pipelines/:id/steps` → the persisted config's
  `otherDataSourceId` was unchanged (still A's own source), confirming the update was rejected
  before any write.
- Sanity: `PATCH` with A's own third source (different columns, `mode: byName`) → **`200`**, config
  updated.

This reproduces all three scenarios the ticket's correction and design.md Decision 9 require, from
scratch, with my own users/sources/pipeline — not reusing or trusting the evaluator's fixtures. Code
path read directly: `backend/src/main/scala/com/helio/services/PipelineService.scala:279-293`
(`addStep`) and `:377-391` (`updateStep`) — both chain `unionCheckF` after `joinCheckF` via
`flatMap` *before* the `pipelineStepRepo.insertInternal`/`updateInternal` call, so the ACL check is
structurally incapable of running after a write.

**2. Execution correctness — live, both modes**

- `byPosition`: `POST /api/pipelines/:id/run` with current rows `[{a:1,b:2}]` (from `A-source`,
  read back as strings) + other source `[{a:3,b:4}]` → output
  `[{a:"1",b:"2"},{a:"3",b:"4"}]`. Matches spec.md's byPosition scenario exactly.
- `byName` with differing columns: current `[{a:"1",b:"2"}]` (cols a,b) + other `A-source3`
  `[{a:"5",c:"6"}]` (cols a,c) → output `[{a:"1",b:"2",c:null},{a:"5",c:"6",b:null}]`. Matches
  spec.md's null-backfill scenario exactly (per-source, per-key backfill).
- `byName` with identical columns (A-source2) → no null backfill, same output as byPosition.
  Matches spec.md's third scenario.

**3. Analyze passthrough — live**

`GET /api/pipelines/:id/analyze` on the union step → `outputSchema == inputSchema` (`a`/`b`,
string), no `validationError` key present in the response. Matches design.md Decision 6 /
spec.md's dedicated-dispatch-case requirement — confirmed live, and confirmed in code
(`PipelineAnalyzeService.scala`: `"union"` added to the `(inputSchema, None)` passthrough case
alongside `filter|limit|sort|dedupe|fillnull`, not the `case unknown => ...` fallback).

**4. Gate suite — re-run fresh, not trusted from the evaluator's table**

- `sbt test` (from `backend/`): `1907 tests, succeeded 1907, failed 0` — matches executor/evaluator
  claims. Flyway bootstrap applied all 71 migrations cleanly, ending at v71 ("add union op"), no
  collision.
- `npm test` (from `frontend/`): `Test Suites: 130 passed, 130 total`, `Tests: 1347 passed, 1347
  total` — matches.
- `npm run lint` (frontend): clean, 0 warnings.
- `npm run format:check` (frontend): "All matched files use Prettier code style!"
- `npm run check:schemas` (root): "schemas in sync ... (18 checked across 22 protocol files)",
  "panel-type enums in sync ... (7 surfaces checked)".
- `npm run check:scala-quality` (root): "Scala code-quality check: clean (64 soft warning(s))" —
  all 64 warnings are pre-existing (test files over the 250-line soft budget), none union-related.
- `npm run check:openspec` (root): fails with "change 'pipeline-union-append-op' is complete
  (25/25) but not archived" — the sole failing gate, matching the commit's stated `-n` bypass
  scope. Every other pre-commit-equivalent check passed standalone above, so the bypass is
  appropriately scoped per CONTRIBUTING.md's "environmental hook breakage, called out explicitly"
  standard.
- `npm --prefix frontend run build`: succeeds (`✓ built in 592ms`).

**5. Ticket/spec/design traceability**

Read `ticket.md`, `design.md`, `tasks.md`, `specs/pipeline-union-op/spec.md`, `files-modified.md`,
and `evaluation-1.md` (as claims). Cross-checked every ticket AC against the diff for commit
`5ea619ee` (isolated via `git show HEAD --stat`, not the full stacked `main...HEAD` which includes
5 unrelated sibling op tickets not yet merged to `main`):

- `UnionStep.scala` (126 lines): `byPosition`/`byName` logic matches design.md Decisions 2-4
  exactly (raw append vs. first-row-derived column union with per-source null backfill); execute-
  time errors match Decision 5's message shape (`"DataSource not found for union: " + id`,
  unsupported-mode error naming the value + both supported modes).
  `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource` mirrors `JoinStep` exactly, with an
  inline comment explaining why the privileged runtime lookup is safe given the pre-flight check.
- `PipelineStep.scala`/`package.scala`/`PipelineStepRepository.scala`: registry, aliases, and
  `rowToDomain` arm all added — read directly, confirmed exhaustive.
- `PipelineStepProtocol.scala`/`PipelineAnalyzeProtocol.scala`/`PipelineStepConfigCodec.scala`:
  `UnionStepResponse`/`UnionAnalyzeStepResponse`, `jsonFormat6`, `encodeConfig`/`extractConfig`
  arms present.
- `V71__add_union_op.sql`: additive drop/re-add CHECK constraint, full accumulated op list plus
  `'union'`; `ls .../migration | sort | tail` confirms V71 is the current unique max.
- Frontend: `UnionConfig.tsx` reuses `Select` (shared component) + the existing
  `pipeline-detail-page__compute-field`/`__filter-combinator`/`__aggregate-section-description` CSS
  classes (grepped `PipelineDetailPage.css`, confirmed these classes are pre-existing, not new) —
  no new CSS, no hardcoded colors. `stepNarrowing.ts` adds `union` directly to `OP_TYPES` per
  Decision 7, with a corrected inline comment explaining `join`'s continued exclusion is about the
  missing editor, not the (now-closed) ACL gap.
- `PipelineStepRoutesSpec.scala`: `unionReq` helper + the exact 404/201/404-on-PATCH-unchanged
  triad tasks.md 6.7/6.8 call for — re-ran this spec file in isolation (`sbt "testOnly
  com.helio.api.PipelineStepRoutesSpec"`), 22/22 pass including all three union ACL tests.
- `InProcessPipelineEngineSpec.scala`/`PipelineAnalyzeServiceSpec.scala`/
  `PipelineStepConfigCodecSpec.scala`/`PipelineStepSpec.scala`: read all new test bodies directly —
  each asserts on real output values (not just "doesn't throw"), matching spec.md's scenarios
  verbatim (byPosition append, byName null-backfill, byName-with-identical-columns, both error
  paths, codec round-trip + `decode({})` tolerance, kind-parity exhaustive match).
- `helio-mcp/src/tools/write.ts`: `add_pipeline_step` description documents `union` + its config
  shape, the analyze-passthrough caveat, and the error-naming behavior.

All 8 ticket ACs trace to real code/tests. No placeholders, no scope creep beyond ticket.md +
design.md's Decision 9 correction.

**6. UI / design judgment (live, browser)**

Logged in via the persisted dev session, navigated to a real union pipeline (`union-eval-pipeline`,
left over from the evaluator's cycle-1 run — reused, not fabricated, to exercise real accumulated
state), expanded the step card:

- Renders "Union / append rows" with a chevron, `Other data source` labeled `Select` (populated,
  showing `A-source3`), `Mode` toggle with `BY POSITION`/`BY NAME` buttons (`aria-pressed`
  correctly reflecting state), and mode-specific description text — matches spec.md's editor
  requirement and `DedupeConfig`/`StringOpsConfig`'s established filter-combinator recipe (read
  `DedupeConfig.tsx` side by side — same class names, same interaction pattern).
- Screenshots taken in both dark and light theme (toggled live via the theme button): consistent
  card chrome, button/select styling, spacing, and typography with sibling step cards in both
  themes; no unstyled/broken elements, no hardcoded colors visible, borders/backgrounds track the
  active theme correctly (light: white card on cream background, orange active-mode accent; dark:
  near-black card on near-black background, same orange accent) — light/dark parity holds.
  `pipeline-detail-page__union-config` (the outer wrapper div) has no CSS rule anywhere in
  `PipelineDetailPage.css` — confirmed it's a bare structural wrapper, not undocumented new styling.
- Opened "+ Add transformation step": menu shows 18 entries ending in "Union / append rows", no
  "Join" entry present — matches design.md Decision 7/9's contrast with `join`'s continued
  exclusion (verified live, not just read in `stepNarrowing.ts`).
- Console: one 404 on `GET /api/pipelines/:id/schedule` — pre-existing pattern on any pipeline
  without a schedule set (confirmed this is the same 404 that appears on unrelated pipelines in the
  list, e.g. "Popover Test Pipeline"), unrelated to this change, UI renders "No schedule set"
  gracefully rather than breaking.

### Verdict: CONFIRM

### Non-blocking notes

- `PipelineService.scala` has grown to 497 lines across this and sibling op-expansion tickets in
  the same batch, past CONTRIBUTING.md's ~400-line "propose a split" guidance — `check:scala-
  quality` doesn't flag it (mechanical checker's threshold differs from the file-size prose
  guidance), and it's correctly called out as a non-blocking spinoff candidate in both design.md's
  Risks section and evaluation-1.md. Agree it's worth a follow-up ticket before the next pipeline op
  lands, not a blocker for this one.
- The evaluator's Phase 3 report and my independent re-verification used different concrete
  fixtures (different user emails/source names/pipeline) but reached identical results on all three
  ACL scenarios plus execution/analyze correctness — this is exactly the kind of independent
  reproduction the cold-skeptic role is meant to provide, and it confirms the evaluator's PASS
  wasn't a fluke or a shared-fixture artifact.
