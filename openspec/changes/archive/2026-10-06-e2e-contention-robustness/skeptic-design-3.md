## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed on HEAD 77bdaec8eacd775b3d85b8793016cdd0a6f24b0c (change dir untracked): ticket.md, proposal.md, design.md,
tasks.md, workflow-state.md, skeptic-design-1.md, skeptic-design-2.md. Cross-checked the throttle-copy mechanism
against both spec files. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=bug/e2e-contention-robustness/HEL-1298`. Read-only: no Playwright runs, no servers started.

### What I verified (with evidence)

**Round-1 change requests** (confirmed in round 2, re-checked that the text is still present):
- CR1 (greens config must be proven red): design.md D1 still defines "reproducing", the CDP ladder, the
  escalate-don't-claim branch and flip-both-ways confirmation. tasks 1.2, 1.3 and 4.1 carry it.
- CR2 (margin arithmetic and headroom): D3 still has the ~31.7s / ~37–38s projections, the ~27s / ~33s
  post-saving figures, the dominant-step idle-vs-contended measurement, and the max ≤ 27s criterion with escalation.
  tasks 2.2 and 4.1 carry it.
- CR3 (exhaustive D2 tree): branches A–D and the keep-probing catch-all are present. Every failing attempt must be
  classified, and split outcomes get one fix per branch.
- CR4 (Standing Constraints): C1–C6 are present, plus C7 and C8 from round 2. They match workflow-state.md
  `CONSTRAINTS`.

**Round-2 change requests:**
- **CR1 (minimum failure rate): addressed.** D1:
  - requires ≥20 attempts recorded as "k/n red";
  - counts a config as reproducing only at p with (1−p)^20 ≤ 0.05, i.e. p ≥ ~14%, in the CI failure mode;
  - says to climb the ladder or combine with (a) when short, and to escalate if no permitted config meets it;
  - sizes the "cause removed → green" half to at least as many attempts as would have shown ≥1 red at the measured p.

  Task 1.2 requires n ≥ 20, and task 1.3 triggers on p < ~14%. C7 is promoted.
- **CR2 (greens exercise the committed spec): addressed.** D1 now names one mechanism. It is an untracked copy,
  `e2e/zz-hel1298-throttle-<spec>.spec.ts`, which matches no `testIgnore` and sits in the same `e2e/` directory so
  relative imports still resolve. It differs from the committed spec only by a `test.beforeEach` that opens a CDP
  session and calls `Emulation.setCPUThrottlingRate`. In addition:
  - the `diff` against the committed spec is captured per batch;
  - any later edit to a spec invalidates its greens and forces a re-run;
  - the copy is deleted before commit and recorded in `files-modified.md`.

  The non-viable "wrapper importing the test body" option is gone. Task 4.1 lists the diff as evidence. C8 is
  promoted.
- **Round-2 non-blocking notes: all taken up.** D1 records that renderer-only throttling approximates the CI mode,
  with a CI run as backstop. D3's escalation states the throttle rate and contention used.

**Mechanism viability (new check):** both failing tests take the built-in `page` fixture:
- `hel519-recent-navigation.spec.ts:84` uses `async ({ page, request })`;
- `hel910-pipeline-to-dashboard-flow.spec.ts:90` uses the `page` fixture.

Neither creates its own context (no `newContext`/`newPage` in either file). A `beforeEach` that throttles `page`
therefore applies to the page the test body drives, so the named mechanism can actually throttle the test.

**Whole-design scan:**
- **Placeholders and hand-waving:** none. `<spec>` in the copy filename is a naming template, not a deferred decision.
- **Contradictions:** none between the proposal, the design and the tasks. The proposal's "≥20 consecutive contended
  greens" matches D1 and task 4.1. "Modified Capabilities: none expected" is consistent with D2's
  conditional delta and `skip_specs` removal on product branches only.
- **AC coverage:**
  - probe-confirmed root cause and failure rate: tasks 1.2, 1.3, 2.1, 2.2;
  - web-first or wait-on-state fix, or product fix with a red-without-fix test: D2 and D3, tasks 3.1 and 3.2;
  - no quarantine or loosening: C4, tasks 3.1 and 3.2;
  - ≥20 greens: task 4.1;
  - HEL-1288 coordination and robustness not workers: C3, Non-goals.
- **Scope:** product edits are confined to `commandPalette/**` (hel519), or to a probe-identified product slowness
  (hel910). There is no planned edit to `playwright.config.ts` or `ci.yml`, and `test.setTimeout`/`test.slow()` are
  explicitly rejected.

### Verdict: CONFIRM

Every numbered change request from rounds 1 and 2 is addressed in the artifacts, not just acknowledged. The design is
now falsifiable: the greens configuration must first be shown to fail at a rate that makes 20 chance greens unlikely
(≤5%), and the greens must run against a provably identical copy of the committed spec.

### Non-blocking notes

- hel910 at p ≥ 14% plus max ≤ 27s, both under the same throttle, may be jointly hard to satisfy. A rate that makes
  the unfixed spec time out often enough may leave little room under 27s. The escalate path covers this. The executor
  should report both numbers at the same rate, not pick different rates for the two criteria.
- When the throttled copy and the committed spec live together in `e2e/`, invoke runs by explicit file path and test
  title (`-g`). This avoids accidentally running both in one batch, which would double the load and skew the
  measured rate.
- The throttle hook should be the copy's top-level `beforeEach`, so it covers the login steps as well as the body.
  Record that in the diff evidence.
