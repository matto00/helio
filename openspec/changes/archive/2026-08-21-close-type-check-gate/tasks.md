## 1. Baseline

- [x] 1.1 Run `npx tsc --noEmit -p frontend` from the repo root; record exit code (expected 0) as the pre-change baseline
- [x] 1.2 Confirm `frontend/tests` does not exist and that `vite.config.ts` / `pwa-assets.config.ts` fall outside the current `include`

## 2. Frontend

- [x] 2.1 Add `"typecheck": "tsc --noEmit"` to `frontend/package.json` scripts, adjacent to `lint`
- [x] 2.2 Add `"typecheck": "npm --prefix frontend run typecheck"` to the repo-root `package.json` scripts, adjacent to `lint`
- [x] 2.3 Change `frontend/tsconfig.json` `include` from `["src", "tests"]` to `["src", "vite.config.ts", "pwa-assets.config.ts"]`
- [x] 2.4 Verify `npm run typecheck` exits 0 from both `frontend/` and the repo root after 2.1-2.3

## 3. Gate wiring

- [x] 3.1 Add `npm run typecheck` to `.husky/pre-commit`, immediately after `npm run lint`
- [x] 3.2 Add a `- run: npm run typecheck` step to the CI frontend job in `.github/workflows/ci.yml`, immediately after `npm run lint`
- [x] 3.3 Assert mechanically (node `js-yaml` or `python3 -c "import yaml"`) that `ci.yml` still parses after the edit
- [x] 3.4 Assert mechanically that a step with `run` exactly `npm run typecheck` exists under `jobs.frontend.steps`, and does NOT exist under `jobs.backend`
- [x] 3.5 Assert mechanically that neither that step nor the `frontend` job sets `continue-on-error`, and the step's `run` contains no `|| true`
- [x] 3.6 Record the assertion output as evidence; a hand-eyeballed YAML read does not satisfy 3.3-3.5

## 4. Falsifiability proof (red-before-green)

- [x] 4.1 Pick a probe site: a tracked `frontend/src` module that NO test imports (else ts-jest reddens `npm test` and blurs which gate caught it) and whose error is lint-clean (root `npm run lint` runs BEFORE typecheck in the hook). Pre-verified candidate: `frontend/src/features/pipelines/hooks/useAnalyzePipeline.ts` (zero importers repo-wide at base `8432f280`) — re-confirm both properties before use rather than trusting this line
- [x] 4.2 Introduce the deliberate type error; run `npm run typecheck` from the repo root and from `frontend/`; capture non-zero exit AND the `error TS…` line; record the transcript
- [x] 4.3 Run the real `.husky/pre-commit` hook against that probe; confirm it aborts non-zero, and record WHICH step produced the failure
- [x] 4.4 Introduce a deliberate type error in `frontend/vite.config.ts`; confirm the gate reports it, proving the widened `include` is live; revert it
- [x] 4.5 Revert every deliberate error; confirm `git status` shows no probe residue
- [x] 4.6 Re-run `npm run typecheck` (expect 0) and the pre-commit hook (expect green) WHILE this change is still in-progress — once all tasks are ticked, `check:openspec` reddens the hook for an unrelated reason; record which step produced each result

Note: confirming the CI step actually executed is a **Delivery-phase obligation on the orchestrator**, not a task
here — CI triggers only on `pull_request`, and the PR is created after this change is archived. See design.md D5.

## 5. Documentation parity

- [x] 5.1 Update CONTRIBUTING.md's Pre-Commit Policy block (the command list) so it still enumerates the hook line-for-line
- [x] 5.2 Update BOTH CLAUDE.md sites: the frontend command list, and the prose "Pre-commit hooks" section, which today says only "ESLint, Prettier, and Jest" and already understates the hook
- [x] 5.3 Add `npm run typecheck` to README.md's frontend command list
- [x] 5.4 Update `.cursor/skills/linear-ticket-delivery/SKILL.md`'s frontend verification-gate list (hand-maintained: no `concertino:sync` marker, so D6's deferral does not cover it)
- [x] 5.5 Sweep for any remaining live enumeration — `git grep -nE "format:check|check:scala-quality|Husky|pre-commit" -- ':!openspec/changes' ':!openspec/specs' ':!**/node_modules'` — and record an explicit update-or-exempt decision for every live hit (do NOT assert "no others exist"; ground truth says otherwise). `openspec/specs/` is excluded deliberately: HEL-775 owns that tree this run, so its 8 hits are exempt-by-fence and MUST NOT be edited. Also decided EXEMPT (found by the final gate, outside the grep pattern): `.github/PULL_REQUEST_TEMPLATE.md:11` — a deliberately non-exhaustive author checklist that already omits `format:check`/`check:schemas`, so it never claimed to enumerate the gate set

  **Sweep result and per-hit decision** (ground truth via `git grep`, run after 5.1-5.4's edits):

  - `.claude/agents/concertino-evaluator.md:96`, `.claude/agents/concertino-executor.md:116` — **EXEMPT.** These are rendered output of `concertino sync` from `concertino.config.json`'s `gates` (frontend: lint/format:check/test/build, no typecheck). Per D6, adding a `typecheck` entry to `concertino.config.json` requires a `concertino sync` re-render, disallowed this run (CON-128); hand-editing the rendered `.md` files directly would create the exact config↔render drift D6 exists to prevent. Same named residual gap as D6, not a new one.
  - `concertino.config.json:61` (`gates` command list) — **EXEMPT per D6**, explicitly deferred there.
  - `.cursor/rules/agent-workflow.mdc:23` and `CLAUDE.md:175` (`### Verification before committing`) — **EXEMPT.** Both read "Respect pre-commit policy: lint, format, and tests are expected to pass." — a categorical reference, not a specific command enumeration (it already omits `check:schemas`/`check:openspec`/`check:scala-quality`, so it was never exhaustive). Distinct from the two CLAUDE.md sites design.md D3 named for update (the literal command list and the "Pre-commit hooks" prose section), both already updated in 5.2.
  - `CONTRIBUTING.md:15` ("Ensure all pre-commit checks pass (see below)"), `:126` (backend-tests note), `:153` (`--no-verify` policy) — **EXEMPT.** None enumerate specific commands; the actual enumeration (line ~112-120) was updated in 5.1.
  - `docs/cloud-dev-setup.md:84` (`npm install # root-level deps (Husky, ESLint, Prettier, Jest)`) — **EXEMPT.** Describes root-level *devDependency categories* installed by `npm install`, not the hook's command list; unaffected since `typescript` was already a devDependency in both manifests before this change.
  - `e2e/hel399-shape-instantiate.spec.ts`, `hel665-message-composer.spec.ts`, `hel666-single-assistant-entry.spec.ts`, `hel716-panel-creation-focus-trap.spec.ts`, `hel716-panel-detail-tall-viewport-footer.spec.ts`, `hel773-top-anchored-mobile-nav-sheet.spec.ts` — **EXEMPT.** Each asserts e2e is *not* part of pre-commit; none enumerate what is. Still accurate.
  - `notes/mobile-pwa-handoff.md:435` (`` `npm run lint && npm test` clean; Husky pre-commit passes. ``) — **EXEMPT.** Historical, dated handoff note for an already-shipped feature, already non-exhaustive before this change (omits `format:check` etc.); not a canonical live spec of the hook.
  - `openspec/config.yaml:25` ("Zero-warnings ESLint policy; Prettier formatting enforced by Husky pre-commit hook") — **EXEMPT.** A curated conventions highlight, not a hook-command enumeration (already omits `check:schemas`/`check:openspec`/`check:scala-quality` too).
  - `scripts/check-scala-quality.mjs:3`, `scripts/concertino/setup-worktree.sh:44,290` — **EXEMPT.** Self-referential/infra comments about the hook needing installed deps, not enumerations of its full command set.
  - `.husky/pre-commit`, `.github/workflows/ci.yml`, `frontend/package.json`, `package.json` — **N/A.** These ARE the gate set (source of truth), already updated in task groups 2 and 3, not "documentation enumerating" it.
  - `CLAUDE.md:19,66` (frontend command list + "Pre-commit hooks" prose), `CONTRIBUTING.md:117` (Pre-Commit Policy block), `README.md:96` (frontend command list), `.cursor/skills/linear-ticket-delivery/SKILL.md:123` — **UPDATED** in 5.1-5.4.
  - `openspec/specs/**` (8 hits) — **exempt-by-fence** (HEL-775 owns this tree this run); not read-modify-written, per operator constraint.

## 6. Tests

- [x] 6.1 Run `npm --prefix frontend test`; confirm it passes with no test file modified by this change
- [x] 6.2 Run `npm run lint` and `npm run format:check` clean at the repo root
- [x] 6.3 Run `npm run build` in `frontend/`; confirm the production build is unaffected by the `include` change
- [x] 6.4 Confirm the final staged diff contains only the intended source/doc files plus this change's openspec artifacts, and no probe residue
