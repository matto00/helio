## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read the round-1 report (`skeptic-design-1.md`) as a claim to re-check, then read
the current `tasks.md`, `proposal.md`, `design.md` fresh, and independently
re-verified both change requests against real source — not the orchestrator's
narrative of having fixed them.

**CR1 (tasks.md 1.1/5.1 — nonexistent `DashboardProposalServiceSpec`)**

- Current 1.1 text now reads: "the existing route-level `DashboardApplyProposal*Spec`
  suites + `DashboardProposalProtocolSpec` must all stay green, unmodified." Ran
  `find backend/src/test -iname "DashboardApplyProposal*Spec.scala" -o -iname
  "DashboardProposalProtocolSpec.scala"` — all seven cited files exist exactly as
  named: `DashboardApplyProposalSpec.scala`, `...AggregationSpec`, `...BindingSpec`,
  `...ConfigSpec`, `...MetricBindingSpec`, `...TimelineSpec` (all under
  `backend/src/test/scala/com/helio/api/`), and
  `backend/src/test/scala/com/helio/api/protocols/DashboardProposalProtocolSpec.scala`.
  No dangling reference to the old fictitious name remains anywhere in
  `tasks.md`/`proposal.md`/`design.md` (confirmed via `grep -rn
  "DashboardProposalServiceSpec"` across the change dir — the only hits left are
  inside the historical `skeptic-design-1.md` record itself).
- Current 5.1 text now reads: "No unit-level spec for `DashboardProposalService`
  exists today... Add a new unit spec (mocked repos, no Postgres harness) directly
  exercising `validate`." Round 1 had asserted this was infeasible because
  `DataTypeRepository`/`MetricRepository` are concrete classes with "no trait/mock
  seam." I re-checked that claim rather than trusting either side: both are indeed
  concrete, non-final classes (`class DataTypeRepository(ctx: DbContext)...` at
  `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala:12`,
  `class MetricRepository(ctx: DbContext)...` at
  `backend/src/main/scala/com/helio/infrastructure/MetricRepository.scala:23`) —
  but `mockito-core` is a real test dependency (`backend/build.sbt:105`), and
  `backend/src/test/scala/com/helio/services/PanelServiceMetricBindingSpec.scala`
  already mocks these exact two concrete classes directly (`mock(classOf[DataTypeRepository])`,
  `mock(classOf[MetricRepository])`, repeated 8x) and feeds them into
  `ProposalPanelSupport.preValidateBindings` (the same method 5.1's target `validate`
  wraps). So a Mockito-mocked-repos unit spec for `validate` is a real, already-proven
  pattern in this codebase — 5.1 as revised is feasible and correctly grounded; no
  Postgres harness is actually required, contrary to round 1's stricter suggested
  fix. This is a valid alternative resolution, not a dodge.

**CR2 (tasks.md 2.3 — combined schema file)**

- Current 2.3 text now plans two files: `schemas/dashboard-authoring-request.schema.json`
  (title `DashboardAuthoringRequest`) and `schemas/dashboard-authoring-response.schema.json`
  (title `DashboardAuthoringResponse`, `proposal` field `$ref`-ing
  `dashboard-proposal.schema.json`). Confirmed no `dashboard-authoring*.schema.json`
  file exists yet (correct — not implemented at design gate) and that the cited
  precedent pair is real: `schemas/bound-panel-request.schema.json` has
  `"title": "BoundPanelRequest"`, `schemas/bound-panel-response.schema.json` has
  `"title": "BoundPanelResponse"` (grepped both files directly). Read
  `scripts/check-schema-drift.mjs` (the binding `.husky/pre-commit` gate): it maps
  each schema file's single top-level `title` to one Scala case class and diffs
  top-level `properties` keys against that case class's fields — a two-file split
  with a `$ref` to another file's `$defs`/root shape is exactly its expected shape
  (matches how `dashboard-proposal.schema.json` itself is already referenced
  elsewhere) and produces no drift, since `proposal`/`warnings` (2.3's cited fields)
  match task 2.2's `DashboardAuthoringResponse(proposal, warnings)` case class 1:1.
  This resolves CR2 correctly.

**Budget / validation**

- `wc -l tasks.md` → exactly 80 lines — within the 80-line budget cited by the
  orchestrator's task.
- `openspec validate nl-dashboard-proposal-authoring --strict` → `Change
  'nl-dashboard-proposal-authoring' is valid`.
- Re-read `proposal.md` and `design.md` in full: no drift introduced by the
  tasks.md edits — D1/D5's "verified against its own existing test suite" /
  "reuses the apply path's own validation exactly" language is consistent with
  the now-corrected regression-suite naming, and no other placeholder/TBD/
  contradiction surfaced on a fresh full re-read of both files.

### Verdict: CONFIRM

Both round-1 change requests are genuinely resolved in the live artifacts, not
just narrated as resolved: 1.1/5.1 now cite real, existing test files and a
feasible (precedent-backed) mocking strategy for the new `validate` spec; 2.3 now
plans a two-file request/response schema split matching the codebase's
zero-exception convention and the binding `check:schemas` gate's actual logic.
The change validates cleanly and tasks.md remains within its line budget. No new
issues surfaced on this fresh pass.

### Non-blocking notes

- tasks.md 2.3 doesn't explicitly restate that `AuthoringContextOptions` (task
  2.1's nested type) should live as a `$defs` entry inside
  `dashboard-authoring-request.schema.json` rather than its own file — round 1
  suggested this explicitly by analogy to `ProposalPanelLayout`/`ProposalPanel`
  nesting inside `dashboard-proposal.schema.json`. The "one-title-per-file"
  phrasing that remains implies it, and `check-schema-drift.mjs` only checks
  top-level titles (a stray third file wouldn't break the gate, just be
  redundant), so this is a documentation nicety for the executor, not a design
  defect worth another round.
