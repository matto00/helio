## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `482398e6` on `bug/connector-picker-kind-mismatch/HEL-845`.
All gate results below are from my own fresh runs, not the executor's report.

### Phase 1: Spec Review — PASS

Issues: none blocking.

- **AC 1** (picker lists only `rest_api`) — demonstrated **live**, not from the filter
  expression. Logged in at `http://localhost:6277`, opened Add data source → REST API →
  Connector picker with a purpose-created `sql` Connector ("HEL845 Eval Warehouse") and a
  `rest_api` Connector ("HEL845 Eval Stripe") both present on the account. Rendered
  `[role="option"]` list contained all 17 `rest_api` Connectors and **did not contain the
  `sql` one**.
- **AC 2** (direct-API mismatch rejected) — live `curl` against the running backend:
  `POST /api/sources` with a `sql` Connector's id →
  `400 {"message":"Connector HEL845 Eval Warehouse is a 'sql' Connector; a REST source
  requires a 'rest_api' Connector"}`. Names both kinds; leaks no id, baseUrl, or credential.
- **AC 3** (no-matching-Connector empty state) — demonstrated live on a freshly registered
  account owning **only** a `sql` Connector (so this is the filtered-empty case, not the
  zero-Connectors case): the control is replaced by the shared `EmptyState` — "No REST
  Connector yet / No REST Connector exists yet. Create one to authenticate this source's
  requests. / + Create new Connector". CTA click opens the Add connector modal.
- **AC 4** (red test before the fix) — captured evidence verified genuinely red for the
  intended reason; see Phase 2.
- **AC 5** (pre-existing mismatched rows) — handled by the fetch-time guard in
  `RestApiConnectorDriver.resolveConnector`, decided and documented (design.md Decisions 2b,
  5, 6). No migration, no backfill — recorded with reasoning.
- Decisions 3 (no update path) and 7 (no `schemas/` edit) were re-checked and hold:
  `UpdateDataSourceRequest` carries `name` only; no OpenAPI doc exists; the only
  `connectorId`-bearing schema is in the HEL-973-owned `schemas/pipelines/`.
- Tasks: all boxes checked and each matches what shipped. No scope creep — the diff is
  confined to the two guards, their specs, the picker, and change artifacts.

Rulings requested by the orchestrator:

- **Task 2.6 (no integration test through `PipelineProposalService`/`PipelineService`) —
  ADEQUATE.** Ruling stated explicitly, as asked. I verified the structural claim rather
  than accepting it: `grep` confirms `PipelineProposalService.scala:359` and
  `PipelineService.scala:754` are the only agent-path REST-source creation sites and both
  call `sourceService.createRest` directly, and `ApiRoutes.scala:275` constructs **one**
  `SourceService` (wired with a real `connectorRepo` via `connectorRepoOpt.orNull`, which
  is `Some` whenever a `DbContext` exists) that both are handed. There is no second create
  path to diverge, so an integration test would re-exercise the same method through a much
  larger harness. The fail-closed branch is also safe here for the same reason: the only
  configuration in which `connectorRepo` is null is one with no database at all.
- **Contract/ownership constraints — CONFIRMED CLEAN.** `git diff --name-only main...HEAD`
  matched nothing under `schemas/`, no Flyway migration, and nothing under HEL-890
  ownership (`PipelineProtocol.scala`, `PipelineRunServiceSpec.scala`, `helio-mcp`) or
  HEL-973 ownership (`PipelineStepRepository`, `schemas/pipelines`). No `?kind=` parameter
  was added to `GET /api/connectors`.
- **Credential hygiene — CONFIRMED CLEAN.** Grepped the full diff for secret-shaped
  material; the only hits are import lines and prose. Fixture credentials are
  `"fake-plaintext-value"` / `"fake-eval-value"` / `""`. The kind-guard spec generates its
  own random master key at runtime. No real credential in any diff, fixture, or log.

### Phase 2: Code Review — FAIL

**Gates (my own fresh runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (zero warnings) |
| `npm run format:check` | PASS |
| `npm test` | PASS — 261 suites / 2674 tests |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | PASS — 265 suites / **3942 tests, 0 failed** (319 s) |

**Red-arm evidence — verified, not accepted:**

- `evidence/task1-backend-red.txt`: 3 failures inside an otherwise-passing 24-test suite;
  the kind-mismatch case fails `result.isLeft shouldBe true` ("false was not equal to
  true"), i.e. **creation succeeded** on unmodified code. Intended reason, not a fixture or
  compile error — the file compiled and 21 sibling tests passed, including the
  matching-kind case, so the guard's absence is what fired.
- `evidence/task1-backend-fetchtime-red.txt`: fails with
  `"Could not resolve host 'example.invalid'" did not include substring "rest_api"` — the
  driver actually attempted to contact the foreign `baseUrl`. That *is* the defect, and it
  doubles as the no-outbound-request signal.
- `evidence/task1-frontend-red.txt`: both cases red for the intended reason (the `sql`
  Connector was listed; the bare combobox was present instead of an empty state).
- **Task 3.3a mutation — re-run by me, not taken on trust.** I created a throwaway detached
  worktree at `482398e6`, moved the guard out of `resolveConnector` and into
  `buildResolvedRequest` after `decryptForUse` but before URI composition, and ran the spec:
  `1 was not equal to 0 (RestApiConnectorDriverKindGuardSpec.scala:143)` — the recorded
  `decryptCallCount` assertion failed while the preceding curated-error assertions (the
  no-request axis, lines 133–140) stayed green, and the matching-kind regression case stayed
  green. Two genuinely separate axes; the executor's claim is exact. Removing the guard from
  `resolveConnector` changed behavior, which also confirms the shipped guard is genuinely in
  its correct position. The throwaway worktree was removed (`git worktree remove --force`,
  verified absent from `git worktree list`).
- **Status-vs-content (HEL-590 lesson) — satisfied.** The matching-kind create case
  (`SourceServiceSpec.scala:305-327`) re-reads the persisted row and asserts
  `stored.config.connectorId shouldBe connector.id.value` plus `result.fetchError shouldBe
  None`, not merely `Right`.
- **jsdom focus/visibility — none written.** `ConnectorSelectField.test.tsx` asserts only
  on rendered option text and on the presence of the empty-state explanation.
- Error-string hygiene is asserted as substrings, not eyeballed
  (`RestApiConnectorDriverKindGuardSpec.scala:136-139`).

**Code-quality finding (mechanical):**

1. Inline fully-qualified name —
   `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverKindGuardSpec.scala:52`:
   `private val admitLocalhost: (String, java.net.InetAddress) => Boolean`.
   `CONTRIBUTING.md:70` ("never inline a fully-qualified name when an `import` would do")
   and `CONTRIBUTING.md:270` (agent-specific restatement). The two specs this file
   explicitly says it mirrors both do the right thing:
   `RestApiConnectorDriverConnectorResolutionSpec.scala:4` and
   `RestConnectorEgressGuardSpec.scala:27` each `import java.net.InetAddress`. This is not a
   companion-scoped single-use qualifier (the `CONTRIBUTING.md:72` exemption); it is a
   top-level field type in a file that already has a top-level import block.

Everything else in the code review is clean: no DRY violation (the fetch-time and
create-time messages are the two independent boundaries the design names, not a duplicated
utility); no magic strings in Scala (`DataSourceKind.RestApi` used, per Decision 2a, with
the frontend's raw-string `REST_API_KIND` constant documented as necessarily raw); no
untyped escape hatches; owner-scoped lookup avoids a cross-tenant existence oracle;
fail-closed on `connectorRepo == null`; no dead code, no TODO/FIXME; the shared `EmptyState`
primitive is reused rather than a bespoke block; no drive-by behavior changes.

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` (READY backend + frontend);
`assert-phase.sh servers` → `PASS servers`.

**JVM freshness verified functionally (CON-155)** before observing anything: the
create-time `400` naming both kinds — a response only this commit's code can produce — was
served by the running backend on port 9184. The JVM is this commit.

- Happy path end-to-end: picker lists only `rest_api` Connectors and a selection is
  accepted; matching-kind create succeeds.
- Unhappy paths: mismatched-kind create returns a legible `400`; filtered-empty picker
  renders the explanatory empty state rather than a blank/bare control. No blank screens,
  no unhandled exceptions.
- Loading state preserved (`showEmptyState` is gated on `status !== "loading"`, so the
  empty state cannot flash during the initial `fetchConnectors`); empty state uses the
  shared `EmptyState` component; errors visible.
- **Console: zero errors and zero warnings** across the whole tested flow on port 6277.
  (Errors visible in the full history belong to other worktrees' dev servers on ports
  6022/6405.)
- Accessible names and keyboard support: the combobox keeps `aria-label="Connector"`; the
  empty-state CTA is a real `<button>` with a visible label and opens the Add connector
  modal on activation.
- Breakpoints 1440 / 1100 / 768 / 360: the empty state lays out inside the modal with no
  horizontal overflow and no document-level horizontal scroll at any width.

### Overall: FAIL

Single mechanical change request; the substance of the change is sound and every
evidence-standard item the orchestrator named checks out.

### Change Requests

1. `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverKindGuardSpec.scala:52`
   — add `import java.net.InetAddress` to the file's top-level import block and change the
   annotation to `private val admitLocalhost: (String, InetAddress) => Boolean`. Required by
   `CONTRIBUTING.md:70`/`:270`; matches the two sibling specs this file mirrors
   (`RestApiConnectorDriverConnectorResolutionSpec.scala:4`,
   `RestConnectorEgressGuardSpec.scala:27`). No other change needed.

### Non-blocking Suggestions

- The "no outbound request was attempted" assertion (task 3.3) is carried indirectly, by the
  unresolvable `example.invalid` host plus the curated-error substring check, rather than by
  a counting seam like the one built for `decryptForUse`. It works (the red arm proved it
  fires as `"Could not resolve host 'example.invalid'"`) and the 3.3a mutation shows the two
  axes are separate, so this is not a defect — but a `fetchOverride`/recording HTTP seam
  would make the claim direct rather than inferred.
- Create with an **unresolvable** `connectorId` now returns `400 "Connector not found"`
  where it previously created the source and failed only at fetch time. This is a strict
  improvement, is covered by an explicit test, and is implied by the design's owner-scoped
  lookup — just noting it is a behavior change slightly wider than the ticket's headline.
- `EmptyState variant="sidebar"` inside a modal body is a visual-fit judgment call; it reads
  well in the screenshot I took, but the sizing/variant choice is the skeptic's call, not
  mine.
- Dev-DB hygiene: my verification created one throwaway account (`hel845-eval@helio.test`)
  and one `sql` Connector under it, left in place; the two Connectors I created on
  `matt@helio.dev` were deleted afterward.
