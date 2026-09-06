## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Round-2's single blocking CR landed in full:

- `tasks.md` 1.5 now triages **all four** baseline combinations explicitly — (a) both flaky, (b) hel912 flaky /
  hel968 clean, (c) **hel912 CLEAN / hel968 flaky -> hel968 becomes the measurement harness for D1/D2/D6, with
  the hel912 un-quarantine carried by 3.6's full-suite run plus the D5 unit guard "NOT by a hel912 tally that
  cannot discriminate"**, (d) both clean -> STOP and escalate. The vacuous-20/20 path is closed, and (d) now
  matches design.md's own Risks entry instead of narrowing it.
- New `1.5a` requires N be computed from the **chosen harness's own** measured base rate *before* any
  verification loop runs; the old recompute-after-the-fact task is gone from section 3 (3.4 = "chosen harness
  ... at the N computed in 1.5a"; 3.5 = "the OTHER spec ... against its own 1.3/1.4 baseline"). The
  run-20-then-rerun-N ordering trap is gone.
- `design.md` D6 now says the 0.55^N decisiveness math "must be computed from **the measurement harness's own**
  measured rate (tasks 1.5/1.5a), not inherited: if `hel968` becomes the harness, state the computation for
  `hel968`'s rate", and that N is fixed before the loop runs. Round-2 non-blocking note 3 is therefore also
  applied.
- New `1.12` requires `probe-findings.md` to record whether `usePipelineDetailPage.ts:257-260`'s
  `skipNextAnalyzeRef` early-return guard was already suppressing the debounced dispatch in the failing
  iteration — the exact ambiguity that would otherwise make a 0/20 D2 probe uninterpretable.
- Cross-reference integrity holds after the renumber: 1.5(c) points at 3.6, and 3.6 is the full-e2e-suite run
  (3.7 = HEL-962/964 report-only, 3.8 = gates). No dangling task numbers.

Independent ground-truth re-verification (I re-derived these; I did not take the artifacts' or prior reports'
word for them):

- `playwright.config.ts:66-80` — the HEL-912/HEL-972 rationale block and the `"**/hel912-lanes-rejoin.spec.ts"`
  `testIgnore` entry, anchored to the one file; `retries: 0` and `fullyParallel: false` immediately below, so a
  `--repeat-each` tally is honest and task 1.1's "remove entry + its stale comment" is well-targeted.
- `OpDropdown.tsx:42-49` — `useLayoutEffect` reading `anchorRef.current`, `setPos({ top, left, maxHeight })` on
  a fresh object, keyed `[anchorRef]`; `if (pos === null) return null;` present below the focus effect.
- The two object-literal anchor sites are real and exactly two: `PipelineRiverView.tsx:312`
  (`anchorRef={{ current: insertAnchorEl }}`) and `BranchAffordance.tsx:46`; `PipelineRiverView.tsx:361,497`
  pass the real `addStepButtonRef` (task 2.5's carve-out is correct).
- `usePipelineDetailPage.ts` — the mount `analyzePipeline(id)` at :219 and the `skipNextAnalyzeRef` guard
  immediately preceding the `window.setTimeout(... analyzePipeline(id) ..., 300)`, both as cited.
- `e2e/hel912-lanes-rejoin.spec.ts` and `e2e/hel968-multi-root-editor-flow.spec.ts` both exist; HEAD is
  `62b428db`, matching design.md's stated base.

Judged against the standard set for this round — "would this produce a probe-confirmed root cause and a
statistically meaningful verification" — the plan now does both: the fix shape is genuinely gated on the D3
observation (2.2/2.3/2.4 are exclusive branches with an explicit escape for an off-shortlist mechanism), the
probe edit is required reverted and its absence diff-verified (1.11, 2.7), the guard must be shown RED before
GREEN (3.3 / D5), and every verification tally now runs against a harness whose base rate was measured on this
branch at a pre-computed N.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 1.3 cites `playwright.config.ts:83` for `retries: 0`; it is `:82` (`:83` is `fullyParallel`). The
  claim is true, the line number is off by one — harmless, but do not copy it into the final report.
- 1.5a states the principle ("a lower measured rate requires a larger N") without the closed form. If the
  measured rate is low, the executor should record the arithmetic explicitly — N >= ln(1e-5)/ln(1-p) against
  D6's own ~1e-5 target — so the chosen N is auditable rather than asserted.
