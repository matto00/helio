## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold reviewer. Every finding below is re-derived from the worktree, the agent definitions, the
`gh` API, or a command I ran myself. The three prior skeptic reports were read only as claim sets;
where they asserted a fact I re-ran the check rather than inheriting it.

### What I verified (with evidence)

**Round 3's single blocking defect — is it actually fixed?**

1. **D5's corrected premise is TRUE, and I reproduced the refutation that forced it.**
   `grep -n "check-merge-readiness" .claude/` returns three hits, all in
   `.claude/agents/concertino-auditor.md` (`:69`, `:173`, `:226`) — none in
   `concertino-orchestrator.md`. Reading `concertino-auditor.md:66-85`, the script checks "every
   reported check `SUCCESS`", PR mergeability, and this run's own gate verdicts — never a *named
   step*. design.md:94-97 now states exactly this. The false claim is gone.
2. **The obligation is genuinely additive — nothing else in the workflow performs it.**
   `grep -n "gh pr edit\|gh run \|gh pr checks" .claude/agents/concertino-orchestrator.md` → zero
   matches; same grep against `concertino-auditor.md` → zero matches. So without this obligation
   the confirmation would simply never happen. Also confirms design.md:101-103's "the body is
   written at Phase 3 step 4 … and no later step edits it".
3. **The named `gh` sequence WORKS here — executed against a real helio run, not assumed.**
   `gh --version` → 2.97.0; `gh auth status` → scopes `gist, read:org, repo, workflow`.
   On PR #413's CI run: `gh run view 32529519874 --json jobs` → `96918571615 frontend success`;
   `gh run view --job 96918571615 --log | grep -F "npm run lint"` returned
   `frontend  UNKNOWN STEP  …Z ##[group]Run npm run lint` (24,544 log lines total, exit 0).
   The identical shape with `-F "npm run typecheck"` will therefore match once the step exists.
   No scope or version problem.

**Is `workflow-state.md` durable, or a fourth piece of prose? (the question I was asked to settle)**

4. **`openspec archive` does NOT delete it — it moves it, and orchestrators keep writing it
   afterwards.** All six most recently archived change dirs contain `workflow-state.md`. The
   decisive evidence is `openspec/changes/archive/2026-08-20-bump-brace-expansion-lockfile/workflow-state.md`
   on main: it carries `PHASE: Cleanup`, the merged PR URL, the merge commit, post-merge AC
   re-verification notes and an escalation resolution — i.e. an orchestrator demonstrably opened
   and edited this file *after* Phase 3 step 2 archived it, all the way through Phase 4. By
   contrast nothing ever reopens `design.md`/`tasks.md`. The distinction the planner is relying on
   is real, and empirically demonstrated rather than asserted.
5. **The orchestrator has a forced touch-point in the same phase.** `concertino-orchestrator.md:903`
   ends Phase 3 with "Update `workflow-state.md` (PHASE: Cleanup)", and `:125-127`/`:1269` make it
   the file a compacted/resumed run recovers from. `.concertino/workflow-state.template.md`'s own
   header says it is "Written by the orchestrator on every phase transition" — so design.md:98-99's
   two sub-claims ("rewrites at every phase transition", "re-reads on resume") are accurate.
6. **Custom sections survive the rewrites.** This run's own `workflow-state.md` already carries
   non-template content (`DESIGN_GATE_ROUND: 4`, `## Planning findings`, `## Concurrency fences`)
   that has persisted across four design-gate rounds of rewrites, and HEL-707's archived copy
   carries multi-line narrative. Rewrites are incremental edits, not template regeneration, so
   `## DELIVERY_OBLIGATIONS` will not be clobbered.
7. **Nothing parses `workflow-state.md`, so the extra prose breaks no tooling.**
   `grep -rn "workflow-state" scripts/concertino/*.sh` → two hits, both *comments*
   (`setup-worktree.sh:202`, `emit-event.sh:9`). No reader, no schema, no failure mode.

Conclusion on the asked question: it is prose — but prose in the one file the orchestrator
provably revisits after the archive, on the one path a compacted run recovers from, carrying a
sequence I verified executable. That is the strongest carrier this harness offers, and the
artifacts do not claim more than that.

**Independent re-derivation of the technical plan (I trusted no prior measurement)**

8. `npx tsc --noEmit -p frontend` in the worktree: **exit 0, 4.892s** (tsc 5.9.3). AC 1 is already
   satisfied; the ~5s cost figure is right.
9. Gate gap real: `.husky/pre-commit` = lint, format:check, check:schemas, check:openspec,
   check:scala-quality, test — no `tsc`. `ci.yml:36-38` frontend job = lint, format:check, test —
   no `tsc`.
10. `frontend/tsconfig.json` `include: ["src", "tests"]`; `ls -d frontend/tests` → does not exist.
    `git ls-files frontend | grep '\.tsx\?$' | grep -v '^frontend/src/'` → exactly
    `frontend/pwa-assets.config.ts`, `frontend/vite.config.ts`. D4's "the widening is complete" is
    literally true.
11. **D4's "both measured clean" reproduced.** From `frontend/`, with the tsconfig's exact
    compilerOptions passed explicitly and only those two files as inputs:
    `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx
    --strict --esModuleInterop --forceConsistentCasingInFileNames --skipLibCheck vite.config.ts
    pwa-assets.config.ts` → **exit 0**. The widened `include` will not ship a red gate.
12. **D4's "ESLint does no typed linting" — verified, and it matters.** `eslint.config.cjs` sets
    `parserOptions` with `ecmaFeatures.jsx` only; no `project`, no `projectService`, no
    `recommendedTypeChecked`. So changing `include` cannot redden `npm run lint`.
13. **The CI leg cannot break on dependency resolution.** `typescript@^5.9.3` is a devDependency in
    *both* `frontend/package.json` and the root manifest, and `frontend/node_modules/.bin/tsc`
    exists. CI runs `npm ci` + `npm --prefix frontend ci`, so the root passthrough
    `npm --prefix frontend run typecheck` resolves. D2's worktree rationale also checks out: this
    worktree has `frontend/node_modules` but **no root `node_modules`**, and `npm run lint --silent
    -- --version` still printed `v9.39.3` (ancestor `.bin` resolution), so the real pre-commit hook
    of task 4.3 is runnable here.
14. **Naming precedent real:** `helio-mcp/package.json` has `"typecheck": "tsc --noEmit"`; root
    `"test": "jest --passWithNoTests && npm --prefix frontend test"` is the delegation pattern D2
    says it mirrors.
15. **Task 4.6's "green only while in-progress" is a real constraint, not superstition.**
    `scripts/check-openspec-hygiene.mjs:31-40` pushes an error when `openspec list --json` reports
    a change `complete`, so ticking every task reddens `check:openspec` in the hook for an
    unrelated reason. (Read-only inspection; I did not touch the file — HEL-775 fence respected.)
16. **Task 4.1's pre-verified probe holds.** `git grep -n "useAnalyzePipeline" -- ':!openspec'`
    returns exactly one line — its own `export function` declaration in
    `frontend/src/features/pipelines/hooks/useAnalyzePipeline.ts`. Zero importers, so `ts-jest`
    cannot claim the failure. The task still requires re-confirmation, which is the right posture.
17. **Task 5.5's sweep runs and its numbers are right.** The exact command executes and returns 23
    live hits — including ones tasks 5.1-5.4 do *not* name (`concertino.config.json:61`,
    `openspec/config.yaml:25`, `docs/cloud-dev-setup.md:84`, `CLAUDE.md:174`,
    `.cursor/rules/agent-workflow.mdc:23`, `notes/mobile-pwa-handoff.md:435`, the two rendered
    agent defs) — which is precisely why "record an update-or-exempt decision for each" is the
    correct instruction. `git grep … -- 'openspec/specs'` → **exactly 8** hits, matching the
    fence note.
18. **D6/D7's split is grounded.** `concertino.config.json` `gates` for `frontend/**` = lint,
    format:check, test, build — no typecheck. `.claude/agents/concertino-evaluator.md:2` carries
    `# concertino:sync v0.1.5`; `.cursor/skills/linear-ticket-delivery/SKILL.md` carries no sync
    marker (hand-maintained) — so task 5.4 must update it while the agent defs are correctly
    deferred. `openspec archive --help` confirms `--skip-specs` exists ("Skip spec update
    operations (useful for infrastructure, tooling, or doc-only changes)").
19. **D3's bypass statistic is honest.** My own count over archived changes dated after 2026-08-14:
    68 dirs, 21 mentioning a bypass with a deliberately broader regex than the planner's. The
    claimed 20/68 (~29%) is if anything conservative.
20. **Artifact-hygiene rules met.** `openspec/config.yaml:48` sets design at "Maximum 150 lines;
    wrap prose at 120 chars". design.md is **150 lines, max width 119** — inside both, at the edge.
    proposal.md 47 lines/117 wide (≤80 lines); spec.md and tasks.md within their rules; the
    numbered `## N. Area` task headings and 372-word proposal both match recent merged precedent
    (archived proposals run 317-702 words). No `TODO`/`TBD`/`???` anywhere in the six artifacts.
21. **AC traceability, all five:** AC1 → tasks 1.1/2.4/6.x (already green, disclosed in ticket.md's
    provenance note); AC2 → tasks 3.1-3.6 + spec "wired into pre-commit and CI"; AC3 → tasks
    4.1-4.6 + spec "demonstrated to fail"; AC4 → tasks 6.1/6.3 + spec "behavior-preserving";
    AC5 → task 6.2. No AC uncovered, no task outside an AC's orbit.
22. **Hard constraints respected:** non-goals explicitly exclude `openspec/specs/` and
    `scripts/check-openspec-hygiene.mjs`; D7 archives `--skip-specs`; task 5.5 fences
    `':!openspec/specs'`. The change's own `specs/` delta lives under `openspec/changes/`, not the
    fenced tree. I modified no file except this report and touched no other worktree.

**Where I looked for overclaim and found none that blocks**

- "asserted mechanically at Execution, confirmed executed at Delivery" (D5), "CI *redness* SHALL be
  described as inferred … SHALL NOT be reported as observed" (spec.md:53-55), and the PR-disclosure
  bullet in DELIVERY_OBLIGATIONS keep "present in YAML" / "executed in CI" / "observed red"
  separated in all four artifacts. I could not find a place where one is smuggled in as another.
- The `12fae281` measurement is still correctly hedged as source-isolating rather than a claim
  about that commit's own lockfile, and design.md:3-5 now attributes each reproduction to the
  specific round that performed it.

### Verdict: CONFIRM

The round-3 defect is genuinely repaired rather than reworded: the false justification is replaced
by a true one I re-derived, the obligation moved to the only carrier that survives the phase
boundary, and the command sequence is one I ran end-to-end against this repo's real CI logs. Every
other load-bearing measurement in the plan reproduced. Nothing here would ship broken, misleading,
or unexecutable.

### Non-blocking notes

1. **`gh pr edit --body` replaces; it does not append.** `gh pr edit --help` (2.97) offers only
   `-b/--body "Set the new body"` and `-F/--body-file` — no append flag. A compacted agent reading
   the checklist tersely and running `gh pr edit --body "<CI note>"` would **clobber** the Phase-3
   body, which is exactly where this change's honesty disclosures (CI-redness-inferred, D6/D7
   residual gaps) live. Suggest spelling the read-modify-write into the obligation:
   `gh pr view <n> --json body -q .body > body.md && printf '\n\n## CI confirmation\n…' >> body.md
   && gh pr edit <n> --body-file body.md`. One-line edit to `workflow-state.md`; no re-gate needed.
2. **design.md:99's contrast is slightly stronger than the truth.** "not merely as prose in
   artifacts Phase 3 archives before it acts" reads as though `workflow-state.md` escapes
   archiving. It does not — `openspec archive` moves the whole directory, this file included
   (verified across six archived changes). The *operative* distinction (the orchestrator keeps
   editing it after the archive; it never reopens design.md) is true, and I verified it — only the
   phrasing implies more. "…not merely as prose in artifacts nothing reopens after Phase 3
   archives them" would be exact.
3. **The template forbids what the section does.** `.concertino/workflow-state.template.md:2-3`:
   "Holds ONLY ids/paths/counters — never prose procedure." `DELIVERY_OBLIGATIONS` is prose
   procedure. Nothing enforces the rule and this run's file already carries three other custom
   blocks, so there is no breakage — but a half-line ("deliberate exception, see design.md D5")
   would stop a future reader from tidying it away.
4. **Ticking the boxes is not the deliverable; the PR-body append is.** The ticks will be made on
   the *archived* copy after the archive commit, so they stay uncommitted and die with the
   worktree at `cleanup.sh --phase4` — I can see exactly that residue on main today
   (`M openspec/changes/archive/2026-08-20-bump-brace-expansion-lockfile/workflow-state.md`). The
   plan already targets the PR body as the durable record, which is right; just don't treat a
   ticked box as discharge.
5. **Resume-path soft spot.** The orchestrator's recovery instruction names
   `WORKTREE_PATH/openspec/changes/<CHANGE_NAME>/workflow-state.md`, which after Phase 3 step 2
   lives at `openspec/changes/archive/<date>-close-type-check-gate/workflow-state.md`. A
   compaction landing between the archive and the CI confirmation would look in the wrong place.
   Harness property, not this plan's defect; a one-line "post-archive this file lives under
   `openspec/changes/archive/`" inside the obligations block closes the last gap.
6. **The obligation silently assumes CI actually triggers.** `ci.yml:11-17` has
   `paths-ignore: ["**.md", …]`, so a markdown-only PR runs no CI at all and the "wait for CI"
   step would wait forever. Fine as planned (this change touches `package.json`, `tsconfig.json`,
   `.husky/pre-commit`, `ci.yml`), but if scope ever collapses to docs-only, the obligation
   becomes unfulfillable rather than merely unmet.
7. Environmental, FYI only: this worktree contains only the four tracked
   `scripts/concertino/*.sh`; `next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`,
   `check-merge-readiness.sh` are gitignored and were not copied in (HEL-710 describes exactly
   this). I ran the canonical scripts from the repo root against this worktree's change dir —
   their documented `<change-dir>` interface — rather than guessing a filename.
