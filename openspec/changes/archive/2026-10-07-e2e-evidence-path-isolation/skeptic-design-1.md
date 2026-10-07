## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{e2e-evidence-path-guard,openspec-archival-hygiene}/spec.md
at worktree HEAD 33dcf8fd22fe21f4823697aec101033e7f637c30 (artifacts untracked).

### What I verified (with evidence)

**The premise: who wrote the stray screenshots.** Checked against ground truth in the main checkout:
- `e2e/hel1350-chart-compare-picker.spec.ts:16` is
  `const SHOTS = resolve(__dirname, "../openspec/changes/chart-output-compare-picker/screenshots");`, with `mkdirSync(SHOTS)` at :159.
  It was committed in `469f4ea93 HEL-1350 Compare picker for chart Outputs ... (#811)`. `__dirname` is the running worktree's `e2e/`,
  so the write stays in that worktree. There is no cross-worktree path.
- `.concertino/runs/HEL-1350/events.jsonl`: `run.end status=delivered` at t=1791351108896, which is Tue Oct 6 22:31:48 PDT. That is
  about 12.5h before the 11:00:53 PNGs. Confirmed.
- `.concertino/runs/HEL-1330/events.jsonl`: evaluator FAIL at 10:57:12, Execution cycle 2 entered at 10:59:16, and the
  `escalation.raised` about the foreign `chart-output-compare-picker/` dir at 11:08:53. HEL-1330's `evaluation-1.md` (lines ~91-93)
  told its executor to re-run `hel1350-chart-compare-picker.spec.ts` in cycle 2. Its `evaluation-2.md:44,61` names hel1350 as the
  writer to that dir. So the attribution to HEL-1330's own cycle-2 run is backed by a documented instruction to run that exact spec,
  and the timing agrees. Timing alone is not the basis, and the mechanism holds regardless of which lane ran the spec. The premise
  holds, and so does the conclusion "no shared browser, nothing upstream".

**The design's claims about the current code** (worktree, `git grep`/`grep`):
- Exactly 10 e2e files call `.screenshot(`: hel588, 1085, 1087, 1088, 1095, 1169, 1275, 1277, 1350, 1351. This matches the
  proposal's migration list.
  - 1275, 1277, 1350 and 1351 use `resolve(__dirname, "../openspec/changes/...")` SHOTS.
  - The other six use cwd-relative `.concertino/runs/HEL-n/evidence/...` paths. Some are multi-line `screenshot({\n path: ... })`
    calls, so D3's balanced-paren scan is needed. It is planned.
- No `toHaveScreenshot`, `.pdf(`, `recordVideo` or `saveAs(` in e2e. The only other `writeFile`s are hel520/hel813 CSS mutation
  probes, which are not evidence. "Every e2e evidence write" therefore equals "every screenshot write", and AC1 is fully covered.
- Every non-spec `openspec/changes` reference in e2e sits in a comment: `support/stateContrast.mjs:8` and `hel813...:71`. `README.md`
  is outside the `{ts,mts,js,mjs}` scan. So rule (a) will pass on the migrated tree, as D4's real-tree case requires.
- `package.json` has `"type": "commonjs"`, so `__dirname` in `e2e/support/evidencePath.ts` (D2) behaves as it does in the existing
  specs. `resolve(__dirname,"../..")` from `e2e/support/` gives the worktree root, which is correct.
- `scripts/check-openspec-hygiene.mjs:235-239` is the no-tasks error. The `runGit` helper (:76-86) already pins `cwd: targetRoot`
  and `env: gitChildEnv()` and fails soft, so D5's fail-closed path is directly implementable.
- The guard pattern to copy (`check-test-temp-dir-hygiene{,.selftest}.mjs`) is wired at `package.json:31-32`,
  `.husky/pre-commit:19-20` and `ci.yml:120-121`, which matches design/task 2.3.
- `.gitignore:48` `*.png` exists, and `/e2e-evidence/` is not yet ignored. Task 1.1 is needed.

**The delta spec.** The MODIFIED requirement "Preservation of the other hygiene rules" keeps all four existing scenarios. It narrows
"Change has no tasks" correctly and adds two scenarios: the ignored-only dir, and git unavailable. `openspec validate
e2e-evidence-path-isolation --strict` prints "Change 'e2e-evidence-path-isolation' is valid".

**Every AC traced to a task:**
- AC1 → D1/D2 + tasks 1.1-1.4.
- AC2 → D3/D4 + 2.1-2.3. This includes mutation-red in 2.2, and pre-commit + CI in 2.3.
- AC3 → D5 + 3.1-3.2. The stderr notice names the dir, committable dirs are unchanged, and 3.2 has a mutation-red.
- AC4 → 1.5. Node v22.23.2 strips TS types by default, so the planned `node` probe of a `.ts` helper is feasible without tsx.
  tsx is not installed.

**Other checks.** I found no placeholders or TODO/TBD. Proposal, design and tasks do not contradict each other. Scope stays within the
ACs. The non-goals are explicit and justified. The collision with sibling HEL-1330 is identified, with a mitigation (keep hunks to
path/import lines).

### Verdict: CONFIRM

### Non-blocking notes
- **D3 escape hatch vs. comment stripping:** D3 strips comments before scanning, and the escape hatch is itself a comment. The
  implementation must detect the `// e2e-evidence-path: reviewed —` marker on the raw source line before stripping, or the hatch
  will never work. D4's escape-hatch green case will catch this if it is built honestly.
- **D5 and an empty change dir:** `git ls-files --cached --others --exclude-standard` also prints nothing for a directory with no
  files at all, so an empty `openspec/changes/<x>/` would also be exempted with the notice. That is harmless, since it cannot be
  committed, but it is outside the spec's literal "contains only gitignored files" wording. Either word the notice to fit both cases,
  or note the edge in the selftest.
- **Task 1.3/1.4 diff limit:** limiting the diff to "path/import/mkdir lines" would leave stale header comments behind. Example:
  `hel1350...spec.ts:12` "screenshots land in the change dir". Updating such a comment to name `e2e-evidence/` is within spirit.
  The evaluator should not flag it as scope creep.
- **Task 2.1 base tree:** get the pre-migration base tree from the live-resolved review base (`resolve-review-base.sh`), not a bare
  `origin/main` typed by hand.
