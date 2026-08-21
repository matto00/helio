## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review of `openspec/changes/close-type-check-gate/` at base `8432f280`. I am a fresh
reviewer: I read `skeptic-design-1.md` but treated it as a claim set, re-derived every
load-bearing measurement with my own commands, and checked the round-1 report's own accuracy
where the revised artifacts lean on it. I modified no file in this worktree except this report;
I touched nothing in `openspec/specs/`, `scripts/check-openspec-hygiene.mjs`, or any other
worktree. All experiments that required mutating files ran in an out-of-tree scratch copy.

### What I verified (with evidence)

**1. Every load-bearing measurement reproduces — including the one round 1 did not check.**

```
$ ./frontend/node_modules/.bin/tsc --noEmit -p frontend      EXIT=0   real 0m4.810s
$ ./frontend/node_modules/.bin/tsc --noEmit -p frontend      EXIT=0   (re-run, reproduced)
```

Historical, via `git archive <rev> frontend` into scratch + today's `node_modules` symlinked:

```
d7815d15   EXIT=0   0 error lines
12fae281   EXIT=2   60 error lines   58 toastListeners.ts | 1 store/listenerMiddleware.ts | 1 config/env.ts
```

So `ticket.md`'s "60 error lines (58/1/1)" and design.md's "already absent at `d7815d15`" are both
true, and AC 1 is genuinely already satisfied. The qualifying clause round 1 asked for
("`12fae281`'s *source* against *today's* `node_modules`, not what CI would have printed on that
commit's own lockfile") is now present in ticket.md, proposal.md **and** design.md. That
non-blocking note is closed.

**2. The gate gap is exactly where the plan locates it.** `.husky/pre-commit` = lint,
format:check, check:schemas, check:openspec, check:scala-quality, test — no tsc.
`ci.yml:36-38` frontend job = lint, format:check, test — no tsc. `frontend/package.json` has no
`typecheck`; `helio-mcp/package.json` does, so D2's naming precedent is real. Root
`package.json`'s `test` already delegates via `npm --prefix frontend test`, so D2's "mirrors how
root `test` delegates" is accurate.

**3. D4 reproduces in both directions.** Scratch copy of the current `frontend/` (699 tracked
files), varying only `include`, with a real type error appended to `vite.config.ts`:

```
include ["src","vite.config.ts","pwa-assets.config.ts"], no error   EXIT=0
include ["src","vite.config.ts","pwa-assets.config.ts"], w/ error   vite.config.ts(69,7): error TS2322 ... EXIT=2
include ["src","tests"]  (today's config),               w/ error   EXIT=0   # invisible
```

`frontend/tests` does not exist; `git ls-files 'frontend/*' | grep '\.tsx\?$' | grep -v '^frontend/src/'`
returns exactly `pwa-assets.config.ts` and `vite.config.ts`, so the widening is complete.
`eslint.config.cjs` sets no `parserOptions.project` (lines 27-51) — no typed linting depends on
`include`, so the "tsc only" claim holds.

**4. The CR-1 remedy is executable and the honesty distinction is now made properly.** Both
assertion tools resolve here: `python3 -c "import yaml"` (PyYAML 6.0.3) and node `js-yaml`, which
parses `ci.yml` to `jobs: [frontend, backend]`. Tasks 3.3-3.6 are mechanical and exact-match on
the `run` string, which closes the "wrong job" and "`|| true`" failure modes D5 names. D5,
spec.md's "CI wiring is mechanically asserted, not eyeballed" / "The CI step is confirmed to have
executed" scenarios, and the falsifiability requirement's "CI *redness* SHALL be described as
inferred ... and SHALL NOT be reported as observed" now separate *present in YAML* / *executed in
CI* / *observed red* explicitly. Round-1 CR 1 is addressed — an executor following 3.3-3.6 cannot
ship a step that is silently decorative in the ways the plan enumerates. (Sequencing of 4.7 is a
separate problem — CR 1 below.)

**5. D6's premise is real, and the residual gap is stated rather than buried.**
`concertino.config.json → gates` declares for `frontend/**` only lint / format:check / test /
build. `.claude/agents/concertino-executor.md:114-118` and `concertino-evaluator.md` carry the
same rendered list, and both files are marked `# concertino:sync v0.1.5` (line 2).
`.concertino/laws/verification-before-completion.md:27-32` does name that config as the agents'
verification commands. And CON-128 is a real, recorded operator constraint, not an invention:
`openspec/changes/archive/2026-08-21-skeleton-loaders-list-detail-panel/workflow-state.md:56-60`
— "ENVIRONMENT — DO NOT RUN `concertino sync` during this run for any reason ... Tracked as
CON-128 (Urgent)." The gap is named in design Non-Goals, D6, Risks, **and** proposal Non-goals.
Sound and honest. (One alternative D6 does not consider — hand-editing config *and* both rendered
files consistently in one commit — but given CON-128's cause, declining it is defensible and the
follow-up is named.)

**6. D3's `git commit -n` claim is now accurate, and I measured the rate.** The round-1
"routinely" claim is gone. The rewritten D3 grounds the bypass in the HEL-657 `check:openspec`
false positive, which is real: `scripts/check-openspec-hygiene.mjs:31-35` errors on a change that
is `complete` but not archived. Measured frequency, since 2026-08-15: **20 of 68** archived change
dirs mention a `git commit -n` (~29%). D3's load-bearing admission — "one that would skip the new
step along with the rest" — is present, and the conclusion it supports (wire both) is the
conservative one. See non-blocking notes for the wording.

**7. CR-3's line references are real.** `CONTRIBUTING.md:112-121` is the Pre-Commit Policy block
and enumerates the six hook commands in order; it is the *only* command enumeration in that file.
`README.md:88-96` and `CLAUDE.md:11-19` are the frontend command lists. Tasks 5.1/5.2 describe
them accurately. (5.3's sweep is a separate problem — CR 2 below.)

**8. CR-4 and CR-5 are addressed.** 4.1 requires a non-test-imported probe (justified:
`frontend/jest.config.cjs:2` is `preset: "ts-jest"`, diagnostics on by default). 4.6 pins the
green observation to "WHILE this change is still in-progress" and requires naming which step
produced each result — correct, and 4.5 (revert) precedes it, so the ordering works. 6.4 now says
"only the intended source/doc files plus this change's openspec artifacts". D7 exists and states
the real consequence (a later MODIFIED/REMOVED delta against a capability absent from canonical
specs aborts `openspec archive`) plus a named follow-up.

**9. Other objective checks.** `typescript@^5.9.3` is a devDependency in both root and
`frontend/package.json`, so CI's `npm ci` + `npm --prefix frontend ci` will have `tsc`.
`npx --no-install tsc --version` resolves 5.9.3 from this worktree (via the enclosing main
checkout), so task 1.1's literal AC command works here. All five ticket ACs map to tasks; no task
exceeds the ticket except D4, which finding 3 justifies. No planned file collides with HEL-775.

### Verdict: REFUTE

The plan's core is sound and, unusually, every factual premise I could reproduce, reproduced —
including the one the previous round left unchecked. Four of the five round-1 change requests are
properly addressed and the fifth (D3's `-n` claim) is now accurate. I am refuting on four
artifact-level defects, all cheap to fix, three of which are instances of the very failure mode
this ticket exists to end: a verification step that structurally cannot be performed or cannot
find what it covers, and a claim of verification that was not performed.

### Change Requests

1. **Task 4.7 cannot be executed in the phase it lives in — as written it forces either a
   fabricated tick or a stalled cycle.** `ci.yml:11-12` triggers only on `pull_request` targeting
   `main` (a feature-branch push runs nothing), and the orchestrator creates the PR at Phase 3
   step 4 — *after* Phase 3 step 2 has already run `openspec archive`, which moves `tasks.md` into
   `openspec/changes/archive/`. The executor is the agent that ticks tasks
   (`.claude/agents/concertino-executor.md:84-88`) and never sees a PR; its standing rule for an
   impossible task is "flag it and stop — do not guess" (line 90). Meanwhile
   `concertino-evaluator.md:80` requires "All task items marked done". Outcomes are therefore: a
   tick with no evidence behind it, or a burned execution cycle. Fix: drop the checkbox from
   `tasks.md` and carry the run-log confirmation as an explicit **Delivery-phase** obligation in
   design.md D5 and the PR body — the natural home is Phase 3, where
   `scripts/concertino/check-merge-readiness.sh` already polls for CI green — or, if it stays a
   task, state in the task itself who performs it, at which phase, and that the change directory
   is archived before that point.

2. **Task 5.3's documentation sweep is structurally incapable of finding two real instances of
   the drift it exists to catch, and asserts a negative that ground truth falsifies.**
   - a. `CLAUDE.md:63-65` is a **second, prose-form** description of the hook: "### Pre-commit
     hooks — Husky runs ESLint, Prettier, and Jest automatically on commit." It *already*
     understates the hook (omits `check:schemas`, `check:openspec`, `check:scala-quality`) and
     will understate it further after this change. Task 5.2 covers only CLAUDE.md's frontend
     command list (lines 11-19), and 5.3's grep terms (`check:scala-quality`, `format:check`)
     match no text in that block — the sweep cannot surface it. This is precisely the
     "advertised scope exceeds real scope" defect D4 refuses to accept in `tsconfig.json`, sitting
     in the change's own canonical doc.
   - b. `.cursor/skills/linear-ticket-delivery/SKILL.md:119-124` enumerates the frontend
     verification gates (`npm run lint`, `npm run format:check`, `npm test`, `npm run build` in
     `frontend/`). It is **not** covered by D6's `concertino sync` deferral: it carries no
     `# concertino:sync` marker (contrast `.claude/agents/concertino-executor.md:2`),
     `concertino.config.json` declares `harnesses: ["claude-code"]` only with no cursor target,
     and its last touch was `a8d7e348` (HEL-17). It is named nowhere in the plan, yet spec.md's
     doc-parity requirement ("Any tracked document that enumerates the pre-commit hook's commands
     **or the frontend's npm scripts** SHALL be updated in the same change") covers it — an
     internal contradiction between spec.md and tasks.md.
   - c. 5.3 is phrased as confirming a negative ("Confirm no other tracked doc enumerates the hook
     steps or the frontend scripts") that is false, and its grep is unscoped:
     `git grep -l format:check` returns ~200 hits, almost all under `openspec/changes/archive/`,
     which buries the live ones.

   Fix: scope the sweep (`-- ':!openspec/changes'`), add prose-form terms (`Husky`, `pre-commit`),
   and reword 5.3 as "enumerate every live hit and record an update-or-exempt decision for each".
   2a must be an update (it is a canonical doc understating the enforced gate set); 2b must be an
   explicit decision — update it, or exempt it with the reason stated (e.g. superseded by the
   concertino workflow) and a follow-up, not left unmentioned. For reference, the complete live
   set is: `.husky/pre-commit`, `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `README.md`,
   `CLAUDE.md` (**two** places), `package.json`, `frontend/package.json`, `concertino.config.json`
   + the two rendered `.claude/agents/concertino-{executor,evaluator}.md` (deferred by D6), and
   `.cursor/skills/linear-ticket-delivery/SKILL.md`.

3. **design.md:3 attributes to the round-1 skeptic a reproduction it did not perform.** "The
   design-gate skeptic independently reproduced every measurement in this section" is false as
   stated: `skeptic-design-1.md` finding 1 reproduces the current-base run and the `12fae281` run
   only; the `d7815d15` bisection point (design.md:10-11) appears nowhere in that report. In a
   change whose entire subject is not claiming verification you do not have, borrowing a
   reviewer's authority for a check they never reported is the same defect in miniature. For the
   record, the underlying facts are sound — I ran `d7815d15` this round and it exits 0 — so this
   is an attribution fix, not a measurement problem. Either attribute precisely (name which
   measurements which round reproduced) or drop the sentence.

4. **`ticket.md`'s acceptance criteria silently diverge from the filed ticket.** Linear HEL-683
   lists **four** ACs; `ticket.md`'s "Acceptance criteria" section lists **five** — planning added
   "The gate is proven to fail on a real type error (red-before-green), not merely proven to
   pass", and reworded the filed "No behavioral changes — type-level fixes only" to
   "type-level/**tooling** changes only". Both edits are defensible (the addition is strictly
   stronger; the rewording is forced by AC 1 already being satisfied), and the *scope narrowing*
   is disclosed prominently — but the AC-list edit itself is not. The orchestrator's Planning
   step 2 specifies ticket.md carries the ticket's acceptance criteria, and
   `concertino-evaluator.md:79` checks "No AC silently reinterpreted"; a downstream gate tracing
   ACs from ticket.md would never learn the list was changed. Fix: one provenance line in
   ticket.md stating the filed list had four items, what planning added/reworded, and why.

### Non-blocking notes

- **D3's "`-n` is not routine practice" is a generous adjective for a measured ~29%.** 20 of the
  68 change dirs archived since 2026-08-15 mention a `git commit -n`, and the trigger is exactly
  the HEL-657 `check:openspec` false positive D3 names. The honest part is present and the
  conclusion is the conservative one, so this is not blocking — but a measured number would be
  strictly better than an adjective in a design doc about gate honesty. Related tension worth a
  glance: `CONTRIBUTING.md:152` says "Never use `--no-verify` to bypass a real gate failure. The
  only acceptable use is an environmental hook breakage."
- **Task 4.1 should require the probe to be lint-clean as well as non-test-imported.**
  `.husky/pre-commit` runs root `npm run lint` (`eslint . --max-warnings=0`) *before* the new
  typecheck step, so a probe that trips a lint rule aborts at step 1 and proves nothing about the
  typecheck leg. 4.3's "record WHICH step produced the failure" catches it after the fact;
  specifying it up front is cheaper. (Round 1 verified a plain exported type mismatch is
  lint-clean, so a well-chosen probe is fine — the point is to say so.)
- **proposal.md calls pre-commit and CI "both enforced gate sets"** while D3 correctly calls CI
  *advisory* (no branch protection). Align the proposal's wording with the design's.
- **Hook ordering is right**: typecheck second, ahead of `check:openspec` and `npm test`, both
  slower and both prone to unrelated reds.
- Environment note, not a blocker: `scripts/concertino/` is gitignored, so `next-report-number.sh`
  and `persist-evidence.sh` are absent from this worktree; I invoked the main checkout's copies by
  absolute path (`next-report-number.sh` returned `READY number=2`).
