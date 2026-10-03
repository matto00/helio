## MODIFIED Requirements

### Requirement: Output CRUD is scoped to a pipeline and ACL-checked
The backend SHALL expose `GET/POST /api/pipelines/:id/outputs` and `GET/PATCH/DELETE
/api/outputs/:id`. Every route SHALL apply the same owner/grantee/other ACL evaluation as the
parent pipeline: owner or a grantee with pipeline-sharing access gets 200; an UNAUTHENTICATED
caller (or one with no ACL relationship at all, on the sharing-aware GET routes) gets 404
(existence not leaked); an AUTHENTICATED caller with no pipeline grant on `POST`/`GET
/api/pipelines/:id/outputs` gets **404** with the same body as an absent pipeline
(`AccessChecker.requireAccess`'s existence-not-leaked rule, HEL-1002; a viewer grantee still gets
**403** on `POST`). `PATCH`/`DELETE
/api/outputs/:id` are owner-only (RLS `outputs_update`/`outputs_delete`) — a non-owner grantee
gets **404** there (RLS makes the row invisible to the update/delete statement, not a 403). `POST`
SHALL accept `{ nodeStepId?, kind, name, config }`; `nodeStepId` absent or null SHALL bind the
Output to the pipeline root. **`OutputResponse.nodeStepId` is `Option[String]`, serialized via
`jsonFormat10` on a protocol with no `NullOptions` mixed in anywhere in this backend — a
root-bound Output's response has the `nodeStepId` key OMITTED entirely, never present as a
literal `null`** (same class of wire-shape imprecision as the `pipeline-shape-registry` delta's
`expand` `outputs` key).

#### Scenario: Owner creates an Output at the pipeline root
- **WHEN** the pipeline's owner calls `POST /api/pipelines/:id/outputs` with no `nodeStepId`
- **THEN** the response is `201 Created` with the `nodeStepId` key OMITTED from the raw response
  JSON entirely (not present as `null`) — asserted against the raw parsed JSON object, not just
  the unmarshalled case class, since `resp.nodeStepId shouldBe None` cannot distinguish "key
  omitted" from "key present as null"

#### Scenario: Authenticated caller with no pipeline grant gets 403 on create
- **WHEN** an authenticated user with no ACL relationship to the pipeline calls
  `POST /api/pipelines/:id/outputs`
- **THEN** the response is `404 Not Found` (HEL-1002: this scenario formerly asserted 403), identical in status and body to a nonexistent pipeline id

#### Scenario: Non-owner grantee gets 404 on PATCH/DELETE
- **WHEN** an editor grantee (not the owner) calls `PATCH` or `DELETE /api/outputs/:id`
- **THEN** the response is `404 Not Found` (owner-only RLS makes the row invisible to the write,
  not a 403)
