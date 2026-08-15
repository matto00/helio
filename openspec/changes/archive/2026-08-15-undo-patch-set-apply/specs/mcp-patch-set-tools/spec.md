## ADDED Requirements

### Requirement: undo_patch_set SHALL post to the existing undo endpoint atomically
The MCP `undo_patch_set` tool SHALL call `POST /api/patch-sets/:id/undo` with the supplied
`applicationId` and return its result verbatim, never attempting a partial or manual per-resource
restore.

#### Scenario: undo_patch_set reverses a prior apply
- **WHEN** an agent calls `undo_patch_set` with an `applicationId` from a prior `apply_patch_set`
  call
- **THEN** the tool posts to `POST /api/patch-sets/:id/undo` and returns its result, restoring every
  touched resource to its pre-apply state

#### Scenario: undo_patch_set surfaces a conflict without partially undoing
- **WHEN** `POST /api/patch-sets/:id/undo` rejects the call with a conflict (a resource changed since
  the original apply)
- **THEN** the tool returns that conflict to the caller verbatim, and does not attempt to restore any
  of the application's other edits itself
