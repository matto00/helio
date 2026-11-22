## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 1f8e762b5b0055a2c1c76eddd47771eeca8823db. The planning artifacts are untracked in the worktree.

### What I verified (with evidence)

I checked each round-1 Change Request against the revised design.md and tasks.md, and checked their claims against the live code.

1. **CR1 (two cases, which one AC2 measures): addressed.** D1 now profiles (A) the first edit and (B) a later keystroke
   separately. `profile-findings.md` must state which case the AC2 control number reflects (D1, task 1.6). In the code,
   `usePipelineDraftFrames.ts:171` sets `walkBase = hasDraft || needBase`, so the saved walk first turns on at the first
   edit of a pipeline with no Output. That matches case A. The probe's control window is one `pattern.fill`
   (`e2e/hel1683-regex-main-thread.spec.ts:255`).
2. **CR2 (precompute ruling): addressed.** D2 rules that precomputing at load is out of scope. If the first-edit walk
   dominates AC2, the executor must raise an ESCALATION with the options named. The executor is no longer left to decide
   this.
3. **CR3 (StrictMode factor): addressed.** D1(b), D5 and tasks C4/1.2 require walks to be counted in the prod build or
   per committed render, with the factor stated. `main.tsx:113` StrictMode is confirmed. D1's escalation clause covers
   the case where no saved re-walk exists beyond StrictMode. That outcome is plausible from the code: `secondaryKey` and
   `secondaryIds` (`:151-155`) are string-keyed, and `baseDefs` is keyed on `baseSteps`/`walkBase`, so case B may show
   no saved re-walk at all. The plan handles that by escalating, not by inventing a fix.
4. **CR4 (scroll-edge attribution): addressed.** D1(d) and task 1.4 must find which trigger ran `measure` (the layout
   effect, scroll, ResizeObserver or resize), whether the time is forced layout or the re-render, and whether a remount
   happened. D4 depends on that result. Confirmed in the code: `useScrollEdges.ts:80-82` measures in a mount layout effect
   and `:68` always calls `setEdges` with a fresh object. In `spine/StepPreviewTable.tsx`, the draft `DataGrid` sits
   inside a fragment in the `draftActive` branch (around :245), while the saved `DataGrid` is a top-level body element
   (around :278). The element type at that position changes, so the saved-to-draft switch remounts the grid. D4's
   remount fix targets exactly this.
5. **CR5 (synchronous scroll): addressed.** D4 and C5 keep scroll measurement synchronous and allow coalescing only for
   ResizeObserver/resize, and only if a burst is shown. The cited tests do assert synchronously after
   `fireEvent.scroll`: `useScrollEdges.test.tsx:58-63, 66-70, 136-139`. D4 says these tests are not edited.
6. **CR6 (AC2 rule fixed in advance): addressed.** D6 fixes the conditions: 4x throttle, the same host, 1 worker, n=5
   before and n=5 after, back-to-back runs, and the `DIV#root.oninput` LoAF script entry as the reading. The criterion is
   that the after-median is below the before-median. If the ranges overlap, the report must say so. The spec already
   logs each script entry as `invoker|source:function|duration` (`hel1683-regex-main-thread.spec.ts:118`), so the reading
   can be extracted.
7. **CR7 (saved walk inputs): addressed.** D3 keeps `sources` derived from the draft's secondaries, as in the code at
   `:151-159, 181`. Only identity churn that the profile names gets stabilised, and a test must show a saved-input change
   still re-walks (task 3.1).
8. The cited test, spec and file paths all exist: `pipelineStepParity.test.ts`, 8 `*.sessionEpoch.test.tsx` suites,
   the e2e specs `hel1631`, `hel1685`, `hel1733-*` (3 files) and `hel1734`.
9. **Prod profile route.** `vite.config.ts` sets `server.proxy` only. Vite's `preview.proxy` defaults to
   `server.proxy`, and the backend port comes from env. D1(c) already makes the executor confirm that `/api` reaches the
   lane backend, which is the right guard.
10. **Scope and placeholders.** Every AC maps to tasks: AC1 to 1.1-1.4, 3.x and 4.1; AC2 to 1.5 and 4.1 (D6); AC3 to
    4.2 and 4.3. The only open item is the fix list, and D1-D4 deliberately leave it to the profile, bounded by the
    escalation clauses. There is no TBD and no hand-waving left. `skip_specs: true` is justified because nothing changes
    in an API, schema or behaviour.

### Verdict: CONFIRM

The profile-first deferral is properly bounded. Each fix class has an attributable trigger. "Remove work, not move it"
is enforced. Each way the ticket's premise could turn out false has a named escalation rather than an improvised fix.
AC2's pass rule is set before any data is taken.

### Non-blocking notes

- **D2's "exactly one saved walk per committed render" (case A).** A literal reader could take this as allowing one
  saved walk per commit when a keystroke produces several commits (the transport state, the flash, the effects). That
  would be exactly the repeated walk the ticket describes. The evaluator should read it as **one saved walk across the
  whole first-edit keystroke**, counted per commit to exclude StrictMode. The executor should state it that way in
  `profile-findings.md`.
- **Name the 1,000-row fixture (task 1.4).** Use the same fixture, with the same row x column shape, for before and
  after. The original 13-18 ms reading was on a 400 x 3,000 frame (HEL-1697 skeptic-final-1). The HEL-1683 probe frame
  is tiny (2 rows), so the scroll-edge AC1 number does not come from the probe. Say which column count was used.
- **AC2 with n=5 and a 62-72 ms spread at 4x.** A median win inside overlapping ranges is weak evidence. D6 already
  requires that this be said plainly. The final gate will hold the report to that.
- **Render-count test (task 3.2).** It renders a large page tree under jest. Keep the expected-set assertion to
  component identities named in `profile-findings.md`, not to incidental children, so the test does not become brittle.
