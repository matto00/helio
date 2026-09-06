## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Read-only review. No backend spec, no dev server, no DB connection, no Playwright, no Jest run
(nothing in this review required one). Hard environment constraint honored.

### What I verified (with evidence)

- Worktree HEAD `abcf0da9` (`git log --oneline -2`); `git status --short` shows only the untracked change dir —
  zero product diff so far, consistent with the ticket's constraint.
- `titleFor()` (`frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx`, ~line 616-626) is verbatim as
  design.md's Context describes: `screen.getByText(label).closest("[title]")`, throws
  `No title-bearing ancestor for "<label>"`, returns `getAttribute("title") ?? ""`.
- Wrapper class set is exactly two, and each render site puts `title` on the wrapper itself:
  `PipelineRiverView.tsx:373-381` (`step-section`), `LaneColumn.tsx:165-171` (`tail-chain` > `tail-chain-step`,
  compact), `LaneColumn.tsx:210-216` (`lane-column` > `step-section`, non-compact). D1's selector list is correct
  and complete.
- `sectionFor()` (~line 123) queries `.pipeline-detail-page__step-section` only — confirmed unusable for the
  compact site, as design states.
- **CR-2 (round 1) genuinely addressed.** D4a now names concrete targets, and I confirmed both are *strict*
  ancestors of the resolved wrapper in the real tree: `.pipeline-detail-page__lane-column` (`LaneColumn.tsx:210`)
  encloses the `step-section` for `Two lane first`; `.pipeline-detail-page__tail-chain` (`LaneColumn.tsx:165`)
  encloses the `tail-chain-step` for `Solo lane step`. The `mutated.contains(resolved) && mutated !== resolved`
  assertion (task 1.7) is the stronger form requested.
- **CR-1 (round 1) genuinely addressed.** D4b's synthetic case is the real falsifiable observation: with a titled
  ancestor `div` wrapping a title-less `.pipeline-detail-page__step-section`, the *old* helper returns the
  ancestor's title (no throw → red), the *new* helper throws `has no title attribute` (green). I traced both
  helper bodies against that DOM; the divergence is real. D4a is correctly and repeatedly labelled a guard, not
  the proof.
- Fixture indistinguishability still avoided: `r1a` → `root-1`, `r2a` → `root-2`; the six existing assertions
  expect `root:<id> > …` strings, distinct from the value-mismatch mutation's bare `step.id`. Read the six
  `.toBe(...)` literals directly.
- Round-1 non-blocking note is addressed: D5 now states the expected per-run outcome (D4b green in both (b) and
  (c)) in advance.

### Verdict: REFUTE

One blocking defect, in the one place round 1 was only *nominally* answered: the before-reading run (a0) is
specified with a predicted outcome that the code contradicts.

### Change Requests

1. **D5 run (a0) / task 1.8a predicts an outcome that cannot occur as specified — "ancestor title + deletion,
   on the pre-change helper, records VACUOUS GREEN" will in fact be RED.**
   The six HEL-985 assertions are exact-string comparisons (`expect(titleFor("Trunk one")).toBe("root:root-1 > r1a")`,
   etc.). Under the old helper with the call site deleted and an arbitrary ancestor `title` (design D4a's
   `"ancestor tooltip"`, or anything else not equal to the path), `titleFor` returns that ancestor string and every
   assertion fails as a **string mismatch**. It does not pass. The ticket's framing ("the deletion-form mutation
   would start passing") shares this error — the true degradation is weaker and different: the deletion form stops
   failing as an *absent-attribute/structural* defect and becomes **indistinguishable from the value-mismatch
   mutation**, i.e. the two axes collapse into one message. That is still a real loss worth closing, and the rest
   of the design (D1/D2/D3/D4b) closes it — but the evidence plan currently instructs the executor to *record* a
   result rather than *observe* one, so it will either stall or produce a transcript that does not match reality.
   Required revision, pick one and state it explicitly in D5 and task 1.8a:
   (a) Make (a0) reach a genuine vacuous green by scoping it to a single assertion whose ancestor title is set to
   that step's *exact expected path* — e.g. for `Solo lane step`, put `title="root:root-1 > r1a > r1b > lane1a"`
   on its `.pipeline-detail-page__tail-chain` ancestor and delete the call site; that one assertion passes green
   with the wiring entirely gone, which is the degradation in its purest form. Say so, and say the other five
   assertions are expected red in that run and are not part of the (a0) claim; or
   (b) Drop the "green" prediction and restate (a0)'s claim accurately as the axis-collapse reading: record that
   on the old helper the deletion mutation fails with the *same* string-mismatch message as the value-mismatch
   mutation (transcripts side by side), while on the new helper it fails with D2's distinct absent-attribute
   message. Then D5's "(b) and (c) fail with different messages" becomes the measured contrast, and (a0) shows
   what was lost.
   Whichever is chosen, also correct proposal.md's "starts passing" and design.md's "the vacuous pass this ticket
   exists to close" so the artifacts do not carry a premise the code refutes.

2. **Internal contradiction: task 1.13 says "the full four-run transcript"; D5 and tasks 1.8a/1.9/1.10/1.12
   define five runs (a0, a, b, c, d).** Make 1.13 say five and enumerate them, so the executor cannot satisfy the
   task while omitting (a0) — the exact run this gate has now twice found to be the weak point.

### Non-blocking notes

- D4b (tasks 1.7a/1.7b) does not say how the synthetic node reaches `screen`. `titleFor` uses
  `screen.getByText`, which queries `document.body`; a manually `appendChild`-ed node is *not* removed by RTL's
  auto-cleanup and would leak into later tests in the same file. Worth specifying: append to `document.body`,
  use a label string that appears nowhere in the fixture (so no duplicate-match), and remove it in a `finally`
  or `afterEach`. Not blocking — the assertion's falsifiability does not depend on this — but it is a live
  cross-test-pollution hazard in a file whose other tests query by text.
- D1/D2/D3 are correct and well-argued; the `""`-return alternative is rightly rejected. No objection.
- `.openspec.yaml` `skip_specs: true` remains appropriate — genuinely test-harness-only.
