## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review of `openspec/changes/close-type-check-gate/` at base `8432f280`. I read
`skeptic-design-1.md` and `skeptic-design-2.md` as **claim sets only** and re-derived every
load-bearing measurement with my own commands — including the ones both prior rounds agreed on,
and including the round-2 report's own factual assertions where the revised artifacts now rest on
them. I modified no file in this worktree except this report. I touched nothing under
`openspec/specs/`, nothing in `scripts/check-openspec-hygiene.mjs`, and no other worktree; every
mutating experiment ran in an out-of-tree scratch copy.

### What I verified (with evidence)

**1. Every quantitative premise reproduces, independently.**

```
$ ./frontend/node_modules/.bin/tsc --noEmit -p frontend        EXIT=0    real 0m4.744s
```

Historical, via `git archive <rev> frontend` into scratch with today's `frontend/node_modules`
symlinked in:

```
12fae281   EXIT=2   61 output lines = 60 `error TS` lines + 1 continuation
             58 frontend/src/features/toasts/state/toastListeners.ts
              1 frontend/src/store/listenerMiddleware.ts
              1 frontend/src/config/env.ts
d7815d15   EXIT=0   0 lines
```

So `ticket.md`'s "60 error lines (58/1/1)", design.md's "already absent at `d7815d15`", and the
"~5s" cost are all true, and AC 1 is genuinely already satisfied. The precision clause both prior
rounds asked for (source-isolating, *not* a claim about that commit's own lockfile) is present in
ticket.md, proposal.md and design.md.

**2. D4 reproduces in both directions — I ran it myself, not from the reports.** Scratch copy of
`HEAD`'s `frontend/`, varying only `include`, with a real `TS2322` appended to `vite.config.ts`:

```
include ["src","vite.config.ts","pwa-assets.config.ts"], no error   EXIT=0
include ["src","vite.config.ts","pwa-assets.config.ts"], w/ error   vite.config.ts(69,7): error TS2322 ... EXIT=2
include ["src","tests"]  (today's config),               w/ error   EXIT=0   # invisible
```

`git ls-files 'frontend/*' | grep -E '\.tsx?$' | grep -v '^frontend/src/'` returns exactly
`pwa-assets.config.ts` and `vite.config.ts`, so D4's "this widening is complete rather than
partial" is exact. `frontend/tests` does not exist (`ls`: No such file or directory).

**3. Gate gap and naming precedent, first-hand.** `.husky/pre-commit` = lint, format:check,
check:schemas, check:openspec, check:scala-quality, test — no tsc. `ci.yml:36-38` frontend job =
lint, format:check, test — no tsc. `frontend/package.json` has no `typecheck`; `helio-mcp`'s is
literally `tsc --noEmit`. Root `package.json`'s `test` is `jest --passWithNoTests && npm --prefix
frontend test`, so D2's "mirrors how root `test` delegates" is accurate. CI runs both `npm ci` and
`npm --prefix frontend ci` (`ci.yml:34-35`), so the root passthrough will resolve `tsc` in CI.

**4. Round-2 CR-2 (doc sweep) is properly closed — I ran the exact command from task 5.5.** It
returns **42 lines**, tractable, and it surfaces every site tasks 5.1-5.4 name:
`CONTRIBUTING.md:112/116/119` (the Pre-Commit Policy block, verified to enumerate the six hook
commands in order), `CLAUDE.md:18` (frontend command list) **and** `CLAUDE.md:65` (the prose
"Husky runs ESLint, Prettier, and Jest" that already understates the hook), `README.md:95`,
`.cursor/skills/linear-ticket-delivery/SKILL.md:122`. It also surfaces the D6-deferred set
(`concertino.config.json:61` + both rendered `.claude/agents/concertino-{executor,evaluator}.md`)
and four further live hits 5.5 now forces a decision on (`.cursor/rules/agent-workflow.mdc:23`,
`CLAUDE.md:174`, `docs/cloud-dev-setup.md:84`, `openspec/config.yaml:25`,
`notes/mobile-pwa-handoff.md:435`). I confirmed `SKILL.md` carries **no** `# concertino:sync`
marker (its front matter is `name/description/license/metadata`), so task 5.4's justification for
excluding it from D6's deferral is correct. 5.5's wording ("record an explicit update-or-exempt
decision for every live hit … do NOT assert 'no others exist'") is the right shape.

**5. Round-2 CR-3 (attribution) is now accurate.** `skeptic-design-1.md` contains the current-base
run and the `12fae281` run (`EXIT=2 LINES=61`) and contains **no** occurrence of `d7815d15`;
`skeptic-design-2.md` contains all three. design.md:3-5's split attribution therefore matches
ground truth — if anything it *understates* round 1, which also reproduced the root-tsconfig 218
and both D4 directions. Understating is the safe direction. Its closing claim ("No measurement
below rests on planning's word alone") holds: I traced each Context bullet to a reproduction in
one report or the other, and re-ran the three numeric ones myself.

**6. Round-2 CR-4 (AC provenance) is accurate and complete.** I fetched Linear HEL-683 directly.
The filed ACs are exactly four:

```
1  `npx tsc --noEmit -p frontend` exits clean.
2  A type-check gate is enforced (pre-commit and/or CI) so new type errors fail before merge.
3  No behavioral changes — type-level fixes only; existing tests pass unmodified.
4  Lint/format/tests clean.
```

`ticket.md:59-63`'s provenance note states the filed list had four, names the one **addition**
(red-before-green) and the one **rewording** (`type-level fixes only` → `type-level/tooling
changes only`), and asserts nothing was removed or weakened. Diffing the two lists confirms that
is the complete set of edits. Closed.

**7. D6 and D7's premises hold.** `concertino.config.json → gates` for `frontend/**` is exactly
lint / format:check / test / build — no typecheck — and
`.concertino/laws/verification-before-completion.md:27-32` does name that file as the delivery
agents' verification commands, so the residual gap D6 records is real. CON-128 is a live operator
constraint, not an invention: it appears in
`openspec/changes/archive/2026-08-21-skeleton-loaders-list-detail-panel/workflow-state.md:59` and
again in `.concertino/runs/HEL-535/events.jsonl` (same day) as "`concertino sync` is forbidden
this run (CON-128, stale binary)".

**8. Objective artifact checks.** `openspec validate --changes close-type-check-gate` → `✓
change/close-type-check-gate`, 1 passed / 0 failed. `design.md` is **149 lines** (within the 150
rule). No `TODO`/`TBD`/`FIXME`/hand-waving in any of the five artifacts. Every one of the five ACs
maps to at least one task (1→1.1; 2→3.1-3.6; 3→4.1-4.6; 4→6.1/6.3; 5→6.2), and no task exceeds
ticket scope except D4, which finding 2 justifies. No file in the Impact list collides with
`openspec/specs/` or `scripts/check-openspec-hygiene.mjs`.

**9. Round-2 CR-1 — the item I was asked to judge — is NOT closed. Reproduced twice.**

```
$ grep -nE "check-merge-readiness|gh run |gh pr checks|gh pr edit|run log" .claude/agents/concertino-orchestrator.md
(NO MATCHES)
$ grep -rn "check-merge-readiness" .claude/agents/
.claude/agents/concertino-auditor.md:69   ← only invoker
$ grep -nE "run log|gh run|typecheck|step executed" .claude/agents/concertino-auditor.md
(no run-log / step-level reading in auditor)
```

Detail in Change Request 1.

### Verdict: REFUTE

This is a genuinely strong plan and it got stronger each round: every factual premise I could
reproduce, reproduced; CR-2, CR-3 and CR-4 are properly closed; and all three non-blocking notes
were applied. I am refuting on **one** item — the one the orchestrator specifically asked me to
judge — because it is not merely misplaced, it is justified by a claim about this repo's own
workflow that ground truth falsifies. In a change whose entire subject is "do not ship a gate that
looks wired but does nothing", a verification obligation that is asserted to be owned by a phase
that demonstrably cannot perform it is the same defect in miniature. The fix is ~5 lines.

### Change Requests

1. **The CI run-log obligation is still not owned by anyone who can perform it, and D5's
   justification for believing it is, is false.** Round 2 asked for the checkbox to move out of
   `tasks.md`; that happened, but the destination does not hold. Three reproduced sub-findings:

   - **a. The premise is factually wrong.** design.md:98-99 reads: *"It is an explicit Phase-3
     obligation on the orchestrator — **the phase that already polls CI via
     `check-merge-readiness.sh`** — and its result is recorded in the PR body."* The orchestrator
     never polls CI. `grep -nE "check-merge-readiness|gh run |gh pr checks|gh pr edit|run log"`
     against `.claude/agents/concertino-orchestrator.md` returns **zero matches** (re-run in two
     forms). The sole invoker is `.claude/agents/concertino-auditor.md:69` — a *separate, cold*
     agent the orchestrator spawns at Phase 3 step 7 — and what that script checks is "every
     reported check `SUCCESS`", not "the `npm run typecheck` step executed". A green CI run with
     the step in the wrong job, or absent, is still green. The auditor is given no instruction to
     read a run log or look for a named step (grep above: no matches). This sentence appears to
     have been adopted verbatim from `skeptic-design-2.md`'s CR-1 prose rather than derived from
     the agent definitions — precisely the "another agent's narrative treated as fact" failure.

   - **b. The stated deliverable is sequenced impossibly.** Per
     `concertino-orchestrator.md:819-903`, Phase 3 is: (1) squash → (2) `openspec archive` → (3)
     `git push` + `assert-phase.sh delivery` → (4) `gh pr create` with the body → (5) emit `pr`
     event → (6) post link to ticket → (7) branch on `AGENT_MERGE`, spawn auditor. The PR body is
     written at step 4, **immediately after the push and before CI has run**, and no later step
     edits it (`gh pr edit` appears nowhere in the file). So design.md:99's "its result is
     recorded in the PR body" and spec.md:44-45's "the result **SHALL** be recorded in the PR
     body" cannot be satisfied as specified. proposal.md:20 carries the same claim ("confirm from
     the run log that it executed").

   - **c. Nothing carries the obligation across the phase boundary.** It now lives in exactly
     three places — design.md D5, the note at tasks.md:31-32, and spec.md:40-45 — and Phase 3 step
     2 `openspec archive`s all three into `openspec/changes/archive/<date>-close-type-check-gate/`.
     Phase 3 reads none of them. The one artifact the orchestrator is *required* to maintain
     "so a compacted or resumed [run] can reconstruct" state
     (`concertino-orchestrator.md:125-127`) and rewrites at every phase transition —
     `workflow-state.md` — does not mention it. Since the orchestrator authored these artifacts
     itself back in Phase 1 (Planning runs directly, no subagent), the obligation survives only if
     Phase-1 prose is still in context after an entire Phase-2 execute/evaluate/final-gate loop —
     which is the exact scenario `workflow-state.md` exists because you cannot assume.

   **Either fix is acceptable; pick one and make all four artifacts agree.**

   - **Option A — make it real.** Correct design.md:98-99 (the orchestrator does not poll CI; the
     *auditor* it spawns does, and only for overall check status). Record the obligation in
     `workflow-state.md` as a durable `DELIVERY_OBLIGATIONS:` entry, and state the concrete
     sequence: after CI reports complete, `gh run view --job <frontend job> --log | grep "npm run
     typecheck"` (or `gh pr checks`), then `gh pr edit --body` to append the result — because the
     body already exists by then.
   - **Option B — drop it, and say so plainly.** Delete the "confirmed executed at Delivery" half
     of D5, delete spec.md's "#### Scenario: The CI step is confirmed to have executed"
     (spec.md:40-45), and drop proposal.md:20's "and confirm from the run log that it executed".
     Then state that CI execution is **inferred** from the mechanical YAML assertions (tasks
     3.3-3.6) plus the observed local red of the identical command — which is exactly the honest
     framing spec.md:53-55 already uses for CI *redness*. This is cheaper and costs almost
     nothing: 3.3-3.6 already close the "wrong job", "`continue-on-error`" and "`|| true`" failure
     modes, and the residual risk (a step that parses correctly but never runs) is small and can
     be named as a residual alongside D6/D7's.

   Option B is my recommendation. Requiring a confirmation the workflow has no mechanism to
   perform is how the "advertised scope exceeds real scope" defect D4 refuses to accept in
   `tsconfig.json` gets re-introduced at the process layer.

### Non-blocking notes

- **Task 5.5's sweep walks the executor into the HEL-775 fence.** The command excludes
  `openspec/changes` and `node_modules` but not `openspec/specs`, and four of its 42 hits land
  there (`backend-file-size-compliance/spec.md:46,57`,
  `concertino-worktree-setup/spec.md:7,14,15,21,26`). 5.5 then instructs "record an explicit
  update-or-exempt decision for every live hit". The fence *is* stated in design Non-Goals and in
  `workflow-state.md`, so an executor would have to override two explicit statements — but adding
  `':!openspec/specs'` to the grep, or pre-declaring those hits exempt-by-fence in 5.5 itself,
  removes the invitation for one token.
- **Task 4.1 does not name a pre-verified probe candidate.** It states both required properties
  (no test imports it; the error is lint-clean) and requires verifying them before use, which is
  correct — but "no test transitively imports this module" is a non-trivial thing for an executor
  to establish from scratch. Round 1 identified `frontend/src/utils/aggregate.ts` as a *negative*
  example (test-reachable; a type error there reddens `npm test` with `Test suite failed to run`).
  Naming one verified positive candidate in 4.1 would convert a search into a check.
- **This run's `workflow-state.md` records the HEL-775 concurrency fence but not CON-128 or
  CON-129**, both of which design.md leans on (D6 and the Risks section respectively). Both are
  genuinely live constraints — I verified them in the 2026-08-21 archives and in
  `.concertino/runs/HEL-535/events.jsonl` — so this is not an accuracy problem. It is the same
  structural point as CR 1c: a constraint that exists only in prose the orchestrator will not
  re-read is a constraint one compaction away from being lost.
- **Hook ordering is right.** `.husky/pre-commit` has `set -e` and runs root `npm run lint`
  (`eslint . --max-warnings=0`) first, so task 4.1's new lint-clean requirement is exactly the
  right guard, and placing `typecheck` second — ahead of `check:openspec` and `npm test`, both
  slower and both prone to unrelated reds — is the correct slot.
- **The evaluator's gate set will fire correctly on this diff.** `concertino.config.json`'s
  `frontend/**` glob matches `frontend/package.json` and `frontend/tsconfig.json`, so lint /
  format / test / build all run; tasks §6 covers each. Nothing in the diff matches `backend/**`.
- Environment note, not a blocker: `scripts/concertino/` is gitignored and therefore absent from
  this worktree; I invoked the main checkout's copies by absolute path
  (`next-report-number.sh` returned `READY number=3`).
