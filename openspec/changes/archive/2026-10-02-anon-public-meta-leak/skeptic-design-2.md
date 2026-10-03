## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- CR1 (schema): schemas/shared/resource-meta.schema.json:6 has createdBy in `required`; revised design D2a + task 2.6 + 3.2 (check:schemas) cover it.
- CR2 (spec): resource-metadata MODIFIED delta present and consistent with the public-dashboards delta.
- CR3 (helio-mcp): helio-mcp/src/types.ts:21 `createdBy: string`; now covered by D2a and task 2.5.
- CR4 (dashboard owner): PublicDashboardRoutes.scala:~425 binds `_` for the directive's ResourceAccess; ResourceAccess.Owner exists (model.scala:797), so the planned `access == Owner || userOpt id == panel.ownerId` decision is implementable. Consequence stated; test pinned (task 1.4).
- CR5: fixture/guard/mutation-evidence now specified (D5, tasks 1.3, 1.5, 3.1); "contains" aligned in spec.
- Wire: ResourceMetaResponse is jsonFormat3 over String (ResourceProtocol.scala:8-24); Option omits None, as designed. Current route uses userOpt.isDefined (line ~447), matching the plan's description.
- No placeholders, no AC uncovered, no scope drift found.

### Verdict: CONFIRM

### Non-blocking notes
- Changing the case-class field to Option[String] breaks positional constructions in tests (AggregatorRegressionSpec:40,54,69; PatchSetUndoInverseSpec:28); executor should update them (Some("u-1")).
- Tasks 2.3 should explicitly mention the `_` -> named `access` binding.
