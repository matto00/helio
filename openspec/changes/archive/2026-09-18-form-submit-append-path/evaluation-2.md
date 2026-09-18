## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `219f4f8b5162478752e7842122cdc389068da37e` (worktree clean).
Diff base re-resolved LIVE via `resolve-review-base.sh` → `b1b954e364b1725787e28c0d86540c910c1fc460`
(exit status checked). Incremental review surface `fe5c2b43..219f4f8b`: 7 files, +421/−44 —
`FormPanelView.tsx` (+17/−2), `FormPanelView.test.tsx` (+22), `FormSubmissionSpec.scala` (+19),
`FormSubmitRoutesSpec.scala` (+32), plus `mutation-evidence.md`, `files-modified.md`,
`evaluation-1.md`.

`git diff --name-only fe5c2b43..HEAD -- 'backend/src/main/**'` is EMPTY — no backend main code
changed this cycle, so the already-running backend served current code for my live probes.
Server identity re-verified before measuring (`readlink /proc/<pid>/cwd`): dev `:6519` → pid
2295051, backend `:9426` → pid 2294837, both inside THIS worktree. `assert-phase.sh servers` →
`PASS servers`. `FormPanel.css` is absent from the incremental diff, so cycle 1's token/both-theme/
breakpoint verification still stands unchanged and was not re-derived.

### Phase 1: Spec Review — PASS

Both cycle-1 change requests are genuinely addressed, and no new scope crept in (the incremental
diff touches one component, one component test, two backend specs, and evidence/handoff docs).
All previously-passing acceptance criteria were re-confirmed by fresh measurement, not assumed:
the server still rejects a declared-required-with-default omission `400` + `fieldErrors` with the
bound source's row count unchanged at 0, and a valid UI submit still appends exactly one row
(`["cycle2-note",9,null]`, total 1) to the panel's persisted `dataSourceId`.

Non-retired constraints C1–C8 re-read this cycle (CON-161) and honored; C1's announcement
behaviour and C7's mutation discipline are the two that moved, both below.

### Phase 2: Code Review — PASS

Gates — **my own fresh runs on `219f4f8b`** (the executor's report was not trusted):

| gate | result |
|---|---|
| `npm run lint` | PASS (`eslint . --max-warnings=0`, clean) |
| `npm run format:check` | PASS |
| `npm test` | PASS — **3598** tests (cycle 1: 3597; +1 = the added CR1 regression test) |
| `npm --prefix frontend run build` | PASS (only the pre-existing chunk-size advisory) |
| `cd backend && sbt test` | PASS — **4667 tests, 0 failed**, "All tests passed" (cycle 1: 4665; +2 = the two added CR2 tests) |

Both new backend specs are confirmed present by name in my own run's output:
`should reject a declared-required field with a declared default, left unsupplied — layer 1's own
check` and `… — layer 1's own check, not layer 2's`.

**CR1 fix.** `handleSubmit`'s leading clear now runs inside `flushSync(() => { setAlertText("");
setStatusText(""); })` (`react-dom`), with a comment naming the batching root cause. This is a
legitimate, targeted use of the escape hatch — called from an event handler, not from render or a
lifecycle body, and my live probes recorded **zero** `console.error` and **zero** `console.warn`
on both the rejection and success paths, so it introduces no React warning. The success path also
gained `values.setExternalErrors({})`, which is exactly cycle 1's non-blocking suggestion.

**CR2 fix.** Two tests added at the levels that matter — unit (`result shouldBe
Left(Vector(FieldError("status", "required")))`) and route (`400` + `fieldErrors` contains
`{status, required}` + `rowCount(src) shouldBe 0`, satisfying C8 by count rather than by status
alone). The fixture is correct for the purpose: `status` is declared `required: true` with
`"default":"open"` and is configured by the form WITHOUT a form-level `required`, so it never
enters `formRequiredNames` and therefore never enters `effectiveDeclaration`'s required-copy —
which is precisely what isolates layer 1.

### Phase 3: UI Review — PASS

Re-measured against the running app on this run's ports, as computed state (C1). Fixtures were
created through the live API and deleted afterwards (dashboard 204, source 204, rows endpoint then
404); the unused fixture seeded for a second user was also removed. No stray screenshots were
produced this cycle and `find /home/matt/Development/helio -maxdepth 1 -name '*.png'` is empty.

**CR1, re-measured — the defect is resolved.** Two consecutive identical client-blocked submits
(required `Note` empty), MutationObserver on `.form-panel-view__alert`:

```
first attempt:  alertText "Note is required", submit requests 0
SECOND attempt: mutations recorded = 1   (cycle 1 measured 0)
                aria-invalid "true", focus is first invalid control, submit requests 0
                consoleErrors [] , consoleWarns []
```

A refined record-level probe (`addedNodes`/`removedNodes` per `MutationRecord`, with a
requestAnimationFrame index) shows the region is genuinely emptied rather than merely re-set:

```
record 1: childList  removed ["Note is required"]  added []                    frame 0  t=100485
record 2: childList  removed []                    added ["Note is required"]  frame 0  t=100485
```

The removal record is the `flushSync` clear reaching the DOM as its own commit — the spec's
"Regions SHALL be emptied when the next attempt starts", now satisfied observably. (My first probe
reported `sawEmptyIntermediate: false`; that was an artifact of MutationObserver callbacks being
delivered as a microtask after all synchronous DOM work, so reading `textContent` inside the
callback is too late to see the transient. The record-level probe above is the correct instrument.
Recorded so the next reviewer does not mistake that earlier readout for a contradiction.)

**Success path, re-measured (regression check on the shared clear):** alert emptied (record:
removed "Note is required"), status announced (record: added "The row was added."), form reset
(`note` and `qty` both empty), `focusIsSubmitButton: true`, `invalidCount: 0`, button re-enabled,
zero console errors/warnings, and exactly one row appended to the bound source.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- **Residual risk on CR1 worth the skeptic's attention — the clear and the refill land in the
  SAME frame.** Both mutation records above carry `frame 0` and the identical timestamp
  `t=100485`: `flushSync` forces its own React commit but does not yield a paint frame, so the
  empty state is never presented, and the region goes empty→identical-text within one task. What I
  proved is what CR1 asked for and what the spec says (the region is observably emptied; DOM
  mutation now occurs where cycle 1 measured none). What I did **not** and cannot prove in this
  harness is that a real screen reader re-announces identical text after a same-task remove/add —
  some AT diff the accessibility tree per frame and may coalesce it. If that guarantee is wanted,
  separating the clear from the set across a frame/task (`requestAnimationFrame`/`setTimeout`) or
  varying the announced text would make it robust. Flagged, not blocked: it is an AT-behaviour
  judgment beyond mechanical review, and the executor delivered exactly the fix the cycle-1
  finding specified.
- **The new regression test cannot distinguish that case**, by construction: it asserts
  `observed.length > 0`, which a same-frame remove/add satisfies. It is a correct regression test
  for the cycle-1 defect (and its recorded RED — "Timed out retrying … Received: 0" — matches my
  own independent cycle-1 measurement of zero mutations, so the red is credible), but it should not
  later be cited as proof that an announcement reaches assistive technology.
- `mutation-evidence.md`'s backend section is now accurate and self-critical: it records mutation 1
  **ALONE** going RED (3 failures: both new distinguishing tests plus one pre-existing
  multiple-errors test), removes the cycle-1 "load-bearing at either layer" claim, and replaces it
  with a correct account of what each layer catches — including the honest note that layer 2 is the
  one that catches an unconfigured declared-required field with no default, which layer 1's
  `config.fields` loop never visits. The disclosed third failing test is incidental and explained,
  not hidden.
