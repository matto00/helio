# HEL-1800: Auto-run refusal on dataset-write / form-submit responses shows non-owners the raw cost detail

## Description

Follow-up of HEL-1661 (PR #1199, merged as 16a6042d6). The owner chose to file this.

In HEL-1661 the owner ruled that grantees see neutral reason text on pipeline analyze, not the owner's cost detail (for example live row counts). That ruling covered analyze only.

The auto-run trigger's `Denied.reasons` still carry the raw cost detail, and they reach responses to non-owners in two places:

* dataset-write responses (row append, update and delete on a dataset source);
* form-submit responses (`POST /api/panels/:id/submit`, which a form's editor grantees can call since HEL-1784).

So an editor submitting a form, or writing to a dataset, can learn facts about the pipeline owner's data size.

## Do

* List every response that carries `Denied.reasons`, and who can receive each one.
* Give a caller who is not the pipeline owner the same neutral text HEL-1661 uses on analyze. The owner keeps the full detail.
* Check that the contract schemas and client handling still match.

## Acceptance criteria

- [ ] A test that fails on the current code: a form submit by an editor grantee whose auto-run is refused for cost carries no row count or other cost figure.
- [ ] The owner's own write still gets the full reason.
- [ ] A seam test covers the client and server for the changed response shape, if the shape changes.
