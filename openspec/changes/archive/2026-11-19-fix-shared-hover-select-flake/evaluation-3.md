## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `a6500058c2ebc6e1adffced8153d871e913c11fe` against the live base `beb94adfe49759ebc8e180500130a032fdfac3b4`.
New in this cycle: commit a6500058c (the control's own animations added to the first-sample log, and the
`transitionProperty || a.id || "anim"` naming), plus the corrected `root-cause.md`.

### Phase 1: Spec Review — PASS

- Cycle 2 CR1 is resolved.
  - `root-cause.md` (b), line 17, now reads "40 light reps under a 90 ms main-thread hog: hoverFrames > 0 in 5/40, three
    with 2 frames and two with 4; the other 35 had 0". That matches my recount of `probe-natural-hog90-40reps.log`.
  - The uncited "unloaded runs: 0" clause is gone (grep: 0 hits for `unloaded` and `12/40`).
- The write-up's statements about (a) and (c) are unchanged from cycle 2 and remain honest: neither is explained by a
  probed discriminator, and both are labelled as such. (b) is evidenced. Whether an unexplained (a)/(c) meets design
  Decision 1 is the orchestrator's ruling, as the document itself states. The fix does not depend on (a) or (c).
- Assertions are unchanged: `not.toEqual(rest)` for all six instances, and `toEqual(DESKTOP_HOVER[theme])`.
- Task 3.1 (three leg-2 passes, all green) and 3.2 (10 repeats) were verified in cycle 2. Task 4.1 (CI on main) is
  deferred to Delivery by design. The PR #1191 `e2e (2)` leg was green at 6d9e955 (run 44685378992, job 136118335545).

### Phase 2: Code Review — PASS

Fresh gates, run by me:
- eslint `--max-warnings=0`, prettier `--check` (the e2e files and the change dir) and `tsc -p e2e/tsconfig.json`: all exit 0.
- `check-openspec-hygiene`: clean.
- Lane servers (`helio_hel1790`, 7222/10129, `ANTHROPIC_API_KEY` empty, 2 workers, nice 19): `hel1675-shared-hover`
  plus the guard spec, `--repeat-each=2`, **12/12 passed**. Servers were stopped afterwards. Log:
  `/home/matt/Development/helio/.concertino/runs/HEL-1790/evidence/.concertino/scratch/HEL-1790/eval3-run.log`.

The new `own` field works and resolves the ambiguity raised in cycle 2:
- In my run, light instance 4 waited 164 ms. At the first sample `running` was true, the document-wide `props` listed
  four border-colour transitions, and `own` was `[]`. So another element was animating, not the control, and its
  border was at rest.
- A future CI line can now tell those two cases apart.
- `name()` is shared by `props` and `own` (DRY), and the `||` fallback now takes effect for an empty `id`.
- The executor's cycle-3 log (`instrumented-local-run-cycle3.log`) independently shows all 12 lines at waited=0ms,
  with `own: []`.

### Phase 3: UI Review — N/A

No trigger matched: there are no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Non-blocking Suggestions
- The `own` comment says "running or not (... pending/idle)". `Element.getAnimations()` omits finished animations,
  so "pending or running" is more precise. This is cosmetic.
- `proposal.md`, `design.md`, `ticket.md`, the `skeptic-design-*.md` files and `evaluation-*.md` are still untracked in
  the worktree. Commit or archive them at Delivery.
- The orchestrator still has to rule on whether the explicitly unexplained (a) and (c) satisfy design Decision 1.
  This report certifies that the write-up is accurate, not that ruling.
