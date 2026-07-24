## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none. All 9 tasks in tasks.md verified against the code (not just the checkboxes):
1.1 `SecretField.scala` defines exactly `SecretField`/`HasSecrets`/`SecretBackend`/
`InlineSecretBackend`/`SecretRedaction.redact` as specified. 1.2/1.3 `HasSecrets` implicits added to
`SqlSourceConfigPayload`/`RestApiConfigPayload` companions with the documented asymmetries. 1.4
`redactSqlPayload`/`redactRestPayload`/`redactRestAuth` are fully removed (`grep` finds zero
references anywhere in `backend/src`), replaced by `SecretRedaction.redact(...)` at both `fromDomain`
call sites. 1.5 `Connector.scala` gets the `'''Secret redaction'''` doc block. 2.1–2.3 the new test
blocks exist and assert the right things (see Phase 2 detail below). 2.4 fresh `sbt test` run
independently confirms 1752/1752 passing, including the pre-existing "credential redaction" block.
No AC reinterpreted, no scope creep, no regressions. `spec.md`'s ADDED requirements match the shipped
code line-for-line (method signatures, field names, backend name). Proposal/design/tasks all reflect
final implemented behavior; the HEL-460/HEL-536 scope split (struck ACs) is honored — no env-var
switch, no Flyway migration, no non-inline backend.

### Phase 2: Code Review — PASS
Issues: none.

Security-specific verification performed (per the task brief), with direct evidence:

1. **JSON-level tests assert absence, not just presence.** Read the new block in
   `DataSourceProtocolSpec.scala` (lines 178–222): each of the three new tests does
   `text should not include raw<Secret>` AND `text should include(""""<field>":"***"""")` against
   `.toJson.compactPrint` output — genuinely catches a leak-alongside-mask bug, not just a
   mask-is-present check.
2. **Pre-existing tests byte-identical.** `git diff 6dbcf4cd..HEAD -- backend/src/test/` shows only
   additions (44 lines added to `DataSourceProtocolSpec.scala`, 0 removed; one wholly new file
   `SecretFieldSpec.scala`). Checked across the whole `backend/src/test/` tree, not just this one
   file — no other pre-existing test file is touched by this change at all (diff --stat confirms
   only these two test files changed in the entire backend/src/test tree).
3. **Asymmetric redaction quirks preserved, not unified.** Read `HasSecrets[SqlSourceConfigPayload]`
   (`DataSourceProtocol.scala:262-272`): `get = p => if (p.password.isEmpty) None else
   Some(p.password)` — empty password → no redaction, exactly as before. Read
   `HasSecrets[RestApiConfigPayload]` (`DataSourceProtocol.scala:333-346`): both `auth.token` and
   `auth.value` fields use `.filter(_.\`type\` == "bearer"/"api_key").flatMap(_.token/.value)` —
   `Some` (redaction triggers) whenever the field is present, regardless of emptiness. The two rules
   are genuinely distinct `get` implementations, not collapsed into shared logic.
4. **No path bypasses the seam.** `redactSqlPayload`/`redactRestPayload`/`redactRestAuth` are fully
   deleted (zero grep hits, not merely unused). Grepped every construction site of
   `SqlSourceResponse(`/`RestSourceResponse(` in `backend/src/main` — only the two inside
   `DataSourceResponse.fromDomain`, both routed through `SecretRedaction.redact`. Grepped every
   `DataSourceResponse.fromDomain` call site (`DataSourceRoutes.scala`,
   `DataSourcePreviewRoutes.scala`) — all routes funnel through `fromDomain`; none construct a
   response directly. The only other callers of `SqlSourceConfigPayload.fromDomain`/
   `RestApiConfigPayload.fromDomain` are `DataSourceConfigCodec.encodeSql`/`encodeRest`
   (`DataSourceConfigCodec.scala:59,72`), which serialize to the DB storage column (pre-existing,
   unrelated to the API-response boundary — the raw secret must round-trip to storage) — correctly
   untouched by this change.
5. **Scope discipline confirmed.** No env-var grep hits (`SECRET_BACKEND`/`secret_backend`/
   `SECRET_MANAGER` — zero matches in `backend/` or `CLAUDE.md`). No new Flyway migration file
   (`git diff main...HEAD -- backend/src/main/resources/db/migration/` empty). `SecretBackend` has
   exactly one concrete implementation (`InlineSecretBackend`), no sealed hierarchy, no dangling case.
   Nothing from HEL-536 (GCP Secret Manager client, envelope encryption, encrypted columns) present.
6. **Standard checks**, all run independently (not trusting executor's report):
   - Fresh `sbt test`: 1752/1752 succeeded, 0 failed.
   - `npm run lint`: clean (zero warnings).
   - `npm run format:check`: clean.
   - `npm run check:schemas`: in sync.
   - `npm run check:scala-quality`: clean (59 pre-existing soft file-size warnings, none in the new
     files — `SecretField.scala` is 57 lines). No inline-FQN violations in the new
     `'''Secret redaction'''` doc block in `Connector.scala` or any touched file — all imports for
     `HasSecrets`/`SecretField`/`SecretRedaction` are top-of-file in `DataSourceProtocol.scala`; the
     one function-scoped import in the new `DataSourceProtocolSpec.scala` test block is a legitimate
     `import` statement (not an inline FQN reference) and is the CONTRIBUTING.md-sanctioned
     single-use-in-a-function pattern.
   - `npm test`: 118 suites / 1239 tests passed (frontend — no frontend files touched by this
     backend-only change, expected no-op).
   - `npm run check:openspec`: reports the expected "complete (9/9) but not archived" hygiene issue —
     matches the disclosed `-n` bypass reason exactly.
   - Commit `9e3ac755`'s body discloses the `-n` bypass with the correct, expected reason
     (complete-but-unarchived openspec hygiene check, archived later in the workflow) and confirms
     every other gate (lint, format, schemas, scala-quality, sbt test) was run manually before commit
     — consistent with the fresh runs above. Nothing else was silently broken by the bypass.

DRY/readable/modular/type-safe/error-handling: the seam is a small, well-documented data-declaration
module; `SecretField`'s `get`/`set` pair is the correct place for the asymmetry, matching design.md
Decision 1. No dead code, no leftover TODO/FIXME. No over-engineering — a plain trait/object instead
of a sealed hierarchy or macro, matching design.md Decision 3's stated rationale. Refactor of
`fromDomain`'s two cases is behavior-preserving (verified via the byte-identical wire-output tests
and the untouched pre-existing test block).

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files were touched by this change (backend-internal redaction seam only,
confirmed via `git diff main...HEAD --stat`).

### Overall: PASS

### Non-blocking Suggestions
- The new `import com.helio.domain.{...}` inside the new test block in `DataSourceProtocolSpec.scala`
  could be hoisted to the file's existing top-level `import com.helio.domain.{...}` line for
  consistency with the rest of the file's style, though this is explicitly permitted by
  CONTRIBUTING.md's single-use-in-a-function carve-out and is not a violation.
