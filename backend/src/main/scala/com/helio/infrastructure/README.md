# Infrastructure Layer

Persistence and external service integrations behind abstractions, split by
concern: `persistence/` (Slick repositories, by domain), `storage/` (blob
storage abstraction), `crypto/` (hashing primitives), `concurrency/`
(the MDC-propagating `ExecutionContext` wrapper). See each subdirectory's
own README for what belongs there.

No file lives directly in `infrastructure/` — every file is under one of
the four subdirectories above.
