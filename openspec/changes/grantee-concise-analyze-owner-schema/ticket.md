# HEL-1799: MCP analyze (analyzeConcise) checks a grantee's steps against their own source view, not the owner's schema

## Description

Follow-up of HEL-1661 (PR #1199, merged as 16a6042d6). The owner chose to file this.

HEL-1661 fixed the REST analyze route (`PipelineAnalyzeReads.scala`). An editor or viewer grantee's step check now uses
the pipeline owner's schema, so a grantee no longer sees a false "A step in this pipeline has a problem". Grantees still
get no new column names or types, and get neutral reason text.

The MCP analyze path (`analyzeConcise`) was not changed. It still checks steps against the caller's own view of the
source. A grantee using MCP can still get the false step problem.

Do:

- Make `analyzeConcise` use the same reads as the REST route after HEL-1661, with the same grantee rules: owner's
  schema for checking, no new schema data for grantees, and neutral reasons.
- Verify the premise first. Check whether `analyzeConcise` already shares code with the REST route.

## Acceptance criteria

- [ ] A test that fails on the current code: a grantee's MCP analyze of a valid shared pipeline reports no step problem.
- [ ] Grantee output carries no column names or types beyond what it carries today, and has no live row count. Proven
  on `helio_app_test` (NOBYPASSRLS).
- [ ] A stranger still gets the same not-found result as today.

## Owner rulings carried from HEL-1661 (binding)

- The owner's schema decides step validity.
- Grantees receive no new schema data.
- Neutral reason text for grantees.
- Last-run row count or nothing, never a live row count.
