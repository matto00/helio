# HEL-1652: Editor grantee pipeline root writes: root add returns 500 (RLS insert policy), root remove returns 200 but changes nothing

## Description

origin_kind: followup
origin_ticket: HEL-1629

Found by HEL-1629's gates (PR matto00/helio#1054, 544bd79ea), which tested editor grantees on a non-BYPASSRLS role:

1. **Editor root add: 500.** The service accepts the source, then the owner-only `pipeline_roots_insert` RLS policy
   rejects the insert, which surfaces as a 500.
2. **Editor root remove: 200, no change.** RLS hides the rows from the editor, so the delete matches 0 rows and
   reports success.

Both are wrong: the service layer and the RLS policies disagree about whether editors may change a pipeline's roots.
Decide the rule (owner-only, or editors too: the draft-save path from HEL-1629 already lets editors save a
definition) and make the service and policy agree. The user then gets a correct 403 or a real success; never a 500,
and never a false 200.

Related: HEL-1648 (editor sample access); the same family of owner-vs-editor gaps.

## Acceptance Criteria

- Red-first tests on `TwoUserRlsApiFixture` (NOBYPASSRLS) for editor add and remove, matching the chosen rule.
- A viewer and a stranger are still refused.
- If editors are allowed, also check (e) HEL-1631's draft flow works for an editor.
- Never a 500, never a false 200, for any caller role on `POST /api/pipelines/:id/roots` and
  `DELETE /api/pipelines/:id/roots/:rootId`.
