## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: b10c64398e327d03e6cd809175fdd99a54205a15 (base fd7064f7d700e49a2f7dfc1f6a244aab02048fd2, resolved live).
Cycle-2 delta reviewed: `git diff 93bc696bf..HEAD`.
Evaluator evidence (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1633/evidence/.concertino/scratch/HEL-1633/eval-c2-specs.txt`.

### Phase 1: Spec Review — PASS

- **CR1 (hel1023) is resolved.** `openAt` now calls `waitForPanelGrid(page, 8, { timeout: 20_000 })` right after its
  `goto` (`e2e/hel1023-breakpoint-layout-derivation.spec.ts:363-364`).
  - The `goto` always happens at 1900 px, so the helper's desktop-only rule holds. `openAt` has exactly two callers,
    :440 and :515, and both loop windows starting at `windows[0]` = 1900. The second caller filters out only `stack`.
  - The doc comment states the 1900 px premise.
  - The `sweep.md` verdict is now FIX, and it explicitly withdraws the earlier wrong "phone widths" reason.
- **CR2 (hel1573) is resolved.** At `e2e/hel1573-motion-grid-chart.spec.ts:32`, the stub-satisfiable
  `.panel-grid-card` count of 3 is replaced by `waitForPanelGrid(page, 3)`. The 800 ms entrance wait is kept, and the
  viewport is 1900 px (`:15`). The `sweep.md` verdict is now FIX.
- **The non-blocking suggestion was adopted.** hel1584-motion-surfaces :110/:612 and hel1573 :288 are now recorded as
  `hasText`-filtered, and the reasons given are accurate.
- **The sweep is complete.** It still covers all 74 hits, and none is left as "follow-up candidate" or "not proven".
- **Constraints C1, C2 and C3 are still honored.** The guard spec and helper did not change in this cycle.
- **Scope is unchanged.** HEL-1644 and hel1681 are untouched, and there is no product code change.

### Phase 2: Code Review — PASS

Gates I ran fresh at HEAD:
- On all changed e2e files: ESLint (`--max-warnings=0`) clean, Prettier `--check` clean (including the change dir).
- `check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths`: all clean.
- hel1023 (both tests), hel1573-motion-grid-chart and the hel1633 guard, `--repeat-each 2` at 2 workers under
  `nice -n 19`: 20 passed, 0 failed or flaky. Servers were started and stopped with the canonical scripts.
- hel1023 passing shows the new 8-item positive anchor is actually reached: 8 real live-layer items mount, so the wait
  is not vacuous.

Each change is a 1-3 line import-and-call that reuses the shared helper. There is no duplication and no dead code.

### Phase 3: UI Review — N/A

No trigger path changed. This is a test-only change.

### Overall: PASS

### Non-blocking Suggestions

- `sweep.md`: the hel1584-motion-surfaces bullet groups :399 with the "Edit layout" reasoning. The bullet itself goes on
  to say that :399/:420 come after a duplicate, so this is only a wording nit.
