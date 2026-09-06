## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Independently re-derived. `mutation-evidence.md` was read only as a set of claims;
every reading below is my own, from a mutation I applied and reverted myself.
Browser/UI phase deliberately skipped per the hard environment constraint (zero
product diff, nothing new renders); no backend spec, dev server, DB connection or
Playwright was run.

### What I verified (with evidence)

**1. D4b is genuinely falsifiable — reproduced red on the PRE-change helper.**
I copied the test file to a scratch sibling suite with ONLY `titleFor()`'s body
reverted to the pre-change `labelEl.closest("[title]")` form, everything else byte-
identical, and ran it:

```
● D4b proof — an absent title on the standard-site wrapper throws...
    Expected pattern: /has no title attribute/
    Received function did not throw
● D4b proof — an absent title on the compact-site wrapper throws...
    Expected pattern: /has no title attribute/
    Received function did not throw
Tests: 2 failed, 32 passed, 34 total
```

Both D4b tests go red on the old helper, red for the right reason (the old walk
silently returns the titled ancestor's value instead of throwing), and they are the
ONLY two that go red — so the red is attributable to the hardening, not ambient
breakage. `mutation-evidence.md`'s red is reproducible.

**2. D4a is honestly labelled a guard.** In the same pre-change run, both D4a tests
were among the 32 that PASSED. That is exactly what the test's own comment and
design.md D4a claim ("green on the old helper too... does not by itself demonstrate
the hardening was necessary"). D4a is not doing evidentiary work it cannot do; the
proof load sits entirely on D4b, which I falsified above.

**3. Both product-mutation axes are red independently, and distinguishably.**
- Value-mismatch (`entries[step.id] = step.id` at `PipelineRiverView.tsx:294`):
  8 red (six HEL-985 assertions + two D4a), all `Object.is` string mismatches,
  e.g. `Expected: "root:root-1 > r1a" / Received: "r1a"`. D4b green — independent.
- Deletion form (removed `title={nodePathByStepId[step.id]}` at all three render
  sites: `PipelineRiverView.tsx:381`, `LaneColumn.tsx:171`, `LaneColumn.tsx:216`):
  8 red, all with the D2 message `Step wrapper for "Trunk one" has no title
  attribute`. D4b green — independent.
  The two forms produce different messages on the same assertions: the axis
  collapse is genuinely undone.

**4. The ticket's premise, re-derived first-hand.** With the deletion mutation in
place I additionally set ancestor `title` attributes in PRODUCT code
(`LaneColumn.tsx:165` `.pipeline-detail-page__tail-chain`, `:210`
`.pipeline-detail-page__lane-column`) to the two steps' EXACT expected paths.
Old helper: `Solo lane step` and `Two lane first` both went GREEN with the wiring
entirely deleted — the vacuous pass the ticket describes. Hardened helper: same
mutation, still 8 red. This confirms both the original ticket premise (in its
exact-path limiting case) and the round-2 correction (an arbitrary tooltip degrades
to a string mismatch instead, collapsing the two axes). proposal.md's "Correcting
the ticket's own framing" paragraph and design.md D5's (a0-i)/(a0-ii) split state
this accurately and do not overclaim — they explicitly scope the "starts passing"
claim to the exact-path case and label the arbitrary case as an axis collapse.

**5. Zero product diff, nothing left behind.** `git diff abcf0da9 HEAD --stat --
frontend/src backend/src schemas` lists only `PipelineRiverView.test.tsx`
(+115/-7). `git diff main...HEAD --stat` excluding openspec: same single file.
After restoring my mutations, `git status --short` shows only the untracked
`evaluation-1.md`; my scratch suite was deleted. Re-ran clean: 34/34 green.

**6. Six HEL-985 assertions unchanged.** Diffed the pre-existing `expect(titleFor(...))`
lines against `main` — all six expected strings byte-identical, including the
multi-line `Nested lane step` one (`diff` on the exact ranges returned no output).

**7. No fixture indistinguishability reintroduced.** The diff contains zero fixture
changes — `wiringProps()` and its steps/roots are untouched, so the existing
`rootId` values keep correct output (`root:root-1 > r1a`) distinct from the
value-mismatch output (`r1a`). D4b's synthetic nodes use label strings
(`"D4b synthetic standard label"`, `"D4b synthetic compact label"`) that appear
nowhere in the fixture, carry no `title` at all, and are removed in `finally`.
`screen.getByText` would have thrown on a double match; it did not.

**8. Permitted gates, all green (run by me):**
- `npx jest --testPathPatterns=PipelineRiverView` → 34 passed, 1 suite passed
- `npm run lint` → clean (`--max-warnings=0`)
- `npm run typecheck` → clean
- `npm run format:check` → "All matched files use Prettier code style!"

Note: `--testPathPattern` is rejected by this Jest version; `--testPathPatterns`
is the current flag. mutation-evidence.md discloses this accurately.

### Verdict: CONFIRM

The guard is falsifiable, the proof half is proven falsifiable by my own re-run
rather than by the executor's narrative, the guard half is labelled honestly, both
product-mutation axes fail independently and distinguishably, and the corrected
premise is stated with the right scope.

### Non-blocking notes
- D4a mutates the rendered DOM via `setAttribute` rather than rendering a real
  ancestor tooltip. Acknowledged as a fidelity trade-off in design.md; fine given
  the zero-product-diff constraint, but if a real lane tooltip ever ships, prefer
  converting D4a to exercise it rather than keeping the synthetic attribute.
- The scoped selector hardcodes two wrapper class names. Already accepted in
  design.md Risks; worth a comment reference from the product-side wrappers if a
  third render site is ever added.
