## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of commits 482398e6 + 06454e57 on `bug/connector-picker-kind-mismatch/HEL-845`.
Every conclusion below is derived from the diff, the source tree, a live browser, and a live
API session — not from `evaluation-1.md`/`evaluation-2.md`, which I read only as claims.

### What I verified (with evidence)

**Server freshness (CON-155).** `start-servers.sh` reported "already healthy … reusing".
Verified functionally before observing anything: `POST /api/sources` with an unresolvable
`connectorId` returned `400 {"message":"Connector not found"}`. On `main` that path creates
the source and returns success, so the running JVM demonstrably carries these commits.

**Concern 1 — the shape of the fix (the guarantee, not the affordance).**
- The server-side check is genuinely the guarantee and is reachable with the UI entirely out of
  the picture. Live, via `curl` with a session cookie + CSRF header, no browser involved:
  created a `sql`-kind Connector (`752676c7…`), then `POST /api/sources` with
  `type=rest_api, config.connectorId=<sql connector>` →
  `HTTP=400 {"message":"Connector HEL845 Skeptic SQL is a 'sql' Connector; a REST source requires a 'rest_api' Connector"}`.
  Names both kinds; names the Connector by user-visible name only — not its id, `baseUrl`, or
  any credential material.
- **The create-time guard is unbypassable because there is exactly one construction site.**
  Verified independently by grep, not from design.md's narrative: `RestSource(` is constructed in
  `src/main` only at `SourceService.scala:193` (`createRestWithConfig`), reached only from
  `createRest`. The two agent/MCP surfaces — `PipelineProposalService.scala:359` and
  `PipelineService.scala:754` — both call `sourceService.createRest` directly, so they inherit
  the guard structurally. `DataSourceService` (the other service that calls
  `dataSourceRepo.insert`) contains zero occurrences of `connectorId`/`RestApi` on any create
  path; its only `RestSource` touch is a rename at line 551. There is no second door.
- **The inverse of HEL-827 was not shipped.** The UI now authors strictly *less* than the API
  allows only in the direction that the API also rejects: the picker hides `sql` Connectors and
  the API rejects them too. Nothing the UI blocks is still creatable through the API.
- `design.md` Decision 1 states explicitly and correctly which layer is which
  ("Guarantee (enforcement): the server-side kind check… Affordance (usability): the picker
  filter… It enforces nothing"), and the source comment at `ConnectorSelectField.tsx` repeats it
  at the point of use. Both rejected alternatives (UI-only, server-only) are recorded.
- **Fetch-time guard reaches every resolved path.** `resolveConnector` has exactly one caller,
  `buildResolvedRequest` (`RestApiConnectorDriver.scala:117`), which is itself the single entry
  for `doFetch` (line 301 — feeding fetch/preview/refresh/infer) and `testConnection` (line 389).
  The guard sits *inside* `resolveConnector`, i.e. before the `credentialRepoOpt.decryptForUse`
  call at lines 121-128 and before `joinUrl`/`Uri` composition further down — so the spec's
  ordering claim ("no request issued, no credential decrypted") is structurally true, not just
  asserted. It applies to both `Owned` and `Internal` resolve contexts.

**Concern 2 — evidence that is evidence.**
- *Red arms fired, and for the intended reason.* `evidence/task1-backend-red.txt` shows the
  create-time mismatch case failing `result.isLeft shouldBe true` at `SourceServiceSpec.scala:296`
  while the sibling matching-kind case stayed green in the same run — the failure isolates to the
  kind check and does not merely prove creation broke. `evidence/task1-backend-fetchtime-red.txt`
  shows the fetch-time case failing with `"Could not resolve host 'example.invalid'" did not
  include substring "rest_api"` — i.e. without the guard the driver *did* proceed to contact the
  foreign `baseUrl`, which is exactly the behavior being closed.
  `evidence/task1-frontend-red.txt` shows both frontend arms red with real diffs.
- *The two fetch-time assertions are separate axes, not one wearing two labels.*
  `evidence/task3.3a-mutation-result.txt` records the named mutation (guard moved after
  `decryptForUse`): it fails **only** `decryptCallCount shouldBe 0` at line 143 (`1 was not equal
  to 0`) — the error-content assertions at line 135 passed in that run. One mutation, one
  distinct observation.
- *The no-decrypt assertion is not vacuous.* `RecordingCredentialRepository` wraps a **real**
  embedded-Postgres `ConnectorCredentialRepository` and counts `decryptForUse` calls, rather than
  passing `credentialRepoOpt = None` (which would short-circuit to `Right("")` and pass regardless
  of the guard). The mutation above proves the counter can reach a non-zero value.
- *No expected value re-derived from the implementation's source.* The assertions match literal
  `"rest_api"`/`"sql"` strings; the implementation interpolates `DataSourceKind.RestApi`. If the
  constant drifted, the tests would go red.
- *HEL-590 rule honored on the success arm.* The matching-kind create test does not stop at
  `Right`: it re-reads the stored source and asserts `stored.config.connectorId shouldBe
  connector.id.value` and `result.fetchError shouldBe None`.
- *No vacuous jsdom assertion.* `ConnectorSelectField.test.tsx` asserts on rendered option
  `textContent` and on the presence of explanation text. No focus, visibility, or layout claim
  anywhere in it.
- *Re-run green, by me.* `sbt "testOnly …RestApiConnectorDriverKindGuardSpec …SourceServiceSpec
  …RestConnectorEgressGuardSpec"` → **62 tests, 62 succeeded, 0 failed**. Frontend
  `jest --testPathPatterns="ConnectorSelectField|RestApiForm|useRestSourceForm|AddSourceModal"` →
  **3 suites, 32 tests passed**. `npm run typecheck` clean; `eslint` on both changed frontend
  files clean (exit 0).

**AC trace.**
1. *Picker lists only `rest_api`* — **live, not from the filter expression.** Opened the real
   REST source form at `localhost:6277/sources` → "Add source" → REST API, opened the Connector
   dropdown, and read the rendered `[role=option]` list: 17 `(rest_api)` entries plus
   "+ Create new Connector"; `HEL845 Skeptic SQL (sql)` — which `GET /api/connectors` does return
   for this user — is absent.
2. *Mismatched `connectorId` via the API rejected with a clear kind-naming error* — the live
   `curl` `400` above.
3. *No-matching-Connector empty state* — logged in as a freshly registered user owning zero
   Connectors and observed the real rendered empty state (screenshots below), not a Jest fixture.
4. *A red test demonstrating the prior silent acceptance* — the three evidence files above.
5. *Pre-existing mismatched bindings behave predictably* — `RestApiConnectorDriverKindGuardSpec`
   writes the mismatched row directly (bypassing the now-guarding create path) and asserts the
   curated rejection plus zero decryptions; I confirmed the guard's position in the source covers
   fetch/preview/refresh/test alike.

**Concern 3 — `EmptyState variant="sidebar"` inside a modal body (my ruling).**
Observed live in both themes (`hel845-empty-dark.png`, `hel845-empty-light.png`, taken during
this review). **Ruling: acceptable — not a REFUTE.** Reasoning against `DESIGN.md`:
- §7 requires `EmptyState` for the empty case ("never render nothing"); this reuses the shared
  primitive rather than reinventing a one-off, which is §6's rule.
- `sidebar` is the *correct* variant here, and the judgment call resolves in its favor: §6/§Typography
  reserve Fraunces for "main empty-state titles", so `variant="main"` would drop a display-face
  hero headline into the middle of a form — visibly wrong. The compact variant's small icon chip,
  `--text-sm`-class title and tighter spacing read as a field-level state, which is what it is.
- Light/dark parity confirmed by toggling the theme: icon chip, title, description and CTA all
  re-tint through tokens, all legible in both, no hardcoded color leaking through.
- The CTA is live, not decorative: clicking "+ Create new Connector" opens the nested "Add
  connector" modal, so the empty state is an exit, not a dead end.
- Zero console errors across the whole session (`browser_console_messages level=error` → 0).

**Concern 4 — unresolvable `connectorId` now `400` at create (my ruling).**
**Acceptable scope.** It is the unavoidable consequence of adding a create-time resolution, and
it moves strictly in the safe direction: previously a source row was persisted and only failed
opaquely at first fetch; now nothing is written. The lookup is `findByIdOwned`, so a foreign
tenant's id is indistinguishable from a nonexistent one and the check cannot be used as an
existence oracle. The message reuses the pre-existing curated `"Connector not found"` wording
from `RestApiConnectorDriver` rather than inventing a new leak surface, and a dedicated test
asserts it is *not* the kind-mismatch message. This is a bug-fix-adjacent tightening within the
ticket's spirit ("nothing downstream rejects the mismatch at authoring time either"), not scope
drift.

### Verdict: CONFIRM

### Non-blocking notes

1. **The empty state's description restates its title nearly verbatim** — title "No REST Connector
   yet" over description "No REST Connector exists yet. Create one to authenticate this source's
   requests." (`ConnectorSelectField.tsx`). The second sentence carries all the new information;
   the first half is redundant. Trimming the description to "Create one to authenticate this
   source's requests." would read cleaner. Pure copy polish.
2. **Two accent-filled buttons in one modal.** The `EmptyState` CTA renders with the Primary
   recipe, so it competes visually with the modal footer's primary "Preview schema" (see
   `hel845-empty-dark.png`). Not wrong — the CTA is genuinely the only forward action while the
   footer primary is disabled — but a secondary-weight CTA here would keep the modal to one
   primary. Worth a look if the pattern recurs.
3. **The spec delta's "agent/MCP proposal-apply path is guarded identically" scenario has no
   executable test.** `files-modified.md` flags this honestly rather than silently claiming it
   done, and I confirmed the claim myself by tracing call sites (only `createRest` constructs a
   `RestSource`), so the assertion is *true* — it is simply guarded by code structure rather than
   by a test that would fail if a future refactor added a second construction site. A cheap
   future guard would be an architecture test asserting `RestSource(` appears in exactly one
   `src/main` location.
4. **The spec delta does not carry a scenario for the unresolvable-`connectorId` `400`.**
   `design.md` Decision 7 elevates this delta to "the contract record" for the new `400`s, so the
   new client-visible rejection is worth one more scenario line under the create requirement.
   Non-blocking because the behavior itself is tested and correct.
5. **Shared-dev-DB side effects from this review** (not from the change): I created two Connectors
   (`HEL845 Skeptic SQL`, `HEL845 Skeptic REST`) and one user (`hel845-skeptic@helio.test`) in the
   shared dev database to exercise the live paths. Harmless, but they will show up in other
   worktrees' Connector lists.
