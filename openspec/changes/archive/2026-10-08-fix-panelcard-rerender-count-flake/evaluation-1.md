## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `c8daa8bad4a2b3ad1f569c2967b881e63cc736ff`. Diff base, resolved live with `resolve-review-base.sh`: `0a1eacd7da55c2612894d991f2f2df88df7f69c6`.
Code diff: `frontend/src/features/panels/ui/PanelCard.test.tsx` +9 (a comment plus one identical-props `rerender`
before the baseline sample). Everything else in the diff is openspec artifacts.

### Phase 1: Spec Review — PASS

- AC "probe-confirmed root cause": met. The executor's timeline (persisted `PanelCard.scratch.test.tsx.txt`,
  `useOutputMeta.probe.diff`) traces the extra render to `useOutputMeta`'s `Promise.resolve().then(() => setIsLoading(true))`.
  That microtask runs outside act, so React handles its same-value bail-out render on the real Scheduler
  (a MessageChannel macrotask), and under load that render can land after the baseline sample.
  I confirmed this independently (see Phase 2 "Independent verification"): delaying Scheduler's MessageChannel
  task by 15ms turns the old settle red 5/5 with exactly `Expected: 2 / Received: 3`.
- AC "measured red, then 0/N after, same recipe": met. Executor's figures: BEFORE was 4/40 single-test and
  1/30 whole-file; AFTER was 0/50 and 0/90, with 3 nice-19 burners. Both AFTER N values meet C6's
  `max(50, ceil(3/p))` floor (50 and 90). I reproduced a natural red myself under the same recipe
  (BEFORE 1/40, AFTER 0/40).
- AC "do not loosen the assertion": met. It stays an exact `toBe(callsBeforeRerender)`.
- AC "must still catch a broken memo boundary": met. M1 is red 5/5 (executor's run and mine).
- AC "minimal/no PanelCard.tsx diff": met. The diff does not touch PanelCard.tsx.
- Tasks 1.1–3.3 are all marked done and match the implementation. No scope creep, and no spec deltas
  (`skip_specs: true` is appropriate).
- CONSTRAINTS C1–C6 are all honored:
  - C1: the cause is probe-confirmed and a natural red was measured.
  - C2: the assertion is unchanged.
  - C3: the recorded recipe used 3 burners plus 1 jest process, all nice 19, burners killed by pidfile.
  - C4: commit c8daa8bad went through the hooks, with no bypass disclosed or needed.
  - C5: PanelCard.tsx is not edited.
  - C6: rates come from the un-instrumented committed and fixed tests.

### Phase 2: Code Review — PASS

Gates, run by me in WORKTREE_PATH:
- `npm run lint` (frontend, `eslint src --max-warnings=0`): exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check` (frontend): all files clean. Root `.prettierignore` excludes `openspec/`, so the change-dir
  markdown is out of scope.
- Frontend jest, full suite, `--maxWorkers=3`, nice 19: 464 suites and 4900 tests passed.
- `npm --prefix frontend run build`: exit 0.
- Root `npm run lint` / root `npm test`: the root has no `node_modules` in this worktree. The only changed code
  file is under `frontend/src`, and the frontend gates above cover it.

Independent verification. I used a throwaway detached worktree at c8daa8bad under the session scratchpad
and removed it afterward (`git worktree list` is clean). Mutations were applied only there; WORKTREE_PATH
was never modified.

| check | result |
|---|---|
| Old settle (fix line removed) + Scheduler MessageChannel delayed 15ms | red 5/5, `Expected: 2 / Received: 3` |
| Fixed test + 15ms delay | green 5/5 |
| Fixed test + 60ms delay | green 3/3 |
| M1: `onDataPointSelect={(...a) => handleDataPointSelect(...a)}` (fresh prop every render) | red 5/5, `Expected: 3 / Received: 4` (also red 3/3 with 15ms injection) |
| M3 (mine, masking check): `frozen={isDragging \|\| isEditingTitle}`, a prop that changes ONLY on the title-edit rerender | red 5/5, `Expected: 3 / Received: 4` (also red 3/3 with 15ms injection) |
| Natural load, 3 nice-19 burners + 1 jest, single test, BEFORE (base test file) | 1/40 fail (`Expected: 2 / Received: 3`) |
| Natural load, same recipe, AFTER (fixed test) | 0/40 fail |

Masking question (raised in the brief): the settle rerender cannot absorb a render caused by the title-edit
rerender, for three reasons:
1. It runs strictly before `callsBeforeRerender` is sampled.
2. It passes byte-identical props: same `panel` object, same module-level `noopProps`, `isEditingTitle={false}`.
3. RTL's `rerender` is act-wrapped and returns synchronously, so it cannot outlive the sample.

A memo break that re-renders on every parent render (M1) still adds +1 at the title edit. A break specific
to title-edit props (M3) is still caught, including under the delayed-Scheduler injection. The mechanism also
holds up: the deferred update sits on a pending lane, and an act-wrapped root update processes it
synchronously. The injection runs show this directly.

Code-quality checklist:
- CONTRIBUTING comment standard is met. The new comment is a hazard/why comment (an act-boundary ordering trap) and
  states its decision inline rather than only via the `HEL-1215` id. There are no [mechanical] violations.
- No dead code, no new escape hatches, and no over-engineering: it is one line plus a comment, with no
  retry loop or timer.

### Phase 3: UI Review — N/A

The only code change is a test file. No UI behavior changes and no Phase 3 triggers apply to runtime surfaces.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `PanelCard.test.tsx` ~line 597-604: the pre-existing HEL-1027 comment still says the two-tick flush yields "a
  genuinely SETTLED baseline". The new HEL-1215 comment directly below corrects that claim. Consider trimming the
  older comment's final sentence so the two do not read as contradictory.
- `probe-evidence.md` cites `m1-*.log` and before/after AFTER-run logs. The persisted evidence dir
  (`.concertino/runs/HEL-1215/evidence/.../`) contains only `before-single-{17,20,37,38}.log`, `before-file-17.log`
  and `results.txt`. There are no M1 or AFTER logs, so those claims rest on `results.txt` plus this evaluator's
  independent re-run above.
