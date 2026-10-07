## Evaluation Report — Cycle 2 (evaluation-2.md)

**Commits reviewed**
- HEAD: `6144e5eee5a6bba989bc6dbcfb874e77f0dc585f`
- Live-resolved base: `a606a9833910e36ad544e6aff6e4b87049245559`

**Delta since cycle 1 (`27b860d16..6144e5eee`)**
- `e2e/support/auth.ts`
- `e2e/support/isolateLivePage.ts`
- `verification.md`, `files-modified.md` and the committed `evaluation-1.md`

No spec file changed in this delta. Every cycle-1 per-spec finding therefore still applies unchanged, including:
- the guard population matches main;
- the 132/132 migrated-spec run;
- the C2 and per-file flag preservation checks.

**Evidence directory (durable):** `/home/matt/Development/helio/.concertino/runs/HEL-1330/evidence/.concertino/runs/HEL-1330/eval-logs/`. This cycle added `eval2-consumers.log` and `eval2-emails.txt`.

### Phase 1: Spec Review — PASS

CR1 is resolved:
- `uiLogin` now lives in `e2e/support/isolateLivePage.ts:26-35`.
- `loginThenIsolate` (`:38-44`) is now `uiLogin` + `isolateLivePage`.
- `auth.ts:2` imports `uiLogin` from `./isolateLivePage` and no longer defines its own.
- `isolateLivePage.ts` imports nothing from `auth.ts`, so there is no import cycle.
- Only one copy of the form-login sequence remains under `e2e/` (`grep uiLogin` shows one definition and two callers).

The code now matches design.md D4 as written. The deviation note in verification.md §1.10 is replaced with an accurate description. The other ACs are unchanged from cycle 1, and constraints C1-C4 are honored.

### Phase 2: Code Review — PASS

Gates, all fresh runs:
- `npm run lint` rc 0
- `npm run format:check` clean
- `npm run check:e2e-types` rc 0

Playwright run:
- Specs: one pass over the `uiLogin` path through `registerAndLogin`, covering every flag combination: `waitForShell` (hel510), `waitForShell` + `isolate` (hel1080), `isolate` (hel1230), the hel503 thin wrapper, and plain with call-site isolate (hel1023).
- Settings: `nice -n 19`, `--workers 2`, headless, default per-test contexts, servers on 6762/9669 (`assert-phase.sh servers` PASS).
- Result: **23 passed, EXIT 0**.
- Throwaway emails: 23 recorded; none is `matt@helio.dev`.

Not run this cycle (by the driver's screenshot rule): the two `loginThenIsolate` consumers, `hel1277-output-history-scrubber` and `hel1350-chart-compare-picker`. Both write screenshots outside this change dir:
- hel1350 writes to `openspec/changes/chart-output-compare-picker/screenshots`. That is the foreign directory the orchestrator relocated.
- hel1277 writes to `openspec/changes/archive/2026-10-06-output-history-scrubber-diff/screenshots`.

The refactored `loginThenIsolate` runs the same statements in the same order as before, now split across `uiLogin` and the call. The type check covers its signature, and the 23-test run exercises `uiLogin` itself.

Disclosure: in cycle 1 my 27-spec run included `hel1275-metric-delta-sparkline`. That spec rewrote 8 gitignored PNGs under `openspec/changes/archive/2026-10-05-metric-delta-sparkline-ui/screenshots/` at 10:53-10:54 PDT. They are untracked, `git status` is clean, and nothing was deleted. The driver's screenshot rule was given only this cycle; I am flagging the write anyway. The `output-history-scrubber-diff` screenshots, timestamped 11:00-11:01, were not written by my runs.

### Phase 3: UI Review — N/A

No trigger path changed.

### Overall: PASS

### Non-blocking Suggestions
- Carried over from cycle 1:
  - follow-up to migrate hel1277's and hel1350's local `registerThenLogin`;
  - follow-up for the ~12 remaining local `uniqueEmail` copies.
- Separate follow-up: hel1275, hel1277 and hel1350 write screenshots into archived or foreign change dirs every time they run. Any lane that runs them dirties another change's directory.
