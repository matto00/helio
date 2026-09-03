# HEL-951 cycle 2 — Case A marker repair + mutation proof

## Diagnosis (confirmed against the tree before acting)

`TOAST_BASE_RULE_MARKER` was `"/* Close button */\n.toast__close {"`. The
`/* Close button */` comment was deleted by HEL-851's comment sweep
(`e14be4d0`), so the marker stopped matching — `toast.css`'s RULE was never
touched; only the decorative comment the harness happened to key on was
gone. Confirmed:

```
$ grep -n "^\.toast__close {" frontend/src/shared/ui/toast.css
126:.toast__close {
$ grep -c "^\.toast__close {" frontend/src/shared/ui/toast.css
1
```

The base rule (unindented, line 126) precedes the `@media (max-width:
768px)` block (line 162, its own copy of `.toast__close {` indented two
spaces at line 163) — the file is still in the HEL-535-FIXED shape Case A's
mutation is supposed to invert. `TOAST_MEDIA_BLOCK`'s literal text was
confirmed byte-identical to the file's actual media block. So Case A is
repairable, not deletable, and the fix is to re-anchor the base-rule marker
on the RULE rather than the prose comment.

## Repair

`TOAST_BASE_RULE_MARKER` is now `"\n.toast__close {"` — the leading newline
plus zero indentation uniquely identifies the base rule; the media block's
own copy is `"\n  .toast__close {"` (two-space indented), a different
string. A new `assertToastBaseRuleMarkerUnique()` counts occurrences of the
marker at runtime on every call to `reorderToastMediaAboveBaseRule` and
throws a clear "source drifted" error if the count is ever not exactly 1 —
so a FUTURE comment sweep (or any other drift introducing a second
unindented `.toast__close {`) fails loudly instead of silently mutating the
wrong rule, which is exactly the failure mode a comment-keyed marker
produced silently once already (the file's own control never noticed the
marker had gone stale — it just stopped finding a match).

## `.toast__close` still satisfies P1

It remains swept by `assertFloor`/`sweepSurface` at 430px in the steady-state
guard's surface 3 (`e2e/hel813-mobile-touch-target-floor.spec.ts`), so it
continues to satisfy D5's P1 precondition.

## End-to-end run (baseline PASS -> mutated FAIL -> reverted PASS)

```
Running 1 test using 1 worker

[hel813-regression][Case A][baseline PASS] {"width":44,"height":44,"visible":true}
[hel813-regression][Case A][mutated FAIL] box={"width":20,"height":20,"visible":true} threw=true
[hel813-regression][Case A][reverted PASS] {"width":44,"height":44,"visible":true}
  ✓  1 e2e/hel813-mobile-touch-target-floor.regression.spec.ts:179:7 › HEL-813 demonstrated-RED regression harness › Case A — HEL-535 above-base-rule @media inert floor goes red, then clean on revert (7.7s)

  1 passed (8.1s)
```

`git status --short frontend/src/shared/ui/toast.css` was empty immediately
after this run — the harness's `try/finally` reverted the file, confirmed
byte-identical to its pre-mutation state.

## Per-assertion mutation proof (D6 — one mutation, one observed red, per assertion)

Case A has one mutation (reordering the media block above the base rule)
and three assertions. Unlike Case B, all three genuinely co-vary under this
single mutation (the whole floor mechanism goes inert at once, so height
and width both collapse to the base rule's unconditional 20x20 desktop
size together) — there is no way to break one conjunct independently of
the others for THIS specific bug shape, because the bug IS "the entire
floor rule stops applying," not a per-axis defect. D6's guard against a
vacuous conjunction is satisfied here by pairing baseline and mutated
measurements, which independently confirms each assertion's truth value
actually flips (has teeth) rather than being trivially true regardless of
what happens:

- **Assertion (a)** — `expect(redError).not.toBeNull()`. Baseline:
  `assertFloor` does NOT throw (box `44x44`, visible, both axes clear —
  see "baseline PASS" line above). Mutated: `assertFloor` DOES throw (`box
  {"width":20,"height":20,...} threw=true`). The assertion is false at
  baseline and true only once the mutation is applied — not vacuous.
- **Assertion (b)** — `expect(mutatedBox.height).toBeLessThan(44)`.
  Baseline height is `44` (assertion would be FALSE if evaluated against
  the baseline measurement). Mutated height is `20` (assertion is TRUE).
  Not vacuous.
- **Assertion (c)** — `expect(mutatedBox.width).toBeLessThan(44)`.
  Baseline width is `44` (FALSE if evaluated against baseline). Mutated
  width is `20` (TRUE). Not vacuous.

Same captured transcript (above) carries all three pieces of evidence,
since the baseline and mutated measurements are both logged explicitly in
that one end-to-end run — persisted as `caseA-repair-run.log`.
