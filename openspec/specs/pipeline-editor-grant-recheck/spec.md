# pipeline-editor-grant-recheck Specification

## Purpose
Defines how editor-reachable privileged pipeline writes re-check the acting user's current owner-or-editor access inside the write transaction, and how Output delete and its undo require current edit access.

## Requirements

### Requirement: Editor-reachable pipeline definition writes re-check access inside the write
Root add, root remove, draft save (including a patch-set undo restore of a draft save) and every step write (create,
update, delete, reorder, duplicate) SHALL, inside the same database transaction that performs the write and after the
pipeline row is locked, confirm the acting user is still the pipeline owner or holds an `editor` grant on it. When the
check fails the transaction SHALL write nothing and the response SHALL be the one the request would have received had
the grant change been visible to the earlier access check: `403` when the user still holds a `viewer` grant, the
route's existing `404` when the user holds no grant. When the check passes, behaviour SHALL be unchanged.

#### Scenario: Editor grant revoked after the access check, before the write
- **WHEN** user B, an `editor` of user A's pipeline P, sends a root add, root remove, draft save or step write, and
  B's grant is deleted after the request's access check passed but before the write transaction locked P
- **THEN** the response is the route's `404` for a user with no access
- **AND** nothing the request would have written exists (no root added or removed, no step change, no draft-save
  change, no journal row)

#### Scenario: Editor downgraded to viewer after the access check
- **WHEN** B's `editor` grant is changed to `viewer` in the same window
- **THEN** the response is `403` and nothing is written

#### Scenario: Owner and current editor are unaffected
- **WHEN** the owner, or an `editor` whose grant is unchanged, performs any of these writes
- **THEN** the outcome is the same as before this change

### Requirement: Output delete and its undo require current owner-or-editor access
`DELETE /api/outputs/:id` SHALL delete only when the caller created the Output AND is, at the time of the delete,
the pipeline's owner or holds an `editor` grant on it. A creator downgraded to `viewer` or with no grant SHALL get the
`404 Output not found` a viewer or stranger gets, and nothing (Output, panels, alert rules) SHALL be deleted.
Patch-set undo of an Output create SHALL apply the same current owner-or-editor check and, when refused, report
`NotFound "Output not found"` and delete nothing. No caller SHALL gain the right to delete an Output they did not
create.

#### Scenario: Creator downgraded to viewer cannot delete their Output
- **WHEN** user B created Output O on A's pipeline P as an editor, and B's grant is now `viewer`
- **AND** B calls `DELETE /api/outputs/O`
- **THEN** the response is `404 Output not found`
- **AND** O and its panels still exist

#### Scenario: Owner and current editor still delete their own Output
- **WHEN** the pipeline owner deletes an Output they created, or a current `editor` deletes an Output they created
- **THEN** the response is `200` with the removed panel ids, as before

#### Scenario: Undo of an Output create by a downgraded creator
- **WHEN** B undoes B's own patch set that created Output O, and B is now a `viewer` of P
- **THEN** the undo reports `NotFound "Output not found"` for that edit and O still exists
