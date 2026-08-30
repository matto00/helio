## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **File enumeration is correct against the live tree.** In the main repo checkout (`/home/matt/Development/helio`), `find scripts/concertino -type f | wc -l` = 25. `git ls-files scripts/concertino/` in the ticket worktree lists exactly 8 tracked files (`README.md`, `cleanup.sh`, `assert-phase.sh`, `setup-worktree.sh`, `start-servers.sh`, `.concertino.env`, `lib/git-child-env.sh`, `lib/git-child-env.selftest.sh`). The remaining 17 filenames match the ticket's baseline list exactly, and `17 absent − 2 strays (pricing-table.json, report-cost.sh) = 15` delivery scripts to track, which I independently counted. AC1/AC6's "15 tracked / 2 excluded / 17 absent" claim is correct.

2. **CON-148 is genuinely live.** `readlink -f "$(which concertino)"` → `/home/matt/Development/concertino/bin/concertino`. `git -C /home/matt/Development/concertino log -1` → `bc6342b22f6... CON-148 Expose cleanup.skipSync so a repo can disable auto-sync durably`. `lib/config.js` and `lib/cli/render.js` in that checkout implement `cleanup.skipSync` → `CONCERTINO_CLEANUP_SKIP_SYNC=1` exactly as the design describes, with tests (`test/config.test.js`) covering the true/false/absent/invalid cases.

3. **`cleanup.sh`'s consumption of the env var is real**, not aspirational: `CLEANUP_SKIP_SYNC="${CONCERTINO_CLEANUP_SKIP_SYNC:-}"` at line 501 of the worktree's `cleanup.sh`, gating the automatic `concertino sync --out="$REPO_ROOT"` call inside the `if [ "$FF_STATUS" = "updated" ]` block. Confirmed by direct read of the file.

4. **Decision 6's bookkeeping bug is real**: in the main repo, `concertino.config.json` is tracked (`git ls-files` returns it) yet still appears in `.gitignore`, and its current content has no `cleanup` key — matching the design's description of the state to be fixed.

5. **Live corroboration of the defect this ticket exists to fix**: attempting to call `scripts/concertino/next-report-number.sh` from inside the ticket's own worktree failed with "No such file or directory" (exit 127) — that script is one of the 17 currently-absent files. I had to fall back to the main repo's untracked copy to generate this report's filename. This is a first-hand, not narrated, confirmation of the problem statement.

6. **README.md already self-declares as a rendered artifact** ("`concertino init` copies these... `concertino sync` writes... alongside them"), consistent with Decision 7's reasoning for why helio-specific prose can't safely live there.

### Ordering constraint (Decision 4) — sufficient, correctly scoped

The design is explicit that within a single landed commit/PR the ordering isn't independently observable — the constraint only matters for the *implementer's own worktree* during the development window, because a Phase-4 cleanup of a **different concurrent ticket** could fire `concertino sync` and, if `.gitignore` had already been relaxed but `skipSync` had not yet taken effect, render into files that are now tracked-but-uncommitted in this ticket's own tree (not cross-worktree — cleanup.sh operates on its own repo root). Read `cleanup.sh`'s gate: it only fires the auto-sync at all when `FF_STATUS = "updated"` (i.e., that run's own fast-forward), not from a sibling worktree's actions. So the actual hazard is narrower than "cross-ticket corruption" implies at first read — it's this-ticket's own working tree, mid-implementation, if task-group order 1-then-2 is violated. Decision 4 correctly identifies and orders around that; I found no scenario in which the stated ordering fails to prevent it. This is sound.

### AC3's render-idempotence check — right proof obligation, but incompletely mapped

AC3 bundles two distinct properties: (a) "cleanup.sh does not run `concertino sync` automatically in this repo" and (b) "the setting survives a re-render." Task 1.4's double-`concertino sync` run only establishes (b). Property (a) is never actually exercised by running `cleanup.sh`; it's established later, in task 4.4, by static code reading — and that task is filed under AC4, not AC3. This is a mapping gap, not a soundness gap: nothing in the tasks actually invokes `cleanup.sh --phase4` and observes the skip in action for *either* AC3 or AC4 (see below). The idempotence check itself (run sync twice, confirm the key persists) is the right check for the config-durability half of the design's own goal ("survives arbitrarily many re-renders") and I found no better alternative — a unit test upstream can't see helio's own config. That part of the design holds.

### AC4 / task 4.4 — attestation, not measurement, and the tasks say so themselves while treating it as sufficient

AC4 literally reads: "A `cleanup.sh --phase4` run leaves no uncommitted changes under `scripts/concertino/`." Task 4.4 does **not** run `cleanup.sh --phase4`. It substitutes: "show the `CLEANUP_SKIP_SYNC` branch... resolving to 1... and that no `concertino sync` invocation is reachable when it does." That is code-path reasoning (reading the script and confirming a variable's value), not executing the postcondition AC4 actually asserts. Tasks.md group 4's own header says "Verify by measurement (no attestation)," which makes the substitution in 4.4 an internal contradiction: the task explicitly disclaims attestation in its title while task 4.4 is exactly that — attestation dressed as measurement.

This matters concretely here, not just in the abstract: this very ticket's own delivery will go through a real `cleanup.sh --phase4` at the end of its lifecycle (per the standard delivery workflow), which is the one moment `FF_STATUS = "updated"` will actually be true and the skip path will actually execute (or not) for real. Task 4.4 as written captures none of that — it produces its "evidence" before that real run ever happens, from a throwaway worktree where `FF_STATUS` is never "updated" at all (no worktree fast-forwards main from inside the AC1/AC6 measurement worktree). So even the throwaway-worktree exercise in task group 4 cannot actually reach the code path task 4.4 claims to demonstrate; it can only be demonstrated by inspection there.

### Change Requests

1. **Rewrite task 4.4** to require a real execution, not inspection. At minimum: set `CONCERTINO_CLEANUP_SKIP_SYNC=1` in the environment (or rely on the tracked `.concertino.env` once task 1 lands) and directly invoke the exact code path in `cleanup.sh` that runs under `FF_STATUS = "updated"` (e.g. by temporarily forcing `FF_STATUS=updated` in a controlled/dry invocation, or by capturing the actual note line `cleanup.sh` prints — `"... concertino sync\` re-render skipped (CONCERTINO_CLEANUP_SKIP_SYNC set)..."` — during this ticket's own real Phase-4 run) and record that literal output as AC4's evidence, rather than a paraphrase of the branch logic. If a controlled dry-run isn't feasible before Phase-4 actually fires for this ticket, say so explicitly in tasks.md and defer AC4's final evidence capture to this ticket's own terminal Phase-4 run (which is a real opportunity, since `FF_STATUS` will be "updated" then) — do not let 4.4 stand as satisfied by static reading alone.
2. **Split AC3's two properties in tasks.md** so each has an unambiguous, dedicated verification step: (a) "config value survives re-render" → task 1.4 as written (this part is fine), and (b) "cleanup.sh does not auto-run sync" → point explicitly at task 4.4 (once fixed per CR1) rather than leaving it to be inferred that group 4 covers "the other half" of AC3.

### Non-blocking notes

- Decisions 1, 2, 3, 5, 6, 7 are all well-reasoned, each rejects a real alternative with a concrete reason, and each is consistent with what I verified in the live tree and the upstream Concertino checkout.
- The ordering constraint (Decision 4) is correctly scoped and I found no gap in it beyond the mapping issue in AC3/AC4 above.
- AC6's mechanism (negative `.gitignore` patterns with a rationale comment) is a reasonable, durable choice and is not being re-litigated here — only the verification of AC4/AC3 around the adjacent skipSync mechanism is in question.

### Verdict: REFUTE

The design is fundamentally sound — the file enumeration is accurate, the upstream CON-148 mechanism is genuinely live and correctly wired, and the ordering constraint holds. But task 4.4 as written does not actually measure what AC4 (and half of AC3) claims to require; it's attestation via code reading, explicitly contradicting task group 4's own "no attestation" header. That's a concrete, fixable gap in the verification plan, not a request to re-open any settled decision (AC6 mechanism, ordering, or tracking-vs-copy are all untouched by these change requests).
