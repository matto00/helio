# patch-set-stale-check Specification

## Purpose
Guarantees that a patch set is applied only onto the target state its preview showed: every update/delete target
carries a fingerprint from preview, and apply refuses, writing nothing, when any fingerprinted field of a target has changed since.

## Requirements

### Requirement: Preview returns a fingerprint per update/delete target

`POST /api/patch-sets/preview` SHALL return, on each `update` and `delete` edit's preview entry, a non-empty opaque
string `fingerprint` derived from the target's current state restricted to the fields that kind's update request can
write (for dataSource and pipeline: `name` only). A `create` edit's entry SHALL carry no
fingerprint. The fingerprint SHALL change when any field that the target kind's update request can write changes, and
SHALL NOT change when only server-maintained fields change (timestamps, run status/counters, version counters,
server-materialized config).

#### Scenario: Update and delete edits carry fingerprints

- **WHEN** a patch set with one panel update, one pipelineStep delete and one pipelineStep create is previewed
- **THEN** the update and delete entries each carry a non-empty `fingerprint` and the create entry carries none

#### Scenario: Fingerprint is stable across a pipeline run

- **WHEN** a pipeline update edit is previewed twice with a pipeline run completing between the two previews
- **THEN** both previews return the same fingerprint for that edit

#### Scenario: Fingerprint changes on an editable-field change

- **WHEN** a panel's title is changed through `PATCH /api/panels/:id` between two previews of the same edit
- **THEN** the two previews return different fingerprints

### Requirement: Apply rejects stale targets with 409 and writes nothing

An edit's `target` SHALL accept an optional `fingerprint` for `update`/`delete` edits; a `fingerprint` on a `create`
edit SHALL be rejected with 400. When any edit carries a fingerprint, `POST /api/patch-sets/apply` SHALL, after
authorization and before any write, compare each supplied fingerprint with the target's current fingerprint. If any
differ it SHALL respond **409** with body `{message, code: "PATCH_SET_STALE", staleTargets: [{index, kind, id}]}`
listing every stale edit, whose `message` names every stale edit's index, kind and id, and SHALL leave every target of every edit (stale or not) unchanged and journal nothing.
Edits without a fingerprint SHALL be applied exactly as before this change.

#### Scenario: Intervening rename is not overwritten

- **WHEN** a patch set updating panel P's title is previewed, P is renamed through another path, and the patch set is
  applied with the preview's fingerprints
- **THEN** the response is 409 with `code` `PATCH_SET_STALE` and `staleTargets` naming P's edit index, kind and id
- **AND** P keeps the intervening title and no other edit in the set was applied

#### Scenario: Stale delete is refused

- **WHEN** a patch set deleting pipelineStep S is previewed, S's config is changed, and the set is applied with the
  preview's fingerprints
- **THEN** the response is 409 naming S and S still exists with the changed config

#### Scenario: Unchanged targets apply normally

- **WHEN** a patch set is previewed and applied with the preview's fingerprints and no target changed
- **THEN** apply returns 200 with every edit `applied` and an `applicationId`

#### Scenario: Callers without fingerprints are unaffected

- **WHEN** a patch set without any `fingerprint` is applied after a target changed
- **THEN** apply behaves exactly as before this change (200, edits applied)

#### Scenario: Fingerprint on a create is rejected

- **WHEN** a `create` edit's target carries a `fingerprint`
- **THEN** apply and preview return 400 and nothing is written

### Requirement: Refinement stamps preview fingerprints onto the patch set it returns

`POST /api/refinements` SHALL return a patch set whose `update`/`delete` targets carry the fingerprints computed by the
same preview that validated it; any fingerprint the model produced SHALL be discarded before that preview. The
in-app assistant's preview path SHALL likewise discard model-produced fingerprints.

#### Scenario: MCP propose then apply is protected

- **WHEN** an MCP client calls `propose_patch_set`, a target in the returned patch set is changed through another
  path, and the client passes the returned patch set unchanged to `apply_patch_set`
- **THEN** the tool returns an error result reporting status 409 and the stale targets, and nothing is applied

### Requirement: MCP apply_patch_set preserves fingerprints and reports conflicts

The MCP `apply_patch_set` tool's input schema SHALL accept `target.fingerprint` and forward it unchanged to the apply
endpoint, and its description SHALL state that a 409 `PATCH_SET_STALE` means the targets changed since the patch set
was proposed and that the caller must re-propose rather than retry.

#### Scenario: Fingerprint survives MCP input validation

- **WHEN** `apply_patch_set` is called with a patch set whose target carries a `fingerprint`
- **THEN** the request body posted to `POST /api/patch-sets/apply` carries the same `fingerprint`

### Requirement: Review page applies what it showed and handles conflicts

The patch-set review page SHALL send, with Apply, the fingerprints returned by the preview it is displaying. On a 409
`PATCH_SET_STALE` it SHALL show a conflict message naming the stale targets, keep the user on the page, and offer a
Re-preview action that fetches a fresh preview (and fresh fingerprints). After a successful apply it SHALL navigate
with history replacement so Back cannot return to an applyable review of the same patch set.

#### Scenario: Conflict is shown with Re-preview

- **WHEN** Apply returns 409 `PATCH_SET_STALE`
- **THEN** the page shows the stale targets and a Re-preview control, and activating it re-requests the preview

#### Scenario: Back after apply cannot re-apply

- **WHEN** a patch set is applied successfully and the user presses Back
- **THEN** the review page for that patch set is not restored and no second apply is possible
