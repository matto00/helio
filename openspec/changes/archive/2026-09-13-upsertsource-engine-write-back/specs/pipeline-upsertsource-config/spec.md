## REMOVED Requirements

### Requirement: The upsertsource step is not yet creatable
**Reason**: HEL-1100 registers a runnable `upsertsource` step; HEL-1101's cycle check already exists on the same
write path, satisfying this requirement's precondition.
**Migration**: None. Callers can now create `upsertsource` steps; see `pipeline-upsertsource-execution`.
