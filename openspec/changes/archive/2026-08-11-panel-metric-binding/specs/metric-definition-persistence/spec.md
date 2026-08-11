## ADDED Requirements

### Requirement: MetricRepository batch owner-scoped lookup

The system SHALL provide `MetricRepository.findByIdsOwned(ids, user)`, returning a `Map[MetricId,
MetricDefinition]` containing only the requested ids that resolve to rows owned by `user`, mirroring
`DataTypeRepository.findByIdsOwned`'s shape and empty-input short-circuit. This supports the panel read
path resolving many panels' `metricId` bindings in one round trip.

#### Scenario: Batch lookup returns only owned, matching ids
- **WHEN** `findByIdsOwned` is called with a mix of ids the caller owns and ids owned by another user
  (or ids that don't exist)
- **THEN** the returned map contains entries only for the ids owned by the caller

#### Scenario: Empty input short-circuits without a query
- **WHEN** `findByIdsOwned` is called with an empty id list
- **THEN** it returns an empty map without issuing a database query
