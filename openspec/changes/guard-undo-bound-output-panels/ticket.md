# HEL-1720: Undoing an Output create deletes panels bound to it later, including other users' panels

## Description

origin_kind: followup
origin_ticket: HEL-1639

### Why

HEL-1639's final skeptic noted that undoing a patch set that created an Output also deletes every panel bound to that Output after the patch was applied. That includes panels another user (an editor grantee) bound on their own dashboard. This is existing undo behaviour, not something HEL-1639 introduced; its PR body notes it.

An undo by one user can remove another user's work without warning.

### What

Decide and implement what undo does when an Output it would remove has gained bindings since the patch was applied. Options to weigh in Planning:

* refuse the undo with a clear message naming the bound panels;
* undo everything except Outputs that now have bindings, and say so;
* keep deleting, but only after showing the user what will be removed.

Confirm the behaviour first with a red test: user A applies a patch set that creates an Output, user B binds a panel to it, user A undoes.

## Acceptance criteria

- [ ] Undo never silently deletes a panel created after the patch was applied, or a panel another user owns.
- [ ] A test covers the two-user case above.
