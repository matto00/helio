# HEL-990 mutation evidence

Five runs, all against `npm test -- --testPathPatterns=PipelineRiverView` from
`frontend/` (jest replaced `--testPathPattern` with `--testPathPatterns`; used the
current flag, same underlying behavior).

## (a0) pre-change helper — two readings

Setup: `titleFor()` temporarily reverted to the pre-change form
(`labelEl.closest("[title]")`), plus two TEMP probe tests added to the
`nodePath wiring (HEL-985)` describe block, plus the product-code call site at
`PipelineRiverView.tsx:294` temporarily replaced with a no-op
(`for (const step of steps) void step;`) — the "delete the `nodePath()` call
site" mutation.

### (a0-i) — the pure vacuous green

```ts
it("TEMP a0-i vacuous green probe", () => {
  render(<PipelineRiverView {...wiringProps()} />);
  const tailChain = screen
    .getByText("Solo lane step")
    .closest(".pipeline-detail-page__tail-chain") as HTMLElement;
  tailChain.setAttribute("title", "root:root-1 > r1a > r1b > lane1a"); // exact expected path
  expect(titleFor("Solo lane step")).toBe("root:root-1 > r1a > r1b > lane1a");
});
```

**Result: PASSED.** With the wiring entirely deleted and an ancestor tooltip set to
the step's exact expected path, the pre-change helper's bare `closest("[title]")`
walk finds the ancestor's `title` first and the assertion is green — the wiring is
gone and the test does not notice. This is the "deletion form starts passing"
failure mode the ticket names. (The other five HEL-985 assertions in the same run
are expected red — `No title-bearing ancestor for "..."` — and are explicitly not
part of this claim.)

### (a0-ii) — the axis collapse

```ts
it("TEMP a0-ii axis collapse probe", () => {
  render(<PipelineRiverView {...wiringProps()} />);
  const tailChain = screen
    .getByText("Solo lane step")
    .closest(".pipeline-detail-page__tail-chain") as HTMLElement;
  tailChain.setAttribute("title", "ancestor tooltip"); // arbitrary, not the expected path
  expect(titleFor("Solo lane step")).toBe("root:root-1 > r1a > r1b > lane1a");
});
```

**Result: FAILED**, verbatim:

```
● nodePath wiring (HEL-985) › TEMP a0-ii axis collapse probe

  expect(received).toBe(expected) // Object.is equality

  Expected: "root:root-1 > r1a > r1b > lane1a"
  Received: "ancestor tooltip"
```

This is a **string mismatch** — the same message shape as run (c)'s value-mismatch
mutation below, not the distinct `No title-bearing ancestor` structural failure the
pre-change helper would throw for a step with no titled ancestor at all. The two
mutation axes (delete-the-call-site vs. neuter-the-value) collapse into one
indistinguishable message on the pre-change helper.

Both (a0-i) and (a0-ii) reproduced exactly as design.md D5 predicted; no deviation
to report.

Full run also failing (expected, not part of either claim): the six pre-existing
`nodePath wiring (HEL-985)` value assertions all failed with
`No title-bearing ancestor for "<label>"` (their own titled ancestor was never set,
only "Solo lane step"'s was), for the reason the pre-change helper's ambient
`[title]` walk finds nothing once every step wrapper's own `title` is gone.

TEMP probe tests, the reverted `titleFor()`, and the product-code no-op were all
removed/reverted immediately after this run.

## (a) baseline green, hardened helper

```
$ npm test -- --testPathPatterns=PipelineRiverView
Test Suites: 1 passed, 1 total
Tests:       34 passed, 34 total
```

30 pre-existing tests + 4 new HEL-990 tests (2 D4a guards, 2 D4b proofs), all green.

## (b) ancestor-title + deletion, against the fixed helper

Setup: hardened `titleFor()` in place; product-code call site mutated to the same
deletion no-op as (a0); the two D4a tests already set a titled strict ancestor
post-render, so this single product mutation plus the existing suite exercises
run (b) directly.

```
$ npm test -- --testPathPatterns=PipelineRiverView
Test Suites: 1 failed, 1 total
Tests:       8 failed, 26 passed, 34 total
```

Failing tests: the six pre-existing HEL-985 value assertions plus the two D4a
guards — all with the **D2 absent-attribute message**, e.g.:

```
● nodePath wiring (HEL-985) › renders the base-case title on a step directly on root 1 (E1, PipelineRiverView.tsx:381)

  Step wrapper for "Trunk one" has no title attribute
```

The two D4b proof tests stayed **green**, confirming D4b is independent of the
product call site (predicted in design.md D5).

Reverted immediately after (`git checkout -- PipelineRiverView.tsx`); confirmed
clean via `git diff --stat` showing only the test file.

## (c) value-mismatch mutation

Setup: hardened `titleFor()` in place; product-code call site neutered to
`entries[step.id] = step.id`.

```
$ npm test -- --testPathPatterns=PipelineRiverView
Test Suites: 1 failed, 1 total
Tests:       8 failed, 26 passed, 34 total
```

Same eight tests failed (the six value assertions + two D4a guards), this time
with **string-mismatch messages** on distinct assertions, e.g.:

```
● nodePath wiring (HEL-985) › renders the base-case title on a step directly on root 1 (E1, PipelineRiverView.tsx:381)

  expect(received).toBe(expected) // Object.is equality

  Expected: "root:root-1 > r1a"
  Received: "r1a"
```

The two D4b proof tests stayed **green** here too — confirming D4b is
independent of the call site, as predicted.

(b) and (c) fail with different messages (`Step wrapper for "..." has no title
attribute` vs. an `Object.is` string-mismatch) on the same eight assertions —
the two mutation forms are distinguishable, unlike on the pre-change helper.

Reverted immediately after; confirmed clean.

## (d) restored, clean tree

```
$ git diff --stat
 .../pipelines/ui/PipelineRiverView.test.tsx | ... (only file changed)

$ npm test -- --testPathPatterns=PipelineRiverView
Test Suites: 1 passed, 1 total
Tests:       34 passed, 34 total
```

Product code fully restored to `git checkout main` state (confirmed via
`git diff` against `PipelineRiverView.tsx` showing no changes); only
`PipelineRiverView.test.tsx` (plus openspec artifacts) differs from `main`.

## Summary

| Run   | Helper       | Product mutation         | Outcome                                                   |
| ----- | ------------ | ------------------------ | ---------------------------------------------------------- |
| a0-i  | pre-change   | deletion + exact-path ancestor title | one assertion passes green — vacuous |
| a0-ii | pre-change   | deletion + arbitrary ancestor title  | fails, string-mismatch shape — axis collapse |
| a     | hardened     | none (baseline)          | 34/34 green |
| b     | hardened     | deletion + ancestor title | 8 red, D2 absent-attribute message; D4b green |
| c     | hardened     | value-mismatch (`step.id`) | 8 red, string-mismatch message; D4b green |
| d     | hardened     | none (restored)          | 34/34 green, zero product-code diff |
