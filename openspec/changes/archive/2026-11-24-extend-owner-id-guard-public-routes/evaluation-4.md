## Evaluation Report — Cycle 4 (evaluation-4.md), the one extra round the owner granted

**Reviewed HEAD:** 1b8fb4e8255a55678ce1260a703d0f219ce8d553. It sits on merge a62c2116f of origin/main. The live base, re-resolved, is 7292f77d60ff9f46cf3fc94ce83c1f110b92139f, which is the merge-base with origin/main.

**Scope against the live base:**
- The only code files are `PublicRouteOwnerIdLeakApiSpec.scala` and `testsupport/PublicRouteScanner.scala`.
- Everything else is change-dir artifacts.
- `backend/src/main` is untouched.

**What cycle 4 changed:** `checkOperands` now checks the final expression of every `{`-opened block in the mounted member. This covers lambda bodies and `if`/`match` arms. `ServiceResponse.run`/`runNoContent` value blocks are skipped, and allow-listed helper bodies get the operand rule but not the block rule.

### Phase 1: Spec Review — PASS
**The named defect is fixed.** I re-applied cycle 3's bypasses to the mounted `HealthRoutes.routes`, with `object HealthLeak1248 { val leak: Route = path("leak1248") { get { complete("leak") } } }` in the same file. Both now fail the check:
- **m6:** `} ~ parameters("q".optional) { _ => HealthLeak1248.leak }` is **RED**: `final expression of a block `HealthLeak1248.leak` does not begin with a known route directive...`.
- **m7:** `} ~ { HealthLeak1248.leak }` is **RED** with the same message.

**New shapes I tried** (not among #1-#16; each applied, run and reverted):
- **n1:** `} ~ parameters("q".optional)(_ => HealthLeak1248.leak)` stays **GREEN** (6/6). This is m6 with parentheses instead of braces.
- **n2:** `} ~ get(HealthLeak1248.leak)` stays **GREEN** (6/6). A directive is applied to a foreign Route with parentheses, with no lambda at all.
- **n3:** a foreign Route inside a `ServiceResponse.run(...) { _ => ... }` value block. **Not reachable:** the compiler rejects it (`found: Route, required: ToResponseMarshallable`), because `run`'s block must yield a marshallable. The executor's `ValueBlockOpeners` exemption is therefore sound for `run`. For `runNoContent` it is moot, since that function takes no block.

**FINDING (documented limitation, not a cycle request):** n1 and n2 are reachable bypasses of the structural check.
- Each one compiles and puts `GET /leak1248` on the unauthenticated tree with no coverage entry, and the spec stays green.
- **Precise cause:**
  - `checkOperand` accepts an operand by its head token alone. `get` and `parameters` are in `OperandHeads`.
  - `checkOperands` only inspects `(` frames when they are `concat(` or contain a separator.
  - The new block rule only covers `{` frames.
  - So a directive from the allow-list applied to a parenthesised Route argument (`get(X)`, `parameters(...)(_ => X)`, `onSuccess(f)(r => r)`) is never looked inside.
  - `routesIn` does not catch these shapes either, because its method and path regexes require a following `{`.
- **Possible fix:** apply the final-expression rule to the last argument frame `(...)` of any `OperandHeads` directive, the same way the block rule now does for `{`.
- **Required before merge:** record this limit in design.md, alongside the allow-listed-helper-body exemption the executor already states in the scanner scaladoc, and file a follow-up ticket. Otherwise the spec delta's "fails and names the uncovered route" scenario claims more than the check does.
- **Context:** both shapes are non-idiomatic in this codebase. Every mounted member uses brace-applied directives.

**ACs:**
- AC 1-3 and AC 5 were met and independently verified in cycles 1-3.
- AC 4 (structural check) is met for every brace-idiomatic shape tried across four cycles (16 executor mutations plus my m1-m7). The finding above is its remaining limit.

**CONSTRAINTS:** C1 and C2 still hold, unchanged.

### Phase 2: Code Review — PASS
**Gates** (fresh runs in WORKTREE_PATH, `nice -n 19 sbt -J-Xmx3g`, lane DB `helio_hel1248`, empty `ANTHROPIC_API_KEY`):
- I re-ran the executor's shard S7 (`api.routes.dashboards.*`, `proposals.*`, `patchsets.*`) together with `testsupport.*` and `testkit.*`. Result: 66 suites, 541/541 passed, and the hel1468-guard reported failed=0, aborted=0, unreadable=0, in 193 s.
- That run includes the new spec and `PublicRouteOwnerIdLeakSpec`.
- S7's own count reconciles exactly: 66 suites minus the 6 testsupport/testkit spec files is the 60 suites `full-suite-shards.txt` claims, and 541 minus 495 is the 46 testsupport/testkit tests.
- `npm run check:scala-quality` is clean.

**The full-suite evidence is real:**
- `full-suite-shards.txt` reports 789 suites completed across S1-S9.
- That matches both the 789 `*Spec.scala` files and the 789 `class ...Spec` declarations under `backend/src/test/scala`.
- Each shard line carries a hel1468-guard summary with zero failures. The 5 canceled tests in S3/S4 are assumption-cancels, as stated.

**Findings (non-blocking):**
- `PublicRouteScanner.scala` is now 432 lines. That is past CONTRIBUTING's "~400, propose a split" point. Moving `checkOperands`/`finalExpressions`/`lastStatement`/`splitTopLevelWord`/`depthAt` into a `RouteOperandCheck` helper object would bring it back under budget.
- The scanner's parsing heuristics are only pinned through main-code mutations. A small synthetic-source unit spec would make limits like n1/n2 visible and testable.

### Phase 3: UI Review — N/A
There is no UI-triggering change from this ticket. The merged frontend files come from origin/main, which is the base.

### Overall: PASS
This follows the orchestrator's stated criteria for this round. m6/m7 are fixed, gates are green, and nothing regressed. The n1/n2 bypass is a finding to document, not a cycle request.

### Non-blocking Suggestions
- Document the n1/n2 limit and the helper-body exemption in design.md and the follow-up ticket, as above.
- Split `PublicRouteScanner.scala` (432 lines) and add a synthetic-source unit spec.
- The cycle-1 nits still stand:
  - Add an ownership read for the history and insight fixtures.
  - Use an owner-entity plant for the GET completion-success mutation.
  - Give the "GET no token" case an expected status.

Evidence:
- The mutation helper for m6, m7 and n1-n3 is `/home/matt/Development/helio/.concertino/scratch/HEL-1248/mutate4.py`.
- Every mutation was reverted with `git checkout -- backend/src/main`, and `git status` was clean after each one.
