# Concurrency

`MdcPropagatingExecutionContext` — wraps an `ExecutionContext` so SLF4J MDC
(request/trace context) survives across thread hops in async chains.

Not a domain — structural infrastructure used wherever an explicit
`ExecutionContext` is threaded through a repository or service. Does NOT
hold: domain logic, or any type with a business dependency.
