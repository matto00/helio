## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Read-only review. No backend spec, no dev server, no DB connection, no Playwright, no Jest run —
nothing in this review required one. Hard environment constraint honored.

### What I verified (with evidence)

- Worktree HEAD `abcf0da9`; `git status --short` shows only the untracked change dir — zero product diff so far.
- `titleFor()` (`frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx`, ~616-626) is verbatim as
  design.md Context claims: `screen.getByText(label).closest("[title]")`, throws `No title-bearing ancestor`,
  returns `getAttribute("title") ?? ""`.
- Wrapper class set is exactly two, `title` bound on the wrapper itself at each of the three render sites:
  `PipelineRiverView.tsx:378/381` (`step-section`), `LaneColumn.tsx:169/171` (`tail-chain-step`, inside
  `.pipeline-detail-page__tail-chain` at :165), `LaneColumn.tsx:214/216` (`step-section`, inside
  `.pipeline-detail-page__lane-column` at :210). D1's selector list is complete; D4a's two named mutation
  targets are genuine *strict* ancestors of the resolved wrappers.
- `sectionFor()` (line ~123) queries `.pipeline-detail-page__step-section` only — confirmed unusable for the
  compact site, as both ticket and design state.
- The six existing `nodePath wiring (HEL-985)` assertions are exact-string `.toBe(...)` comparisons and all
  expect `root:<rootId> > …` — read the literals directly; indistinguishability with the bare-`step.id`
  value mutation is still avoided.
- **Round-2 CR-1 genuinely addressed** (not nominally). D5/tasks 1.8a-1.8c now adopt *both* remedies I would
  have accepted singly. I traced (a0-i) against the code: with the call site deleted, `nodePathByStepId` is
  empty, `title={undefined}` renders no attribute, so the pre-change `closest("[title]")` escalates to the
  `.pipeline-detail-page__tail-chain` ancestor; with that ancestor set to `"root:root-1 > r1a > r1b > lane1a"`
  — which I confirmed is character-for-character the `Solo lane step` assertion's expected literal — that
  assertion genuinely passes with the wiring entirely gone. The predicted green is real, and 1.8a correctly
  scopes the claim to that one assertion with the other five declared expected-red. (a0-ii)'s axis-collapse
  reading is also correct on the code. 1.8c ("if it does not reproduce, STOP and escalate") converts the
  remaining risk into an observation, not an assertion.
- **Round-2 CR-2 genuinely addressed.** tasks.md:22 now says "five-run" and enumerates (a0 i+ii)/(a)/(b)/(c)/(d);
  grep finds no surviving "four-run".
- **Premise correction is accurate and consistent.** proposal.md:8-14 states the corrected severity (deletion form
  passes only in the limiting exact-path case; otherwise the two axes collapse into one message) and says the fix
  direction is unchanged. design.md D5 states the same correction in the same terms. grep for "starts passing" /
  "the vacuous pass this ticket exists to close" finds no uncorrected residue — the only "starts passing"
  occurrence is the sentence explicitly quoting and correcting the ticket. No contradiction between the two docs.
- **Round-2 non-blocking note addressed.** D4b and tasks 1.7a now specify `document.body` append, a fixture-absent
  label string, and `finally`/`afterEach` removal — the cross-test-pollution hazard is closed.
- Predicted per-run outcomes are self-consistent against the code: in (b) the hardened helper finds the wrapper
  and throws absent-attribute (D4a red, six value assertions red, D4b green since it is call-site-independent);
  in (c) the value assertions and D4a go red as string mismatches while D4b stays green. Different messages on
  different assertions, as D5 requires.
- ACs traced: ancestor-independence → D1/D2; both-ways mutation with transcript → 1.9/1.10/1.13; independence →
  D4b + 1.11; zero product diff → Non-goals + 1.15; fixture indistinguishability → Risk 5 + 1.8;
  pre-existing assertions unchanged → 1.8. No AC is uncovered; no task exceeds the ticket's scope.

### Verdict: CONFIRM

Sound enough to implement. Both round-2 change requests are substantively, not nominally, closed, and the
corrected premise is stated accurately and identically in proposal.md and design.md.

### Non-blocking notes

- (a0-ii) / task 1.8b is less precisely scoped than (a0-i). With an arbitrary ancestor tooltip on one step's
  ancestor plus the deletion, only *that* step's assertion produces the string-mismatch message the claim is
  about; the other five steps have no titled ancestor at all and will throw `No title-bearing ancestor`. The
  side-by-side comparison should therefore name the single assertion it compares, exactly as 1.8a does.
  Not blocking — 1.8c already forbids recording an unobserved outcome.
- Task 1.9's "add an ancestor `title` in the fixture render tree" leaves the injection mechanism unstated
  (post-render `setAttribute`, as in D4a, is the obvious and least invasive choice). Worth pinning in the
  transcript so run (b) is reproducible.
