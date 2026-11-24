## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e6bdfb578d571955c1abb44007fc58bd7a7f62dc` against the live-resolved base
`a6ac494b47f756d38520e17b4fb5aeab898ace6b` (`resolve-review-base.sh`, exit 0). Commits: `eee05b85b` (red, tests and
openspec only, verified with `git show --stat`), `e6bdfb578` (implementation).

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-min-rows-duplicate-proposal/HEL-1834`.
- **The diff (read in full, backend main sources):**
  - `FormPanelConfig.isCompactCounter` is `fields.size == 1 && fields.head.control == "counter"`. That matches the
    client's `isCompactCounterConfig` (`compactCounter.ts`) exactly. Missing or Empty config counts as a plain form on both sides.
  - `FormPlacementRule.isSpaceBelowFree` matches `panelGridConfig.ts:100-114` term for term: top is `y+h`, bottom is
    `y+rows`, column and row overlap are half-open, and the target is excluded by panelId.
    `minRowsFor` returns 5 for a non-counter `FormPanel`, else 1.
  - Duplicate: `duplicateSizes(..., minH)` floors h in every breakpoint. The repository computes minH from the source
    row read inside the transaction. `CreatePlacement.append` (CreatePlacement.scala:67-89) stacks the copy at x=0 below
    each breakpoint's stored bottom, so the floor cannot overlap or move anything.
  - Proposal apply / PUT contents: `buildLayout(minRows)` lifts an authored lg item only when `h < min` and the space
    below is free. It checks against the running authored set, so earlier lifts count. Unauthored items are appended
    below the bottom after the lift. `LayoutReflow.reflow` keeps `h` (`math.max(1, s.h)`), so md/sm/xs carry the lift.
    Apply always creates a fresh dashboard (`createAll`), and contents replace the whole layout. No pre-existing panel
    is ever outside the set being checked.
- **Path enumeration (independent grep for `DashboardLayoutItem(`, `buildLayout(`, `duplicateSizes(` in main):** I
  found no other path that copies a caller- or source-supplied height for a newly created panel. The only other
  verbatim copy is `DashboardSnapshotRepository:138` (import and dashboard duplicate), which is out of scope by owner
  ruling (`workflow-state.md` SCOPE_RULINGS) and pinned by GUARD tests. Panel create uses kind defaults.
  Including PUT contents follows a recorded owner ruling (`contents=include`). It is not scope drift.
- **AC1 (red first):** the red commit `eee05b85b` touches only the spec and openspec files. Its committed red run
  (`evidence/red-route-spec.txt`) shows the three growth tests failing with "4 was not equal to 5". From the base
  code I read, failure is the forced outcome: base `duplicateSizes` returned the stored `i.h`, and base `buildLayout`
  copied `l.h` verbatim. The evaluator also says it reproduced the red at `eee05b85b`.
- **AC2 (compact counter unchanged):** route tests on all three paths assert 4 -> 4, plus a `minRowsFor` unit test.
- **AC3 (import unchanged, GUARD):** `GUARD: dashboard import` and `GUARD: dashboard duplicate` both assert h=4 in
  every breakpoint and are labelled GUARD. The evaluator recorded mutation evidence that each guard can fail.
- **Fresh gates (my own runs, lane DB `helio_hel1834`, `-J-Xmx3g`, `nice -n 19`, empty `ANTHROPIC_API_KEY`):**
  - The four new or changed specs (`FormMinRowsPathsSpec`, `FormPlacementRuleSpec`,
    `ProposalLayoutSupportMinRowsSpec`, `CreatePlacementSpec`): `Tests: succeeded 32, failed 0`. Every one of the 9
    route tests is listed by name in the output.
  - The broader set (those four plus `com.helio.services.proposals.*`, `com.helio.api.routes.proposals.*`, the
    dashboard contents routes and the panel duplicate routes): `Suites: completed 31, aborted 0; Tests: succeeded 221,
    failed 0`. I relied on the evaluator's pasted 10-shard full-suite run (782 suites, 10,381 tests, 0 failed) for the rest.
- **UI:** no `frontend/**` change, so the visual-judgment step does not apply. I started no servers.

### Verdict: CONFIRM

### Non-blocking notes
- When the lg lift is blocked by a neighbour, the form stays at 4 rows in md/sm/xs as well. Reflow stacks items on
  shelves, so the space below would often be free at those breakpoints. This is consistent with "md/sm/xs reflowed
  from lg" in the design. A follow-up could apply the rule per breakpoint if that matters.
- The apply and contents route tests assert only `lg`. A md/sm/xs height assertion would pin the claim that reflow
  carries the lift. The unit test validates the layout at every breakpoint, but it does not check that the lifted
  height carries through to md/sm/xs.
- `evidence/mutations.txt` lists outcomes without the mutation diffs, so it does not prove itself. The evaluator's
  independent mutations cover the guards, the unconditional lift and the counter exemption.
