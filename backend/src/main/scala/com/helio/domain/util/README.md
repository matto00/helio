# Domain Utilities

Small, dependency-free helpers shared across the domain layer: `Clock`
(injectable time source for testability) and `CronSchedule` (cron/interval
next-fire-time computation).

Does NOT hold: domain data types (`domain/model/`), or anything with a
service/repository dependency — a file that needs `ExecutionContext` or a
repository belongs in `services/` or `domain/engine/`, not here.
