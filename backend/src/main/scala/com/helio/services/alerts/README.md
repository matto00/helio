# Services — Alerts

Alert rule evaluation and alert event lifecycle (evaluate/acknowledge/snooze/resolve).

Holds: `AlertEvaluationService`, `AlertEventService`, `AlertRuleService`.

Does NOT hold: the alert **lifecycle state machine** — that is
`domain/engine/AlertEventStateMachine.scala`. `domain/` is split by kind rather
than by domain, so it is the one part of the alerts stack a `services|api|
infrastructure`-style domain grep does not surface; look there before assuming
transition logic lives here. Also does NOT hold: business logic for other
domains, or persistence (`infrastructure/persistence/alerts/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
