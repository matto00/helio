## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Registered vs. unregistered ops (ticket.md claim, design.md Context).**
  `PipelineStep.Registry` (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:210-234`)
  lists exactly 24 kinds ending in `UpsertSourceStep.Kind`; `analyzewithai`/`generatetext`/`convertformat`
  have no corresponding step file under `backend/src/main/scala/com/helio/domain/steps/` and no
  `Registry` entry. `PipelineStepKind.All = PipelineStep.Registry.keySet` is exactly the
  programmatic source design.md D2 needs for its "allowlist == registered ops − upsertsource"
  equality test — genuinely derivable, not hand-maintained. Confirmed.

- **V107 CHECK constraint.** `backend/src/main/resources/db/migration/V107__add_writeback_ops.sql`
  admits the 23 pre-existing ops + `upsertsource`, `convertformat`, `analyzewithai`, `generatetext`
  (27 total) at the DB level, while its own header comment states `PipelineStepKind.All` (the actual
  request-validation gate) does not list the three unimplemented ones. Confirmed — matches design's
  "V107 admits four; only upsertsource is registered" claim exactly.

- **`PipelineSummary.lastRunRowCount` reachable inside `analyze`.** `PipelineService.analyze`
  (`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:914` on) binds
  `summary <- pipelineRepo.findSummaryByIdShared(...)`, and `summary.lastRunRowCount` is a real
  `Option[Long]` field on `PipelineSummary` (`PipelineRepository.scala:641`, wired through at
  `PipelineProtocol.scala:113`). Confirmed available at exactly the point design D7/D4 needs it.

- **Source kinds and `sourceUrl`.** `DataSource.scala` defines exactly 7 kinds — csv, rest_api,
  sql, text, pdf, dataset, image — matching design D3's `{csv,text,pdf,image,dataset,rest_api,sql}`
  set with no gap. `sourceUrl: Option[String]` exists on csv/text/pdf/image configs only; rest_api
  and sql have no `sourceUrl` field (correctly classified `remote-fetch` unconditionally by D3
  rather than via `hasSourceUrl`). Confirmed.

- **`dataset_rows` / `DataSourceRepository.countDatasetRows` feasibility.** `dataset_rows` is a
  real Slick table (`DataSourceRepository.scala:1081`, `DatasetRowTable`), and `findByIdOwned`
  (line 155) is the exact ACL-checked method design D7 says a new `countDatasetRows` would sit
  beside. Confirmed as a sound, additive repository method.

- **`PipelineAnalyzeResponse` arity.** `PipelineAnalyzeProtocol.scala:205-210` currently has 5
  fields with `jsonFormat5` (line 357) — matches design's "jsonFormat5 → jsonFormat6" claim exactly.
  The sibling `PipelineAnalyzeConciseResponse` is a wholly separate case class, confirming D6's
  "concise mode byte-identical" claim is structurally true (no shared formatter to accidentally
  widen).

- **D8's genuinely uncertain claim — "if the step repository can load [a forced AI-op row], or if
  it cannot, that is recorded."** Traced `pipelineStepRepo.listByPipelineInternal` →
  `rowToDomain` (`PipelineStepRepository.scala:1286-1322`) → `PipelineStepConfigCodec.decode(row.op,
  ...)` (`PipelineStepConfigCodec.scala:30-35`) → `PipelineStep.companionFor(kind)`. For
  `kind = "analyzewithai"` (not in `Registry`), `companionFor` returns `Left`, which the codec
  turns into a thrown `IllegalArgumentException` inside the `Try`, caught by `rowToDomain`'s
  `case Failure(ex) => throw new IllegalStateException(...)`. **This does throw** — a
  manually-inserted V107-legal `analyzewithai` row makes `listByPipelineInternal` blow up, so
  `PipelineService.analyze` would fail the whole Future (→ 500), not deny. This is exactly the
  scenario D8/task 4.4 and the Risks section already flag ("An unimplemented AI op row may not
  deserialize at read; D8 surfaces it instead of assuming") — my independent trace confirms the
  design's own uncertainty was correctly placed, not glossed over. The estimator-level D8 tests
  (task 4.1) never touch this decode path at all — they build `CostInput` by hand with raw
  `(stepId, op)` string pairs, bypassing `Registry`/`companionFor` entirely, so the AI-deny/allow
  probe itself is unaffected by this gap. The only user-unreachable edge (row only creatable via
  direct SQL, since `PipelineStepKind.All` gates the insert route) is honestly scoped as "record if
  it can't load," not silently ignored. Non-blocking.

- **D8 mutation genuinely failable.** M1 (delete the `AiOps` arm) is checked against the
  `reasons contain "ai-step"` assertion specifically, not just `autoRunnable=false` — the design
  explicitly notes the verdict alone would stay `deny` via `unclassified-op` even after the
  mutation, which is why the reason-code assertion is the one that must go red. That is a real,
  non-vacuous kill condition for the AI-specific code path, not a tautological check. M2 (add
  `analyzewithai` to `CheapOps`, remove the arm) targets the `autoRunnable` assertion directly.
  Both mutations target distinct code and distinct assertions — sound.

- **Deny-by-default coverage.** D2 (unclassified op), D3 (unclassified source / zero roots), D4
  (no row estimate / over threshold / over step bound), D5 (`CostVerdict` private constructor, single
  derivation point `reasons.isEmpty`) together cover every branch named in the ticket's AC
  (AI step, remote fetch, row threshold, step-count bound) plus the ticket's explicit
  "deny is the default for anything the estimator cannot classify" instruction. No path in the
  design allows an unclassified/unresolved input to produce an allow.

- **Sound base for HEL-1108/1093/1096.** `ai-step`'s own distinguishable reason code (checked
  before the general allowlist, per D2) is exactly what HEL-1108 (tier gating on AI steps) needs to
  key on without re-deriving classification logic. The additive, always-present wire field with a
  schema-enforced closed `code` enum (D6) is a reasonable contract for HEL-1093's auto-run trigger
  and HEL-1096's UI affordance to consume.

### Verdict: CONFIRM

No placeholders, no internal contradictions between proposal/design/tasks, no ambiguity in what a
competent implementer must build. Every load-bearing factual claim in design.md's Context and
Decisions that I could check against the live tree checked out true, including the one claim
(D8's step-repo-load uncertainty) the design itself flagged as uncertain — I confirmed it fails
exactly as anticipated and is handled by "record, don't assume," which is adequate for a ticket
whose non-goals explicitly exclude implementing the AI/convertformat ops.

### Non-blocking notes

1. D2's phrasing "every other op (including `convertformat`) → `unclassified-op`" is slightly
   imprecise: `convertformat` cannot currently reach the estimator via any real persisted step
   (same registry gap as the AI ops — a real `PipelineStep` object can't exist with that op today).
   It's only reachable in the same manually-inserted-row scenario as the AI ops, not a distinct,
   more-common case the prose implies. Worth a one-line clarification during implementation, not a
   blocking revision.
2. Worth double-checking at implementation time that `helio-mcp`'s `types.ts` and the frontend
   `PipelineAnalyzeResponse` type are updated in the same commit as the schema (task 3.1/3.2 already
   list this) — no evidence of drift risk found, just flagging it stays in scope per tasks.md.
