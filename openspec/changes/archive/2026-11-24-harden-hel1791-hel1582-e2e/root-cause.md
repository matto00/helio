# HEL-1830 root cause and shape

Item 1 (hel1791): the shared beforeAll `owner` paid all seeding plus both owner theme tests inside one 120-request/60 s
window (HEL-1826 measured 115-119 of 120).

Pre-fix projection (Decision 1, threshold 50): `t1-count-unfixed-shared-owner.txt` shows seeding 17 plus 43 for the
first owner theme test, 60 before any run wait, above 50. The per-(theme, width) fallback was therefore chosen and
implemented: 6 owner tests (light and dark at 390, 768 and 1100), each with its own principal and board.

Post-fix (C19, threshold 60): owner max-60s is 30 at 1x (20 runs) and 31 at CPU 4x (5 runs), so no further fallback
applies. Evidence: t1-count-unfixed-shared-owner.txt, t1-red-burn-unfixed.txt,
t4-1791-20x.txt, t4-1791-throttle4x.txt, t1-isolation-control.txt, t1-mutation-owner-geometry.txt.
Editor fold-in (Decision 10, owner answer 2026-11-24): the shared editor principal (both theme tests) measured max-60s
72-74 at 1x and 80 at 4x (t4-1791-20x.txt, t4-1791-throttle4x.txt); the red is t6-red-burn-shared-editor.txt (burn
before the dark editor test, fails at toHaveCount(7) with Received 0). Each editor theme test is now its own principal,
granted editor on the beforeAll board by the board owner. Post-fold-in highest max-60s (C20 threshold 60): editor-light
41 and editor-dark 41 at 1x (20 runs) and at 4x (5 runs); board owner 19 at both; owner tests 30 (1x) and 31 (4x); no
fallback applied. Evidence: t6-1791-20x.txt, t6-1791-throttle4x.txt, t6-1582-1run.txt,
t6-isolation-control-editor.txt, t6-mutation-editor-caption.txt.

Item 2 (hel1582 tap (b)): outcome (i). The sheet mounts its own StepPreviewTable, which fetches the preview afresh;
`.step-preview__count` arrives with that response and moves the trigger from x=188 to x=249 (375 and 390 wide). A tap at
the pre-reflow point hits `span.step-preview__count` and opens nothing; a tap after the count is visible opens it
(t2b-stale-tap.txt, t2b-probe-log-1x.txt, t2b-probe-log-4x.txt). As in HEL-1826 there is no natural red for the
race itself; the coordinate stand-in is the evidence. Fix: bounded wait for `.step-preview__count` before tap (b).
The step-sheet cell still reds under the off-screen mutation (t2b-mutation-sheet-cell.txt).

Verification note: during the hel1582 20x one run (run 11 of a first streak) failed at the unrelated contrast test
(:527) with a 240 s test timeout while host load average was 11-13; three solo reruns passed in about 15 s. No probe-confirmed
cause (trace not retained), so the streak was restarted and 20 consecutive passes recorded (t4-1582-20x.txt).
