## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: f34e9dc3d3df60000809e2bc7551687ac1ed7038. Base resolved live via resolve-review-base.sh (main/origin): 5f3990f8ee873b3124e936875bbfb1cef2335d25.
Code diff: `e2e/hel1260-orphan-owner-repair.spec.ts` (+3/-2) and the archived `probe-check-isolation.py` (+28/-5). Everything else is this change's own planning artifacts.

### What I verified (with evidence)
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/hel1260-spec-probe-nits/HEL-1302`.
- **Lane servers:** start-servers.sh reused healthy servers and `assert-phase.sh servers` printed `PASS servers`. I checked ownership through `/proc/<pid>/cwd`. Port 6734 (pid 1355492) runs from `.../HEL-1302/frontend` and port 9641 (pid 1355141) runs from `.../HEL-1302/backend`.
- **AC1:** spec lines 88-91 now read `expect(repairPosts[0].url).toMatch(new RegExp(`/api/dashboards/${escapeRe(dashboardId)}/layout/repair$`))`. The pattern is anchored at the end and the id is escaped. No other line in the spec changed (checked with `git diff`). To check that it accepts exactly what the old check accepted, I ran a Node harness of my own. It compared `.endsWith` with the new regex over 49 cases: 7 ids, including regex metacharacters `.`, `+()`, `[]$^`, `\`, `|{}`, against 7 URL variants (query suffix, trailing `\n`, trailing `/`, `repairs`, prefixed id). Result: 0 mismatches.
- **AC4 green:** `DEV_PORT=6734 nice -n 19 npx playwright test e2e/hel1260-orphan-owner-repair.spec.ts --workers 2 --trace on` gave **4 passed**, exit 0. That covers the orphan test in light and dark, and the UI-create test in light and dark.
- **AC4 red with the actual URL printed:** I ran a mutated copy (`repairX$`) from a scratch dir outside the worktree, with a minimal scratch config pointed at 6734. It failed with exit 1:
  `Expected pattern: /\/api\/dashboards\/f2f246bc-...\/layout\/repairX$/`
  `Received string:  "http://localhost:6734/api/dashboards/f2f246bc-.../layout/repair"`.
  The worktree source was never modified.
- **AC2, keyed on the in-trace title rather than the folder name:**
  - The new probe on my real traces printed `4 traces, 0 bad`, and each trace was tagged `[orphan]` or `[ui]` correctly.
  - Folder-swap test: I copied the orphan trace into `a-survives-a-reload/` and the UI trace into `b-every-breakpoint/`. The new probe still classified both correctly (`[orphan]`, `[ui]`, 0 bad). The base-commit probe (`git show 5f3990f8e:...`) misclassified both (`ui test repairs 1`, `repair count 0`, 2 bad). This shows the old probe was fragile and the new one is not.
  - Negatives, run against my own rewritten zips: a trace with the title stripped printed `BAD ['no title']`, and a trace whose file was renamed printed `BAD ['wrong file=other.spec.ts:37']`. Neither was silently classified.
- **AC3:** the header comment states ARCHIVAL, not run by CI, hooks or any gate. It gives the usage and what the probe keys on (the `context-options` title, the file segment and the two title prefixes), and notes that a missing, conflicting or unrecognised title is reported BAD.
- **Gates (fresh):**
  - `prettier --check` on the spec: clean, exit 0
  - `npm run check:e2e-types`: exit 0
  - `npm run check:openspec`: "openspec/ is clean", exit 0
  - tasks.md: no unchecked boxes
- **UI judgment (step 4):** N/A. No `frontend/**` changes. The diff only touches an e2e assertion and an archived Python script, so there is nothing to render.
- **Cleanup:** all my scratch artifacts (traces, the mutated copy, synthetic zips) are removed. The worktree `git status` shows only the evaluator's untracked `evaluation-1.md`.

### Verdict: CONFIRM

### Non-blocking notes
- In `probe-check-isolation.py`, the control flow `if kind is None: pass` / `elif ...` and the leftover `if True:` are awkward but behave correctly. When `kind is None`, `probs` is always non-empty, so a stale `rinfo` is never printed. This is cosmetic in an archival script.
- The worktree has no `node_modules` of its own. Playwright resolves `@playwright/test` from the parent checkout's `/home/matt/Development/helio/node_modules`. This works, but note it if the root deps ever diverge.
- No mtime-ordering evidence was relied on. Every claim above rests on content: the assertion text, the probe output and the exit codes.
