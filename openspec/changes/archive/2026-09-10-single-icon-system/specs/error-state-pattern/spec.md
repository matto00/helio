## REMOVED Requirements

### Requirement: EmptyState icon and cta icons accept a ReactNode
**Reason**: `@fortawesome/*` is removed from the codebase (HEL-443) — the `IconDefinition` arm and
its `FontAwesomeIcon`-rendering behavior no longer exist.
**Migration**: Replaced by "EmptyState icon and cta icons accept a ReactNode only", below.

## ADDED Requirements

### Requirement: EmptyState icon and cta icons accept a ReactNode only
The `EmptyState` component's `icon` prop, and its `cta.icon`/`secondaryCta.icon` props, SHALL each
accept a `ReactNode`, rendered directly.

#### Scenario: A ReactNode icon renders directly
- **WHEN** `EmptyState` is rendered with `icon={<AlertTriangle />}`
- **THEN** the provided element is rendered directly
