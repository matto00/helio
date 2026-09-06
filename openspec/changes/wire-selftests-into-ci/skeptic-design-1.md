## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Every line-number claim in design.md/tasks.md, against the real files — all correct:**
- `scripts/check-no-credential-in-agent-surface.selftest.mjs:140` `isRoot`, `:141` `skippedCases`, `:143` `skip(name, reason)` — confirmed by `sed -n '130,150p'`. Four `skip()` callers, all guarded by `if (isRoot)` (:540, :579, :615, :735).
- Terminal branch `:1058-1070`: `failures>0 → exit(1)`, `else if (skippedCases.length > 0)` at `:1061` printing `OK WITH SKIPS (... running as euid 0)` with no exit call (implicit 0). design.md's "`:1061-1069`" and its description are accurate, including the hardcoded euid-0 wording task 1.3 removes.
- `.github/workflows/ci.yml`: `:41` node-root-encoding:selftest, `:43` ts:selftest, `:46` dependabot:selftest, `:54-55` `check:no-credential-leak` + `:selftest` under a HEL-846 comment block (`:47-53`). AC1 is indeed already delivered on the base branch — I did not treat its absence-of-work as a defect.
- `627fc281 HEL-846 Add a mechanical credential-shaped-string commit guard...` is in `git log` on this branch's history. Claim verified.
- `.husky/pre-commit:13` = `npm run check:openspec:selftest`, `:18` = `check:no-credential-leak:selftest`. `check:openspec:selftest` appears in `package.json:19` and in **no** ci.yml step (`grep`, zero hits). The AC4 gap is real and correctly scoped.
- AC5 survey conclusion is recorded in proposal.md ("What Changes", bullet 4) as required.

**Gate-Chain Implications Checklist — five answers checked against the script, not just for presence:**
1. *What does it execute?* — `import { spawnSync } from "node:child_process"` (:16); spawns are `spawnSync("node", [scriptPath])` (:186) and `("node", [destPath])` (:265), cwd `repoRoot`. `grep` for `"git"`, `GIT_DIR`, `execSync` returns **zero** hits. No network/db/backend. Answer is accurate.
2. *Environment inherited* — correct; the two newly-read vars (`CI`, the test-only hook) are the only additions, and "derive a child env from `process.env` rather than mutating the parent's `CI`" is the right construction for a file that reads `CI` in its own terminal branch.
3. *Writes outside its sandbox* — fixture paths are repo-relative constants, cleaned in the `finally` at `:1041`. Accurate. (See non-blocking note 1 for the one case the answer under-states.)
4. *Worktree vs main checkout* — verified: paths resolve via `fileURLToPath`/`dirname`/`join` (:27-28), no git metadata touched, so the HEL-657/HEL-805 poisoned-`GIT_DIR` mechanism genuinely does not apply. Not a hand-wave.
5. *First run* — stateless, self-planting; accurate.

**Decision 4 (the forced-skip probe) — the load-bearing question: is the new hard-failure branch genuinely provable, or is it an unexecuted claim?**
It is genuinely provable, and the plan does not smuggle a tautology. I pushed on the obvious failure mode: task 2.1 asserts only *non-zero exit* plus *the skipped case is named in the output* — and with the hook set, the case is named regardless of which branch fired, so 2.1 alone could be satisfied by a child that died for an unrelated reason (e.g. fixture-path collision with the parent, since child and parent write the same fixed paths). What rescues it is the **pair**: task 2.2 spawns the identical child with `CI` cleared and asserts **exit 0**. A child failing for any non-`CI` reason breaks 2.2. So 2.1-red + 2.2-green isolate `CI` as the only differing input — that is a real differential, not an assertion. Task 2.4 then requires inverting the CI-fatal condition and confirming 2.1 goes red, which is the mutation bar this gate's own history (HEL-956/HEL-993, seven defects, none found by reading) established. The probe clears the bar the ticket sets.

**Other adversarial checks:** no `TODO`/`TBD`/"figure out later" anywhere in the change dir (grep, zero hits). No contradiction between proposal, design and tasks — Decision 2 (key on `skippedCases.length`, not `isRoot`) is broader than the ticket's literal wording, but it is strictly stronger and in the same direction, and the planner flagged it explicitly rather than sliding it in. Non-goals correctly fence off `package.json`/`tsconfig.json` (HEL-997 collision) and `.husky/**`; task 1.6 encodes the escalate-don't-edit rule. Spec deltas cover both modified capabilities with scenarios for all four states (CI-root fails, local-root warns, self-test enforced, bypassed hook caught). Every AC traces to at least one task; no task exceeds the ACs.

No design check I ran required a database, a backend spec, or a dev server; the HEL-974 constraint was respected.

### Verdict: CONFIRM

### Non-blocking notes

1. Checklist answer 3 ("this change adds no new write path") is true of the *hook* but under-states the *spawns*: the child self-test re-plants the same fixed-path fixtures in the same worktree that the parent uses. `spawnSync` is synchronous so there is no race, but if the probe cases are placed at a point where the parent still has fixtures planted, the child's own `finally` will delete them under the parent. Place the two probe cases at the end of the `try` block, after every other case has cleaned up — and if a lingering plant makes that impossible, say so rather than interleaving.
2. Consider having 2.1 assert on the specific new fatal message (or a distinctive token in it), not merely non-zero exit. The 2.1/2.2 pairing already makes the probe sound, but a message assertion makes it self-evidently sound to the next reader without reconstructing the differential argument.
3. Task 1.4 says the new comment should follow "the established house style of the HEL-913/HEL-846 comments in `.github/workflows/ci.yml`", but the comment it describes lands in the `.mjs` script. Harmless wording; the intended style is clear.
