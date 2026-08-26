## 1. ### Backend

- [x] 1.1 Add `auditService: AuditService = null` param to `WorkspaceTeardownService`'s constructor and import `com.helio.services.audit.AuditService`
- [x] 1.2 Add private `audit(action, resourceId, user, metadata)` helper mirroring `DashboardService`, no-op when `auditService` is null
- [x] 1.3 Call `audit("workspace.teardown", Some(tag), user, metadata)` exactly once, gated strictly on `outcome.committed` (never on `counts > 0` — see design.md Decision 1), with metadata carrying `sourcesDeleted`/`pipelinesDeleted`/`typesDeleted`
- [x] 1.4 Wire `auditService` through `ApiRoutes.scala` at the `workspaceTeardownServiceOpt` construction site (~line 422), passing the existing `auditService` private val already threaded into sibling services

## 2. ### Tests

Host spec: `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala` (the
existing route-level spec — real HTTP requests through the actual `ApiRoutes`-constructed service
tree, so a regression at the task-1.4 wiring site is caught, not masked by a test-local
`new WorkspaceTeardownService(...)` construction). `POST /api/workspace/teardown` is not currently
mounted/exercised there — add the necessary route mounting/fixtures as part of 2.1.

- [x] 2.1 In `AuditMutationInstrumentationSpec.scala`: a committed teardown (including the
      all-zero-match case, tag matching nothing) writes exactly one `workspace.teardown` audit row
      via a real `POST /api/workspace/teardown` request, with correct resourceId (tag), actor id,
      tokenId, source, and metadata deletion counts — use `eventuallyAuditRows` (existing helper,
      `:209`) to wait for the row
- [x] 2.2 In the same spec: a `dryRun: true` teardown writes no `workspace.teardown` audit row —
      use the negative-assertion barrier (design.md "Test plan"): after the dry-run call, issue a
      second, committed mutation (e.g. a committed teardown of a different tag), `eventuallyAuditRows`
      on that row to prove the write path has drained, THEN assert zero `workspace.teardown` rows
      for the dry-run tag
- [x] 2.3 In the same spec: a blocked teardown (tag with a conflicting/shared resource) writes no
      `workspace.teardown` audit row — same barrier technique as 2.2
- [x] 2.4 Existing `WorkspaceTeardownServiceSpec`/route tests still pass with the new optional
      constructor param (null-default)
