## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit `12e4474d` on top of `aafb34ed`/`2bd7c268`/`b16a3382` (base `7b872db9`).
§4/§5 remain de-scoped by orchestrator decision and are not evaluated as gaps.

Five of six cycle-1 change requests are properly closed. CR1's *mechanism* is closed correctly,
but re-measuring at the corrected floor exposed a defect in the probe that CR1's own residual
population now rests on. That is the one blocking issue, and it is a real one: **all 10 named
residuals are false positives**, measured and proven below.

### Phase 1: Spec Review — PASS

- **CR2 closed.** `specs/dialog-focus-lifecycle/spec.md` and `specs/keyboard-flow-operability/spec.md`
  are deleted in full. `proposal.md`'s "New Capabilities" is now `_(none)_` with a "Scope amendment"
  section recording the cycle-3 decision and pointing at the follow-up tickets.
  `openspec validate focus-management-keyboard-navigation --type change` → **"Change ... is valid"**
  (run by me). One delta remains and it is the one this change's code implements.
- **CR3 closed.** The requirement is retitled "Clipping counts as absence", the
  painted-behind-a-sibling scenario is gone, and an inline note names occlusion as an unowned
  follow-up with the correct reason. `grep -rn "occlu"` across the spec dir returns only that
  note. In code, `| "occluded"` is gone from the `Verdict` union and "unoccluded" is gone from
  both the test title and the failure message.
- **CR6 closed.** `files-modified.md`'s cycle-2 entry no longer claims a cycle-3 reconfirmation
  that its own transcript contradicted.
- `tasks.md` 2.6a/2.6 now checked with the deviation noted, per the cycle-1 non-blocking suggestion.
- The Cycle 4 handoff is accurate about what it did, including volunteering the `measureLive` bug
  and the baseline-assertion change. No AC is claimed that is not met.

The one Phase-1 consequence of the Phase-2 finding: the `accessible-focus-indicator` delta's third
requirement speaks of measuring "whichever mechanism conveyed focus". On the 10 flagged elements
*two* mechanisms convey focus and the guard grades only the weaker one. The delta text is fine;
the implementation does not yet satisfy it. Tracked as CR-A below, not as a separate spec change.

### Phase 2: Code Review — FAIL

Gates, re-run fresh by me in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run check:e2e-types` | PASS |
| `npm test` | PASS — 299 suites / 3143 tests; helio-mcp 25 / 248 |
| `openspec validate --type change` | PASS |
| `e2e/focus-presence-guard.spec.ts` | PASS — 196 elements, 8 views, 98593ms, 10 named residuals |
| `e2e/hel520-focus-presence-guard.regression.spec.ts` (`HEL520_REGRESSION=1`) | PASS — 2/2 |
| `git status --short` after every run | clean — no leftover mutations |

No `backend/**` changes; sbt not run.

---

#### [BLOCKING] CR-A. All 10 named residuals are false positives: the probe grades the decorative channel and ignores the conforming one

`measureOneElement` (`e2e/support/focusPresenceProbe.ts:264-296`) picks exactly ONE channel to
measure, by precedence `outline > box-shadow > border/background`, and discards the rest.

Every one of the 10 residuals is a `.ui-input`-family element governed by
`frontend/src/shared/ui/inputs.css:36-42`:

```css
.ui-input:focus-visible,
.ui-select__trigger:focus-visible,
.ui-textarea:focus-visible {
  outline: none;
  border-color: var(--app-focus-ring-color);   /* the real indicator */
  box-shadow: 0 0 0 3px var(--app-accent-dim); /* a decorative glow */
}
```

`outline` is `none`, so the precedence falls to `box-shadow` and the guard grades
`--app-accent-dim` — a token whose entire design purpose is to be a dim glow — while never
measuring `--app-focus-ring-color`, the contrast-derived token whose derivation design.md D0
records as *"derived to clear 3:1 against every surface declared in both theme blocks
(`deriveFocusRingColor`), and that derivation is separately guarded"*.

I measured this directly against the running app rather than reasoning about it, using this
change's own `parseColor`/`compositeStack`/`contrastRatio` and the same CDP-forced
`:focus-visible` path, on `input[aria-label="Filter dashboards by name"]` (one of the 10):

```
[dark]  focused border-color = rgb(219, 101, 19)                        ratio = 4.9596   <- not measured
        halo = color(srgb 0.976471 0.45098 0.0862745 / 0.1)             ratio = 1.1443   <- graded
[light] focused border-color = rgb(219, 101, 19)                        ratio = 3.4815   <- not measured
        halo = color(srgb 0.976471 0.45098 0.0862745 / 0.08)            ratio = 1.0829   <- graded
```

The two graded numbers are exactly `KNOWN_RESIDUAL_RATIOS = [1.0828608452896535,
1.1443462316946211]`. The unmeasured border channel clears the 3:1 non-text floor in **both**
themes (4.96 and 3.48). Rest border is `rgba(242,239,233,0.09)` / `rgba(33,29,25,0.11)`, so the
border genuinely *changes* on focus — this is a real, conforming, perceivable indicator, not a
technicality.

Consequences, in order of seriousness:

1. **The residual population is 10/10 false positives.** Not one of the ten is an element lacking
   a conforming focus indicator. The guard's own run output asserts the opposite in the app's
   permanent record.
2. **The attribution to HEL-1046/1050 is incorrect.** Those tickets own `--app-accent-dim` and
   `deriveFocusRingColor`. Handing them ten "sub-floor focus indicators" would send them to raise
   the contrast of a glow that is behaving exactly as designed — on evidence derived from
   measuring the wrong channel. This is the specific thing I was asked to check for at the
   scope boundary; it is not a dodge (the executor plainly believed the measurement), but the
   boundary call is wrong because its input is wrong.
3. **`KNOWN_RESIDUAL_RATIOS` now entrenches the defect.** Two hardcoded floats suppress a probe
   bug under the label "named residual". The mechanism was designed to be fail-closed and
   honest, and it is — but what it is currently naming is not what it says it is naming.
4. **The precedence is wrong in principle, in both directions.** For a multi-channel indicator
   the accessible question is "does *any* channel clear the floor", not "does the
   highest-precedence channel". As written the guard false-fails the correct multi-channel
   pattern (demonstrated above) and, symmetrically, a conforming halo would mask a
   non-conforming border on an element that had one. The spec delta's own wording —
   "whichever mechanism conveyed focus" — reads more naturally as the any-channel rule.
5. **This predates cycle 2.** At the old 1.10 floor the same bug produced the 5 light-theme
   "residuals"; CR1 did not create it, it exposed it. The 5→10 growth the handoff describes as
   "the same root cause, newly surfaced in dark theme" is really "the same probe defect, now
   above threshold in both themes".

Required: measure every channel that changed and pass the element if **any** of them clears the
floor, reporting the best ratio (and ideally listing the per-channel ratios in the `detail` for
diagnosability). Then re-run the sweep. On the evidence above I expect the named-residual
population to go to **zero**, in which case `KNOWN_RESIDUAL_RATIOS` and its whole allowance block
should be deleted rather than emptied — and `files-modified.md`, `tasks.md` 3.5 and the guard's
own comment must stop describing a residual population that does not exist. If any site *does*
still fail on an any-channel basis, that one is a genuine find and should be named and owned as
CR1 intended. Do not simply reorder the precedence to prefer `border` — that swaps which
single channel is graded and reproduces the same class of bug facing the other way.

---

#### [BLOCKING] CR-B. The CR5 partition assertion still passes an empty view

`assertRouteFullyCovered` (`e2e/focus-presence-guard.spec.ts:105`) opens with:

```ts
if (coveredIds.size >= totalStamped) return;
```

When a route renders zero focusable elements, `totalStamped === 0` and `0 >= 0` returns
immediately. The surviving global `expect(totalMeasured).toBeGreaterThan(0)` (line 350) is a
headline total across all eight views, so seven views can render nothing at all — an error
boundary on `/pipelines/:id`, a redirect, a seeding change — and the guard still passes while
printing `0 focusable element(s) measured` lines. That is the exact hole cycle-1 CR5 named, one
layer in: the new assertion checks *stamp/sweep agreement*, which is a genuine and worthwhile
property, but not *non-emptiness*, which is the property that keeps the coverage claim alive.

Required: assert a per-view floor — at minimum `expect(totalStamped).toBeGreaterThan(0)` inside
the route loop, with the view name in the message. A route-specific expected minimum would be
better still, since a stripped-down error page can render one focusable "Reload" button and clear
a floor of 1.

The partition assertion itself is otherwise a good adaptation of the HEL-866 pattern and I am
not asking for it to be reworked. Two smaller notes on it, non-blocking:

- `coveredIds.add(docId)` happens at line 207, *before* the `try` that focuses and measures, so an
  element whose `.focus()` throws and `continue`s is still counted as covered. The assertion's
  failure text says "only N were measured", which slightly overstates what it checks. One-line
  fix: move the `add` to after the successful `measureOneElement`, or reword the message.
- The stamp filter excludes on `rect.width === 0 && rect.height === 0` (both), while the sweep
  uses Playwright's `isVisible()`, which excludes on an empty bounding box (either). An element
  measuring 0x20 would be stamped but not swept, producing a spurious partition failure. It did
  not fire in my run; worth aligning the two predicates so it cannot.

---

#### CR4 — closed, and the bug-plus-proof entanglement checks out

I ran the harness myself (`HEL520_REGRESSION=1`, `playwright.regression.config.ts`): **2 passed**,
`git status --short` clean afterwards.

```
[Case A][baseline] verdict=fail  detail=ratio=1.1443462316946211
[Case A][mutated]  verdict=no-indicator  detail=no outline/box-shadow/border/background channel changed under forced focus-visible
[Case A][reverted] verdict=fail  detail=ratio=1.1443462316946211
[Case B][baseline] verdict=pass  detail=ratio=5.1089714871982395
[Case B][mutated]  verdict=clipped  detail=clipped on X by ancestor box [302.0,553.3]
[Case B][reverted] verdict=pass  detail=ratio=5.1089714871982395
```

On the specific entanglement risk you flagged:

- **The `measureLive` fix cannot weaken the live guard.** `measureLive` is module-local to
  `hel520-focus-presence-guard.regression.spec.ts`; it is not imported by
  `focus-presence-guard.spec.ts` and not part of `focusPresenceProbe.ts`. I diffed the shared
  probe: the only changes there are the threshold constant and the `Verdict` union. The live
  guard's own sweep already blurs between elements and reads `base` before focusing.
- **Case A goes red for the stated reason, not incidentally.** `no-indicator` is emitted from
  exactly one branch (`focusPresenceProbe.ts:206`), the assertion names it explicitly rather than
  asserting "not pass", and the injected style forces all four channels to the resting values.
- **The green control is strong enough to catch a masking fix.** The failure direction of the
  original bug is instructive: a `base` contaminated with the *focused* border-color would make
  `borderChanged` read TRUE under the injected style, i.e. it would break Case A rather than
  fake it. And the reverted arm asserts equality with the baseline on both verdict **and** the
  exact ratio string, so a fix that merely flattened the measurement would show up there.
  The fix (blur, settle, then read `base`) is applied uniformly to all three arms, not only to
  the asserted one. I am satisfied this is a real fix with a real proof, not a mutual validation.
- `page.addStyleTag` is a legitimate substitute for file mutation here: same `measureOneElement`
  path, same real rendered element, and it removes the Vite HMR race that defeated two earlier
  anchors. Task 7.4's requirement is that the arm drive real rendering source through the whole
  pipeline, and it does.

One consequential note: Case A's baseline/reverted control is anchored to
`ratio=1.1443462316946211` — one of the two numbers CR-A shows to be a misgraded channel. Once
CR-A is fixed, `#email`'s baseline verdict will change (very likely to `pass`), and this test's
`expect(["pass","fail"]).toContain(baseline.verdict)` will still hold, but the handoff prose
explaining "the baseline is itself a named residual" will no longer be true and should be updated
with it.

#### CR1's mechanism — closed and correct

`FOCUS_NONTEXT_CONTRAST_THRESHOLD = 3.0` is declared locally in `focusPresenceProbe.ts` with a
comment stating which floor is enforced, why, and why `CONTRAST_THRESHOLD` is not it — quoting
that constant's own disclaimer. `CONTRAST_THRESHOLD` is no longer imported. design.md D1c,
tasks 2.1 and the spec delta all said 3:1 and the code now says 3:1. This part is exactly right;
only the residual population that came out of the re-measurement is wrong, per CR-A.

### Phase 3: UI Review — PASS

Triggers matched. Servers restarted via `scripts/concertino/start-servers.sh` (5952/8859) after
the previous session's frontend had exited — process cwd re-verified with
`readlink /proc/<pid>/cwd` against this worktree before any measurement was trusted. No bare
`npx playwright`/`npm`/`vite` invocation: the binary was called by absolute path with `DEV_PORT`
and `BACKEND_PORT` set explicitly and `-c` naming this worktree's config.

Rendered evidence is the three runs above plus my own direct channel measurement. The sweep
reproduces the executor's reported figures exactly (196 elements, 8 views, ~98.6s vs their ~98s,
10 residuals). No console errors surfaced. No `frontend/src` runtime code changed this cycle, so
there is no new UI surface, breakpoint or state to exercise beyond cycle 1's CSS offset fix,
which remains passing under Case B.

Subjective visual judgement remains the skeptic's.

### Overall: FAIL

Two blocking change requests, one of them substantive. Everything else in this cycle is closed
cleanly, and the CR4 work in particular is better than what was asked for.

### Change Requests

1. **(CR-A) Measure every changed channel and pass on the best one.** In
   `e2e/support/focusPresenceProbe.ts:264-296`, replace the single-channel `outline > box-shadow >
   border/background` precedence with an any-channel rule: compute the ratio for each channel that
   changed under forced focus, pass if any clears `FOCUS_NONTEXT_CONTRAST_THRESHOLD`, and report
   the best ratio (listing per-channel ratios in `detail` for diagnosability). Keep clipping keyed
   to the geometry of the channel that actually extends past the element's box.
   Then re-run the sweep. Expect the named-residual population to fall to zero; if it does, delete
   `KNOWN_RESIDUAL_RATIOS`, `KNOWN_RESIDUAL_EPSILON`, `isKnownResidual` and the whole allowance
   block outright, and correct `files-modified.md`, `tasks.md` 3.5 and the guard's comment so they
   no longer describe a residual population that does not exist. If any site still fails
   on an any-channel basis, name and own that one as CR1 intended.
   Do not reorder the precedence to prefer `border` — that grades a different single channel and
   reproduces the same bug facing the other way.
   Evidence to work from, measured against the running app with this change's own compositing
   helpers: `input[aria-label="Filter dashboards by name"]`, focused border `rgb(219,101,19)` →
   ratio **4.9596** (dark) / **3.4815** (light), versus the graded halo at 1.1443 / 1.0829.

2. **(CR-B) Give the coverage assertion a non-emptiness floor.** In
   `e2e/focus-presence-guard.spec.ts`, add a per-view assertion that the stamped population is
   non-empty (`expect(totalStamped).toBeGreaterThan(0)` inside the route loop, with the view name
   in the message), so `assertRouteFullyCovered`'s `0 >= 0` early return cannot pass a view that
   renders nothing. A route-specific expected minimum would be stronger, since an error page can
   render a single focusable button.

### Non-blocking Suggestions

- Move `coveredIds.add(docId)` (line 207) to after a successful `measureOneElement`, or reword
  `assertRouteFullyCovered`'s "only N were measured" message — as written it counts elements that
  entered the loop, including any whose `.focus()` threw.
- Align the stamp filter's visibility predicate (`rect.width === 0 && rect.height === 0`) with the
  sweep's Playwright `isVisible()` (empty box on *either* axis), so a 0x20 element cannot produce
  a spurious partition failure.
- Two stale comments in `e2e/focus-presence-guard.spec.ts` (lines ~258 and ~263) still refer to
  "occlusion sampling" and a false "occluded" finding as if that code path existed. The
  historical note about the 400ms transition wait is worth keeping; the occlusion framing is not.
- When CR-A lands, update the Cycle 4 handoff's Case A note explaining that `#email`'s baseline is
  "one of the CR1 named residuals" — it will no longer be one.
- This worktree still has no root `node_modules` and resolves through the parent repo's. Worked
  fine again this cycle; noted for the orchestrator, not a defect in this change.
