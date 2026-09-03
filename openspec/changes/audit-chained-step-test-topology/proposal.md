## Why

`PipelineStepRepository.insert(...)` has no `parentStepId` parameter and is
structurally incapable of chaining steps: every row it writes is a root-level
branch reading straight from the source. Thirteen call sites in
`PipelineRunRoutesSpec` read as "add the next step". Where two such calls appear
in one test, the test believes it built a two-step trunk and has actually built
two parallel single-step pipelines. Those tests pass either way, so the wrong
topology never surfaces.

This is a blind-gate *generator* rather than a single blind gate: one shared
method manufactures the same wrong assumption in every test that uses it.
HEL-922 hit this while adding `stepRowCounts` assertions, worked around it with
`insertInternal(..., parentStepId = ...)`, and left an in-file warning comment —
but the remaining call sites were never audited and the trap is still armed.

## What Changes

- **Audit** all 33 call sites across the **four** consuming test files
  (`PipelineRunRoutesSpec` 12, `PipelineAnalyzeRoutesSpec` 12,
  `PipelineStepRepositorySpec` 7, `WorkspaceContextServiceSpec` 2),
  recording per-site whether the test's original
  intent was a chained trunk or parallel roots, with justification drawn from the
  test's own name, comments and assertions.
- **Correct** the sites whose intent was chained to build a real trunk via
  `insertInternal(..., parentStepId = Some(...))`; leave genuinely-root sites as
  roots and say so explicitly. Single-step tests are topology-independent and
  stay as roots.
- **Mutation-check** every test whose topology changes: demonstrate the assertion
  goes RED under a deliberate break once the shape is correct, and record the
  mutation and observed failure. A test still passing under both topologies is
  reported as having tested nothing either way.
- **Disarm the trap** by making the API state what it does, so the next author
  cannot read it as "append the next step". `insert` has **zero production call
  sites** (test-only in practice, per its own comment), so this is a contained
  rename/signature change, not a production-wide ripple.
- **Report** whether any audited test was asserting something that holds only
  under one topology — a real coverage hole, distinct from a naming problem —
  including the "none found" outcome if that is the answer.

## Capabilities

### New Capabilities

None. This change adds no product behavior.

### Modified Capabilities

None. `PipelineStepRepository.insert` has no production callers, so no
externally-observable pipeline behavior, route contract, or persisted shape
changes. Every edit is confined to test topology and a test-only method's name
and signature. `skip_specs: true` is set in `.openspec.yaml` accordingly — no
requirement is invented to satisfy validation.

## Impact

Six files. The rename in D4 is compiler-enforced, so **every** consuming test
file is necessarily in scope — the earlier two-file scope claim was wrong and is
corrected here.

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
  (`insert` -> `insertRootStep`; rename + scaladoc only; zero production callers)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`
  (12 sites; 4 of them in 2 multi-step tests)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala`
  (12 sites; 2 of them in 1 multi-step test)
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpec.scala`
  (7 sites; all single-step)
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala`
  (2 sites; both in 1 multi-step test)
- `openspec/changes/audit-chained-step-test-topology/audit-report.md` (new deliverable)

No migrations, no route changes, no frontend, no schema/spec deltas.
