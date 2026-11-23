# HEL-1826 root causes

Evidence files are named in each paragraph; all live in this directory. "Confirmed" = a committed probe output shows
it; "unconfirmed" = stated as such.

## T1 hel1791-compact-counter-stack-height:290 -- CONFIRMED, test-side cause (shared principal's rate-limit window)

The HEL-1804 test clicks `+` on the counter as the shared `owner` principal. By then that principal had spent almost
all of its `/api` budget on the geometry tests: the backend limiter (`InMemoryRateLimiter`) is a fixed window of 120
requests per 60 s starting at the principal's FIRST request, and the owner's setup plus six page-loading tests sit at
115-119 of 120 even on this desktop (`t1-probe-evidence.txt`, two runs: remaining 1 and 5). On the CI runner a few
extra polls (`runs/latest`, `run-events`) pushed it over: the CI trace shows 429 on `POST panels/<id>/submit` with
`Retry-After: 4` at 07:40:20Z, so the window began about 07:39:24Z and was exhausted 56 s in. A 429 submit never sets
the status text ("The row was added.") -- it sets the alert -- so the status region stayed `<p role="status"></p>`:
exactly the CI message (9 polls, `Received string: ""`).

Reproduced (`t1-red-burn-stress.txt`): a context route spends the owner's remaining budget right before the first
submit is forwarded (`t1-stress-mechanism.py.txt`; `STRESS-ACTIVE burn: spent 5 remaining owner requests` is in the
output). The unfixed spec fails with the CI message. Hypotheses H1a (transient status), H1b (region replaced) and H1c
(layout race) are not what happened: the region was never replaced and the text was never set.

Fix (test only): the HEL-1804 test registers its own owner and one-panel dashboard (`newActor`, own counter source) so
it spends its own window. `openStack` takes the dashboard and expected item count. Assertions are unchanged; the
skeptic's optional suggestion was applied (the alert regex is now `/HEL1804 rejected step/`, the routed message, which
the region renders).

Mutation (`t1-mutation.txt`): status region `position: absolute` -> red at `status message: in flow`. 20x plain
(`t1-plain.txt`) and 20x under CPU 4x on every page (`t1-stress.txt`) all green. Under the burn stress the unfixed
test reds and the fixed one is unaffected (it no longer shares that principal).

## T2 hel1582-mobile-pipeline-motion-and-states:244 -- MECHANISM CONFIRMED, natural race timing UNCONFIRMED

The failing step is the first `checkPanel("preview tab")`: the tap on the "N fields" trigger opened nothing. The CI
trace's tap point is (319, 311.79). A probe that logs the trigger's centre every frame (`t2-probe.spec.ts.txt`,
`t2-stale-tap.txt`) shows the trigger first renders at (319, 312) at the right end of the header's first line, then
moves to (65, 343) the moment the header gains its row count (`step-preview__count`, "14 rows", which arrives with the
`steps/:id/preview` response). The CI screenshot after the failure shows the trigger on the second line. A tap at the
stale point lands on the "+ duration_min" diff chip and the panel never opens (`t2-stale-tap.txt`: "tap at the
pre-reflow point opened the panel: false", element there `step-card-diff-chip--added`). The test waited only for the
"Rows after step" region, which is present before the count.

Not confirmed: that the reflow landed in the few milliseconds between Playwright's hit-target check and the touch
dispatch. Nine delay-sweep runs at 1x (`t2-delay-sweep.txt`), twelve at CPU 6x (`t2-delay-sweep-6x.txt`) and a full
file at CPU 4x (`t2-red-throttle4.txt`, 8 passed) never hit the window, so there is no natural red for the unfixed
spec. Hypotheses H2a/H2b (animation never settles, 300 s timeout) are ruled out by the CI message (a 5 s assertion
failure at 19 s), H2c (auto-run refetch) by the request list in the trace (no run or refetch in that window).

Fix (test only): wait for `.step-preview__count` (the header's last late arrival) before tapping the trigger, with a
message. Nothing is loosened. Mutation (`t2-mutation.txt`): the panel placed off screen -> red at `dark preview tab:
right inside the viewport`. 20x plain (`t2-plain.txt`) and 20x under CPU 4x (`t2-stress.txt`) all green.

## T3 hel1572-appearance-preferences:126 -- CONFIRMED, cause is in the APP (unordered preference writes)

The CI trace (PR #1223 older head, run 44979065391) shows three `PATCH /api/users/me/preferences`: Serif (321 ms),
Mono (467 ms) and Serif again (243 ms). The second Serif was sent while Mono was still in flight and answered first;
Mono's write landed last, so `/api/auth/me` stayed `mono` for the 5 s poll. Each radio click dispatches its own PATCH
(`handleAppearanceChange` in `frontend/src/main.tsx` -> `saveAppearancePreferences`) with no ordering, so a slow earlier
write overwrites a later one. This is a real defect a fast user can hit; the test only exposed it.

Reproduced deterministically (`t3-red-held-mono-patch.txt` 1500 ms and `t3-red-held-mono-patch-200ms.txt`): the page's
first Mono PATCH is held before being forwarded (`t3-stress-mechanism.py.txt`; `STRESS-ACTIVE holding...` is in the
output). The unfixed spec fails with serif expected and mono received. With the hold the failure surfaces at the
other-device assertion (the 5 s poll happened to read before Mono landed); in CI it surfaced at the poll. Same cause.
H3a/H3c (read before apply) are not it: the server value itself was `mono`.

Test-side change that is correct independent of the app fix (Decision 3): each type-style click now waits for its own
save to be answered before the next change (`selectTypeStyle`). The test is about applying and persisting a style, not
about write ordering. The app defect is NOT fixed here and is reported as a follow-up candidate.

Mutations: `t3-mutation.txt` (save never sent) -> red at the save wait; `t3-mutation-2.txt` (device never adopts the
server value) -> red at the other-device `data-type-style` assertion. 20x plain (`t3-plain.txt`) and 20x with Mono's
PATCH held 300 ms plus CPU 4x (`t3-stress.txt`) all green.

## C12 deviation and cycle-2 notes (disclosed, history not rewritten)

- C12 ordering: only T1's red (`t1-red-burn-stress.txt`) was committed before its fix (7ba1d52de). T2's stand-in red
  (`t2-stale-tap.txt`, `t2-delay-sweep*.txt`, `t2-red-throttle4.txt`) and T3's reds (`t3-red-held-mono-patch.txt`,
  `t3-red-held-mono-patch-200ms.txt`) were committed TOGETHER with their fixes in 46c81740e. The runs themselves preceded
  the fixes.
- T3 proof the reds ran against the UNFIXED spec: the failing test sits at `probe-hel1826-1572-stress.spec.ts:139`,
  which is the unfixed declaration line 126 plus the 13-line hook the generator inserts; the fixed spec declares it at
  142, which would give 155.
- T2 has no natural red (race timing unconfirmed, above); `t2-stale-tap.txt` is the deterministic stand-in.
- Cycle 2: `selectTypeStyle`'s save wait now has `{ timeout: 10_000 }` and fails with "the <style> preference save was
  never answered within 10 s"; mutation 1 re-run (`t3-mutation.txt`) is red at that message, no app file in
  `git status`; full hel1572 file green (`t3-green-cycle2.txt`, 15 passed). Because the change only bounds an existing
  wait (no timing change on the passing path) I did a single full-file run, not a fresh 20x.
- T1 alert regex is failable: `t1-alert-regex-failable.txt` (route returns a different message) is red at
  `alert message: text`.
- `t1-stress-diff.txt` was regenerated after the original 20x; it is now regenerated from HEAD together with a fresh
  stressed full-file run of that exact generated copy (`t1-stress-fresh-run-cycle2.txt`, 6 passed, STRESS-ACTIVE lines).
