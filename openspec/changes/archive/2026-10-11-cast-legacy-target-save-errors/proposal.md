## Why

A cast step that holds a stored legacy target (one HEL-1436 now rejects at write time) cannot be edited. Every edit
sends the whole `casts` map, the server answers 422, and the editor swallows the error, so the card looks saved when
nothing persisted. That is silent data loss. HEL-1476 also left duplicate without three of create's reference checks.

## What Changes

- A rejected cast-step save surfaces the server's message on the step card, as fillnull/window/pivot already do (HEL-1416).
- Per the owner's ruling (escalation answered `row-hint`), a cast row whose stored target is unsupported is marked
  invalid and carries an inline hint: choose a supported type, or "keep as is" to keep today's run behaviour (legacy
  targets run as passthrough). No new action, no data rewrite. A stored key that is absent from the input schema still
  gets a row, so the user can always clear it.
- An audit of duplicate against create's secondary-source access check, lane-reference check and upsert-target check.
  A reproduced validity gap is closed red-first. A reproduced authorization gap is escalated with its repro, not fixed
  silently.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-cast-op`: the editor surfaces rejected saves and flags stored unsupported targets per row.
- `pipeline-step-lifecycle`: duplicate applies create's reference checks that the audit shows are missing (lane/upsert).

## Non-goals

- Migrating or rewriting stored legacy targets (owner rejected `one-click` and `auto-migrate`).
- Surfacing swallowed PATCH errors for other step kinds (each kind is its own decision, as in HEL-1416).
- Changing run/analyze passthrough of legacy targets (HEL-1436 D5 stands).
- Fixing an authorization gap in duplicate without an owner ruling.

## Impact

Frontend: `stepCardFieldHandlers.ts` (cast persist call), `CastFieldsConfig.tsx`, `StepOpEditor.tsx` (cast branch
error display). Backend: `PipelineStepWrites.duplicateStep` (only for reproduced, non-authorization gaps). Tests: Jest
and ScalaTest (`VerifiedEmbeddedPostgres.start`). No API shape, schema, or migration change.
