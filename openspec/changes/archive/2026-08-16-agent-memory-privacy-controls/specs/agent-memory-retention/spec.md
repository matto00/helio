## ADDED Requirements

### Requirement: Entries past the retention window are excluded from reads and pruned
`AgentMemoryRepository` SHALL exclude, and delete, any of the caller's entries whose `created_at`
is older than a documented retention window (90 days by default, env-var-overridable via
`AGENT_MEMORY_RETENTION_DAYS`, coordinated with HEL-438 as a placeholder pending that epic's own
retention-policy value), enforced on access by both `list` and `add` — no new scheduler is
introduced by this ticket.

#### Scenario: An over-age entry is excluded from list and removed
- **WHEN** `AgentMemoryRepository.list` is called for a caller with an entry whose `created_at` is
  older than the retention window
- **THEN** that entry is not included in the returned results
- **AND** a subsequent direct query confirms the row no longer exists

#### Scenario: A within-window entry is unaffected
- **WHEN** `AgentMemoryRepository.list` is called for a caller with an entry whose `created_at` is
  within the retention window
- **THEN** that entry is included in the returned results and is not deleted

#### Scenario: Pruning runs before the cap-and-evict check on add
- **WHEN** `AgentMemoryRepository.add` is called for a caller who is at or near the per-user cap
  and also has one or more over-age entries
- **THEN** the over-age entries are pruned before the cap is evaluated, so a live, within-window
  entry is not evicted merely because expired entries were still occupying cap slots

#### Scenario: A frequently-touched entry is still pruned once past the retention window
- **WHEN** an entry's `created_at` is older than the retention window, regardless of how recently
  its `last_used_at` was updated
- **THEN** it is still excluded from reads and pruned — `touch` does not extend or reset the
  retention window
