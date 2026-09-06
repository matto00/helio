## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read only; no servers, no DB, no backend spec, no Playwright (hard environment constraint honored).

- `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in the change dir.
- Worktree HEAD = `abcf0da9` (`git log --oneline -2`) — matches design.md's stated ground-truth commit.
- `titleFor()` at `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx:616-626` is verbatim as design.md
  describes: `screen.getByText(label).closest("[title]")`, throws `No title-bearing ancestor for "<label>"`, returns
  `getAttribute("title") ?? ""`. Design's Context is accurate.
- `sectionFor()` (test file line ~123) queries `.pipeline-detail-page__step-section` only — confirmed unusable for the
  compact site, as design claims.
- Render sites confirmed by grep: `PipelineRiverView.tsx:378/381` (`step-section`), `LaneColumn.tsx:169/171`
  (`tail-chain-step`), `LaneColumn.tsx:214/216` (`step-section`). Wrapper class set is exactly two members — D1's
  selector list is correct and complete against today's tree.
- Single binding site `PipelineRiverView.tsx:292-294` — deletion of line 294 leaves `nodePathByStepId[step.id]`
  `undefined`, and React omits `title` entirely. The deletion mutation does produce a genuinely absent attribute, so
  D2's `hasAttribute` branch is the one that would fire. Confirmed.
- Fixture `rootId` claim confirmed: `r1a` → `root-1` (line 557), `r2a` → `root-2` (line 574); all other wiring steps are
  non-root-head children. Expected titles are `root:<id> > …`, genuinely distinct from the value-mismatch mutation's
  bare `step.id`. The HEL-985 indistinguishability trap is currently avoided.
- D3's nesting claim is consistent with the fixture: `laneC` is nested under `laneA`/`laneB`, so a `tail-chain-step`
  wrapper can sit inside a `step-section`. `closest`'s nearest-match semantics are indeed load-bearing.

So the design's factual base is sound, and D1/D2/D3 are correct. My objections are all to the *verification* plan —
which is precisely what this ticket is about.

### Verdict: REFUTE

### Change Requests

1. **D4's permanent tests (tasks 1.5-1.7) cannot go red by reverting the fix — they pass identically on the old
   helper, so they do not guard the property they claim to guard.**
   With an ancestor title injected post-render and the step wrapper's own `title` present, the *old*
   `closest("[title]")` also returns the step's own wrapper (it is the nearest title-bearing ancestor). The D4
   assertion "titleFor still returns the step's own path" is therefore true before and after this change. Task 1.7's
   two guards (mutated element ≠ resolved element; injected string ≠ expected path) rule out one vacuity mode but not
   this one. As specified, D4 is a test that is green on the unhardened code — the exact "passes for the wrong reason"
   failure the ticket names.
   Required revision: D4 must add a **second, falsifiable observation** — the absent-`title`-with-titled-ancestor case,
   which is the only configuration where old and new helpers differ. Since no render path can omit the wrapper's
   `title` without a product diff, specify it concretely as a synthetic-DOM assertion: build (in the test) a titled
   ancestor `div` containing a `.pipeline-detail-page__step-section` (and a second case for
   `.pipeline-detail-page__tail-chain-step`) with **no** `title`, containing the label text, then
   `expect(() => titleFor(label)).toThrow(/has no title attribute/)`. That assertion is red on the old helper (it would
   return the ancestor's title instead of throwing) and green on the new one. Update design.md D4 and tasks 1.5-1.7
   accordingly.

2. **"A genuine intermediate ancestor of a step card" (D4, tasks 1.5-1.6) is ambiguous in the one dimension that
   decides whether the test means anything — above or below the wrapper — and the ancestor is not named.**
   Only an ancestor *of the wrapper* simulates the escalation this change defends against; an element between the label
   and the wrapper is inert under both the old and the new helper. Two competent implementers will read this
   differently. Required revision: state explicitly that the `setAttribute` target must be a strict ancestor of the
   element `titleFor` resolves, and name the concrete element for each of the two render sites (e.g. by class), so the
   choice is not left to executor improvisation. Add an assertion that the mutated element `.contains()` the resolved
   wrapper and is not equal to it — a strictly stronger form of task 1.7's current inequality check.

3. **Mutation run (b) (task 1.9) does not demonstrate the degradation the ticket exists to close, so the transcript
   cannot show the fix did anything.**
   Under the hardened helper the injected ancestor `title` is inert, so run (b) reduces to "deletion → red", which the
   *old* helper's `No title-bearing ancestor` throw would also produce absent an ancestor title. The claim under test
   is "ancestor title + deletion is GREEN before, RED after". Required revision: add a fifth run to D5/tasks — the same
   ancestor-title + deletion mutation executed against the **pre-change** `titleFor()` (e.g. `git stash` the test-helper
   edit, or a temporary local copy of the old helper), recorded as **green**, i.e. the vacuous pass. Without that
   before-reading, `mutation-evidence.md` documents that the new guard works but never that the old one was broken.

### Non-blocking notes

- Task 1.11 asks the executor to "note explicitly whether the D4 tests are red in (b) but green in (c)". Once CR-1's
  synthetic-DOM assertion exists, that expectation is predictable in advance (the new assertion is independent of the
  product call site and should be green in both) — worth stating the expected outcome in design.md so a surprise is
  legible as a defect rather than absorbed as an observation.
- D2's two messages are well chosen and the `""`-return alternative is correctly rejected; no objection there.
- `.openspec.yaml`'s `skip_specs: true` is appropriate — this is genuinely test-harness-only with no requirement delta.
