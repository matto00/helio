# HEL-1522 mutation runs and red-first evidence (C3)

Each row: the production line changed, the specs run, the failing tests. The production file was restored after every
run (script kept `git diff` clean of mutations; final targeted runs are green). Test workers capped (`nice -n 19`,
sbt `-J-Xmx3g`).

| # | Mutation | Specs | Result |
|---|----------|-------|--------|
| 1 | `PatchSetPipelineDefinition.outputsJson`: `alertRules` replaced by a constant empty array | StaleDefinitionGaps, StaleWidenedFingerprint, StaleCascade | RED (5): gaps `alert rule on an Output was edited` (update, delete); widened `refuse a update / delete after an alert rule was created`; cascade `step delete ... alert rule created on an Output of the step` |
| 2 | `Allowlist("output")` loses `panelIds`, `alertRules` | StaleCascade | RED (4): output delete after panel bound / alert rule created / edited / deleted |
| 3 | `Allowlist("pipelineStep")` loses `removedSteps` | StaleCascade | RED (3): removed tail step edited; new child under tail root; sibling reorder changing the promoted child (4.2a) |
| 4 | `Allowlist("pipelineStep")` loses `outputs` | StaleCascade | RED (3): panel bound on step Output; on removed tail step Output; alert rule on step Output |
| 5 | schedule `enabled` dropped from the pipeline definition | StaleDefinitionGaps | RED (2: update, delete) |
| 6 | schedule `timezone` dropped | StaleDefinitionGaps | RED (2) |
| 7 | step `position` dropped from `StepKeys` | StaleDefinitionGaps | RED (2) -- the dedicated "step's position changed" test; the reorder test alone was masked by `parentStepId` |
| 8 | step `parentStepId` dropped | StaleDefinitionGaps | RED (2) |
| 9 | Output `kind` dropped from `OutputKeys` | StaleDefinitionGaps | RED (2) |
| 10 | Output `nodeStepId` dropped | StaleDefinitionGaps | RED (2) |
| 11 | skip the apply-once claim (`PatchSetApplyOnce.run` always just applies) | PatchSetApplyOnceRoutesSpec | RED (3): second apply 409; unrecoverable rollback keeps the claim; concurrent applies once. This IS the item-3 red-first: with no claim the same create-only patch set with a `proposalId` applied twice creates two resources (the no-`proposalId` test shows the same two-resource outcome as the baseline). |
| 12 | pipeline-delete naming hint disabled | PatchSetPipelineDeleteImpactRoutesSpec | RED (5 of 6) |
| 13 | removal rule tie-break by id removed (position only) | PipelineStepRemovalRuleSpec | RED (1): tie broken by arrival order |

Not run as a mutation: the stale-refused / clean-rollback release tests pass vacuously under mutation 11 (they assert
a later apply succeeds, which is also true with no claim); their failability is covered by the keep-claim test, which
goes red when the claim is skipped, and by the claim being the only thing that makes the second apply 409.

## Not reproduced
The refinement-drawer double apply (`RefinementChatDrawer` clears the stored conversation before navigating) was not
reproduced. The assistant hand-off (`extractProposal` re-rendering the latest proposal with no applied state) is the
confirmed path.

## Cycle 3: V131 RLS under NOSUPERUSER NOBYPASSRLS (skeptic-final-2 CR1/CR2)

New `PatchSetAppliedProposalsRlsSpec` (non-owner role and table-owner role) and a post-chain FORCE assertion in
`FlywayNonSuperuserMigrationSpec`. Mutations were applied to `V131__patch_set_applied_proposals.sql` and restored
afterwards (`git diff` of the file is empty).

| Mutation | Result |
|----------|--------|
| delete `FORCE ROW LEVEL SECURITY` | RED (4): the flags test (both roles); the owner-role "owner INSERT/SELECT, hide others' rows" case (the table owner now bypasses RLS, which only the owner role can show); `FlywayNonSuperuserMigrationSpec` |
| delete `CREATE POLICY` | RED (6): flags/policy test, cross-owner and real claim-path tests for both roles |

Claim-table RLS is now proven under real non-bypassing roles (incl. the table owner), not only by code reading.
