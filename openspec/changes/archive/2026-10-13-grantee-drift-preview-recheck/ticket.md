# HEL-1516: After HEL-1503: grantee analyze never reports schema drift (owner-only baseline read); revoked editor's step preview still runs

## Description

These follow-ups came from HEL-1503 (matto00/helio#969, b71af7072). Editor runs now refresh the schema-drift
baseline, a pipeline deleted mid-submit returns 404 (never 500), and a revoked editor's dry run returns 403.

1. **Owner-designated follow-up:** the baseline READ side is owner-only. `findLastSourceSchema` is scoped to the
   owner, so a grantee's analyze never reports drift. Read the baseline the way the pipeline owner sees it, mirroring
   the write path HEL-1503 added. Write a test that fails first, running as a NOBYPASSRLS role.
2. A revoked editor's step preview (`PipelineRunPreview`) still runs. HEL-1503's item 5 covered dry runs only, so
   bring previews in line: re-check owner-or-editor and return 403 without executing. That's a product call,
   consistent with the owner's dry-run ruling.

Item 3 of HEL-1503 (splitting `PipelineRunRepository.scala`, about 700 lines) stays on HEL-1503.

## Acceptance Criteria

- AC1: A grantee's `GET /api/pipelines/:id/analyze` reports the same `sourceSchemaDrift` the pipeline owner's analyze
  reports (baseline AND current primary-root schema both read as the pipeline owner sees them). Proven by a test that
  is red on unchanged main and runs under a NOBYPASSRLS role.
- AC2: A step/output preview by a user whose grant was revoked between the preview's ACL read and execution returns
  403 and never executes; a pipeline deleted in that window returns 404. Live owner/editor/viewer previews are
  unchanged.

## Assumed product calls (overnight; owner asleep -- see design.md "Assumed product calls")

- A1: what a grantee sees in analyze drift.
- A2: the preview re-check keeps viewer previews of non-AI closures (HEL-279/HEL-1108) rather than a literal
  owner-or-editor check.
- A3: a preview of a pipeline deleted mid-request answers 404 (was 422), mirroring HEL-1503 ruling A.

## Driver context (claims, verified in premise-validation.md)

- HEL-1492 (V124, #953) made editor-grantee runs count against the owner. Highest migration on main is V130.
