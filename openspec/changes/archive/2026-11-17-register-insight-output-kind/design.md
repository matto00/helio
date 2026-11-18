## Context

See proposal.md (Why). Ground truth on main 96ed5156b: `OutputKind` is a sealed trait with hand-written
`fromString`/`asString` (`domain/model/model.scala:606-642`); V94:212 holds the DB CHECK; per-kind maps live in
`OutputConfigValidation.KnownKeys` (:20-28), `OutputBindingSpec` (markdown at :105 is the no-slot precedent),
`OutputPanelDefaultSize` (`PanelPacker.scala:143-153`), `LegacyOutputConfigKeys.scala:43`, and
`AssistantProposalToolSchemas.scala:292`. `OutputSummaryReducer.summarize` (:49-57) already writes null `metric`
unless Metric and null `series` unless Chart. L3 (HEL-1741) added `domain/insights/InsightPreset`. Kinds are also
enumerated in five JSON schemas (+ node-capabilities-response), helio-mcp (`tools/pipelines.ts:152`,
`tools/outputs.ts:55`, `tools/pipelineProposal.ts:89`, `types.ts:1106`) and the frontend (`types/output.ts:14`,
`nodeCapabilities.ts`, `OutputPanelContent.tsx`, `LiveOutputRender.tsx`, `outputEditor/*`, `crossFilterRows.ts`).
The executor MUST re-enumerate sites from the tree (grep every kind literal, e.g. `'timeline'`, plus `OutputKind.`),
not trust this list.

## Goals / Non-Goals

**Goals:** create/update/place an insight; one shared config validator; a drift guard covering every site.
**Non-Goals:** `model` key, rendering, storage, triggers, authoring UI, MCP/proposal enums (see proposal Non-goals).
Never touch HEL-1755's files: `AssistantService`, `ClaudeConfig`, `ChatAccessService`, the assistant composer,
Settings, any model catalog. Inside `domain/insights` add nothing (the insight config parser lives in
`domain/outputs/InsightConfig.scala`, importing `InsightPreset` read-only).

## Decisions

**D1 Kind registration.** Add `case object Insight` + `"insight"` to `fromString`/`asString` and an
`OutputKind.all: Vector[OutputKind]`. This build sets no `scalacOptions`, so a non-exhaustive match is only a warning:
the real guard is a spec asserting `all.map(asString).map(fromString) == all.map(Right(_))` (dropping `case Insight`
from `asString` surfaces as a MatchError) plus the drift spec. `fromString`'s literal valid-values error message
(`model.scala:637`) is itself a pinned site. `all` is the canonical set every drift check compares against.

**D2 Migration V141** (`V141__outputs_kind_insight.sql`): drop and re-add the `outputs.kind` CHECK with `insight`.
Look up the real constraint name (V94's inline CHECK is auto-named; verify with `\d outputs` on the dev DB) and drop it
by that exact name with `IF EXISTS` guard only if that is the established pattern (V108 is the precedent for widening
a kind CHECK). Check main's highest migration immediately before committing; V141 is this ticket's number (see D2a).

**D2a Renumbered to V141 (driver decision, 2026-11-17, after cycle 1).** The shared dev DB already has HEL-1755's
V140 applied and Flyway has no `outOfOrder` (`Database.scala:23-28`), so a V138 would stay pending below V140 there
forever. Ledger: V140 HEL-1755, V141 this ticket, V142 HEL-1742. Caveat: if V141 merges before V140, any DB that
applies V141 before V140 exists rejects V140 later. CI (fresh DB per run) and the shared dev DB (V140 already applied)
are safe; prod is exposed only if a release is cut between the two merges. No release is planned, and the driver holds
the release until both have merged. The renumber-at-merge rule (C1) still applies if main moves past V141.

**D3 Config contract** (spec "Insight config contract"). `InsightConfig.parse(config): Either[String, InsightConfig]`
in `domain/outputs`, pure, returns effective values with defaults applied (preset auto, refresh on_run,
maxSentences 2, maxChars 400, reads.outputs None, windows empty) — L4 will read through it. Defaults are never written
back. `KnownKeys(Insight)` = `fieldMapping, preset, prompt, reads, refresh, maxSentences, maxChars` (no `compare`, no
`historyPayloads`: an insight has no numeric series to compare and no row payload; `model` deliberately absent per the
2026-11-17 driver comment). Nested unknown keys under `reads` are rejected naming `reads.<key>`. Windows reuse
`OutputCompare.fromString` and reject `previous_run` (not a window). Error messages name the key, in the existing
`OutputConfigValidation` message style. The existing "tolerance rule" (unchanged re-sent values pass) applies
unchanged since no insight row predates this change.
Alternative rejected: letting the generic unknown-key path alone handle insight — it cannot range-check values.

**D4 Reads scoping.** A service-level check `InsightReadsCheck(insightId: Option[OutputId], pipelineOutputs:
Map[OutputId, OutputKind], written, stored)` runs on the VALIDATING write paths, and only judges `reads.outputs` when
the write introduces or changes `reads` (same tolerance rule as `OutputConfigValidation`: a `PATCH {prompt}` on an
insight whose reads dangle after a sibling's deletion succeeds). The six Output write paths (skeptic-design-1) are:
(1) `OutputService.create`/`update` (also reached by `PatchSetApplyForward`) - checked; (2)
`PipelineCreateTransaction` - checked; (3) `DraftSaveTransaction` via `DraftDiff` (new/changed Outputs; DraftDiff's
unchanged-Output short-circuit is kept) - checked; (4) `PatchSetApplyRollback` (`RestorePriorStored`), (5) draft undo
`DraftRestore` (`RestorePriorStored`), (6) `PatchSetUndoService.restoreBoundOutputs` (raw, deliberately unvalidated) -
NOT checked: restoring stored state is never refused. Rules when checked: `pipelineOutputIds` is the pipeline's
Output id set as the write will leave it (for create: the pipeline's persisted Outputs; for draft save: the stored ids
the draft keeps; for a brand-new pipeline: empty, so any id is rejected). A foreign or unknown id, the insight's own
id, and an id naming another `insight` Output (no insight-reads-insight, so L4 never has a cycle) are all 400 naming
`reads.outputs`. `reads.outputs: []` means "no sibling Outputs" (the insight reads only its own node); absent means the
same-node default. A key set to `null` clears it (existing config convention), i.e. is treated as absent. Ids of another pipeline are indistinguishable from unknown ids in the message
(no existence oracle across ACLs). An Output later deleted leaves a dangling id; readers (L4) skip missing ids — L1
does not cascade-edit configs. The executor MUST re-verify this six-path list against the tree and record it in sites.md.

**D5 Bindings/sizing.** `OutputBindingSpec.Insight` = no slots, vacuously bindable (copy of markdown). Panel default
size `w = 6, h = 3`. Node capabilities: report insight like markdown (update the parity fixture
`nodeCapabilitiesParity.json` and `NodeCapabilitiesParitySpec` together). Summary reducer: no code change; a spec pins
null metric/series for insight.

**D6 Surfaces deferred to later leaves = pinned exclusions.** helio-mcp kind enums and `AssistantProposalToolSchemas`
(proposal surface, L8 HEL-1747) and any proposal-side kind list (`ProposalPanelSupport`, dashboard-proposal schema if it
enumerates Output kinds) keep the six kinds. `OutputConfigValidation.KeysDoc` (built from `KnownKeys`, embedded in
`AssistantProposalToolSchemas.scala:297,:461` and `RefinementEditShape.scala:268`) EXCLUDES Insight until L8, so the
assistant is never told about a kind it cannot propose; `AssistantProposalToolSchemasSpec:273` and
`RefinementEditShapeSpec:388` are updated to assert every non-insight KnownKeys key appears and no insight-only key
does, and KeysDoc is a pinned exclusion in the drift table. A refinement edit reaching an existing insight still goes
through `OutputService.update` and is validated; the frontend Output-editor kind picker does not offer insight (L5 HEL-1744).
Each is listed in the drift test's exclusion table with the owning ticket. Opening an existing insight in the Output
editor must not crash: the kind card shows a one-line note ("Insight settings arrive in a later release") and
`buildOutputConfig`/`configPatch` pass the stored config through unchanged.

**D7 Not-yet-rendered state.** `OutputPanelContent` and `LiveOutputRender` render an insight with a shared
`InsightNotRenderedState` (existing empty-state component/tokens per DESIGN.md; copy: "Not yet rendered" + one muted
line "This insight will appear after its first render."). Row fetching is unchanged (`usePanelData` fetches before the kind is
known, as it does for markdown); the insight branch ignores `rawRows` and calls no new endpoint or model. Cross-filtering
(`crossFilterRows.ts`) treats insight as non-filterable, like markdown.

**D8 Drift test (two halves, one canonical list).**
- Backend `OutputKindDriftSpec` (ScalaTest, reads files relative to the repo root the way existing parity specs do):
  canonical = `OutputKind.all.map(asString)`. Checks: the total per-kind maps (`KnownKeys`, `OutputBindingSpec.All`,
  `OutputPanelDefaultSize.Sizes`) have exactly the canonical key set (`LegacyOutputConfigKeys` is NOT a per-kind map:
  it mirrors V117's legacy keys; insight needs no entry because `normalise` is a no-op for a kind without legacy keys);
  `fromString`'s error-message list equals canonical; the LIVE `outputs.kind` CHECK (`pg_get_constraintdef` on the
  test DB after Flyway, in a DB-backed spec) lists exactly canonical, and the parse fails if it extracts nothing; each of the five JSON schemas' kind `enum` (navigate by
  JSON path, not regex on the whole file) equals canonical; each helio-mcp/assistant-tool site equals canonical minus
  its exclusion. Text-extracted sites use a narrow, anchored extraction and the test fails if extraction finds nothing
  (no vacuous pass).
- Frontend jest `outputKindDrift.test.ts`: an exported `OUTPUT_KINDS` const (typed so a missing union member is a tsc
  error) equals the backend canonical list read from a checked-in file or the schema enum; frontend dispatchers whose `kind` is typed `OutputKind` use the `const _exhaustive: never = kind` idiom (OutputPreviewPane); dispatchers fed a wire `string` are pinned by jest tests and recorded mutations; and the picker exclusion is pinned.
- Record, in `drift-mutations.md` in this change dir, for EVERY pinned site: the one-line mutation (drop `insight`),
  the command run, and the failing output line. Also one mutation adding `insight` to an excluded site. Restore after.

**D8a Schema contract docs.** Besides the five enums, add insight to node-capabilities-response's description prose
and add the insight keys and rules (ranges, `reads` shape, `fieldMapping` empty-only, "insight kind only") to the
per-kind config prose and `properties` of create-output-request, update-output-request,
create-pipeline-transactional-output-request and draft-save-request.

**D9 Fail-first.** Before any production change, add the route-level test `POST /api/pipelines/:id/outputs` with kind
`insight` asserting 201; run it red (400) and record the output in `fail-first.md`; then implement.

## Risks / Trade-offs

- [A write path missed by D4 stores an unchecked `reads`] → D4's mandatory path enumeration, listed in tasks, and a
  test per path.
- [Text-extracted drift sites pass vacuously after a refactor] → extraction-found-nothing is a failure.
- [Shared dev DB: V141 applied by this lane is visible to other worktrees] → widening-only migration; harmless to
  older code. Never edit V141 after it has run on the shared DB.
- [HEL-1755 touches nearby code] → stay out of the files listed in Goals.

## Migration Plan

V141 is additive (CHECK widened). Rollback: re-narrow only after deleting insight rows; not expected.

## Planner Notes

Self-approved after skeptic-design-1: KeysDoc excludes insight until L8; insight may not read insight; `[]` vs
absent defined; null clears; live-constraint drift check. Self-approved: `compare`/`historyPayloads` excluded for insight; maxChars 80..1200 default 400; maxSentences 1..6;
prompt <= 2000; windows <= 4; default size 6x3; editor picker excluded until L5; MCP/proposal enums until L8.

Executor notes from skeptic-design-2 (CONFIRM): Context's mention of `LegacyOutputConfigKeys` is superseded by D8.
Also update `OutputConfigValidationSpec.scala:174` (KeysDoc) and `:26-30` (give insight valid values; deliberate edit).
If `PatchSetPreviewProjection` validates output-update previews, note it in sites.md. Frontend exhaustiveness uses the
existing `const _exhaustive: never = x` idiom (`shared/chrome/resourceNavigation.ts:90`).

## Gate-Chain Implications Checklist

Gate-chain script touched: `scripts/check-schema-drift.mjs` (run by `.husky/pre-commit` via `npm run check:schemas`).
The change adds one `KNOWN_PRE_EXISTING_DRIFT` allowance (exact surface label, exact value `insight`) and a loop that
errors on an allowance naming an unknown surface or matching no live drift.

- **What does it execute?** Only `node` on this one script, which reads JSON schemas and Scala/TS source files under the
  repo root and compares enum sets in memory. It spawns no child process and runs no other command.
- **What environment does it inherit, and from where?** The hook shell's environment via husky/npm; the script reads no
  environment variable (no `process.env` use). It resolves the repo root from its own file location
  (`import.meta.url`), not from the cwd.
- **Does it write anything outside its own sandbox?** No. It writes nothing at all: it only prints errors and sets the
  exit code.
- **Does it behave differently from a linked worktree than from a main checkout?** No. Paths resolve relative to the
  script's own location, so a linked worktree checks its own tree; it uses no git commands and no `.git` paths.
- **What happens on its first run?** The same as every run: it reads the tree and exits 0 or 1. It keeps no state or
  cache. `node scripts/check-schema-drift.selftest.mjs` passes, and the hook passed on both branch commits.
