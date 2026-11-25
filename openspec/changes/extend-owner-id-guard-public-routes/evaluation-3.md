## Evaluation Report — Cycle 3 (evaluation-3.md)

**Reviewed HEAD:** 0819a3d2dcb0df017ddb7ee9aa5d31783b894066.

**What cycle 3 changed** (diff b3d30b365..0819a3d2d):
- `PublicRouteScanner.checkOperands`/`checkOperand` add a default-deny on route operands inside scanned members, against the `OperandHeads` allow-list.
- The `ident.routes` regex no longer matches after a `.`, which fixes m5's misleading message.
- `mutation-structural.txt` adds entries #7-#9.

The main-code diff is still empty.

### Phase 1: Spec Review — FAIL
**Cycle 2 CR1/CR2 are fixed for the shapes they named.** I re-applied m4 (`~ HealthLeak1248.leak` appended to `HealthRoutes.routes`, with the object defined in the same file), and it now goes **RED**: `route operand `HealthLeak1248.leak` does not begin with a known route directive or an allow-listed helper`. Mutations #8 and #9 in `mutation-structural.txt` are consistent with the code.

**Two further independent bypasses of the default-deny stay GREEN.** Both were applied to the mounted `HealthRoutes.routes` with the same `object HealthLeak1248 { val leak: Route = path("leak1248") { get { complete("leak") } } }`. Each compiled, the spec passed 6/6, and each was reverted:
- **m6:** `... } ~ parameters("q".optional) { _ => HealthLeak1248.leak }`. Its head, `parameters`, is in `OperandHeads`, and the foreign Route sits alone in the directive's `{ }` body.
- **m7:** `... } ~ { HealthLeak1248.leak }`. A bare block wraps the foreign Route.

In both cases `GET /leak1248` becomes a public route with no coverage entry, and nothing reports it.

The cause is in `checkOperands`/`checkOperand` (PublicRouteScanner.scala, about lines 150-194):
- A frame is only checked when `groupHasSeparator || isRoot || f.isConcat`, so a `{ }` body with a single operand is never checked.
- `checkOperand` explicitly skips an operand that starts with `{`, on the assumption that the block's own frame is checked. It isn't, because that frame has no separator.
- `routesIn` does not catch these shapes either. m7 adds no path head. In m6, `parameters` is not a method or path directive, so no route key is recorded and the "encloses no recognised method directive" rule never applies.

D4(b) ("any reference to another Route-valued identifier ... fails") is therefore still not met. The structural AC still has a silent-pass path, now behind any allow-listed wrapper directive or a bare block.

**What is met:**
- AC 1-3 and AC 5: route enumeration, guard coverage of every unauthenticated route, per-route owner-entity and literal mutations, and no behaviour change. I verified these by independent re-runs and re-applied mutations in cycles 1-3.
- C1 and C2 still hold.

### Phase 2: Code Review — FAIL
**Gates** (fresh runs in WORKTREE_PATH, `nice -n 19 sbt -J-Xmx3g`, lane DB `helio_hel1248`, empty `ANTHROPIC_API_KEY`):
- `testOnly PublicRouteOwnerIdLeakApiSpec PublicRouteOwnerIdLeakSpec com.helio.testsupport.* com.helio.testkit.*` passed: 8 suites, 60/60 tests. The hel1468-guard reported failed=0, aborted=0, unreadable=0.
- `npm run check:scala-quality` is clean. Soft warning: `PublicRouteScanner.scala` is 337 lines against a 250 budget (informational, though growing).

**Findings:**
- The only blocking issue is the operand check gap described in Phase 1.
- Readability: `checkOperands` uses a mutable frame stack with a special-cased root, which makes it hard to see which frames get checked. That is how the m6/m7 gap arose. A comment stating the invariant ("every route-position expression is checked") plus a test of the scanner itself on small synthetic sources would make the gap visible. Today the scanner is only exercised through mutations against main code.

### Phase 3: UI Review — N/A
There is no UI-triggering change.

### Overall: FAIL

### Change Requests
1. **Check single-operand `{ }` bodies too** (`backend/src/test/scala/com/helio/testsupport/PublicRouteScanner.scala`, `checkOperands`). For every `{`-opened frame in a scanned member, run `checkOperand` on each operand after the lambda prefix is stripped, whether or not the frame has a separator, so that a block's trailing route expression must start with an `OperandHeads` entry. Keep the current rule for `(` frames, which are argument lists, except `concat(`.

   As a result, `checkOperand`'s `startsWith("{")` skip becomes correct, because the nested frame is now always checked. If a scanned member has a multi-statement block, check only the block's final expression.
2. **Add m6 and m7 (exact text above) to `mutation-structural.txt` and show both RED, then revert.** Re-confirm #1-#9.

### Non-blocking Suggestions
- Add a small unit spec for `PublicRouteScanner` over synthetic source strings, one per accepted and rejected shape. The scanner's own behaviour should be pinned directly, rather than only through main-code mutations.
- The cycle-1 notes still stand:
  - Add an ownership read for the history and insight fixtures.
  - Use an owner-entity plant for the GET completion-success mutation.
  - Give the "GET no token" case an expected status.

### Critical Path (final cycle, 3 of 3)
**Most important issue:** the structural coverage check (AC 4 and design D4(b)) still passes silently when a foreign `Route` is wrapped in a bare block or in an allow-listed directive's single-operand body (m6, m7). Each cycle closed the shapes it was shown but not the general rule. The fix is the frame-checking change in CR1 above. It is small and local to `checkOperands`.

**Everything else is verified:**
- Every currently mounted unauthenticated route is exercised by `OwnerIdGuard`.
- Each new coverage point goes red under an owner-entity or literal mutation. I re-applied several of these myself.
- The region-level classifier is default-deny.
- No owner-id leak exists, and main code is untouched.

**Recommendation for the human:** the security value of the ticket, which is the guard coverage, is delivered and sound. The remaining defect is in the meta-check that keeps that coverage complete for future routes. Choose one:
- (a) Allow one more executor cycle for CR1/CR2. This is a small change, and the bypass shapes are documented here verbatim.
- (b) Merge as is, but first record in design.md that the structural check does not inspect single-operand directive bodies or bare blocks inside mounted members, and file a follow-up ticket for CR1/CR2.

Merging with no such note would leave the spec delta's "fails and names the uncovered route" scenario claiming more than the check does.

Evidence:
- The mutation helper is `/home/matt/Development/helio/.concertino/scratch/HEL-1248/mutate3.py`, covering m4, m6 and m7.
- Every mutation was reverted with `git checkout -- backend/src/main`, and `git status` was clean after each one.
