## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD beb94adfe49759ebc8e180500130a032fdfac3b4 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/hel1675-hover-flake/HEL-1790`.
- **Round-2 CR1 (trace-first) is addressed.**
  - design.md Context bullet 4 now names the `playwright-report-shard-2` artifacts of runs 44667845106 and 44664959871 (both attempts), their contents and the 2026-11-27 expiry.
  - Decision 1 has a Step 0 that downloads, persists and extracts the traces. It requires the named cause to be consistent with the real-run trace.
  - tasks.md 1.2a mirrors it, ahead of local reproduction.
  - The design notes that the passing run has no trace, so discriminator (c) still needs local or diagnostic evidence.
- **The round-1 fixes are still present:** the neighbour correction, the rest-equals-hover fact, the (a)/(b)/(c) completeness bar, the forced-guard rules, AC4 (task 4.1) and the leg-2 / neighbour split (tasks 3.1 and 3.2).
- **Log facts, re-derived myself from the four logs (grep):**
  - The passing log has test ids 104/105/109/112, with desktop dark 32.6 s, light 28.6 s and `120 passed (17.5m)`.
  - The failing logs have ids 104/108/112/114, with dark passing at 18.8 / 18.2 / 18.9 s and light failing at 9.2 / 8.7 / 8.8 s, and `119 passed (12.2m / 12.0m / 11.9m)`.
  - Every failure is `Error: 3 Select trigger must differ from rest on hover` at spec `:374`.
  - Each failing log prints a `trace.zip` attachment path.
  - The rest operand in `main-e2e2.log:2011` has border `rgba(33, 29, 25, 0.2)`. That equals `DESKTOP_HOVER.light["3 Select trigger"]` (spec `:256-263`).
- **Code facts:**
  - `inputs.css:12` sets the rest border to subtle, and `:30-35` is the `(hover: hover)` `:hover` rule that sets it to strong. The transition is on border-color.
  - `theme.css:148` sets `--app-transition: 0.16s ease`.
  - The spec reads `rest` right after `inst.open` (`:367-368`).
  - `noAnimations` waits only on animations already `running` (`:35-39`).
  - Instances 1 and 3 both use `openSheet` (`:98`). So discriminator (b), "why instance 3 and not instance 1 from the same pointer position", is a sharp and testable bar.
  - `scripts/e2e-shard.mjs` has `plan` (`:415-418`) and `DEFAULT_E2E_LEGS = 7` (`:234`).
- **The pass/fail discriminator is not a code change.** PR #1188 failed against a merge ref on main 94a8ef292, and main 94a8ef292 itself passed. Same product code, different outcome, so the plan's focus on timing and pointer state rather than a regressing commit is correct.
- **Sufficiency against the ticket's ACs:**
  - AC1, the probe-confirmed cause: Decision 1, the completeness bar and tasks 1.2a-1.4.
  - AC2, stability with a reported count: tasks 3.1 and 3.2.
  - AC3, no weaker assertion: Decision 4 and task 2.2.
  - AC4, CI green: task 4.1, with post-merge main handed to the orchestrator.
  - The ticket's ban on retries, skip and timeout increases is carried into Decision 4 and the Non-goals.
  - The HEL-1735 escalation hook is in Decision 3.
- **Placeholders, contradictions, ambiguity:**
  - No TODO or TBD.
  - `skip_specs` has an explicit reversal path.
  - Decision 3's test-fix shape is concrete: rest is read with the pointer provably off the control, and hover after the transition has provably ended, asserted rather than slept.

### Verdict: CONFIRM

The plan is investigation-first and evidence-ordered: real CI traces first, then the exact leg-2 reproduction, then neighbours, then throttling for a named hypothesis only, then a CI diagnostics commit. It has an explicit bar for what counts as a confirmed root cause, a committed red probe, mutation proof, and no-weakening rules. It is sound and sufficient to reach a probe-confirmed cause and a non-weakening fix.

### Non-blocking notes

- Do Step 0 first. The traces expire on 2026-11-27, and persisting them is the one time-sensitive action.
- For the "pointer off the control" precondition, the spec header warns that `el.matches(":hover")` can lie under touch. Planner Notes already say to verify it on desktop. Pair it with `elementFromPoint`, and do not rely on `:hover` matching alone.
- If the fix moves the pointer off before the rest read, apply it to all six instances or justify it per instance. That keeps the six `not.toEqual` checks meaningful and avoids special-casing instance 3.
- `TICKET_TYPE: feature` in workflow-state.md is still set for a bug ticket. This is cosmetic.
