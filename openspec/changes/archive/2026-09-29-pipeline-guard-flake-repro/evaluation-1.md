## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- **All ticket acceptance criteria addressed explicitly**: PASS. AC1 (reproduce under
  full-suite load, capture test name + assertion + surefire XML) — done via a 3-way
  `sbt testOnly` contention loop (design.md Decision 1 method 1), failure captured at
  iteration 33/40 (159s/1200s budget), verbatim assertion + XML persisted under
  `repro-evidence/1/`. I independently re-read the copied XML
  (`repro-evidence/1/TEST-com.helio.services.pipelines.PipelineRunGuardIntegrationSpec.xml`)
  and confirmed it verbatim-matches `repro-findings.md`'s quoted assertion text, test name
  and timestamp — not just trusted the prose summary. AC2 (identify H1/H2/H3 before any fix)
  — done; see independent verification below. AC3 (if H1, reopen guard-correctness) — N/A,
  H1 not confirmed, correctly not touched.
- **No AC silently reinterpreted**: PASS.
- **All task items marked done and matching what was implemented**: PASS with one gap.
  Tasks 1.1–5.3 are checked and each carries an evidence pointer except **tasks.md 4.4**:
  its own stated Verify step ("temporarily mutate the guard/test to force a mismatch and
  confirm the `withClue` text actually appears in the failure output, then revert the
  mutation") has no corresponding evidence anywhere in `repro-findings.md` or
  `files-modified.md` — unlike every other task, which cites a specific log/section. The
  guardrail code itself is present and correctly shaped (`withClue` wraps both assertions,
  mirroring `awaitAllSettled`'s existing pattern at line 181 — verified by direct read at
  `PipelineRunGuardIntegrationSpec.scala:318-324`), and `withClue`'s message-prepending
  behavior is a guaranteed ScalaTest library contract, not custom logic, so the residual risk
  of this being wrong is low. This is a **non-blocking suggestion**, not a Change Request: the
  substance is correct, but the task's own prescribed verification procedure was not evidenced
  as executed.
- **No unnecessary changes outside ticket scope**: PASS. `git diff --name-only` against the
  live-resolved base (`c740775e`) shows exactly one production/test source file touched
  (`PipelineRunGuardIntegrationSpec.scala`) plus the change-dir's own openspec artifacts. No
  production code touched — confirmed by diff, matching `files-modified.md`'s explicit claim.
- **No regressions to existing behavior covered by other specs**: PASS — full suite gate below
  (4883/4883, 0 failed) covers this directly.
- **API contracts / schemas**: N/A, no API-surface change.
- **Planning artifacts reflect final implemented behavior**: PASS. `design.md`,
  `tasks.md`, `repro-findings.md`, `files-modified.md` all consistently describe the H3
  classification and the 60→3600 fix; no drift between plan and diff.
- **`workflow-state.md` CONSTRAINTS honored (CON-161)**: PASS on all six.
  - C1 (hardware cap): repro-findings.md documents 3 concurrent `sbt` OS-level invocations
    under `nice -n 19`, matching the design-gate-approved cap.
  - C2 (verbatim failure recording): satisfied, verified independently above.
  - C3 (never loosen an assertion / raise a timeout without probe-confirmed mechanism
    evidence): the diff does not touch any assertion's strictness, and the window-widening is
    tied to a probe-confirmed mechanism (see independent verification below), not a blind
    guess.
  - C4 (H1 → STOP and escalate, never self-approve a production fix): H1 was not confirmed;
    `PipelineRunRepository.insertRunIfUnderConcurrencyCap` is untouched — confirmed by diff.
    I independently re-derived the H1/H2/H3 classification (see below) rather than trusting
    the executor's label, since C4 makes this the one classification error that must never be
    self-approved past.
  - C5 (budget exhaustion → mandatory escalation): not triggered; task 1.1 reproduced within
    its own budget (33/40, 159s/1200s).
  - C6 (fresh final-gate verdict after any post-CONFIRM commit): not yet applicable at this
    (evaluator) gate; noted for the final-gate skeptic.

**Independent verification of the H1/H2/H3 classification** (not trusting the executor's
label, per the explicit instruction in this ticket's C4 and the driver's brief): I read the
captured failure's assertion text directly from the XML — `expected Left(TooManyRequests),
got Right(RunResultResponse(...))` at `PipelineRunGuardIntegrationSpec.scala:188`, inside the
rate-limit describe block, not the concurrency-cap test (lines 265-303, which the same XML
shows passed). This assertion shape has nothing to do with an admission-count mismatch (H1's
`4 != 3` shape) and contains no latch/settlement text (H2's `awaitAllSettled` `withClue`
message). I then independently read
`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunGuardRepository.scala`
(`bucketStart`, lines 31-35; `incrementRateIfUnderLimit`, lines 46-48) and confirmed the
window bucketing is exactly the absolute wall-clock-anchored fixed window described —
`(epochSeconds / windowSeconds) * windowSeconds`, defaulting `now` to `Instant.now()` with no
caller-supplied override in `PipelineRunService.executeRun` (`grep` confirms
`incrementRateIfUnderLimit(user.id, guardConfig.rateLimitPerWindow,
guardConfig.rateWindowSeconds)` at line 997, no `now` argument passed). I also independently
confirmed `PipelineRunGuardRepositorySpec`'s cited "buckets by window" test exists as described
(lines 175-189) and demonstrates the identical mechanism with explicit, deterministic
`Instant`s. This corroborates H3 independently of the executor's own write-up: the
classification is correct.

### Phase 2: Code Review — PASS

Read `CONTRIBUTING.md` in full before reviewing.

Gates run fresh, by me, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` this cycle):
- `cd backend && sbt test` (only `backend/**` files changed; no `frontend/**` changes) —
  **PASS**: `Total number of tests run: 4883`, `Tests: succeeded 4883, failed 0, canceled 0,
  ignored 0, pending 0`, `Suites: completed 331, aborted 0`, `Total time: 322s`. Matches the
  executor's own reported baseline exactly — independently reproduced, not trusted from their
  report.
- `node scripts/check-scala-quality.mjs` — clean (188 pre-existing soft warnings unrelated to
  this diff; `PipelineRunGuardIntegrationSpec.scala` itself is a 378-line informational-only
  soft-budget warning, not a hard failure).
- `npm run check:openspec` — clean.

Checklist:
- **Canonical code-quality compliance [mechanical]**: PASS. No inline FQNs introduced. No new
  imports needed (only literal/comment/`withClue` changes).
- **Comment discipline (CONTRIBUTING.md "Tests are held to a stricter line")**: PASS. The new
  Scaladoc-style comment above the rate-limit describe block (lines 191-207) is a "why" comment
  explaining a hazard/mechanism the code cannot express by itself (why 60→3600, why no clock
  seam exists at this layer) — exactly the category CONTRIBUTING.md calls out as worth writing
  in a test file ("why a fixture has this particular shape"), not step narration or assertion
  restatement.
- **DRY / Readable / Modular**: PASS. Six mechanical config literal changes, one comment, one
  `withClue` wrap — no duplication introduced, nothing restructured.
- **Type safety**: N/A, no type-relevant change.
- **Security**: N/A, test-only.
- **Error handling**: N/A.
- **Tests meaningful**: PASS. The `withClue` guardrail (Decision 4) genuinely improves future
  failure diagnosability for the concurrency-cap test without loosening any assertion — verified
  by direct read that both assertions remain unchanged in strictness, just wrapped.
- **No dead code**: PASS.
- **No over-engineering**: PASS — the fix is minimally scoped to the six config literals plus
  one guardrail, no speculative abstraction.
- **Behavior-preserving where expected**: PASS — no production code touched at all (confirmed
  by diff), and the six rate-limit tests' assertions are unchanged in shape, only the injected
  config's window size changed.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files changed (diff touches exactly one backend test file plus this
change's own `openspec/changes/**` artifacts).

### REQUIRED RULING: statistical mitigation vs. deterministic fix

Per the explicit driver directive, ruling **(b)**: **accept the statistical mitigation
(60s → 3600s) as implemented, and require a standalone follow-up ticket for the deterministic
clock-injection version before this ticket is considered done.** Reasoning:

1. **A deterministic fix requires a production-code change, which conflicts directly with this
   ticket's own Non-Goals as currently authorized.** I independently confirmed this by reading
   `PipelineRunService.executeRun` (line 997): it calls `incrementRateIfUnderLimit(user.id,
   guardConfig.rateLimitPerWindow, guardConfig.rateWindowSeconds)` with no `now` argument, so
   the repository's own `now: Instant = Instant.now()` default parameter is never overridden
   from above. There is no seam at `PipelineRunService`'s public surface (`submit`) through
   which an integration test could inject a fixed clock. Building one — e.g. threading an
   explicit `Clock`/`now` parameter through `submit` → `executeRun` — is unambiguously a
   production-code change to `PipelineRunService`. `design.md`'s Non-Goals state explicitly:
   "Any production-code change UNLESS hypothesis 1 is probe-confirmed, and only after an
   explicit escalation to the human per the ticket's standing constraint (never self-approved)."
   H1 was **not** confirmed (H3 was, independently re-verified above). So requiring the
   deterministic fix right now, inside this ticket, would mean self-approving past this
   ticket's own explicit scope boundary — exactly the thing standing constraint C4 (and the
   Non-Goals more generally) exist to prevent. If the deterministic fix is wanted, it needs its
   own ticket with its own design-gate review (open questions a real design pass should settle:
   should the clock seam be a general-purpose `Clock` abstraction reused by other
   window/time-dependent config in the same service — `sourceFetchRateLimitPerWindow`,
   `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS` — or scoped narrowly to this one test path;
   this is a real design decision, not a one-line patch, and does not belong bolted onto a
   ticket whose own design gate approved it on the premise of zero production changes).
2. **The 3600s value is grounded in the confirmed mechanism, not a blind round number.** The
   collision probability for this race is proportional to (elapsed time between a test's
   sequential submissions) / (window size). Widening the window 60x directly and linearly
   divides that probability by 60x, holding the (unchanged) elapsed-time numerator fixed — this
   is the same category of reasoning C3 requires for a timeout change (probe-confirmed
   mechanism, then a headroom-justified adjustment), applied here to a window size instead. The
   captured failure's own measured per-test time (`0.471s`) against the original 60s window
   gives a back-of-envelope per-run collision probability in the same order of magnitude as the
   observed 1-in-33 empirical rate; at 3600s the same arithmetic yields roughly 1-in-2000 per
   affected test per run even under contention — a large, mechanism-tied reduction, not a
   cosmetic one.
3. **Residual risk is bounded and has an existing, documented fallback.** The race is not
   eliminated, only made ~60x rarer — this is disclosed plainly in `repro-findings.md`,
   `files-modified.md`, and `workflow-state.md`, not hidden. `CONTRIBUTING.md`'s own
   HEL-924 section already documents the standing convention for this repo — "If `sbt test`
   still produces a failure that a second, immediate, unchanged re-run does not reproduce, that
   is environmental flakiness, not a regression" — so the small residual tail this fix leaves
   behind already has a known, low-cost triage path if it ever fires again, and per Decision 4
   any future concurrency-cap-adjacent failure now also self-describes via `withClue`.
4. **A bare pass count is explicitly not being used as the justification here** — per the
   driver's directive, task 5's 4883/4883 and 120/120 numbers are cited above only as gate
   evidence (Phase 2), not as the basis for this ruling. The ruling above rests on (1) the
   Non-Goals/scope conflict, (2) the mechanism-tied math behind the specific 3600s value, and
   (3) the bounded, disclosed, already-mitigable residual risk — independent of any pass count.

**Condition of this PASS**: a standalone follow-up Linear ticket for the deterministic
clock-injection fix (production-code seam in `PipelineRunService`, scoped and design-reviewed
on its own) **must be filed — with `Follow-up` label, `origin_kind: followup` /
`origin_ticket: HEL-1195`, and `relatedTo` — before this ticket is considered delivered /
before `cleanup.sh` runs.** `files-modified.md`'s "Open question for evaluator/skeptic" section
confirms this was left open by the executor; as of this report it has not yet been filed. This
is the same standing "file before cleanup.sh" requirement already in the ticket's own brief,
made explicit and binding for this specific follow-up.

### Overall: PASS

### Non-blocking Suggestions

- `tasks.md` 4.4's own prescribed verification step (mutate to force a mismatch, confirm the
  `withClue` text appears, then revert) was not evidenced as executed anywhere in
  `repro-findings.md`/`files-modified.md`, unlike every other completed task item. The code
  itself is correctly shaped and low-risk (standard ScalaTest `withClue` semantics), so this is
  not a Change Request, but a future cycle/report should either cite the missing evidence or
  stop marking a task `[x]` when its own stated Verify step has no evidence trail.
- Ensure the follow-up ticket required above is filed before delivery (see "Condition of this
  PASS").
