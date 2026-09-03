## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived from files, not from the revision summary. Each round-1 CR re-checked against the
revised `design.md`/`tasks.md`/`ticket.md` AND against ground truth in the repo.

- **CR1 (candidate must be measured by the shipped guard).** ADDRESSED. `design.md` D5 P1 states the
  candidate MUST be a selector currently measured by a surface in
  `e2e/hel813-mobile-touch-target-floor.spec.ts` at 430px via `assertFloor`/`sweepSurface`, explicitly
  NOT `assertExpanderFloor`, NOT `assertHiddenAtWidth`; `tasks.md` 6.1 makes that finite set "the ONLY
  candidate pool". Ground truth: the pool is real and non-empty — `grep -n` on that spec shows
  `sweepSurface` at lines 119, 176, 193, 254, 259, 285, 304 (`.toast__close`, `.ui-empty-state__cta`,
  `.ui-select__trigger`, `.ui-select__option`, …) versus `assertExpanderFloor` at 125, 151, 290, 316,
  332 and `assertHiddenAtWidth` at 281. So P1 constrains without being vacuous or unsatisfiable.
- **CR2 (baseline-green must be measured).** ADDRESSED. D5 P2 requires the candidate be MEASURED to
  satisfy `assertFloor` on BOTH axes unmutated at 430px with the measurement recorded, and names the
  vacuity it prevents (PASS→FAIL→PASS contract). `tasks.md` 6.2 repeats "MEASURED at 430px and recorded".
- **CR3 (constrain the search mechanism, not the outcome).** ADDRESSED. New D6 second paragraph forbids
  string search and enumerates the miss modes a `min-height: 44px` grep cannot see (`height`, token,
  padding + line-height, shared class in another file); D5 P4 adds the shared-class/token disqualifier
  with the correct reason (mutation would not be confined to the candidate's rule, so red is
  unattributable). `tasks.md` 6.2 carries the same NOT-by-grep instruction. This is mechanism-level, per
  standing lesson 3/6.
- **CR4 (epsilon, not the bare literal).** ADDRESSED. D5's "Epsilon, not the bare literal" paragraph and
  task 6.5 require importing `DEFAULT_MIN_PX` and `RENDERED_BOX_EPSILON_PX` and comparing against
  `DEFAULT_MIN_PX - RENDERED_BOX_EPSILON_PX`, never a re-typed `44`. Ground truth: both symbols ARE
  exported from `e2e/support/touchTargetProbe.ts` (lines 15 and 70), and `assertFloor` (line 105) computes
  `floor = minPx - RENDERED_BOX_EPSILON_PX` — so the instruction is executable as written.
- **CR5 (whole-suite composition run).** ADDRESSED. New D7 and new `tasks.md` section 7 require running
  the exact committed glob invocation once as a whole suite after tasks 3, 4 and 6, capturing the
  aggregate transcript and wall-clock, quarantining anything red ONLY in the combined run per D2, and
  reporting the measured wall-clock against the CI-cost risk (Risks section updated to say "measured and
  reported so the number is known rather than discovered", plus a new cross-spec-interference risk entry).
- **CR6 (correct the false comment, not append).** ADDRESSED. Task 3.2 says CORRECT / "Rewrite it, do not
  merely append below it", and quotes the three clauses that become false. Ground truth: `ci.yml`
  lines 199-205 do read exactly as quoted ("the ONLY spec run here…", "were never CI-gated", "a natural
  follow-up, not bundled into this change"). Task 3.3 keeps AC 2's regression-exclusion content in the
  rewritten comment, so the correction cannot drop it.
- **CR7 (literal `run:` string, by-name collection).** ADDRESSED. Task 5.2 requires executing the LITERAL
  `run:` string extracted from the committed `ci.yml` e2e step and rejects a hand-typed near-equivalent;
  5.3 requires the transcript show `e2e/zz-glob-proof.spec.ts` collected BY NAME going red AND the two
  previously-wired specs in the same run, explicitly discharging task 3.4. Ground truth: the two current
  per-spec steps are `ci.yml` lines 302/304 as described.
- **Round-1 non-blocking notes taken.** Task 8.1 now lists `npm run check:e2e-types` with the reason
  (it is the gate that scans `e2e/**` and `playwright.config.ts`); task 1.5 now states failing specs were
  sampled once, so "fails" is not asserted as stable.
- **ANTI-GOAL intact.** No task or decision wires `*.regression.spec.ts` into CI. AC 1 preserves all three
  exclusion layers; D2 keeps `**/*.regression.spec.ts` as a permanent `testIgnore` entry; task 4.3 only
  extends its comment. Non-Goals still names it an anti-goal, and Non-Goals still forbids fixing red orphans
  (task 2.3 repeats it).
- **AC traceability.** ACs 11-14 were added to `ticket.md` to encode CR5/CR1+2/CR4/CR6 as acceptance signals,
  and each maps to a task (11→7.1-7.4, 12→6.1-6.3, 13→6.5, 14→3.2). No AC is left without a task, and no
  task ranges beyond the ACs.

### Verdict: CONFIRM

### Non-blocking notes

- Task 7.3 quarantines specs that are red only in the combined run, which mutates `testIgnore` after the
  suite ran. No task re-runs the suite afterward to confirm the post-quarantine set is green. In practice a
  re-run is the natural thing to do and quarantine only removes specs, so this is a completeness nit, not a
  hole — but stating "re-run after any 7.3 quarantine" would close it.
- `ci.yml` also carries a separate, still-true comment below line 304 about `helio-mcp/e2e/sleeper-rebuild.ts`
  being deliberately unwired. Task 3.2's rewrite targets lines 199-205 only; that block should survive the
  edit untouched.
- D3's flake rule ("a spec that does not produce the same verdict across repeated runs") is only sampled twice
  for passing specs (task 1.4) and once for failing ones (1.5). Disposition is identical either way, as 1.5
  now says, so nothing turns on it.
