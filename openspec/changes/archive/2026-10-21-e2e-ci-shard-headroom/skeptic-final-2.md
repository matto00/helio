## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD dedfdeebd73e607d40aa0e58725ed138c6f4316f against the live base 26f6a1ede9b8b5f6c2b7144f9dc4d61698ea5a11 (`resolve-review-base.sh main origin`, exit 0). The change is CI-only, so section 4 (UI) does not apply and no servers were started. I did not re-litigate the 6-leg owner ruling. AC measurement (5 green main runs, slowest leg <= 20 min) is post-merge and owned by the driver.

### What I verified (with evidence)
- **Cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/e2e-ci-shard-headroom/HEL-1698`.
- **Round-1 CR1 (Dependabot coverage), resolved.** `.github/dependabot.yml:75-77` now has `directories: ["/", "/.github/actions/*"]` for `package-ecosystem: "github-actions"`, replacing `directory: "/"`.
  - `directories` accepts glob patterns, and `*` matches the single segment `e2e-setup`, so the composite action's pins are in scope. That claim rests on my knowledge of GitHub's Dependabot docs. No offline schema exists in the repo, and this sandbox has no web access.
  - `/` still covers `.github/workflows/*`.
  - The single `groups.github-actions: patterns ["*"]` group spans both directories, so workflow pins and action pins move together in one PR.
- **`check:dependabot` parses the entry rather than skipping it.**
  - I imported `parseDependabotYaml` and printed every update entry. The github-actions entry came back as `{"ds":["/","/.github/actions/*"],"g":["github-actions"]}`, so the flow sequence parses to a real 2-element array.
  - The neighbouring `sbt` and `npm` entries parse intact: `/backend` with group `sbt`, and the three npm directories with their groups.
  - Scope caveat: the checker validates only npm families and coverage (`check-dependabot-groups.mjs:355-378`, `:395-397`). It never validates github-actions entries, before or after this change. "Passes" therefore means "parses without breaking the rest", not "validates this key". That is a pre-existing scope limit, not a defect here.
  - `npm run check:dependabot` exit 0, and `check:dependabot:selftest` 6/6.
- **Round-1 nits:**
  - `e2e/README.md:109` now says `plan` (default 6 legs).
  - `README:113` documents `--legs 4` for pre-HEL-1698 runs.
  - The `playwright.config.ts:169-171` comment now has balanced parentheses and is wrapped.
  - A new CLI selftest (`e2e-shard.selftest.mjs:172-192`) spawns the real script: `weights --legs 4 <4-report dir>` exits 0, and the same dir without `--legs` exits 1 with stderr naming the dir and "expected exactly 6". Reading `findReports(runDir, expected)` confirms that dropping the `legs` pass-through would turn the first assertion red, so the test is failable.
- **Whole-branch fresh review:**
  - **Composite action:** every `run:` step has `shell: bash`, and only the Vite step is gated (on `inputs.start-dev-frontend == 'true'`). `e2e-prod-build` passes `"false"`, matching its old step set, which had no Vite step. Steps and versions are verbatim from the removed inline blocks.
  - **Matrix:** `[1..6]` with `max-parallel: 6`. Leg count passes as `${{ strategy.job-total }}` (ci.yml:630).
  - **Triggers:** ci.yml has no path filters (push/PR on main), so action edits always run e2e. `e2e-slow.yml` now also triggers on `.github/actions/e2e-setup/**`.
  - **Pattern-kill guard:** now scans `e2e-slow.yml` and `action.yml`.
  - **No stale leg counts:** a grep for `four shard|shard-4|plan 4|EXPECTED_SHARD_REPORTS` outside openspec finds only the derived constant.
- **Gates re-run by me (fresh, all exit 0):**
  - `e2e-shard.selftest.mjs` (18 cases)
  - `check-e2e-slow-results.selftest.mjs` (6)
  - `check-ci-sbt-no-pattern-kill.mjs` (6 files) and its selftest
  - `check-ci-complete-needs.mjs`
  - `check-precommit-ci-parity.mjs`
  - `check:test-temp-dir-hygiene`
  - `check:openspec`
  - `prettier --check` on every changed non-openspec file
  - js-yaml load of action.yml, ci.yml, e2e-slow.yml and dependabot.yml
  - Working tree clean.
- **Evidence:** no screenshots or mtime-based evidence were used. No gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- `check-dependabot-groups.mjs` gives no protection for non-npm entries. A future typo in the github-actions `directories` key (for example `/.github/action/*`) would pass every local gate. An optional follow-up: assert that each `.github/actions/*/action.yml` is covered by some github-actions entry.
- The AC margin is still real but modest (plan ~1385 weighted s per leg). The post-merge watch is the true measurement.
