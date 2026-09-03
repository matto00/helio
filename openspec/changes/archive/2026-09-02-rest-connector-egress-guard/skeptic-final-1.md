## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the diff, the source files, or a command I
ran myself. The prior gates' reports were read as claims only.

### What I verified (with evidence)

**Ground truth.** `git log --oneline 7ad8a2dc..HEAD` (3 commits) and
`git diff 7ad8a2dc...HEAD` (28 files, +1690/-101). Read the full main-source diff and the full
`ContentSourceSupport.scala`, `RestApiConnectorDriver.scala`, `SourcePreviewRoutes.scala`.

**1. Can any REST outbound path reach a socket without the guard? — No, I could not defeat it.**
- `grep -n "singleRequest"` in `RestApiConnectorDriver.scala` returns exactly two sites
  (lines 299, 334), inside `issueAndParse` and `issueTest`. Both are now preceded by
  `guardedPoolSettings(request)` and return `Left` without opening a connection on refusal.
- `grep -n "def "` over the whole driver shows no pagination/follow-up-request loop and no third
  issuance site. All four entry points (`fetch`, `testConnection`, `fetchEphemeral`,
  `testConnectionEphemeral`) funnel into those two.
- Repo-wide `grep -rn "singleRequest|Http(system|Http()" backend/src/main/scala`: the only other
  outbound sites are `ContentSourceSupport.fetchUrl` (owns the policy), `OAuthRoutes` (×2),
  `HttpResendEmailSender`, `HttpClaudeTransport` (×3) — all hard-coded literal hosts — and
  `HttpServer` (inbound bind). Design Decision 6's enumeration table matches what I found.
- **Parser-differential attempt.** The guard parses with `java.net.URI`; Pekko parses with its own
  `Uri`. I probed the classic bypass shapes with a scratch JDK program:
  `http://[::1]/` → loopback (blocked); `http://2130706433/` → 127.0.0.1 (blocked);
  `http://[0:0:0:0:0:ffff:169.254.169.254]/` → link-local (blocked);
  `http://evil.com@169.254.169.254/` and `http://user:pw@169.254.169.254/` → host parses as
  `169.254.169.254` (blocked); `http://0x7f.0.0.1/`, `http://127.1/`, `http://a_b/` →
  `URI.getHost == null` → guard returns "URL is missing a host" (fail-closed).
  Crucially, even where a differential could exist it cannot move the socket: `pinnedPoolSettings`
  installs `ClientTransport.withCustomResolver` returning the `InetAddress` the guard validated,
  so the TCP connection goes to the validated address regardless of what Pekko's `Uri` says. A
  relative/scheme-less URI also fails closed (`Unsupported URL scheme`).
- Redirects: `singleRequest` does not follow them, and both issuers now use the explicit
  `code >= 200 && code < 300` range check instead of `isSuccess()` (which is true for 3xx in
  Pekko), so a 302 stub body is never parsed. Proven by the spec's `/redirect` route pointing at
  `169.254.169.254`.

**2. The seven modified fixtures — checked line by line, no address class is widened.**
Each of `RestApiConnectorDriverSpec`, `...BodySpec`, `...ConnectorResolutionSpec`,
`...TemplatingSpec`, `RestSourceConnectorMigrationSpec`, `DataSourceRoutesSpec` and the new
`RestConnectorEgressGuardSpec` defines the identical helper:
`(host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)`.
That is keyed on the *hostname string*, delegates every other host to the real denylist, is
passed only as a per-instance constructor argument, and appears only under `src/test`.
`ContentSourceSupport.isBlockedAddress` itself is untouched by the diff (verified in the diff
hunk list: no change to the denylist, `isUniqueLocalIPv6`, or the scheme policy). A literal
`127.0.0.1` URL in a test would still be blocked, because the key is the string `"localhost"`.
This edit is safe.
The seventh fixture, `ConnectorEntityRoutesSpec`, is a different edit (`api.example.com` →
`example.com`) — see non-blocking note 1.

**3. Iron Laws — re-run, not taken on trust.**
- `sbt -batch 'testOnly RestConnectorEgressGuardSpec ConnectorEntityRoutesSpec RestApiConnectorSpec'`
  → 72 tests, all passed (read the output).
- `sbt -batch test` (full backend suite, run by me): **3605 tests, 240 suites, 0 failed, exit 0,
  261s.** Log: scratchpad `fullsuite.log`.
- Systematic-debugging law: the ticket is a vulnerability, not a mystery bug, but the root cause
  is probe-confirmed in the design (unguarded `Uri` → `singleRequest` with no `ClientTransport`),
  and the regression guard is real, not vacuous — `RestConnectorEgressGuardSpec`'s rebinding test
  uses hostname `rebind-test.invalid` that real DNS cannot resolve, so it can only pass if the
  connection is pinned; the evaluator's mutant (removing the pinned transport) failing task 4.5 is
  consistent with that construction, and I confirmed the construction myself.

**4. Acceptance criteria traced.**
- AC1 (create/update reject each class, per class not per representative) — `blockedClasses`
  is a 7-entry table (loopback, 169.254.169.254, RFC1918, IPv6 site-local, IPv6 unique-local,
  any-local, multicast) iterated over both `create` and `update`; create asserts row count
  unchanged, update asserts `reloaded.baseUrl == created.baseUrl`. 14 green tests observed.
- AC2 (`/api/sources/infer` and `/api/sources/test`) — covered at `SourceService.inferRest` /
  `testRest`, 14 green tests. I verified the equivalence claim rather than accepting it:
  `SourcePreviewRoutes.scala` is a pure decode-and-delegate shell (`entity(as[JsValue])` →
  `convertTo[RestApiConfigPayload]` → `sourceService.inferRest/testRest`), with no URL handling
  of its own. Service-level coverage is genuinely equivalent here.
- AC3 (DNS name → internal address rejected, connection pinned) — the rebinding test above, plus
  `validateAndResolve` rejecting on `addresses.exists(isBlocked)` (any address blocked ⇒ reject)
  while pinning `addresses.head`. Conservative and correct.
- AC4 (redirect not followed) — the 302 test plus the explicit 2xx-range check.
- AC5 (enumeration recorded) — design.md Decision 6 table; I re-derived it independently by grep
  and got the same set, and confirmed the four exempt HTTP sites use literal hosts.
- AC6 (stored-data assessment) — files-modified.md records 106 dev Connectors, 0 matching the
  disallowed-literal regex, 0 legacy bare-url REST sources, with the no-migration disposition
  (Decision 7). Dev DB only, production untouched. Recorded and internally consistent.
- AC7 (live external endpoint) — see item 4 below.

**5. Design-gate divergences — I found none.** Decisions 1–8 all match the shipped code:
`validateAndResolve` published (D1), guard at the two issuers keyed on `request.uri.toString`
(D2), explicit 2xx range (D3), non-authoritative create/update check (D4), driver wired at
`Main.scala` and `ConnectorEntityService` wired at `ApiRoutes` off the existing `dataSourceUrl*`
seam (D5), enumeration (D6), no migration (D7), untyped 502 channel with the message naming the
host (D8). The one place the spec text and the tests differ in *level* (route vs service for
task 4.3) is explicitly reasoned in the spec file and I verified the reasoning holds.

### Verdict: CONFIRM

The vulnerability is closed at the structurally correct point, the guard is load-bearing (I could
not construct a bypass), the highest-risk edit in the diff does not weaken the denylist, and the
full backend suite is green on my own run.

Answers to the four specific questions raised at spawn:

1. **Yes, the guard closes it.** No unguarded REST outbound path exists; see above for the bypass
   attempts I made and why the pin defeats parser differentials.
2. **The fixture edits are safe.** Hostname-keyed, test-only, delegating; `isBlockedAddress` is
   unmodified.
3. **Decision 8's 502 is acceptable to ship.** It is a response-classification defect, not a
   security defect: the request is refused before any socket is opened, no amplification exists,
   and the create/update path still returns a true 400. Typing `ConnectorDriver`'s error channel
   would drag `SqlConnectorDriver` and ~10 consumers into an Urgent security fix. HEL-953 is the
   right home. It does not materially harm the fix.
4. **AC7's deleted throwaway spec is sufficient, and I agree with the evaluator.** The property it
   proves that nothing else does is "https + pinned transport against a real public host", and
   that exact code (`pinnedPoolSettings` → `pinnedTransport`) has been the production path for
   text/pdf/image/csv URL sources since HEL-215 — REST now shares it rather than adding a new
   one. A committed live-network spec would add real CI flake for a property already carried by
   shipped code. Note 4 below is the only improvement I'd ask for, and it is not blocking.

### Non-blocking notes

1. **`ConnectorEntityRoutesSpec`'s `api.example.com` → `example.com` swap introduces a real
   external-DNS dependency in `sbt test`** (that spec constructs `ConnectorEntityService` with no
   `resolveHost` override, so create-time validation hits real DNS; `RestConnectorEgressGuardSpec`
   does the same for its permitted-baseUrl and update-setup cases). Existing specs only depended
   on `localhost` (hosts file, no network). I judge this **follow-up, not merge-blocking**:
   `example.com` is IANA-reserved and stable, and CI runners have DNS. The clean fix is one line —
   inject `resolveHost = resolverFor("api.example.com", "93.184.216.34")` — and the seam to do it
   already exists. Worth filing.
2. The duplicated `admitLocalhost` helper (7 copies) should be hoisted into a shared test util.
   Follow-up; duplicating it was arguably the safer choice for this diff, since a shared helper is
   a single place a later edit could widen for everyone.
3. `ConnectorEntityService.create` now runs `validateUrl` **before** `DataSourceKind.parseKind`,
   so a request that is both bad-kind and bad-url now reports the URL error first. No test asserts
   the old precedence (full suite green), and tasks.md 3.2 only pins "after the non-empty check".
   Harmless; worth one line in the PR body so it is not a surprise.
4. AC7 would be better evidenced by pasting the throwaway spec's *source* into files-modified.md
   alongside the observed output, so the check is reproducible from the repo without committing a
   network-dependent spec. Suggest for future security tickets.
5. The refusal message (`URL host 'x' resolves to a disallowed address`) is a mild
   internal-vs-external resolution oracle. Pre-existing behavior inherited from HEL-215's guard,
   not a regression here — noting it only so it is a known, accepted property.
6. **Bookkeeping:** `openspec/changes/rest-connector-egress-guard/evaluation-2.md` is untracked
   (`git status --porcelain` → `?? .../evaluation-2.md`). The working tree is not quite clean as
   reported. Commit it with the rest of the evidence before the PR.

### Commands run
- `git log --oneline 7ad8a2dc..HEAD`, `git diff --stat 7ad8a2dc...HEAD`, `git diff 7ad8a2dc...HEAD -- <paths>`
- `grep -rn "singleRequest|Http(system|Http()" backend/src/main/scala`
- `grep -rn "new RestApiConnectorDriver|new ConnectorEntityService" backend/src/{main,test}/scala`
- scratch JDK probe of `java.net.URI` host parsing + `InetAddress` classification for 10 bypass shapes
- `sbt -batch 'testOnly ...RestConnectorEgressGuardSpec ...ConnectorEntityRoutesSpec ...RestApiConnectorSpec'` → 72/72 pass
- `sbt -batch test` → 3605/3605 pass, 240 suites, exit 0
- `git status --porcelain`

No frontend files are touched by this diff (`git diff --stat` shows `backend/**` and
`openspec/**` only), so the UI/design-judgment section of the final gate does not apply and no
dev server was started.
