## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, revised `design.md`, `tasks.md`, both spec deltas, and
`skeptic-design-1.md`. Then re-derived from source in the worktree:

- `backend/src/main/scala/com/helio/domain/model/model.scala:485-503` — `ApiKeyPlacement`,
  `RestApiAuth` ADT, `RestApiConfig(url, method, auth, headers)`. Unchanged; Decision 3's
  starting point is accurate.
- `.../api/protocols/sources/DataSourceProtocol.scala:128-135,300-356,384-385` —
  `RestApiConfigPayload` is `jsonFormat4(url, method, auth, headers)`; `RestApiAuthPayload`
  carries `token`/`value`. CR1/CR2's revised `ConnectorAuthShape` (Decision 3) is a genuinely
  secret-free shape distinct from `RestApiAuthPayload` — **CR1 and CR2 hold.**
- `.../services/sources/ConnectorEntityService.scala:17-20,31-60,81-88` — `create(req, user)`
  requires an `AuthenticatedUser`; `cred.isEmpty => 400 "credential is required"`;
  `dependentCount` is a constructor param used only by `delete`. CR5/CR6's targets are real
  and the seam wiring (Decision 5, tasks 3.1-3.4) still holds.
- `frontend/src/features/sources/ui/forms/RestApiForm.tsx` — builds `{url, method:"GET",
  jsonPath?}` and renders `<TestConnectionAffordance type="rest_api" buildConfig={buildConfig}/>`.
- `frontend/src/features/sources/ui/AddSourceModal.tsx:99-160` — `handlePreview` calls
  `inferFromJson({url, method, jsonPath?})` and only on success sets `step = "preview"`;
  `handleCreate` (reachable **only** from that preview step) calls `createRestSource`.
- `frontend/src/features/sources/services/dataSourceService.ts:169-172,220-233` —
  `inferFromJson` → `POST /api/sources/infer`; `testConnection` → `POST /api/sources/test`,
  REST config posted **flat as the body**.
- `backend/.../api/routes/sources/SourcePreviewRoutes.scala:30-80` — both `/sources/infer` and
  `/sources/test` `json.convertTo[RestApiConfigPayload]` and call
  `sourceService.inferRest(payload)` / `testRest(payload)`.
- `backend/.../services/sources/SourceService.scala:72,113,134` — `createRest(request, user)`
  takes a user; **`inferRest(payload)` and `testRest(payload)` take no `AuthenticatedUser`.**

### Verdict: REFUTE

CR1, CR2, CR4 (as far as it goes), CR5, CR6, CR7 and the unchanged Decisions 2/5/8/9 hold up as
written. CR3's resolution does **not**: it fixes the create call and leaves the two other live
bare-`url` REST endpoints — which the very same form calls, one of them as a hard precondition
of reaching create — unaddressed. And task 4.0's "one shared synthesis helper" cannot be one
code path as currently specified.

### Change Requests

1. **CR3's dual-support covers `POST /api/sources` only; the UI it was resolved to preserve
   cannot reach that endpoint.** `AddSourceModal.handlePreview`
   (`AddSourceModal.tsx:112-122`) posts a bare `{url, method, jsonPath?}` to
   `POST /api/sources/infer` and *only advances to the preview step on success*
   (`setStep("preview")`, line 133); `handleCreate` — the sole `createRestSource` call site —
   is reachable only from that step. `SourcePreviewRoutes.scala:31-53` decodes that body
   directly as `RestApiConfigPayload` and calls `SourceService.inferRest`
   (`SourceService.scala:113`). Once `RestApiConfigPayload` becomes connectorId-shaped,
   "Preview schema" fails and the dual-supported create path is dead code from the UI's
   perspective. The design and tasks name neither `inferRest` nor `/api/sources/infer`.
   Extend the dual-support decision (and add tasks) to cover it explicitly.

2. **Same gap for `POST /api/sources/test` — RestApiForm's own "Test connection" button.**
   `RestApiForm.tsx` renders `TestConnectionAffordance`, which calls
   `dataSourceService.testConnection("rest_api", {url, method, jsonPath?})` →
   `POST /api/sources/test` (`dataSourceService.ts:226-233`) →
   `SourcePreviewRoutes.scala:56-78` → `SourceService.testRest`. Task 1.7 (CR4) addresses only
   the *assistant* `test_connection` tool, not this HTTP route. Decide explicitly what a
   bare-`url` infer/test now does, and note the trap: naively routing it through
   Decision 1's implicit-Connector synthesis would persist a `connectors` row on every
   "Test connection"/"Preview schema" click — an ephemeral, non-persisting resolution path is
   almost certainly required, and that is a real divergence from the create path that the
   "one compat story" framing currently hides.

3. **`inferRest`/`testRest` have no acting user, and nothing in the design supplies one.**
   `SourceService.scala:113,134` — both take only a payload, unlike `createRest(request, user)`
   (line 72). Any Connector resolution must be ownership-scoped (`findByIdOwned`, Decision 3 /
   task 2.3), so both signatures and both route call sites must be threaded with
   `AuthenticatedUser`. Task 2.2 gestures at threading the user through driver call sites but
   never names these two service methods or `SourcePreviewRoutes`; the ownership check is the
   ACL boundary here, so leaving it to implementer inference is not acceptable.

4. **Task 4.0's shared `ImplicitConnectorSynthesis` helper cannot be a single code path as
   specified — the design contradicts itself on where it bottoms out.** Decision 1 (create
   half) says the implicit-Connector create "*is* a no-auth Connector create, routed through
   the same validated path", and CR6's revision explicitly contrasts that with "a new bypass
   path like the migration's direct `ConnectorRepository.create` call". But
   `ConnectorEntityService.create(req, user)` requires an `AuthenticatedUser`
   (`ConnectorEntityService.scala:31`), which the startup migration (Decision 7, iterating rows
   across arbitrary owners with no request context) does not have. So the two halves must
   bottom out at different layers — service+validation for create, repository for migration.
   Resolve it concretely: state which layer the shared helper lives at, and if it is
   `ConnectorRepository.create`, say so plainly rather than claiming the create path goes
   "through the same validated path" (and re-check that CR6's `authType == "none"` carve-out
   still actually gates anything for the create path in that case).

5. **`implicit: true` is client-settable, so it is not the trustworthy structural flag
   Decision 1a claims.** `ConnectorEntityService.create` passes
   `req.config.getOrElse(JsObject.empty).compactPrint` through verbatim
   (`ConnectorEntityService.scala:47`), and `update` likewise replaces `config` wholesale
   (line 69). A user-created Connector can therefore carry `implicit: true`, and a synthesized
   one can have it removed via `PATCH`. Decision 1a says the flag exists precisely because
   names are mutable. Either specify that `implicit` is stripped from client-supplied
   `config` on create/update (server-owned field) or drop the claim that it is a reliable
   signal. Relatedly, Decision 3's `ConnectorAuthShape` JSON block does not list `implicit`
   at all even though Decision 1a says that shape "gains" it — task 2.1a defines the shape, so
   the field will plausibly be omitted; make the shape definition complete in one place.

### Non-blocking notes

- The frontend sends `jsonPath` on every REST infer/test/create body; `RestApiConfigPayload`
  is `jsonFormat4` with no `jsonPath` (`DataSourceProtocol.scala:385`), so spray silently
  drops it today. Not introduced here, but worth confirming the new payload doesn't
  accidentally start failing on it (a stricter decoder plus an unknown field is a plausible
  new 400).
- Round-1's non-blocking note about `RestApiConnectorDriver.metadata.requiredFields` still
  declaring `url` remains unaddressed by any task.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree's
  `scripts/concertino/` (only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
  `start-servers.sh`); I used the main-repo copy against the worktree path. Not a blocker for
  this gate, but the final-gate agent will hit the same thing.
