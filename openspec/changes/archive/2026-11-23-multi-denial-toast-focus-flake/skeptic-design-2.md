## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 1cdd7df9084fe812729ea4731f1eda502b94fd98 (the planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/multi-denial-toast-focus-flake/HEL-1842`.
- **Round-1 CR1 (false premises) is resolved.**
  - proposal.md Why now says there was no Playwright retry. That matches `playwright.config.ts:190` (`retries: 0`).
  - design.md Context records that shard company is not the differentiator, and names timing/load and cold start as the leading candidates.
  - design.md Context now says `Received: inactive` leaves the focus location unknown until task 1.1. The old "lands outside the page/toast" claim is gone.
  - ticket.md still says "Playwright's own retry failed too". That file is the ticket provider's text, and design.md corrects it, so this does not block.
- **Round-1 CR2 (cold-start repro) is resolved.**
  - D1 and task 1.2 now require a cold-start loop that restarts servers through `stop-servers.sh`/`start-servers.sh` and runs the leg-7 order.
  - The throttled `--repeat-each` runs stay as a second loop alongside it.
  - `[dev]` is the primary target, and `e2e:prod-build` is marked secondary in both D1 and Risks.
  - I checked the leg-7 order is reproducible locally: `node scripts/e2e-shard.mjs plan` prints `leg 7/8` containing both `hel1096-run-to-update-affordance.spec.ts` and `hel1172-multi-denial-toast.spec.ts (defaulted)`, with `DEFAULT_E2E_LEGS = 8` at `scripts/e2e-shard.mjs:234`.
- **Round-1 CR3 (acceptance signal) is resolved.**
  - D5a and tasks 1.2/3.3 record red as k failures in N runs per named condition.
  - The post-fix run uses the same conditions with N_post >= ceil(3/p). (1-p)^(3/p) is about e^-3, about 0.05, so zero failures gives roughly 95% confidence. That arithmetic is correct.
  - The arithmetic has to be committed.
- **The test step matches the ticket.** `e2e/hel1172-multi-denial-toast.spec.ts:105` is the test title. Line 146 is the Beta-link `toBeFocused` after the second Tab. `waitForTimeout(5500)` sits just before the Tab sequence, as design.md says.
- **The referenced files exist.**
  - Under `frontend/src/shared/ui/`: `Toast.tsx`, `ToastRowList.tsx`, `toastFocusHandOff.ts`, `toast.css`, `Toast.items.test.tsx`.
  - `features/toasts/state/toastsSlice.ts` and `features/pipelines/services/deniedPipelinesToast.ts`.
- **skip_specs is still correct.** `openspec/specs/run-to-update-affordance/spec.md:124` already requires "reachable by Tab in row order", and line 146 already has the next-row scenario. A fix restores existing requirement text.
- **D6 matches the planner's conventions.** The `e2e/shard-weights.tsv` header says "never hand-edit" and records a median across runs, and the plan's `defaulted` line lists 10 specs. Leaving the row defaulted and saying why is consistent with that.
- **D3, D4 and D5 are unchanged and still sound.** The product-vs-test rule hinges on what a real keyboard user can hit. The ban on waits has a narrow, named-condition exception that applies only when the cause is test-side. The guard must be shown red by mutation.
- **Constraints C1–C3 in tasks.md agree with design.md.** I found no TBDs or placeholders, and every AC maps to a task:
  - root cause: tasks 2.1/2.2
  - red then repeated green: tasks 1.2/3.3
  - no unrelated assertion weakened: C3 and task 3.1

### Verdict: CONFIRM

### Non-blocking notes

- **Cold-start cost.** If red appears only in the cold-start loop at a low rate, N_post can get expensive. For example, p = 1/20 needs 60 server restarts. The executor should prefer the two-spec subset (D1's "at minimum") over the full 147-test leg once the red condition is known to reproduce with it. The red and green runs must use the same subset.
- **Disagreement between the two Playwright configs.** If the `[dev]` Playwright project manages its own `webServer`/`reuseExistingServer` separately from the lane's `start-servers.sh`, the executor should confirm that a restart really yields a cold Vite module graph. The repro record should say so.
- **Wording of task 1.2.** It says "verify the file shows at least one failure at the line-146 assertion". If the local red appears at a neighbouring Tab assertion (line 144 or 148) with the same mechanism, that should still count. The probe, not the exact line, decides it.
