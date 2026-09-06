# HEL-990: Harden the nodePath wiring guard against an ancestor gaining a title attribute

## Description

Spun off from HEL-985 (PR #558, merged as `f93efa9d`), raised by that run's final-gate skeptic as non-blocking.

HEL-985's wiring guard in `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` locates a step's rendered path by walking from the step's visible label to `closest("[title]")`, then asserting on that attribute (helper `titleFor`, lines 621-626).

That query is correct **only because no ancestor of a step card currently carries a `title`**. It is not defended by anything — it is a property of today's DOM, not an invariant anyone declared.

If any ancestor later gains a `title` (a lane tooltip, a root-column tooltip, a hover hint on a wrapper `div`), `closest("[title]")` silently starts resolving to that ancestor instead of the step's own wrapper. The consequence is specific: the **deletion-form** mutation — removing the `nodePath()` call entirely, so the step wrapper renders no `title` at all — would start **passing**, because the walk would find the ancestor's `title` and assert against it instead of failing with "No title-bearing ancestor".

The **value-mismatch** mutation form (neutering the call site to `entries[step.id] = step.id` while leaving `title` present) still catches the regression, since the assertion compares an exact string. So the guard degrades rather than dying outright — one of its two mutation forms goes vacuous, not both.

### Fix direction (from the ticket)

Remove the dependency on ambient DOM structure. Either:
- add a `data-testid` to the step wrapper that owns the `title` and query that directly; or
- scope the `closest` search to the known wrapper classes (`.pipeline-detail-page__step-section` / `.pipeline-detail-page__tail-chain-step`) and assert `hasAttribute("title")` before reading it, so an absent attribute fails loudly as an absent attribute.

HEL-985 deliberately avoided `sectionFor()`, the file's existing helper, because it queries `.pipeline-detail-page__step-section` only and cannot find the compact tail-chain site's `.pipeline-detail-page__tail-chain-step` wrapper. Any scoped-query fix must cover both.

The `data-testid` option would require a product-code change, which conflicts with the zero-product-diff acceptance criterion below. The scoped-`closest` option is therefore the expected shape unless a stronger reason emerges.

## Acceptance Criteria

- The guard no longer depends on the ambient fact that no ancestor of a step card has a `title`.
- **Verify by mutation, both ways, with a recorded transcript — not a claim:**
  - Add a `title` to an ancestor container in the fixture's render tree, then delete the `nodePath()` call site; the test must **still go red**, and red for the right reason (an absent-attribute failure naming the step wrapper, not an unrelated fixture break).
  - Confirm the value-mismatch mutation (`entries[step.id] = step.id`) stays red independently.
  - Both forms must be failable **independently** — neither may rely on the other to produce the red.
- No product-code change. HEL-985's zero-product-diff property is preserved: the diff touches `PipelineRiverView.test.tsx` (and openspec artifacts) only.
- Fixture-indistinguishability check: HEL-985 nearly shipped a fixture where `Step.rootId` was unset everywhere, making every expected title fall back to a bare step id — identical to the value-mismatch mutation's own output. Confirm the fixtures used here do not reintroduce any state where the correct and mutated outputs are indistinguishable. If two mutations produce the same observation, that is one axis wearing two labels; the fix is a second falsifiable observation (and note that fixture length is not always where one exists — see HEL-994).
- All pre-existing tests in `PipelineRiverView.test.tsx` continue to pass, and the six existing `nodePath wiring (HEL-985)` assertions keep their current expected values.

## Hard environment constraint (non-negotiable)

A sibling ticket (HEL-974) holds the dev PostgreSQL exclusively for an RLS migration. This work is **frontend-Jest-only**:
- Do **NOT** run any backend spec (`sbt test`, `sbt run`).
- Do **NOT** start a backend dev server.
- Do **NOT** open a database connection.
- Do **NOT** use Playwright or run any e2e spec.

If the work appears to require any of these, **stop and escalate** rather than proceeding. A stray connection during a migration run poisons `flyway_schema_history` for another run.

Verification is limited to: `npm test -- --testPathPattern=PipelineRiverView`, `npm run lint`, `npm run typecheck`, `npm run format:check`.
