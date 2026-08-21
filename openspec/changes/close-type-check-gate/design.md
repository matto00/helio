## Context

Measured on base `8432f280`, in the worktree, before any edit. Reproduction, attributed precisely: the round-1
design-gate skeptic independently reproduced the current-base run and the `12fae281` run; the round-2 skeptic
reproduced those *and* the `d7815d15` bisection point. No measurement below rests on planning's word alone.

- `npx tsc --noEmit -p frontend` (the ticket's AC 1 command) exits **0**, in ~5s — no frontend type errors remain.
- Taking `12fae281`'s `frontend/` **source** (main's tip when this ticket was filed) against **today's**
  `node_modules`, the same command exits 2 with **60 error lines** — 58 `toastListeners.ts`, 1
  `listenerMiddleware.ts`, 1 `config/env.ts`. This isolates the fix to *source* changes rather than dependency
  drift; it is not a claim about what CI would have printed on that commit's own lockfile. The errors were already
  absent at `d7815d15` (HEL-535's parent), so the fix landed in the 49-commit window `12fae281..d7815d15` as a side
  effect of unrelated work.
- `.husky/pre-commit` runs `lint`, `format:check`, `check:schemas`, `check:openspec`, `check:scala-quality`, `test`.
  The CI frontend job (`ci.yml:36-38`) runs `npm run lint`, `npm run format:check`, `npm test`. Neither runs `tsc`.
- **No whole-program type check exists, but type-checking is not literally absent**: `ts-jest` type-checks modules
  *reachable from a test*. The historical errors escaped because nothing imported them — at `12fae281`,
  `store.test.ts` mentions `listenerMiddleware` only in a comment and Jest passed with `TS2344` present. The hole is
  exactly the un-tested-module surface.
- `frontend/tsconfig.json` has `"include": ["src", "tests"]`; `frontend/tests` does not exist.
- The repo-root `tsconfig.json` has no `include`, uses `commonjs`/`node` resolution, and emits 218 error lines —
  overwhelmingly resolution artifacts (`import.meta`, `react-grid-layout/core`, `vite`), not real defects.

## Goals / Non-Goals

**Goals:**

- An enforced type-check gate wired where `lint` is enforced today: pre-commit and CI.
- The gate demonstrably fails on a real type error — direct observation where possible, mechanical assertion where not.
- Gate coverage matches the real frontend surface, not a subset that silently omits config files.
- Every document enumerating the enforced gate set is updated in the same change.

**Non-Goals:**

- Type-error fixes in `frontend/src` (none remain), `e2e/` or `helio-mcp/` coverage, root-`tsconfig.json` repair,
  branch protection.
- Any change to `scripts/check-openspec-hygiene.mjs` or `openspec/specs/` — HEL-775 owns both concurrently.
- **Adding a `typecheck` entry to `concertino.config.json`'s `gates`** — see D6. Recorded as a residual gap with a
  named follow-up, not silently omitted.

## Decisions

**D1 — Gate on `frontend/tsconfig.json`, never the root `tsconfig.json`.** The AC names `-p frontend`, and the root
config is 218 errors of misconfiguration — gating on it would be red from commit one and promptly disabled.
*Alternative rejected:* fixing the root config first is a separate, larger change (it needs per-area project
references), and bundling it would block this gate behind unrelated work.

**D2 — Script name `typecheck`, in `frontend/package.json`, with a root passthrough.** `helio-mcp/package.json`
already defines `"typecheck": "tsc --noEmit"`; reusing the name keeps one vocabulary. The passthrough
(`npm --prefix frontend run typecheck`) mirrors how root `test` already delegates, and is more worktree-robust than
the AC's literal command: `CONCERTINO_LINK_MODULES` populates only `frontend/node_modules`, so a worktree has no root
`node_modules`, and `npm --prefix frontend` resolves `tsc` regardless. *Alternative rejected:* invoking
`npx tsc --noEmit -p frontend` from the hook and workflow — duplicates it in two places and inherits npx's
resolution fragility.

**D3 — Wire into both pre-commit and CI, not one.** The ticket allows either; both is strictly stronger and matches
`lint`. Measured cost ~5s. Neither gate alone suffices, and the reasons are asymmetric:
- Pre-commit is *bypassable* with `git commit -n`. Worktrees here are provisioned to run the full hook chain
  (`setup-worktree.sh` populates `frontend/node_modules` so tickets need not resort to `-n`), yet **20 of the 68
  change dirs archived since 2026-08-15 (~29%) record a `-n`**, triggered by the HEL-657 `check:openspec`
  false-positive on implementation commits. A bypass skips the new step with the rest, so pre-commit alone cannot
  carry this gate. (CONTRIBUTING.md:152 already restricts `-n` to environmental breakage; that ~29% deserves its own
  follow-up, not this ticket.)
- CI is *advisory*: helio has no branch protection, so a red frontend job does not mechanically block a merge.
Wiring both maximises the chance a failure is seen; neither makes recurrence impossible, and the PR says so.


**D4 — Correct the tsconfig `include` to `["src", "vite.config.ts", "pwa-assets.config.ts"]`.** `tests` does not
exist — a phantom entry making coverage look broader than it is. The two config files are the *only* tracked
TypeScript outside `frontend/src`, so the widening is complete. Both measured clean, and the hole was proven live:
under today's `include` a real type error in `vite.config.ts` yields exit 0 and is invisible; widened, it yields
`TS2322` and exit 2. `include` affects `tsc` only — `vite build` uses esbuild and ESLint does no typed linting.
*Alternative rejected:* leaving `include` alone — that ships a gate whose advertised scope ("the frontend") exceeds
its real scope (`src` only), the exact failure mode this ticket exists to end.

**D5 — Falsifiability is required for every leg of the gate, by the strongest means available to that leg.** A
type-check gate is exactly the class of check that can be wired up and do nothing: misspelled script name, hook not
executable, step in the wrong job, `|| true` swallowing the exit code. The three legs get three different proofs,
and the difference is stated rather than blurred:
- *Script leg — observed.* Introduce a deliberate type error, run `npm run typecheck` from root and `frontend/`,
  observe non-zero exit plus an `error TS…` line; revert; observe 0.
- *Pre-commit leg — observed.* Run the real hook against the same probe and observe it abort non-zero. The green
  counterpart must be observed **while the change is still in-progress**: once every task is ticked, `check:openspec`
  reports "complete but not archived" and reddens the hook for an unrelated reason. Evidence must name which step
  produced each result.
- *CI leg — asserted mechanically at Execution, confirmed executed at Delivery.* True CI *redness* cannot be observed
  without pushing a deliberately-broken throwaway PR, which this change will not do. Instead, in two parts owned by
  two different phases: (a) **Execution** parses the edited workflow and asserts the step exists, is in the
  `frontend` job, and cannot be neutered (no `continue-on-error`, no `|| true`) — tasks 3.3-3.6; (b) **Delivery**,
  after the PR exists, reads the actual run log and confirms the step really executed. (b) is deliberately NOT a
  task checkbox: `ci.yml` triggers only on `pull_request`, and the orchestrator creates the PR at Phase 3 *after*
  archiving this change, so the executor could never perform it and would have to either fabricate the tick or stall
  the cycle.
  Stated accurately, because an earlier draft of this doc got it wrong: **the orchestrator does not poll CI today.**
  `check-merge-readiness.sh` is invoked only by the *auditor* (`concertino-auditor.md:69`), a separate cold agent,
  and it checks whether every reported check is `SUCCESS` — never whether a *named step* ran. A green run with the
  step missing or in the wrong job is still green, so nothing in the existing workflow establishes (b) as a side
  effect. It is therefore carried as an explicit, durable **`DELIVERY_OBLIGATIONS` entry in `workflow-state.md`** —
  the artifact the orchestrator rewrites each phase transition and re-reads on resume — not prose in artifacts
  nothing reopens once Phase 3 archives them (archive moves this file too, but the orchestrator keeps editing it). Concrete sequence, once CI reports complete:
  `gh run view --job <frontend job> --log | grep -F "npm run typecheck"` (or `gh pr checks`), then `gh pr edit
  --body` to **append** the result, since the body is written at Phase 3 step 4 before CI has run and no later step
  edits it. "Present in YAML", "executed in CI" and "observed red" are three different claims; the spec and PR state
  which is which rather than implying an observation that was never made.
- The probe must live in a module **no test imports**, so the failure is unambiguously attributable to the new gate:
  `ts-jest` already reddens `npm test` on a type error in a test-reachable module.

**D6 — Do not add a `typecheck` entry to `concertino.config.json`'s `gates` in this change; record the gap.**
That file declares, for `frontend/**`, `npm run lint` / `format:check` / `npm test` / `build` — no typecheck — and it
is the source rendered into the *tracked* agent definitions (`.claude/agents/concertino-{executor,evaluator}.md`),
which `.concertino/laws/verification-before-completion.md` names as the delivery agents' verification commands.
Editing the config alone changes no agent behaviour; only `concertino sync` re-renders it, and running `concertino
sync` is disallowed for this run by operator constraint (CON-128). Hand-editing the rendered files instead would
create exactly the config↔render drift that constraint exists to prevent. So: after this change, `tsc` is enforced in
pre-commit and CI but still absent from the gate set delivery agents run. That is a real residual gap, named here and
in the PR, and carried as a follow-up to be applied when a sync is permitted. *Alternative rejected:* editing the
config now for a later sync to pick up — that manufactures sync-dependent work the operator has ruled out.

**D7 — Archive with `--skip-specs`, and record what that defers.** This change declares a new capability
`frontend-type-check-gate`, but archiving normally would write a fresh `## ADDED Requirements` block into
`openspec/specs/` while HEL-775 is concurrently normalising 22 files there — the fence this run must respect.
`--skip-specs` is therefore correct. The consequence, recorded rather than left implicit: the capability never lands
in canonical specs, so a *later* change submitting a MODIFIED/REMOVED delta against `frontend-type-check-gate` would
abort `openspec archive` against a canonical spec that lacks the requirement. Follow-up: apply this delta to
`openspec/specs/` once HEL-775 has merged.

## Risks / Trade-offs

- **Pre-commit is bypassable (`-n`); CI is advisory without branch protection.** → Wire both; state the limitation
  in the PR rather than overclaiming "cannot recur". Branch protection offered as follow-up.
- **CI redness is inferred, not observed.** → Mechanical assertion + run-log confirmation; labelled inferred wherever
  it appears (D5, spec.md, PR).
- **The probe could be left behind in a commit.** → Probes reverted, `git status` clean, evaluator re-checks the diff.
- **Docs drifting from the hook.** → Five live enumerations are updated here: CONTRIBUTING.md's Pre-Commit Policy
  block, **both** CLAUDE.md sites (the command list *and* the prose "Pre-commit hooks" section, which names only
  "ESLint, Prettier, and Jest" and already understates the hook), README.md's list, and
  `.cursor/skills/linear-ticket-delivery/SKILL.md`'s frontend gate list — hand-maintained, so D6's deferral does not
  cover it. Task 5.5 sweeps for remaining hits and records an update-or-exempt decision for each, rather than
  asserting a negative ground truth falsifies.
- **Concurrent HEL-775 may touch `.husky/pre-commit`** if it adds a hygiene guard. → Merge `origin/main` before the
  evaluation gates (CON-129) so they run against the integrated tree.
- **Residual gaps by design:** `concertino.config.json` gates (D6), canonical spec delta (D7), `e2e/`+`helio-mcp/`
  coverage, root `tsconfig.json`, and a CI step that parses but never runs. → All named in the PR with follow-ups.

## Planner Notes

Self-approved, all within ticket scope: D2's script name and passthrough, D3's both-gates wiring, D4's `include`
correction (measured clean first), and the doc updates keeping CONTRIBUTING.md truthful. D6/D7 are deferrals forced
by external constraints (the `concertino sync` prohibition; HEL-775's ownership of `openspec/specs/`), recorded with
follow-ups. The AC-1 scope narrowing is recorded in `ticket.md` and surfaced in the PR.
