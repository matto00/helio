## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Diff surface.** `git log --oneline -3` confirms HEAD=9407b8a4 sits directly on 431d86de
(origin/main tip, "Sync Concertino: CON-152"). `git diff --stat 431d86de..HEAD` = 10 files,
429 insertions: 2 backend files + 8 openspec artifacts. Reviewed `git show 9407b8a4`, not
the stale `main...HEAD` range.

**AC1 — bare-url create persists `parameters` and templates resolve against a real server.**
`SourceService.scala:141-144` now passes `parameters = request.config.parameters.getOrElse(Map.empty)`,
mirroring the `headers` idiom two lines up. The guard spec
(`SourceServiceBareUrlParametersSpec.scala`) creates through `SourceService.createRest` with
`url=/data?account={{accountId}}`, header `X-Account: {{accountId}}`, `parameters=accountId->acct-42`,
then re-fetches the PERSISTED config through a real `RestApiConnectorDriver` (no `fetchOverride`)
against a bound localhost echo route, asserting `receivedQuery == "account=acct-42"` and
`receivedHeader == Some("acct-42")` — i.e. what the server actually received, not an in-process
stub. I ran it myself: `sbt testOnly ...SourceServiceBareUrlParametersSpec` → 1 succeeded.

**AC2 — the guard is not vacuous (reproduced independently, twice).**
1. Reverted the one-line fix alone (removed the `parameters =` argument, restored the
   `rootSelector` trailing comma; `git diff --stat` = 1 file, +1/-2) and re-ran:
   `*** FAILED *** Left("Unresolved template variable: accountId") was not an instance of
   scala.util.Right ... (SourceServiceBareUrlParametersSpec.scala:132)` — exactly the signature
   the executor reported.
2. Independently failability-checked the server-received assertions the ticket cares about
   (not just line 132): mutated the pass-through to `.map { case (k, _) => k -> "WRONG" }`, so
   resolution SUCCEEDS but with wrong values. Result:
   `"account=[WRONG]" was not equal to "account=[acct-42]" (…Spec.scala:133)`. Line 133 is
   therefore independently failable — the guard proves value fidelity, not merely
   non-emptiness. Both mutations restored; `git status --short` shows the working tree back to
   HEAD (only the untracked `evaluation-1.md` remains).

**No regressions.** `sbt testOnly com.helio.services.sources.*` → Suites: 15, Tests: 196
succeeded, 0 failed.

**Migration constraint (shared dev Postgres, concurrent HEL-987/HEL-985).**
`git diff --name-only 431d86de..HEAD | grep -i migration | wc -l` → `0`. No Flyway migration
added. The new spec starts its own `EmbeddedPostgres` in `beforeAll` and Flyway-migrates that
instance only (`embeddedPostgres.getJdbcUrl("postgres","postgres")`), closing it in `afterAll` —
it never touches the shared dev DB.

**Spec delta integrity** (per the "delivery steps are unreviewed code" trap). The `## MODIFIED
Requirements` block reproduces the base requirement body from
`openspec/specs/rest-api-connector/spec.md` verbatim, adds one create-time-obligation paragraph
and one new scenario, and preserves all three pre-existing scenarios. `openspec validate
carry-parameters-bare-url-create --strict` → valid. `files-modified.md` matches the actual diff.
`tasks.md` has 10 checked, 0 unchecked.

**UI gate:** not applicable — zero `frontend/**` files in the diff, so no servers started and no
design-standard review is owed.

### Verdict: CONFIRM

### Non-blocking notes
- The spec's ordering comment (run the server-received assertion before the narrower persisted-map
  assertion so the loud failure signature surfaces first) is a good call and worth keeping if this
  file is ever refactored.
- `admitLocalhost` widens the SSRF block only inside the test; the production `isBlocked` default
  is untouched. Worth remembering if this pattern gets copy-pasted into a non-test path.
