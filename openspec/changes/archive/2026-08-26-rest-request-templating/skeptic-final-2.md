## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review. Every claim below is derived from the actual diff, a fresh full `sbt test` run I
executed myself, a targeted suite run, and two JVM probes I compiled and ran against the real
compiled `TemplateInterpolator` class and the real pekko-http jar on the project classpath —
not from the commit message, `evaluation-1.md`, or skeptic-final-1's narrative.

### What I verified (with evidence)

**Fix commit scope** — `git show 8b5e0a82 --stat`: 3 production files
(`TemplateInterpolator.scala`, `DataSourceProtocol.scala`, `model.scala`), 1 test file, and
planning artifacts. No new files, no unrelated refactors, no touch to
`RestApiConnectorDriver.scala`/`DataSourceConfigCodec.scala` (so round 1's findings 1–6 about
the templating boundary, wire shape, and credential unreachability remain valid unchanged —
I re-read the driver's `buildResolvedRequest`/`resolveTemplatedRequestParts` at HEAD to confirm
they are byte-identical to what I reviewed in round 1).

**CR1 is genuinely fixed — verified by running the real class, not by reading the patch.**
`encodePathSegment` is now `if (value.isEmpty) "" else Uri.Path.Segment(value, Uri.Path.Empty).toString`.
I compiled a Java probe against `Compile/fullClasspath` (`sbt export Compile/fullClasspath`)
and invoked the actual `TemplateInterpolator`:
```
empty      -> Right(/echo/)
space*     -> Right(/echo/New%20York*)
unresolved -> Left(v)
traversal  -> Right(/echo/a%2F..%2Fb%3Fx=1%23f)
```
- the empty case now returns a `Right`, no exception — CR1's exact defect, gone;
- the non-empty encoding is unchanged (`%20`, not `+`; `*` left literal) — the fix did not
  regress the RFC-3986 behaviour;
- fail-loud on an *unresolved* variable still returns `Left(v)` — the fix did not weaken the
  fail-loud contract into swallowing missing variables (the distinction the change requires);
- a hostile value still cannot escape its segment (`/`→`%2F`, `?`→`%3F`, `#`→`%23`).

**The pre-fix behaviour really was a throw** (so the new test exercises a genuinely broken
path, not a vacuous assertion). Reflection probe against the same jar:
```
ctor=public ...Uri$Path$Segment(java.lang.String, ...Uri$Path$SlashOrEmpty)
Segment("")   -> THREW: java.lang.IllegalArgumentException: Path segment must not be empty
Segment("ok") -> ok
```
Since the only new code on that path is the `if (value.isEmpty)` guard, the new test's
asserted result (`path == "/echo/"`, reached through a real HTTP round-trip) is unreachable
without the fix. That is the "would go red" grounding, established without editing the tree.

**The regression test is end-to-end, not a unit stub.** New test at
`RestApiConnectorDriverTemplatingSpec.scala` (§4.4): builds a real `RestApiConfig(endpoint =
"/echo/{{v}}", parameters = Map("v" -> ""))`, calls `driver.fetch(..., ConnectorResolveContext.Owned)`
against the suite's real bound pekko echo server, and asserts the server actually received
`"/echo/"`. It goes through the same `buildResolvedRequest` the defect escaped from.

**Targeted suite — re-run by me.**
`sbt -batch 'testOnly ...RestApiConnectorDriverTemplatingSpec'` → **18 tests, 18 succeeded,
0 failed**, including the new empty-parameter case and all of §4.1–4.9 (both-paths, fail-loud,
escaping, credential unreachability, decode regression, auth-header collision, ephemeral
passthrough).

**Full backend gate — re-run by me, twice.** `cd backend && sbt -batch test`:
`Total number of tests run: 3553 / succeeded 3540 / failed 13` (was 3552/3539/13 at round 1 —
exactly the +1 new test, no new failures). I re-ran to capture the failure cause: every one of
the 13 is `ConnectorCredentialEncryptionFailed: Failed to encrypt connector credential:
NoKeyConfigured`, in `SourceServiceSpec`/`DataSourceRoutesSpec`/`PipelineApplyProposalRollbackSpec`/
`ApiRoutesSpec`/`AuditMutationInstrumentationSpec`. `grep -c CONNECTOR_MASTER_KEY backend/.env`
→ `0`. Reproduced across both runs: environmental, pre-existing, independent of this diff
(which touches no encryption code). Notably the templating spec is immune because it injects
its own `EnvMasterKeyProvider(Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), ...))` — so its
credential-decrypt assertions (4.8) are real, not skipped.

**Other repo gates — re-run by me.** `node scripts/check-scala-quality.mjs` → *clean* (141
pre-existing soft warnings, none in the changed files); `check-schema-drift.mjs` → *in sync*
(67 schemas / 49 protocol files); `check-openspec-hygiene.mjs` → *openspec/ is clean*. No
`frontend/**` files in `git diff main...HEAD --stat`, so `DESIGN.md` and the UI/visual phase
are correctly N/A — no servers started, no screenshots owed.

**DRY fold is behaviour-preserving, not just tidier.** `resolveWith(template, params,
encodeValue)` is the single scan; `resolve`/`resolveEndpoint`/`resolveJsonBody` are now
one-liners passing `identity`/`encodePathSegment`/`jsonEscape`. The transform is applied at
exactly the same point as before (`case Some(value) => Regex.quoteReplacement(encodeValue(value))`),
first-unresolved-wins short-circuit and the no-placeholder passthrough are unchanged. The probe
above plus the 18 green tests cover all three arms. This does what the commit message claims:
CR1 is fixed in one place rather than leaving the encoding arm as the odd one out.

**Both non-blocking notes actually addressed** (I read the hunks, not the message):
- "not secret storage" scaladoc added in **both** places — `DataSourceProtocol.scala:154-155`
  ("NOT secret storage — round-trips unredacted on every read … never put a credential here,
  it belongs on the Connector") and `model.scala:510-512` on `RestApiConfig`.
- `evaluation-1.md`'s test-4.5 overstatement corrected in the same commit.

**Acceptance criteria traced.**
1. endpoint/query/headers/body parameterization — endpoint/query/headers wired in
   `resolveTemplatedRequestParts` (tests 4.1, 4.4); `body` is templated at the interpolator
   (`resolveJsonBody`, test 4.7) but is *not* attached to the outbound request — because
   `buildResolvedRequest` never sends an entity at all today. That is pre-existing and
   explicitly scoped out by the ticket ("REST body/response shaping beyond templating the body
   string (HEL-826)") and documented in design.md Decision 7. AC met as scoped.
2. both paths — 4.1 (`Owned` authoring) and 4.2 (real `InProcessPipelineEngine.loadRows`
   `case r: RestSource` with `ConnectorResolveContext.Internal`).
3. unresolved fails loud naming the variable — four §4.3 tests asserting
   `Left("Unresolved template variable: <name>")`, demonstrated red; probe above confirms
   `Left(v)` at the interpolator.
4. escaping per context — §4.4: `&`/quote/newline/unicode through `Uri.Query`, CRLF header
   rejection, JSON-body escaping, `%20`-not-`+` endpoint encoding, plus my traversal probe.
5. credentials not interpolable — structural (`credentialValue` never enters any map passed to
   `TemplateInterpolator`), plus 4.5's same-named-key hostile test and 4.8's real bearer decrypt.
6. no-parameters source unchanged — 4.6 (end-to-end) and 4.6a (real `DataSourceConfigCodec.decodeRest`
   on a blob with no `parameters` key → `Map.empty`).

### Verdict: CONFIRM

The single blocking defect from round 1 is fixed at the root, the fix is proven against the
real classes rather than asserted, the regression test would genuinely have caught it, no
other behaviour regressed (test count moved by exactly +1, gate results otherwise identical),
and both non-blocking notes were closed. Ships.

### Non-blocking notes

- `TemplateInterpolator.resolveJsonBody` currently has no production caller — `config.body` is
  never attached to the outbound request until HEL-826. It is public API with tests, deliberately
  scoped and documented (design.md Decision 7), so this is a handoff, not dead code — but if
  HEL-826 slips, it is the thing to re-check.
- Environmental, carried from round 1: this worktree's `backend/.env` has no
  `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID`, so 13 connector-credential tests fail in
  every local backend run here. Pre-existing and unrelated, but it keeps the local backend gate
  permanently red and will mask a real regression in a future ticket touching those suites.
  Worth fixing in the shared local dev env, not in this branch.
- This branch's `scripts/concertino/` predates `next-report-number.sh`/`persist-evidence.sh`/
  `emit-event.sh` (only `assert-phase`/`cleanup`/`setup-worktree`/`start-servers` exist here). I
  ran those three from the main checkout at `/home/matt/Development/helio/scripts/concertino/`
  against this worktree's paths; `next-report-number.sh` returned `READY number=2`, matching this
  filename. Not a blocker, but the worktree will pick the newer scripts up on the next rebase.
