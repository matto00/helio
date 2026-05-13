# HEL-236 CS2c Handoff — Panel + DataSource ADT Remodel

**Date:** 2026-05-13
**Linear:** [HEL-236](https://linear.app/helioapp/issue/HEL-236)
**Status:** CS2c not yet started. CS1, CS2a, CS2b ✅ merged.
**Purpose:** Bootstrap CS2c if the session continuing this work is lost or context is muddled.

This doc is self-contained. Read it top-to-bottom and you have everything needed to draft the CS2c OpenSpec proposal and invoke the executor + evaluator. Do **not** rely on session memory.

---

## TL;DR for the next session

You (the orchestrator) need to:

1. Read this doc in full
2. Read `CONTRIBUTING.md` (binding for all edits — especially _Imports & Qualifiers_ and file-size budgets)
3. Read the active memory files: `feedback-no-inline-fqns.md`, `feedback-refactor-discipline.md`, `project-backend-architecture-remodel.md`
4. Create a worktree off `main` for CS2c: `task/backend-domain-adts/HEL-236` → `.worktrees/HEL-236-cs2c`
5. Draft the OpenSpec proposal (proposal.md, design.md, tasks.md, ticket.md) per CS2c scope below
6. Invoke `linear-executor` (model: opus, high effort) with a self-contained briefing prompt
7. Invoke `linear-evaluator` (model: opus, high effort) after executor returns — **Phase 3 Playwright smoke is required** (wire shape evolves; verify frontend still works against the new contract)
8. Fold any blockers back via SendMessage to the executor; push + open PR when clean
9. Pause for user merge before starting CS3

---

## Where HEL-236 is right now

HEL-236 grew mid-flight from a 4-PR structural refactor into a 6-PR architectural remodel. **CS2c is the largest and most consequential change set.**

| CS       | Status                    | What                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CS1      | ✅ merged (PR #146)       | Split `JsonProtocols.scala` (832 → 34 lines) into 8 per-domain protocol traits under `com.helio.api.protocols`. Introduced `PathMatcher1[T]` ID segments via `IdParsing.scala`.                                                                                                                                                |
| CS2a     | ✅ merged (PR #147)       | Routes decomposed. ID-wrapper rollout on remaining routes. `PanelRoutes` PATCH flattened. `DashboardRoutes` PATCH deduped. Repository/directive `extends JsonProtocols` narrowed. 5 routes split. Every route ≤ 150 lines except `PipelineRunRoutes` (CS2c).                                                                   |
| CS2b     | ✅ merged (PR #148)       | Service-layer extraction. `services/` package with 11 service classes. Routes shrink to thin `entity → service → ServiceResponse` adapters. `AccessChecker` for ACL inside services. `ServiceError` → HTTP mapping. `PanelPatchService` → `PanelService`. `resolvePanels` triplication eliminated. Wire shapes byte-identical. |
| **CS2c** | **← THIS**                | Panel + DataSource sealed-trait ADTs. **Wire shape evolves alongside.** `InProcessPipelineEngine` split. `PipelineRunRoutes` decomp. `DataSourceRepository.rowToDomain` alignment. Inner-vs-left-join policy codified. Pipeline repo ID narrowing + missing `IdParsing` segments.                                              |
| CS3      | pending (blocked by CS2c) | Frontend structure — feature folders.                                                                                                                                                                                                                                                                                          |
| CS4      | pending (blocked by CS3)  | Frontend decomposition + domain-aware components (`MetricPanelView`, etc.) mirroring backend subtypes.                                                                                                                                                                                                                         |

Parallel work (off-CS2c critical path):

- **HEL-256** (P0 DataSource schema disappearance after restart) — address as side-PR off main; expected to surface during CS2c design
- **HEL-242** (P0 Panel ↔ DataType binding) — deferred until CS2c lands; the polymorphic `Panel` ADT fixes this naturally
- **HEL-265** (Push ACL down to repo/SQL layer) — backlogged; scheduled for **after** CS2c since CS2c will already be touching every repo's `rowToDomain`

---

## CS2c scope

### Architectural goal

Replace the wide-nullable `Panel` and `DataSource` case classes with sealed-trait ADTs containing strict per-type subtypes. **Polymorphic methods** (`evaluate`, `validateConfig`, etc.) defined on the trait dispatch via subtype rather than enum switching. **Wire shape evolves** — `PanelResponse` and `DataSourceResponse` become discriminated unions over the wire, and the frontend adapts in lockstep.

### Panel ADT (strict per-type)

User decision in this session: **strict per-type, 7 subtypes today.** Common methods will reveal where intermediate traits belong; restructure later if natural. Do **not** start with grouped hierarchies.

```scala
sealed trait Panel {
  def id: PanelId
  def dashboardId: DashboardId
  def title: String
  def meta: ResourceMeta
  def appearance: PanelAppearance
  def ownerId: UserId
}

// Bound-to-data subtypes
final case class MetricPanel(...) extends Panel
final case class ChartPanel(...) extends Panel
final case class TablePanel(...) extends Panel

// Content subtypes
final case class TextPanel(...) extends Panel
final case class MarkdownPanel(...) extends Panel
final case class ImagePanel(...) extends Panel

// Structural subtypes
final case class DividerPanel(...) extends Panel
```

Each subtype carries **only the fields it needs.** Current bag of nullable `content` / `imageUrl` / `dividerOrientation` / `dividerWeight` / `dividerColor` / `imageFit` / `typeId` / `fieldMapping` distributes naturally by subtype.

### DataSource ADT

```scala
sealed trait DataSource {
  def id: DataSourceId
  def name: String
  def ownerId: UserId
  def createdAt: Instant
  def updatedAt: Instant
}

final case class CsvSource(...) extends DataSource
final case class RestSource(...) extends DataSource
final case class SqlSource(...) extends DataSource
final case class StaticSource(...) extends DataSource
```

### Wire shape evolution

**This is the part the previous change sets explicitly avoided.** CS2c evolves the wire shape to be a discriminated union with a `type` discriminator. Old:

```json
{
  "id": "...",
  "type": "metric",
  "title": "...",
  "content": null,
  "imageUrl": null,
  "dividerOrientation": null,
  ...lots of nulls...
}
```

New:

```json
{
  "type": "metric",
  "id": "...",
  "title": "...",
  "config": { "valueLabel": "...", "unit": "..." }
}
```

Each subtype emits only its own fields. The `type` discriminator names which subtype the JSON represents. **Frontend executors are bound to update consumers in lockstep** within CS2c — this is a coordinated cross-tier change, not "backend now, frontend later."

### Bundled in CS2c (the long tail)

Bundled because each item naturally touches the same code paths as the ADT remodel:

1. **`InProcessPipelineEngine.scala` split** (459 lines → dispatcher + executor + step-counts, target each ≤ 250 lines)
2. **`PipelineRunRoutes.scala` decomp** (378 lines → thin route + service helpers). Per CS2b's "Out of scope" note, this is the run-lifecycle work bundled with the engine split.
3. **`DataSourceRepository.rowToDomain` alignment.** Today it does its own JSON marshalling. CS2c's DataSource ADT discriminator unpacking is the natural moment to align with the other repos.
4. **Inner-vs-left-join policy codification.** HEL-200 surfaced this. Pick one and stick to it; document in CONTRIBUTING or as an ADR-style comment.
5. **Pipeline repos accept value-class IDs.** CS2b deferred this; `PipelineRepository`, `PipelineStepRepository`, `PipelineRunRepository` still take raw `String`. Narrow signatures to `PipelineId`, `PipelineStepId`, `PipelineRunId`.
6. **Add `PipelineStepIdSegment` to `IdParsing.scala`.** A `case class PipelineStepId(value: String) extends AnyVal` exists in `domain/model.scala:321` but has no `PathMatcher1`. `PipelineRunId` doesn't even have a value class yet — introduce it + matching segment.
7. **`resolvePanels` final cleanup.** CS2b absorbed the function into `PanelService.resolveBindingsForRead`. `PublicDashboardRoutes` now consumes that. Double-check no stragglers remain.

### Out of CS2c scope

- **Frontend structure (CS3) and decomposition (CS4)** — separate PRs. CS2c only updates the frontend code that consumes the evolved wire shape (Redux slices, type definitions, panel renderers); it does not move files into feature folders or split god components.
- **ACL pushdown to repo/SQL layer (HEL-265)** — explicit follow-up; do NOT pull into CS2c.
- **HEL-242 panel binding fix** — naturally falls out of the ADT remodel but should not be marked complete in CS2c. Verify the bug is gone post-CS2c; if so, close HEL-242 with a reference to the CS2c PR.
- **New endpoints, new fields beyond what ADT discrimination requires.** The wire shape evolves _because of_ the ADT; no opportunistic feature additions.

---

## Hard rules binding the executor

These are non-negotiable and enforced. The executor's agent definition already references CONTRIBUTING.md; reinforce in the prompt.

1. **CONTRIBUTING.md is binding.** Especially:
   - _Imports & Qualifiers_: NO inline FQNs. Top-of-file imports only. Pre-commit hook (`scripts/check-scala-quality.mjs`) blocks commits that violate.
   - File-size soft budgets (~250 lines per source, ~80 aggregator). Routes target ≤ 150 lines.
2. **Refactor discipline.** Trivial bugs may be fixed inline (call out in report). Non-trivial bugs become **spinoff candidates** in the final report. The user explicitly stated this rule.
3. **Wire-shape evolution is coordinated.** Backend AND frontend update in the same PR. Frontend executors/evaluators are bound to the new contracts. If a backend change is made without a frontend counterpart, the PR is incomplete.
4. **No drive-by improvements.** The ADT remodel is the focus. Resist temptation to also "fix" something tangential.
5. **HEL-242 P0 is NOT in scope.** Verify post-hoc that it's gone, but don't directly target it.

---

## Pre-commit hook (mechanical FQN enforcement)

Lives at `scripts/check-scala-quality.mjs`. Wired into `.husky/pre-commit` via `npm run check:scala-quality`.

- **Hard-fails** on inline FQNs matching the prefixes in `FQN_PREFIXES` (currently: `com.helio.`, `spray.json.`, `org.apache.pekko.`, `org.postgresql.`, `java.util.UUID`, `java.util.Base64`, `java.util.concurrent.`, `java.nio.charset.`, `java.security.`, `scala.concurrent.`, `at.favre.lib.`, `slick.jdbc.`)
- **Warns** (no fail) on file-size budget violations

If the executor encounters an FQN pattern that isn't caught and should be, extend `FQN_PREFIXES`. Don't relax the rule.

---

## How to invoke the executor

Set up:

```bash
cd /home/matt/Development/helio
git fetch --prune origin && git pull --ff-only origin main
git worktree add -B task/backend-domain-adts/HEL-236 /home/matt/Development/helio/.worktrees/HEL-236-cs2c main
```

Write the OpenSpec artifacts under `.worktrees/HEL-236-cs2c/openspec/changes/2026-XX-XX-backend-domain-adts/`:

- `ticket.md` — CS2c scope + standards binding (model on prior change sets)
- `proposal.md` — Why, what, scope, acceptance criteria, risk
- `design.md` — ADT package layout, wire shape transition spec, polymorphic method strategy, frontend coordination plan, repo migration, test strategy
- `tasks.md` — Numbered checkboxes the executor will mark `[x]`

Then invoke (use the `linear-executor` agent type, model `opus`, high effort). The prompt must be self-contained:

- Orchestrator parameters (`CHANGE_NAME`, `WORKTREE_PATH`, `TICKET_ID`, no `EVALUATION_REPORT_PATH` on cycle 1)
- Mission summary (one paragraph)
- Standards binding (reference CONTRIBUTING.md + the agent definition's Step 1)
- Critical correctness areas (see below)
- Hard rules (4–5 bullets)
- Reporting requirements (specific report structure)

### Critical correctness areas for the CS2c executor

1. **Wire shape transition.** Every JSON-emitting code path must be audited. The pre-CS2c flat shape lives in tests + frontend; the post-CS2c discriminated-union shape must agree with the frontend's new TypeScript types byte-for-byte.
2. **`Option[Option[_]]` PATCH semantics.** Currently preserved in `PanelService.update` via `ResolvedPanelPatch`. The ADT refactor changes the patch shape — typed sub-PATCH requests per panel type. Verify the new semantics are correct AND that the old "absent vs. explicit null" semantics still hold where applicable.
3. **AuthService security paths.** Unchanged in CS2c; verify by `git diff` that `services/AuthService.scala` is untouched (or only mechanical compile fixes).
4. **Pipeline engine + run lifecycle.** The split is meaty. The engine's op dispatcher should be polymorphic on `Step` ADT once steps follow the same pattern (defer step ADT to a future CS unless it falls out naturally).
5. **Frontend type definitions.** `frontend/src/types/models.ts` defines `Panel` as a flat type today. CS2c replaces with a discriminated union (`type Panel = MetricPanel | ChartPanel | ...`). All consumers (Redux slices, panel renderers, panel detail modal, panel creation modal) must update.

### Suggested per-area sequencing within CS2c

Recommend the executor commit per area for bisect. Tentative order (executor may revise):

1. **Foundations** — add `PipelineStepId` segment + `PipelineRunId` value class + segment; narrow pipeline repo signatures
2. **DataSource ADT** — backend domain → infrastructure → service → JSON formatter → wire shape → frontend types → consumers
3. **Panel ADT** — same shape
4. **InProcessPipelineEngine split** — dispatcher + executor + step-counts
5. **PipelineRunRoutes decomp** — service-layer extraction for run lifecycle (matches CS2b shape)
6. **rowToDomain alignment** — DataSourceRepository normalized; document join policy
7. **Frontend smoke verification** — Playwright smoke test runs in evaluator's Phase 3

---

## How to invoke the evaluator

`linear-evaluator` agent, model `opus`, high effort.

**Phase 3 (Playwright smoke) is required for CS2c** because the wire shape changes. The evaluator must run the full smoke flow against the running backend+frontend to verify that the contract negotiation is correct end-to-end. Use ports `DEV_PORT=5174` and `BACKEND_PORT=8081` to avoid colliding with the user's local dev.

Smoke flow (minimum):

1. Login (`matt@helio.dev` / `heliodev123`) — confirms `AuthService` untouched
2. Create dashboard
3. Create one of each panel subtype that has UI affordance (metric, chart, text, table, divider, image, markdown)
4. Verify each panel renders with the new wire shape
5. PATCH a metric panel's value label — confirms typed PATCH dispatch
6. Snapshot export → import — full round-trip through the new shape
7. Create CSV / REST / Static data source — each path through the new DataSource ADT
8. Create pipeline + run — confirms engine split didn't break run lifecycle

If any step fails, BLOCKER.

---

## Files NOT to touch in CS2c (red flags if modified)

- `services/AuthService.scala` — security-sensitive, untouched since CS2b
- `services/PasswordHasher.*` (if extracted) — same
- `domain/ExpressionEvaluator.scala` — pipeline expression engine, untouched
- Anything under `infrastructure/` Slick column definitions unless directly required for ADT discriminator unpacking
- `.husky/pre-commit` / `scripts/check-scala-quality.mjs` / `CONTRIBUTING.md` — meta-infrastructure, only update if extending the FQN prefix list

---

## Reviewer feedback patterns (from CS1, CS2a, CS2b)

Three patterns have repeated. Brief the executor on each:

1. **Inline FQNs.** Three PRs in a row introduced them. The hook should now catch them mechanically, but the executor should still audit imports proactively. Pre-emptive grep before commit: `grep -rE "(com\\.helio\\.|spray\\.json\\.|org\\.apache\\.pekko\\.|scala\\.concurrent\\.|org\\.postgresql\\.|java\\.util\\.concurrent\\.)" backend/src/main/scala | grep -vE "(import |package )"`.
2. **`Option[Option[_]]` semantics.** Distinguishes absent / explicit-null / value over the wire. The ADT remodel changes the shape but the semantic distinction may need to persist for certain fields (e.g., `typeId` on bound panels). Audit explicitly.
3. **Spec/code agreement.** OpenSpec tasks.md should accurately reflect what landed. The evaluator spot-checks tasks against the diff.

---

## Memory / context references

These live in `~/.claude/projects/-home-matt-Development-helio/memory/` and load automatically:

- `MEMORY.md` — index
- `project-backend-architecture-remodel.md` — the architectural intent (this doc summarizes a piece of it)
- `project-helio-vision.md` — broader product direction, agentic platform
- `project-panel-datatype-binding-p0.md` — HEL-242 context
- `feedback-no-inline-fqns.md` — pet peeve, now mechanically enforced
- `feedback-refactor-discipline.md` — behavior-preserving rule; trivial inline / non-trivial spinoff
- `feedback-pipeline-op-wiring.md` — checklist for new pipeline ops (relevant if CS2c touches pipeline op patterns)
- `reference-dev-account.md` — login credentials for smoke tests

---

## Quick orientation: useful greps and reads

```bash
# Current Panel domain definition
grep -n "case class Panel\b\|sealed trait Panel" backend/src/main/scala/com/helio/domain/model.scala

# Current DataSource definition
grep -n "case class DataSource\b\|sealed trait DataSource" backend/src/main/scala/com/helio/domain/model.scala

# Wire shape today (CS2b output)
cat backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala     # 211 lines
cat backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala # 166 lines

# Frontend Panel type (target for evolution)
grep -n "interface Panel\|type Panel" frontend/src/types/models.ts

# Service-layer state
ls backend/src/main/scala/com/helio/services/
```

---

## Open questions to resolve in CS2c design

The user has already locked in:

1. ✅ Wire shape evolves alongside backend
2. ✅ Strict per-type Panel ADT (7 subtypes today)
3. ✅ DataSource ADT in the same PR
4. ✅ HEL-242 deferred; HEL-256 parallel side-PR

Things still open for the orchestrator to decide during proposal drafting:

- **Pipeline `Step` ADT in CS2c, or later?** Steps are similar in spirit (each op has its own config shape). Recommend leaving for a future CS to keep CS2c focused — the engine split is meaty enough.
- **Migration strategy for stored Panel rows.** The DB has `panels.type` + various nullable columns today. Two options: (a) keep the table shape, just discriminate on the type column when reading; (b) split columns into `metric_panels` / `chart_panels` etc. tables. Recommend (a) — less surgery, no migration needed, and the typed ADT layer hides the DB shape.
- **Frontend update strategy.** Option (a): backend ships new shape with both old and new keys in the JSON for one PR, then frontend updates and a follow-up removes the old keys. Option (b): backend and frontend ship together, no transition layer. Recommend (b) since we have a single deployment pipeline.

---

## When to start CS2c

User said they will pick this up later today. **Do not start CS2c unprompted** — wait for the user to confirm. When they do, this doc is your starting point. Drafting the proposal alone is ~1 hour of work; the executor cycle is multi-hour. Plan for the full session.

---

End of handoff.
