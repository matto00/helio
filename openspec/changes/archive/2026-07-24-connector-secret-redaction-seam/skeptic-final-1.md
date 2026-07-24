## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Seam is the only path to a response payload; `DataSourceConfigCodec` is a genuinely different case.**
   - Read `backend/src/main/scala/com/helio/api/protocols/DataSourceConfigCodec.scala` in full: its
     `decode*`/`encode*` functions only convert between the domain config and the persisted `config`
     JSON column string.
   - `grep -rn "DataSourceConfigCodec\." backend/src/main/scala` shows its only caller is
     `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` (lines 29-64,
     135-141) — pure DB round-tripping, never touches an HTTP response.
   - `grep -rn "RestSourceResponse(\|SqlSourceResponse(\|...`" across `backend/src/main/scala` (excluding
     `DataSourceProtocol.scala` itself) returns nothing — `DataSourceResponse.fromDomain` (lines 181-237
     of `DataSourceProtocol.scala`) is the sole construction site, and its `RestSource`/`SqlSource` cases
     (lines 190-205) both call `SecretRedaction.redact(...)` before building the response.
   - `git diff 6dbcf4cd..HEAD --stat -- .../DataSourceConfigCodec.scala` is empty — this file is
     byte-for-byte unchanged by the ticket, confirming storage round-tripping was never in scope and
     was not touched.

2. **New JSON-level tests assert raw-secret absence, not just mask presence.**
   - Read `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala` lines 178-222
     (new `"...serialized JSON never leaks raw secrets"` block). All three cases do
     `text should not include raw<Secret>` **and** `text should include(""""field":"***"""")` — both
     directions asserted, against `DataSourceResponse.fromDomain(src).toJson.compactPrint` (the actual
     wire bytes), not `SecretRedaction.redact`'s return value directly.

3. **SQL-empty-password vs. REST-any-`Some` asymmetry intact.**
   - Read the two `implicit val hasSecrets` instances directly in `DataSourceProtocol.scala`:
     `SqlSourceConfigPayload.hasSecrets` (line 266-274): `get = p => if (p.password.isEmpty) None else
     Some(p.password)` — empty password exempted.
     `RestApiConfigPayload.hasSecrets` (line 333-346): both `auth.token`/`auth.value` fields mask
     whenever `Some(_)` regardless of string content (no `.isEmpty` guard) — matches ticket's documented
     nuance exactly.

4. **Pre-existing tests byte-identical.**
   - `git diff 6dbcf4cd..HEAD -- backend/src/test/` touches exactly two files:
     `DataSourceProtocolSpec.scala` (modified) and `SecretFieldSpec.scala` (new).
     `git diff ... | grep "^-" | grep -v "^---"` returns nothing — zero deleted/altered lines anywhere
     in the whole test tree; the entire diff is pure addition.

5. **Scope discipline.**
   - `git diff 6dbcf4cd..HEAD` has zero hits for `Sys.env`/`System.getenv`/env-var code (only doc-prose
     mentions describing what was *not* done).
   - `git diff 6dbcf4cd..HEAD --stat -- backend/src/main/resources/db/migration/` and
     `-- CLAUDE.md` are both empty — no migration, no production-env table change.
   - `grep -rn "extends SecretBackend" backend/src/main/scala` → exactly one hit
     (`InlineSecretBackend`), no dangling/unimplemented case.

6. **design.md AC1-logs note (lines 117-128).** States "Verified (not assumed): grepping every
   `log.error`/`log.warn`/`log.info`/`log.debug` call in `SqlConnector.scala`, `RestApiConnector.scala`,
   `SourceService.scala`, and `DataSourceProtocol.scala`, none logs a config/auth object" — names its
   evidence concretely. Independently re-ran the same grep myself:
   `grep -n "log\.\(error\|warn\|info\|debug\)"` on those four files returns only static-message +
   exception calls (e.g. `log.error("SQL execution failed", e)`), zero config/payload interpolation.
   `SourceService.scala` has no log calls at all. The note also explicitly states the seam "adds no
   mechanism that would catch a future connector...that starts logging its raw config. Nothing here
   would fail if that happened" — unhedged on both required points (evidence named, no enforcement
   claimed going forward).

7. **Fresh verification runs (all read myself, not trusted from prior reports):**
   - `sbt -batch "testOnly com.helio.services.SecretFieldSpec com.helio.api.protocols.DataSourceProtocolSpec"` → 26/26 pass, including the new JSON-leak and asymmetry tests.
   - `sbt -batch test` (full suite) → **1752/1752 pass**, 0 failed — matches the executor's disclosed count exactly.
   - `npm run lint` → clean. `npm run format:check` → clean. `npm run check:schemas` → in sync.
   - `npm run check:scala-quality` → exit 0, "clean (59 soft warning(s))" — the only new soft-budget
     warning is `DataSourceProtocol.scala is 434 lines (soft budget 250)`, a non-blocking line-count
     note, not a hard failure; no FQN violations reported.
   - `npm test` → backend jest: no tests (expected, JS-only harness); frontend: 118 suites / 1239 tests
     pass (unaffected by this backend-only change, as expected).
   - Manually grepped `com\.helio\.` in every touched file — all hits are legitimate `package`/`import`
     statements, none in prose/doc-comments (no inline FQN violations).
   - `git log 6dbcf4cd..HEAD --format='%B'` — every `-n` bypass commit discloses its reason in the body
     (state-tracking-only files; evaluation-report artifact; `check:openspec` "not archived yet" on the
     real code commit, explicitly stated as expected/established precedent along with "all other
     pre-commit gates run manually and pass clean; sbt test passes (1752/1752)"). Re-ran
     `npm run check:openspec` myself — reproduces the identical "complete (9/9) but not archived" message,
     confirming the bypass reason is accurate, not a cover for a real failure.

### Verdict: CONFIRM

### Non-blocking notes
- `DataSourceProtocol.scala` is now 434 lines, over the 250-line soft budget flagged by
  `check:scala-quality` (non-blocking, pre-existing pattern — many files in this codebase already
  exceed the soft budget). Worth a split if the file grows further with future HEL-429 connectors.
- design.md's own Risk/Trade-off section already names the residual gap accurately (a future
  connector's `fromDomain` case could assign an unredacted payload without a compile-time guard,
  caught only by the JSON-assertion test pattern this ticket establishes) — this is disclosed, not
  hidden, and is explicitly deferred to per-connector follow-on tickets per the ticket's own
  out-of-scope list.
