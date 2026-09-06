## Context

See proposal.md — Why. Ground truth as of `abcf0da9`:

- `titleFor()` (`PipelineRiverView.test.tsx:621-626`) does `screen.getByText(label).closest("[title]")`, throws
  `No title-bearing ancestor` on `null`, and returns the attribute.
- Exactly three render sites bind the path attribute, and each puts it on the wrapper `div` directly:
  `PipelineRiverView.tsx:378-381` (`.pipeline-detail-page__step-section`), `LaneColumn.tsx:169-171`
  (`.pipeline-detail-page__tail-chain-step`, compact), `LaneColumn.tsx:214-216` (`.pipeline-detail-page__step-section`,
  non-compact). So the wrapper class set is exactly two members.
- `sectionFor()` (line 125) queries `.pipeline-detail-page__step-section` only and cannot reach the compact site — this
  is why HEL-985 avoided it, and it remains unusable here.
- The `nodePath wiring (HEL-985)` fixture sets `rootId` on `r1a` (`root-1`) and `r2a` (`root-2`), so every expected title
  is `root:<rootId> > …` — already distinct from the value-mismatch mutation's bare `step.id`. The HEL-985 trap is
  currently avoided; this change must not regress it.
- No ancestor of a step card carries a `title` today. `PipelineRiverView.tsx:336`'s `title="No steps yet"` is an
  `EmptyState` React prop inside the `steps.length === 0` branch, never rendered alongside step cards.

## Goals / Non-Goals

**Goals.** Make the step-wrapper lookup independent of ambient DOM structure; make an absent `title` fail as an absent
`title`; prove both mutation forms fail independently, by running them.

**Non-Goals.** Any product-code diff (rules out the `data-testid` option). Changing `sectionFor()`. Extending coverage
beyond HEL-985's four prop-threading edges. Changing any of the six existing expected title strings.

## Decisions

**D1 — Scope `closest` to the two wrapper classes, rather than adding a `data-testid`.** Use
`labelEl.closest(".pipeline-detail-page__step-section, .pipeline-detail-page__tail-chain-step")`. A selector list covers
both render sites in one call. *Alternative rejected:* `data-testid` on the wrappers — cleaner as a query, but it is a
product-code change and the ticket makes zero-product-diff an acceptance criterion. *Alternative rejected:* reusing
`sectionFor()` — structurally cannot reach the compact tail-chain wrapper.

**D2 — Two distinct failure messages, one per failure mode.** `closest` returning `null` means the fixture or the
component structure broke (no step wrapper at all); a wrapper found but `hasAttribute("title") === false` means the
wiring is gone. These are different defects and must not share a message, or the deletion mutation's red becomes
indistinguishable from a fixture break. Throw `No step wrapper for "<label>"` and
`Step wrapper for "<label>" has no title attribute` respectively. *Alternative rejected:* returning `""` for a missing
attribute — that would make the deletion mutation fail as a string mismatch against the expected path, which reads as a
value defect and hides which axis actually broke.

**D3 — `closest` (nearest-ancestor) semantics are load-bearing, and correct under nesting.** A lane column can render
inside a `.pipeline-detail-page__step-section` (E4, the lane nested under `laneA`/`laneB`), so a step's wrapper may itself
have an ancestor matching the same selector. `closest` returns the *nearest* match, which is always the step's own
wrapper. A `querySelector`-from-the-top approach would resolve the outer one and silently assert the wrong step's path.

**D4 — The hardening gets permanent assertions, and they must be red on the pre-change helper.** (Revised, skeptic
CR-1/CR-2.) Two separate observations are needed, because only one of them is falsifiable:

- *D4a — ancestor-inert case (a guard, not a proof).* After rendering, set `title="ancestor tooltip"` on a strict
  ancestor **of the step's own wrapper**, then assert `titleFor()` still returns the step's path. Named concretely:
  for the standard site use the step `Two lane first` and mutate its enclosing `.pipeline-detail-page__lane-column`;
  for the compact site use `Solo lane step` and mutate its enclosing `.pipeline-detail-page__tail-chain`. Both are
  exactly the "lane tooltip" the ticket names. Assert the mutated element `.contains()` the resolved wrapper **and** is
  not the resolved wrapper, and that the injected string differs from the expected path. This assertion is green on the
  old helper too (the wrapper's own `title` is present, so `closest("[title]")` finds it first) — it is therefore
  labelled a **guard**, not the proof, and must not be presented as evidence the fix works.
- *D4b — absent-title-under-titled-ancestor case (the actual proof).* This is the only configuration where the old and
  new helpers differ, and no render path reaches it without a product diff, so build it synthetically in the test:
  a titled ancestor `div` containing a `.pipeline-detail-page__step-section` that carries **no** `title` and holds the
  label text. Append it to `document.body` (RTL's auto-cleanup does not remove manually appended nodes), use a label
  string that appears nowhere in the fixture so `screen.getByText` cannot double-match, and remove it in a `finally` /
  `afterEach` — otherwise it leaks into the other by-text queries in this file. Assert `expect(() => titleFor(label)).toThrow(/has no title attribute/)`. Repeat for
  `.pipeline-detail-page__tail-chain-step`. On the old helper this returns the ancestor's title instead of throwing —
  red. On the new helper it throws — green. This is the second falsifiable observation the ticket demands.

**D5 — Independence, plus a before-reading that shows the old guard was actually broken.** (Revised at rounds 1 and 2.)

*Round-2 correction, adopted.* The old helper does not simply go green under ancestor-title + deletion for an arbitrary
tooltip string: the six assertions are exact-string comparisons, so they fail as string mismatches. (a0) therefore
records **two** readings, and both are observations, not predictions to be asserted into existence:
- *(a0-i) the pure vacuous green.* Set the ancestor `title` to one step's **exact expected path** — for `Solo lane step`,
  put `title="root:root-1 > r1a > r1b > lane1a"` on its `.pipeline-detail-page__tail-chain` ancestor — and delete the
  call site. That single assertion passes green with the wiring entirely gone. The other five assertions are expected
  red in this run and are explicitly **not** part of the (a0-i) claim.
- *(a0-ii) the axis collapse.* With an arbitrary ancestor tooltip and the call site deleted, record that the old helper
  fails with the **same** string-mismatch message as the value-mismatch mutation — the two axes reduced to one label —
  versus the new helper's distinct absent-attribute message.

The transcript must show five runs: (a0) the above, against the **pre-change** `titleFor()`; (a) baseline green with the fix;
(b) ancestor-title + deletion against the fixed helper → red with D2's absent-attribute message; (c) value-mismatch
mutation alone → red with a string-mismatch message; (d) baseline green restored with a clean product-code `git diff`.
(b) and (c) must fail with different messages on different assertions. Expected and stated in advance so a deviation
reads as a defect: D4b is independent of the product call site and should be **green in both (b) and (c)**; D4a and the
six HEL-985 value assertions go red in (b) and in (c). Without (a0), `mutation-evidence.md` would document that the new
guard works but never that the old one was broken. If either (a0) reading fails to reproduce as described, that is a
finding to report, not a result to record — stop and escalate rather than writing an outcome that was not observed.

## Risks / Trade-offs

- **[Class rename breaks the guard silently — it becomes a hard `null`, not a pass.]** → D2's distinct "No step wrapper"
  message makes that a loud, specific failure. A rename is a real product change and should break a structural test.
- **[The scoped selector hardcodes two class names that could drift out of sync with a third future render site.]** →
  Accepted, and strictly better than today: a new site with no wrapper class match fails loudly at `closest` rather than
  silently escalating. The alternative (`data-testid`) has the same drift exposure plus a product diff.
- **[D4a is green on the unhardened helper, so mistaking it for the proof would ship a vacuous test.]** → D4b is the
  falsifiable half, and (a0) in D5 pins the before-reading. D4a is explicitly labelled a guard in both design.md and the
  test's own comment, so no later reader can promote it to evidence.
- **[D4a's `setAttribute` could target an element between the label and the wrapper, which is inert under both helpers,
  or the wrapper itself, making the test vacuous.]** → The named targets are strict ancestors of the wrapper, and the
  test asserts `mutated.contains(resolved) && mutated !== resolved` plus a title-string inequality.
- **[Fixture indistinguishability regression.]** → The `rootId` values already present make correct output
  (`root:root-1 > r1a`) differ from the value-mismatch output (`r1a`). Any new fixture step added for D4 must set
  `rootId` on its root-head step for the same reason; a bare-id expected value is the HEL-985 trap re-entering.

## Migration Plan

None. Test-only change; no deploy, no migration, no rollback surface. Reverting the commit fully restores prior state.

## Planner Notes

- Self-approved: D1's selector-list form over `data-testid`, on the ticket's own zero-product-diff constraint.
- Self-approved: D4's post-render `setAttribute` over a titled render container, on fidelity grounds (D4 rationale).
- Verification is frontend-Jest-only by hard environment constraint (see ticket.md): no backend spec, no dev server, no
  database connection, no Playwright. The executor must escalate rather than reach for any of those.
