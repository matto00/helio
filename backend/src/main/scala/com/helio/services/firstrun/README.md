# Services — First run

The deterministic, rule-based zero-to-dashboard build: classify a CSV source's columns, plan a
pipeline and outputs from the shapes registry, apply and run it, then lay out a dashboard.

Holds: `ColumnClassifier`, `FirstRunDashboardService`, `FirstRunPlanner`, `PersonaTemplates`.

Persona sample-data templates (HEL-1210, `PersonaTemplates`): `FirstRunDashboardService.buildTemplate`
creates the caller's own `Sample: ...` CSV source from a bundled classpath dataset
(`resources/templates/`), then runs the same apply path as the rule planner with the template's
explicit pipeline, chart types, table column order and layout. Any failure after the source exists
deletes it again.

Does NOT hold: any Claude/LLM collaborator — the constructor has none, so the first-run path is
structurally non-AI for every tier — or persistence (`infrastructure/persistence/`). Composes
`PipelineProposalService` and `DashboardProposalService` rather than writing resources itself.
