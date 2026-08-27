## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All six ticket ACs addressed explicitly and match the design-gate-confirmed decisions
  (both skeptic-design rounds' CRs are resolved in the final artifacts and in the code):
  - Endpoint/query/header/body all support `{{name}}` (`TemplateInterpolator`, wired into
    `buildResolvedRequest`).
  - Authoring-time vs run-time parity demonstrated on both real paths (tasks 4.1/4.2): a
    connectorId-carrying `driver.fetch` test and a real `InProcessPipelineEngine.loadRows`
    `RestSource` test, not argued from shared code.
  - Unresolved variable fails loud naming the variable, demonstrated red for endpoint, query,
    and header (4.3), plus a `TemplateInterpolator`-level body test — no HTTP call issued
    (verified via the embedded test server: `Left` is returned before any request).
  - Escaping tested for `&`, quote, newline, unicode in a query param (round-trip through
    `Uri.Query`, decoded back to the exact hostile string) and quote/newline/unicode in a JSON
    body; header CRLF rejected; endpoint space/`*` RFC-3986-encoded (`%20`, not `+`) —
    matches skeptic-design-2's CR3 fix and non-blocking widen-note for query-param escaping.
  - Credential unreachability: hostile `{{apiKey}}`/`{{credential}}`/`{{secret}}` templates
    fail loud like any other unresolved variable, plus a same-named-key test asserting the
    decrypted credential string never appears in the built request (constructed with
    `authType=none` so there is no legitimate channel for it to appear via; the real `bearer`
    decrypt-and-apply path is covered separately by test 4.8).
  - No-parameters source is byte-identical (4.6); decode regression for a stored blob missing
    the `parameters` key (4.6a) — exactly the CR2 regression the design-gate skeptic demanded.
- tasks.md section 4 (and 1–3) all marked done, and each item is demonstrably implemented, not
  just checked off — verified by direct read of
  `RestApiConnectorDriverTemplatingSpec.scala` against every enumerated sub-task (4.1–4.9),
  including the two regression tests carried over from HEL-822's known-issues brief (4.8
  auth-header collision with a templated value, 4.9 ephemeral literal-passthrough).
- No scope creep: diff touches exactly the five production files + one test file +
  `tasks.md` (all-complete) named in `files-modified.md`; no unrelated refactors.
- No regressions to existing behavior found in code review (see Phase 2/gate results below —
  the only test failures are pre-existing and environmental, not introduced by this diff).
- Wire/schema contract (`RestApiConfigPayload`/`DataSourceConfigCodec`) updated correctly per
  Decision 2a: `Option[Map[String,String]] = None` on the payload (matching all eight sibling
  fields), `.getOrElse(Map.empty)` on decode, `None`-when-empty on encode, both `jsonFormat8`→
  `jsonFormat9` sites updated together (`DataSourceProtocol.scala:391`,
  `DataSourceConfigCodec.scala:20`) — confirmed by direct diff read.
- Planning artifacts (proposal/design/tasks/spec) reflect the final implemented behavior:
  cross-checked design.md's Decision 3 escaping rules, Decision 4 credential-unreachability
  claim, and Decision 2a wire-shape fix line-for-line against the actual
  `TemplateInterpolator.scala` and `RestApiConnectorDriver.scala` diffs — all match. The two
  design-gate skeptic rounds (REFUTE → CONFIRM) already adjudicated the syntax/wire-shape/
  encoding/update-path questions; nothing in the implementation deviates from the confirmed
  design.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (fresh run, this worktree, `CLEAN_WORKTREE` not set):**
- Changed files are backend-only (`git diff --name-only main...HEAD` — no `frontend/**` hits),
  so only the backend gate applies: `cd backend && sbt test`.
- Full `sbt test`: 3552 tests run, 3539 succeeded, **13 failed** (5 suites: `SourceServiceSpec`,
  `DataSourceRoutesSpec`, `PipelineApplyProposalRollbackSpec`, `ApiRoutesSpec`,
  `AuditMutationInstrumentationSpec`).
- Investigated every failure: all 13 throw the identical
  `ConnectorCredentialEncryptionFailed: ... NoKeyConfigured` (or a downstream 500 caused by the
  same root cause) from `ConnectorCredentialRepository.create` — this worktree's `backend/.env`
  has no `CONNECTOR_MASTER_KEY` set, an environmental gap unrelated to this ticket's diff.
  **Independently reproduced on a clean `--detach` worktree at `main`'s pre-ticket commit
  (`e5d84a5c`, the parent HEL-822 merge)**, using the same `.env`: identical 13 failures with
  identical stack traces, none touching `TemplateInterpolator`/`RestApiConnectorDriver`
  templating code. Confirmed pre-existing and environmental, not a regression introduced by
  this diff. Throwaway worktree removed after verification
  (`git worktree remove --force /tmp/claude-1000-eval-main-check`).
- The new `RestApiConnectorDriverTemplatingSpec` (which sets its own explicit
  `CONNECTOR_MASTER_KEY` via `EnvMasterKeyProvider` construction, sidestepping the env gap) was
  re-run in isolation: **17/17 passed**, `testOnly com.helio.domain.connectors.RestApiConnectorDriverTemplatingSpec`.
- No `npm`/frontend gates apply (no `frontend/**` changes).

**CONTRIBUTING.md / mechanical compliance:** no inline fully-qualified names found in the diff
(imports used throughout — `TemplateInterpolator.scala`, `RestApiConnectorDriver.scala`); no
new file exceeds a reasonable size budget (`TemplateInterpolator.scala` 137 lines,
`RestApiConnectorDriver.scala` diff is +100/-56 against an existing file). No `DESIGN.md`
review needed — zero `frontend/**` changes.

**DRY / readability / modularity:** `TemplateInterpolator` is a single well-scoped object with
four small pure functions (`resolve`, `resolveEndpoint`, `resolveJsonBody`, `guardHeaderValue`,
`jsonEscape`), each documented with a rationale tying back to design.md decisions. The
`resolve`/`resolveEndpoint`/`resolveJsonBody` trio does share near-identical
scan-and-replace structure (three near-duplicate `Placeholder.replaceAllIn` blocks) — a
non-blocking DRY observation (see below), not a violation serious enough to fail.

**Type safety:** `Either[String, X]` used consistently for the fail-loud contract; no `Any`/
`asInstanceOf` in production code (test file uses `asInstanceOf`/`@unchecked` only in test
assertions on JSON responses, an accepted idiom in this codebase's existing spec files).

**Security:** CRLF header-injection guard, RFC-3986 (not form) endpoint-segment encoding,
credential structurally never merged into the interpolation map — all verified by direct code
read to match design.md Decisions 3/4, and each has a corresponding hostile-input test.

**Error handling:** every failure path (unresolved variable, CRLF guard, connector-not-found,
credential-not-found) returns a curated `Left`/error string before any `HttpRequest` is
constructed or any network call issued — verified by reading `buildResolvedRequest`'s
`for`-comprehension short-circuit and confirmed by the fail-loud tests (assert `Left(...)` with
no HTTP call reaching the embedded test server).

**Tests meaningful:** every test in `RestApiConnectorDriverTemplatingSpec` exercises real
production code (DB-backed `ConnectorRepository`/`ConnectorCredentialRepository`, a real
embedded HTTP echo server, and — for 4.2 — the real `InProcessPipelineEngine`), not a stub that
would pass under a broken implementation. The decode-regression test (4.6a) calls the real
`DataSourceConfigCodec.decodeRest` against a literal JSON string missing the `parameters` key —
exactly what would break under a bare-`Map`-with-Scala-default mistake.

**No dead code:** no leftover TODO/FIXME, no unused imports found in the diff.

**No over-engineering:** the interpolator's extension seam (Decision 5, plain `Map[String,
String]` signature) is minimal — no premature run-time/workspace-override machinery was built.

**Behavior-preserving where expected:** `buildEphemeralRequest` is untouched except for an
explanatory comment (confirmed via diff — no interpolator call added there), matching the
literal-passthrough decision; the auth-header-collision filter logic (Decision 6) is unchanged,
only now operating on already-resolved header values.

### Phase 3: UI Review — N/A
No `frontend/**` changes; no changes to `ApiRoutesSpec`'s route surface characteristics that
add a UI-facing endpoint; `schemas/**`/`openspec/specs/**` changes are additive spec-delta only
(`rest-api-connector/spec.md`, backend-scoped). Backend-only ticket per its own "Out of scope"
list (Connectors CRUD UI is HEL-824). Correctly triggers N/A.

### Overall: PASS

### Non-blocking Suggestions
- `TemplateInterpolator.resolve`/`resolveEndpoint`/`resolveJsonBody` share near-identical
  scan-and-first-unresolved-wins scaffolding (three copies of the same
  `Placeholder.replaceAllIn` + `firstUnresolved` pattern, differing only in what happens to a
  resolved value). Could be factored into one private helper parameterized by a
  `String => String` value-transform, reducing ~40 duplicated lines. Not required — the
  duplication is small, each copy is independently simple to read, and design.md Decision 3
  deliberately keeps the base `resolve` dumb; flagging for a future cleanup pass, not this
  ticket.
- Per skeptic-design-1's still-open non-blocking note: `parameters` is stored as plaintext in
  `data_sources.config` JSONB with `HasSecrets[RestApiConfigPayload] = HasSecrets(Set.empty)`
  (no redaction) — nothing in this ticket's artifacts or code adds a one-line doc/comment
  stating `parameters` is explicitly not secret storage. Cheap to add as a code comment on the
  `RestApiConfigPayload.parameters` field or the domain field's scaladoc in a follow-up; not
  required to pass this ticket (the credential-unreachability AC is about the *Connector's*
  credential, which this implementation correctly keeps unreachable).
