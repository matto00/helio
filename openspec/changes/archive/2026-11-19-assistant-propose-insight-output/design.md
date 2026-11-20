## Context

See proposal.md. Re-derived on main dfb65eebb:
- `AssistantProposalToolSchemas.scala:290-293` hand-lists six kinds in `PipelineProposalOutputSchema`
  (used by `propose_pipeline` and `propose_combined`). `propose_patch_set`'s `patch` is a free-form object whose
  description (`:445-461`) embeds `OutputConfigValidation.KeysDoc`; its `kind` is not enum-constrained there.
- `OutputConfigValidation.scala:39-41`: `DocumentedKnownKeys` filters out `Insight`; `KeysDoc` (`:52`) is built from
  it and says "Every kind: compare, fieldMapping, historyPayloads", which is false for insight
  (`KnownKeys(Insight) = InsightConfig.Keys`, no `compare`/`historyPayloads`). `KeysDoc` also feeds
  `RefinementEditShape.scala:268` (refinement output update), so that surface gains insight docs too.
- Patch-set output create: `PatchSetOutputResolvers.resolveOutputCreate` (`:95-130`) checks shape via
  `OutputService.validateConfig` (KnownKeys + `InsightConfig.parse`) and field mapping, but NOT
  `InsightReadsCheck` (the stored-id rule). Apply (`PatchSetApplyForward.scala:111`) calls
  `OutputService.create(..., backfill = false)`, which DOES run `checkInsightReads` (`OutputService.scala:150,186`).
  So a bad `reads.outputs` previews clean and fails at apply: a preview/apply disagreement.
- Pipeline proposal create path: `PipelineCreatePreflight.scala:228-229` rejects any non-empty `reads.outputs`.
- Render: insight renders run after a real run's `succeeded`, on the daily tick, on refresh, and an `on_run` catch-up
  on the scheduler tick (HEL-1743). Output create's backfill (`OutputService.triggerBackfill`) is a node backfill, not
  a render. Whether a backfill completion can trigger a render must be probed, not assumed (D5).

## Goals / Non-Goals

Goals: kind enum + config docs from one source, path-specific `reads` rule, preview/apply parity, no render on
create, positive drift guard, red-first proof. Non-goals: see proposal.md.

## Decisions

**D1 Kind enum derived.** `PipelineProposalOutputSchema.kind.enum` = `OutputKind.all.map(OutputKind.asString)`. A
text check in `OutputKindDriftSpec` asserts no literal `"timeline", "markdown"` kind list remains in
`AssistantProposalToolSchemas.scala`, and a value check reads the built tool `inputSchema` JSON (not source text) and
asserts the enum equals canonical. Alternative (append `"insight"` to the literal list) rejected: it is the drift the
ticket names.

**D2 KeysDoc covers every kind.** Delete `DocumentedKnownKeys`; `KeysDoc` iterates `KnownKeys`. The shared-keys
sentence becomes "Every kind except insight: compare, fieldMapping, historyPayloads; insight takes only fieldMapping
(leave it empty) plus its own keys". Add an insight sentence built from constants: `preset` one of
`InsightPreset.all` (default auto); `prompt` optional text up to `MaxPromptChars`; `reads` = `{ outputs?, windows? }`
(outputs up to `MaxReadOutputs` distinct ids, windows up to `MaxReadWindows`, values as `parseReadWindows` accepts --
the executor reads that function and builds the value list from its constants; absent `reads.outputs` = the other
Outputs on the same node); `refresh` one of `InsightRefresh.all` (default on_run); `maxSentences` in
`MaxSentencesRange` (default `DefaultMaxSentences`); `maxChars` in `MaxCharsRange` (default `DefaultMaxChars`);
`model` optional, a selectable model id, omit for the server default. Defaults are never written back. KeysDoc does
NOT state a `reads.outputs` id rule (it is path-dependent, D3).

**D3 Per-path `reads.outputs` rule, two constants in `AssistantProposalToolSchemas`.**
- `InsightNewPipelineReadsDoc`, appended to `PipelineProposalOutputSchema.config.description`: a new pipeline has no
  stored Output to read, so any non-empty `reads.outputs` is rejected with 400; omit `reads` (the insight reads the
  other Outputs on its node), and add reads later with a patch-set output update. Applying the proposal runs the
  pipeline, and that run is an `on_run` insight's first render trigger (charged to the pipeline owner); set
  `refresh: "manual"` (or `daily`) to avoid an immediate render.
- `InsightExistingPipelineReadsDoc`, appended to the `propose_patch_set` `patch` description: on an output create or
  update, `reads.outputs` names stored ids (from get_resource on the pipeline) of OTHER non-insight Outputs of the
  same pipeline; a `$ref:` is not accepted there. Creating an insight writes no render and starts no run; it renders
  on its next trigger (next real run for `on_run`, the daily pass for `daily`, a refresh for `manual`).
`RefinementEditShape` keeps KeysDoc only; the executor checks whether refinement can create Outputs and, if so,
appends the existing-pipeline constant there too (same constant, no new prose). The finding is recorded in evidence
either way.

**D4 Preview/apply parity, create AND update.**
- Create: `resolveOutputCreate` runs `InsightReadsCheck.check(kind, None, config, JsObject.empty, map, isSelectableModel)`
  for an insight write carrying `reads`.
- Update: `resolveOutputUpdate` (`PatchSetOutputResolvers.scala:35-62`, today no config validation at preview) runs
  `InsightReadsCheck.check(existing.kind, Some(outputId), patch.config, existingConfig, map, ...)` and ALSO
  `OutputService.validateConfig(existing.kind, patch.config, existingConfig)` -- the same pair `OutputService.update`
  runs at apply (executor confirms `update` calls `validateConfig`; if it does not, only the reads check is added and
  the reason is recorded). Both are pure parity: anything they reject at preview already fails at apply.
- `map` = `outputRepo.listByPipelineInternal(pipelineId)` (kind by id) NET of Output deletes in the same patch set for
  that pipeline, so "delete X + insight reads X" is rejected at preview instead of failing at apply. ACL: the
  pipeline was already authorized owner/editor in the same resolver.
- Errors are `400 "edit N: <message>"` like the resolver's other checks. A `$ref:` id fails the check naturally (no
  stored Output has that id); assert the existing message, no special case.

**D5 Render rule, stated and proven.** The rule (HEL-1747's wording): creating an insight Output writes no render.
- Patch-set path: apply creates the Output and starts no run, so no render follows. Proven by a spec whose
  `PipelineRunService` (the one apply and the post-apply backfill use) is wired with a REAL `InsightRenderService` as
  `insightTrigger` (built like `InsightRenderFixture`) over a fake model that FAILS the test on any call. The default
  `InsightRunTrigger.NoOp` would make the test vacuous and is forbidden here. After apply and backfill (`eventually`,
  explicit `PatienceConfig`, no `Thread.sleep`): zero `output_insights` rows for the Output, zero model calls.
  Recorded mutation that must go red: make patch-set apply call `insightTrigger.afterRunSucceeded` /
  `renderForRun` for the pipeline (or submit a real run in the test with the insight `on_run`) -- proving the wiring
  can observe a render.
- Pipeline-proposal path: apply's real run renders `on_run` insights (`PipelineProposalService.scala:617` →
  `PipelineRunSucceededWrites.scala:343`). This change does NOT alter that trigger. The spec asserts, with the same
  real-trigger wiring, that a `refresh: "manual"` insight gets zero rows/zero calls after the apply run completes.
  It does not assert the `on_run` render itself (HEL-1743 owns that behaviour and its specs).

**D6 System prompt.** One bullet in `AssistantSystemPrompt`'s Output glossary: an `insight` Output is a short
narrative over the other Outputs of its pipeline (attach it to the node whose Outputs it reads); on an existing
pipeline it is a `propose_patch_set` output create; on a new pipeline the apply's run renders an `on_run` insight, so
use `refresh: "manual"` when the user did not ask for it now. No duplication of KeysDoc.

**D7 Drift spec positive.** Replace the "pinned exclusions" block with: proposal tool enum == canonical (D1);
`KeysDoc` contains `insight:` and every `InsightConfig.OwnKeys` key; every `InsightPreset.all`/`InsightRefresh.all`
value appears in KeysDoc. Delete `withoutInsight`. Mutation proof: drop `Insight` from the derived enum (filter) and
re-add the `DocumentedKnownKeys` filter, each separately → red; recorded in `drift-mutations.md` in this change dir.

**D8 Frontend check, not change.** The executor greps the assistant proposal review UI
(`frontend/src/features/assistant`, pipeline-proposal review) for kind-keyed maps; if an insight Output would render
blank or crash, fix it in this change with a test; otherwise record "no kind map" in evidence.

## Red-first plan (C12)

Committed red before implementation: (a) `AssistantProposalToolSchemasSpec`: a `propose_pipeline` input with an
insight Output validates against the tool's `inputSchema` (JSON-schema validator already used in repo tests, or the
enum read) -- red today; (b) `PatchSetOutputCreateSpec`-style spec: insight create with a bad `reads.outputs` is
rejected at PREVIEW -- red today (D4); (b2) the same for an insight output UPDATE at preview -- red today; (c) the drift spec's positive checks -- red today. The end-to-end
apply-and-no-render test may already pass on main; if so it is labelled a GUARD with a recorded mutation, never
claimed as red.

## Gate-Chain Implications Checklist

The change edits `scripts/check-schema-drift.mjs`, which the pre-commit hook runs (schema-drift check). The edit adds one
branch that reads the canonical Output kinds from `OutputKind.fromString` in `model.scala` when the assistant tool enum is
derived from `OutputKind.all`, and empties `KNOWN_PRE_EXISTING_DRIFT`.

- What does it execute? Only node reading files: it reads `model.scala` with `readFileSync` and parses it with regexes.
  It spawns no process, runs no git command and makes no network call; the rest of the script is unchanged.
- What environment does it inherit, and from where? The hook's environment from `.husky/pre-commit` via `npm run`; the
  new branch reads no environment variable. Paths are resolved from the script's own `repoRoot`, as before.
- Does it write anything outside its own sandbox? No. The script writes nothing at all; it prints and sets the exit code.
- Does it behave differently from a linked worktree than from a main checkout? No. It reads tracked source files relative
  to `repoRoot`, which is the checkout it runs in, linked worktree or main; it does not touch `.git`.
- What happens on its first run? It parses `model.scala`; if `object OutputKind` or `fromString` cannot be found, or lists
  no kinds, it throws, failing the check loudly rather than passing on an empty set.

## Risks / Trade-offs

- [KeysDoc grows and reaches refinement] → acceptable; it is the single source and refinement updates Outputs.
- [Insight prose drifts from the parser] → every value/range is interpolated from constants; D7 checks them.
- [Delete + insight-reads in one set] → handled by building the reads map net of same-set deletes (D4).
- [`fieldMapping` doc for insight] → executor confirms `OutputFieldMappingCheck.validate(Insight, ...)` behaviour and
  the doc states what it actually does (empty/ignored/rejected).
- [Sibling lanes] → HEL-1782 frontend shell, HEL-1783 dashboard-changes route: no file overlap.

## Migration Plan

None. No Flyway migration; V147 not claimed.

## Planner Notes

- Self-approved: D3 constant placement, D4 (parity fix is required by "validates and applies"), D6 prompt bullet,
  D8 verify-only frontend.
- Design round 1 REFUTE: D5 restated. The ticket's "does not render" is read as HEL-1747's add_output rule (creation
  writes no render); the pipeline-proposal apply's own run rendering `on_run` insights is existing HEL-1743
  behaviour, left unchanged and documented to the model. Reported to the driver as a judgment call.
- Driver claims verified: kind list, KeysDoc filter, drift exclusions, `PipelineCreatePreflight` 400, HEL-1785 on
  main (patch-set resolver already requires owner/editor on the pipeline).
