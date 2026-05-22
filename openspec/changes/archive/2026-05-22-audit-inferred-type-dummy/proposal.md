# Proposal: Audit Inferred-Type Schema for Dummy Data

**Ticket**: HEL-261
**Status**: Implemented

## Problem

User-reported uncertainty: when connecting a data source, does the resulting
`DataType` schema come exclusively from the source, or could fabricated /
placeholder fields be injected along the way?

Three specific concerns:

1. Does `DemoData` startup seeding plant any `DataType` rows with hardcoded
   field lists?
2. Does any inference path use a fallback constant table instead of the actual
   source data?
3. Does `TypeRegistryBrowser` render a "Sample" or placeholder preview for
   types with zero rows?

## Scope

Backend-only audit. Inference paths under `SchemaInferenceEngine`,
`DataSourceService` (CSV + Static), `SourceService` (REST + SQL), and
`DemoData`. Frontend `TypeDetailPanel` checked for honest empty state.

## Outcome

Audit found **no dummy data injection**. All paths derive field names and
types exclusively from the source. Regression tests added to make future drift
detectable.
