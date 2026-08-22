# Services — Hooks

Webhook-triggered pipeline runs.

Holds: `HookTriggerService`.

Does NOT hold: business logic for other domains, or persistence. `hooks` is the
one domain with **no** `infrastructure/persistence/hooks/` subpackage — it owns no
tables. `HookTriggerService` reaches storage through `persistence/pipelines/`
(`PipelineRepository`, `PipelineRunRepository`) and never calls `db.run` directly
(CONTRIBUTING.md). `private[services]` members here stay reachable from every other
domain subpackage (no encapsulation implied by the split).
