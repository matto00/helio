## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 46c81740ee3b2c25aeecd08049009c351e8932b3. The base is 07a1180016b8032c9c16f2514aa8a8c0319cb776, resolved live with
`resolve-review-base.sh`. Commits: 7ba1d52de (T1 red and CI evidence) and 46c81740e (the three fixes plus T2/T3 evidence).
The diff touches only `e2e/` (3 specs) and the change dir. It touches no app, sibling-lane or `openspec/specs/**` file.

### Phase 1: Spec Review — FAIL

What I checked:
- AC1 (root cause with evidence): met for all three tests (`root-cause.md`, backed by committed probe output).
  - T1 is confirmed by the CI-trace 429s (`t1-probe-evidence.txt`) and by the burn red (`t1-red-burn-stress.txt`), which
    shows the exact CI message (`Received ""`, 9 polls).
  - T2's mechanism is confirmed by `t2-stale-tap.txt`. A tap at the pre-reflow centre (319,312) hits
    `step-card-diff-chip--added` and opens nothing, and the CI tap point was (319,311.79). The natural race timing is
    explicitly labelled **UNCONFIRMED**, with the sweeps that failed to hit it (`t2-delay-sweep*.txt`,
    `t2-red-throttle4.txt`). That satisfies C18.
  - T3 is confirmed. The CI trace's PATCH timings are cited, and the deterministic hold red
    (`t3-red-held-mono-patch*.txt`) shows `Expected "serif" Received "mono"`. The cause is correctly attributed to the
    app and reported as a follow-up, not patched.
- AC2 (20x green, 2 workers, nice, under stress): 20/20 plain and 20/20 stressed for each file, and every stressed run
  logs `STRESS-ACTIVE` lines. All are full-file runs (6, 8 and 15 tests), so C15 holds.
- AC3 (mutation): every test goes red at a guarding assertion.
  - T1 goes red at `status message: in flow`.
  - T2 goes red at `dark preview tab: right inside the viewport`.
  - T3 goes red at the save wait (mutation 1) and at the other-device `data-type-style` (mutation 2).
  - Every mutation file ends with `git status --short` showing no `frontend/` file, so C17 holds.
- Probe specs: there is no `e2e/probe-hel1826-*.spec.ts` in the tree or in the diff. Probes were committed only as
  `.txt` (`t2-probe.spec.ts.txt`, `*-stress-mechanism.py.txt`).
- No assertion is removed or loosened.
  - T1 tightens the alert check from `/\S/` to `/HEL1804 rejected step/`.
  - T3 adds a `status() === 200` check per save.
  - T2 adds a wait with a message.
- Scope and tasks: all tasks are ticked and match the diff. There is no scope creep, and no contract or schema impact.

**Issue (C12, binding driver constraint):** "Record and COMMIT the red run before writing fixes" holds for T1 only.
- T1's red (`t1-red-burn-stress.txt`) is in 7ba1d52de, before the fix commit.
- T2's red stand-in (`t2-stale-tap.txt`, `t2-delay-sweep*.txt`, `t2-red-throttle4.txt`) and T3's reds
  (`t3-red-held-mono-patch.txt`, `t3-red-held-mono-patch-200ms.txt`) were first committed in 46c81740e, together with
  their fixes.
- The content does show that the T3 reds ran against the UNFIXED spec. In both red files the failing test is at
  `probe-hel1826-1572-stress.spec.ts:139`. That equals the unfixed declaration line 126 plus the 13-line hook
  `t3-stress-mechanism.py.txt` inserts. The fixed spec declares the test at 142, which would give 155.
- So the red was real, but the committed ordering C12 requires does not exist, and `root-cause.md` does not disclose
  this.

Everything else in Phase 1 passes.

### Phase 2: Code Review — FAIL

Gates I ran myself (the diff is `e2e/**` plus `openspec/changes/**`; no `frontend/**` or `backend/**` file changed, so
the frontend/backend gate set is not triggered):
- `eslint --max-warnings=0` on the 3 specs: exit 0.
- `prettier --check` on the 3 specs and the change dir: clean.
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0.

Fresh full-file runs of the committed specs (2 workers, `nice -n 19`, lane DB, `ANTHROPIC_API_KEY` empty, servers via
`start-servers.sh` on 7258/10165). Output is in `.concertino/scratch/HEL-1826/eval-t1-runs.txt` and
`eval-t2-t3-runs.txt`:
- hel1791: 6/6 runs green, 6 passed each.
- hel1572: 2/2 runs green, 15 passed each.
- hel1582: 1/1 run green, 8 passed.

Your questions:
- **T1 regex tightened after the 20x.** I treat the 20x as still covering the committed spec, now backed by my 6 fresh
  full-file passes of exactly HEAD.
  - The change is a text-only strengthening of a retrying `toHaveText` against a static string. The test's own
    `route.fulfill` supplies that string, and `FormPanelView` renders it in `.form-panel-view__alert`.
  - CPU stress cannot change that text. The only way the regex could add flakiness is a different rendered text, and
    the runs rule that out.
  - It is not shown failable, though: no mutation exercises the alert regex itself (non-blocking, see below).
  - `t1-stress-diff.txt` was regenerated at 17:49 against the current spec. It is not necessarily the exact copy run at
    14:21. Line numbers in `t1-stress.txt` are not printed, so this cannot be checked from content.
- **T1 fix meaning.** The assertions are byte-identical, and the counter panel config matches the shared one (same
  source columns, `step: 5`, `resetOnSuccess: false`). Only the principal changes, to a fresh `newActor`, which the
  run's teardown cleans up ("deleted 4 recorded throwaway users").
  - The burn stress is inert against the fixed test (it routes `owner.context`), so "unaffected under burn" is true by
    construction rather than demonstrated. The CPU 4x stress is the one shown active.
- **T2.** The wait is on the header's last late arrival (`.step-preview__count`, which the probe shows coinciding with
  the reflow), with a message. The mechanism probe is sound: it captures the pre-reflow centre, releases the held
  preview, confirms the reflow and touches the old point, and the panel does not open. It is labelled unconfirmed per
  C18.
- **T3: does it still guard HEL-1572?** Yes. HEL-1572's assertions are that a style applies with no reload (`__noReload`
  checks and font reads), persists server-side (`/api/auth/me` poll) and is adopted by a fresh context. All are intact.
  - Awaiting each save is a real precondition, allowed by Decision 2 ("a request's response"). It also adds a 200
    check, and the predicate is exact (the PATCH body is exactly the patch, e.g. `{typeStyle:"mono"}`).
  - What the test no longer covers incidentally is rapid-toggle convergence, which is the app's unordered-PATCH bug.
    That was never an assertion of HEL-1572. The follow-up should add a guard for it once the app orders its writes.

**Issue (Decision 2 "bounded waits with explicit messages"):** `e2e/hel1572-appearance-preferences.spec.ts:46`,
`selectTypeStyle`.
- `page.waitForResponse(predicate)` has no timeout and no message. A save that is never answered hangs until the 30 s
  test timeout.
- The committed mutation shows this: `t3-mutation.txt` reports `page.waitForResponse: Test timeout of 30000ms exceeded`,
  not a named precondition.
- The `expect(..., "the ${style} preference save")` message only applies once a response exists.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The change is test-only.

### Overall: FAIL

### Change Requests
1. **C12 disclosure** (`openspec/changes/deflake-hel1820-e2e-specs/root-cause.md`, T2 and T3 sections). State plainly
   that the T2 stand-in red and the T3 reds were committed together with their fixes in 46c81740e, not before them
   (C12 deviation).
   - For T3, cite the self-authenticating proof that the reds ran against the unfixed spec: the failing line
     `probe-hel1826-1572-stress.spec.ts:139` = unfixed :126 + the 13-line hook (the fixed spec would give :155).
   - For T2, state that no natural red exists and that `t2-stale-tap.txt` is the deterministic stand-in.
   - Do not rewrite history to fake the ordering.
2. **Bound the save wait with a message** (`e2e/hel1572-appearance-preferences.spec.ts:46-54`). Give
   `page.waitForResponse` an explicit timeout (e.g. `{ timeout: 10_000 }`) and turn a timeout into a named failure,
   e.g. `.catch(() => { throw new Error(`the ${style} preference save was never answered`); })`.
   - Then re-run mutation 1 (save never sent). Commit it as `.txt` showing red at that named message, with
     `git status --short` free of app files.
   - Then do one full-file green run.

### Non-blocking Suggestions
- T1: show the tightened alert regex is failable. For example, a stress-copy run whose `route.fulfill` uses a different
  message must go red at `alert message: text`.
- T1: `t1-stress-diff.txt` was regenerated after the runs. Note that in the evidence, or regenerate it alongside a fresh
  stressed run of HEAD.
- T1: the new test repeats the counter source columns and panel config from `beforeAll`. A small shared constant would
  keep the two from drifting.
- For the orchestrator: the T3 app follow-up (unordered `PATCH /api/users/me/preferences`, last arrival wins) should
  also restore a rapid-toggle convergence guard in e2e once the app orders its writes.
