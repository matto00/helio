## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 CR1 (impossible Playwright join walkthrough) — FIXED.**
`grep -rn "Playwright\|playwright" proposal.md design.md tasks.md ticket.md` → no hits (rc=1). The
proposal's "What Changes" bullet now demands the RED-first patch-set probe for BOTH the union and
join cells, names HEL-958, and labels the UI leg a union regression guard. No other artifact
demands the impossible task. Residual: CR1's second half (retitle or add a parenthetical, because
the title still says "against the picker's empty seed id") was not done, and the same stale framing
survives in a DURABLE artifact — see CR1 below.

**Round-2 CR2 (nonexistent `PipelineStepConfig` type) — FIXED, and the new home is correct.**
- Signature is now `secondaryDataSourceId(config: Any): Option[String]` (design Decision 1, task 2.1).
  Verified `PipelineStepConfigCodec.decode` returns `Try[Any]`
  (`api/protocols/pipelines/PipelineStepConfigCodec.scala:29`) and that the 23 `*Config` case classes
  have no sealed parent.
- Placement rationale verified line by line: `PatchSetApplyResolvers.scala:7` and
  `PipelineService.scala:6` both already import `com.helio.api.protocols.pipelines...PipelineStepConfigCodec`,
  and the codec file imports all 23 configs from `com.helio.domain` (`PipelineStepConfigCodec.scala:4`).
  No new dependency edge either way. Accepted.

**Class-closing enumeration re-checked independently.** `grep -rn "DataSourceId"
backend/src/main/scala/com/helio/domain/steps/` returns id-bearing case-class fields in exactly three
files: `JoinStep.scala:12`, `UnionStep.scala:11`, `LookupStep.scala:12`. All 23 `*Config` case classes
live under `domain/steps/` (only panel/source configs live elsewhere). Design's table and the
proposal's audit still match ground truth.

**Decision 7 (the structural guard) — judged on its merits, per the explicit ask.**
It is NOT theatre: task 4.6's "add a throwaway fourth field, confirm RED, remove it" makes it a real
tripwire rather than a prose risk note, and it is strictly better than the round-2 hand-wave. But as
specified it has three holes and one false claim, all verified:
- **The named precedents are not source scanners.** I read all three.
  `SchemaFieldStructuralGuardSpec` is a constructor-behavior test (no file I/O);
  `RlsPolicyGuardSpec` queries the embedded-Postgres catalog against an explicit allowlist;
  `RestConnectorEgressGuardSpec` is a route/service test with a live HTTP stub. `grep -rln
  "src/main/scala" backend/src/test/scala` shows the ONLY real source-scanning precedent is
  `services/assistant/CredentialSurfaceEnumerationSpec.scala`. An executor told to "model it on
  SchemaFieldStructuralGuardSpec" will not produce a source scanner.
- **The regex is type-shaped, and the types are not guaranteed.** `[A-Za-z]*DataSourceId: String`
  misses a future field declared `Option[String]`, `Seq[String]`, or — most plausibly, since all
  three existing sites immediately wrap in `DataSourceId(...)` (`JoinStep.scala:54`,
  `UnionStep.scala:68`, `LookupStep.scala:82`) — the `DataSourceId` value class itself. It also
  misses any second-source id not named `*DataSourceId`, and anything defined outside
  `domain/steps/`.
- **"Asserts each found field is handled by `secondaryDataSourceId`" is not mechanically specified.**
  A source scan yields field-name STRINGS; it cannot invoke the extractor on them without a bridge.
  The unstated bridge is a hardcoded expected set, which an executor can implement tautologically.
- **Vacuity risk survives task 4.6.** The one-time red proof shows the scan sees the source ON THE
  DAY IT IS WRITTEN. The precedent scanner swallows all read failures
  (`CredentialSurfaceEnumerationSpec.scala:52`, `case _: Exception => false`), so a later cwd/path
  change makes such a guard pass while scanning nothing — exactly lesson 4.
- **A strictly stronger mechanism is available with no new machinery.** Scala is 2.13.15
  (`build.sbt:1`), so `productElementNames` exists; `PipelineStep.Registry`
  (`domain/model/PipelineStep.scala:188`) is the codebase's own declared single source of truth for
  step kinds, and `Companion.decodeConfig` is CONTRACTUALLY tolerant (L114-118), so
  `decodeConfig("{}")` yields a default-valued config for every registered kind. A guard can
  therefore enumerate every kind at RUNTIME, read each config's field names via `Product`, and for
  every field ending in `DataSourceId` assert `secondaryDataSourceId` returns `Some(id)` for a
  non-empty decode and `None` for `""`. That closes all three holes (no regex, no directory
  assumption, no `String`-type assumption) and matches `RlsPolicyGuardSpec`'s real pattern
  (allowlist vs. runtime enumeration).

**Other checks.** Error strings preserved by tasks 3.1-3.4 exist verbatim. Decision 3 + task 4.5
satisfy lesson 5 (each leg broken singly). Task 6.1 satisfies lesson 4 for the frontend gates. Task
4.4 satisfies lessons 1/6. Spec deltas validate and both `## MODIFIED Requirements` headers match
baseline.

### Verdict: REFUTE

Both round-2 blockers are genuinely fixed. I refute on two items: one un-propagated correction that
has now reached the durable spec artifact, and Decision 7's mechanism, which is the one thing this
round was asked to judge and which as written can be implemented as a scan that proves less than it
claims.

### Change Requests

1. **The corrected reachability has NOT reached the spec delta — the artifact that outlives this
   change.** `specs/pipeline-joinstep-right-source-acl/spec.md`, "JoinStep right-source must be
   caller-owned on creation": *"An empty `rightDataSourceId` (the "+ Add transformation step"
   picker's own default seed value — `defaultConfigFor("join")`)"*, and the scenario titled
   *"Empty rightDataSourceId join step creation succeeds (picker default)"*. `ticket.md`'s own
   CORRECTION establishes join is picker-EXCLUDED (`stepNarrowing.ts:82-84`, no `JoinConfig.tsx`),
   so attributing this seed to the picker is precisely the falsehood rounds 1 and 2 removed from the
   other three artifacts. Rewrite both to attribute the empty value to its real provenance — the
   frontend `defaultConfigFor("join")` shape as sent by agent/MCP and patch-set callers — and drop
   "(picker default)" from the scenario title. While there, honour round-2 CR1's unaddressed second
   half: retitle the proposal or add the one-line parenthetical noting the title's "picker" framing
   is historical.

2. **Decision 7: replace the source regex with a Registry-driven runtime enumeration (or justify
   the regex against the three named holes).** As written the guard can miss the very drift it
   exists to catch. Preferred: enumerate `PipelineStep.Registry`, decode each kind via
   `Companion.decodeConfig`, use `Product.productElementNames` to find every field whose name ends
   in `DataSourceId`, and assert for each that `secondaryDataSourceId` returns `Some(id)` on a
   non-empty decode and `None` on `""`. This is type-agnostic, location-agnostic, and exercises the
   extractor for real rather than comparing two lists of strings. If the source-scanning form is
   kept instead, the design must state explicitly: (a) the pattern also matches `Option[String]`,
   `Seq[String]` and the `DataSourceId` value class, and fails loudly on an unrecognized declared
   type rather than skipping it; (b) how a scanned field NAME is bridged to an actual
   `secondaryDataSourceId` invocation, so the assertion is not two hardcoded lists compared to each
   other; and (c) that the scan asserts a POSITIVE baseline (it found all 23 step files and exactly
   the three known id fields) so a later path/cwd change cannot make it pass vacuously.

3. **Fix the precedent claim, and make task 4.6's red-proof cover both halves.** Design Decision 7
   cites `SchemaFieldStructuralGuardSpec` / `RlsPolicyGuardSpec` / `RestConnectorEgressGuardSpec` as
   precedent for a source-scanning guard; none of the three reads a source file (verified by reading
   all three). Cite `services/assistant/CredentialSurfaceEnumerationSpec.scala` if a scanner is kept,
   or `RlsPolicyGuardSpec` if CR2's runtime form is adopted. Additionally, task 4.6 currently proves
   only the DETECTION half (new field → red). Require a second, independent mutation proving the
   HANDLING half is non-vacuous: delete one arm from `secondaryDataSourceId` alone and confirm the
   guard (not merely task 2.2's unit test) goes red. Two legs, each broken singly — lesson 5 applies
   to the guard itself, not just to the ACL tests.

### Non-blocking notes

- Task ordering: 4.6 is written above 4.5 in `tasks.md`. Cosmetic, but easy to reorder.
- Round-2's non-blocking notes (the third guard mechanism `PanelServiceHelpers.validateCreatePanelRequest`
  missing from the proposal's audit; `requireTargetId` cited at L91 vs actual L90) are still
  unaddressed. Neither affects a conclusion I re-verified.
- Round-2's note that tasks 1.2-1.3 need pre-existing owned join and union steps to target is also
  still unaddressed; adding that setup step would keep "deterministic" honest.
