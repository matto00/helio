## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Alert-set ground truth matches the design's table exactly.** Re-ran
   `gh api repos/matto00/helio/dependabot/alerts -X GET -f state=open` myself (not trusted from the
   artifacts) and reduced it to `{number, manifest, package, severity, ghsa, first_patched, vulnerable_range}`
   for all 35 open alerts. Confirmed independently:
   - Severity split: 15 high / 19 medium / 1 low (exact match to ticket.md).
   - Per-manifest counts: `frontend/package-lock.json` 23, `helio-mcp/package-lock.json` 10, root
     `package-lock.json` 2 (exact match).
   - Every row of design.md's version-floor table reproduces correctly from the raw alert data,
     including the two cases where the design correctly took the *max* of multiple alerts on the
     same package (`postcss` max(8.5.18, 8.5.23) = 8.5.23; `fast-uri` max(3.1.4, 3.1.5) = 3.1.5 in
     both frontend and helio-mcp) and the two cases where it correctly kept separate floors per
     major line (`brace-expansion` 1.x/2.x; `js-yaml` 3.x/4.x in root).
   - PR #258 (`gh pr view 258` / `gh pr diff 258`) confirmed OPEN, titled "Bump axios from 1.16.0 to
     1.18.0 in /frontend...", and its diff shows exactly `axios: ^1.15.0 → ^1.18.0` in
     `frontend/package.json` plus the lockfile bump to 1.18.0 — matches design.md's claim that it
     covers all 10 axios GHSAs (all 10 have `first_patched=1.18.0` in the raw alert data) but only
     10/35 overall.

2. **Currently-locked versions and direct-vs-transitive classification are accurate.** Parsed all
   three lockfiles directly (Python/`json`, not npm) for every flagged package. Every package the
   design calls "transitive" (`postcss`, `fast-uri`, `brace-expansion`, `js-yaml`, `sharp`, `hono`,
   `ip-address`, `@hono/node-server`) is absent from `dependencies`/`devDependencies` in the
   corresponding `package.json`; `axios` and `react-router-dom` are the only direct deps among the
   35, matching the design's table. Instance counts match (single instance everywhere except
   `brace-expansion`, which actually has *three* installed instances — 2.1.0 top-level, 1.1.14
   nested under `test-exclude`, and 5.0.7 nested under `workbox-build` — but I confirmed the 5.0.7
   instance falls outside both alerts' `vulnerable_version_range` (`< 1.1.16` and `>= 2.0.0, <
   2.1.2`), so it needs no floor and the design's two-row table is complete, not incomplete).

3. **The sharp override-fallback case is real and correctly anticipated.** `sharp`'s only parent,
   `@vite-pwa/assets-generator` (a `dev: true` transitive), pins `"sharp": "^0.33.5"` in the
   lockfile — under 0.x semver rules that's `>=0.33.5 <0.34.0`, which cannot reach the required
   `>=0.35.0` via a plain `npm update`. Design Decision 2's generic "targeted update first,
   `overrides` fallback, document the pinning parent" correctly anticipates this exact case.

4. **Existing `frontend/package.json` `overrides` block does not conflict.** It already scopes
   `"@istanbuljs/load-nyc-config": {"js-yaml": "^3.15.0"}` — one of the 35 flagged packages. I
   verified `^3.15.0` under standard (non-0.x) caret semantics is `>=3.15.0 <4.0.0`, which comfortably
   admits the required `3.15.1` floor, so this pre-existing override is not a blocker. (Flagged for
   my own scrutiny given it directly touches a scoped package; verified benign.)

5. **`npm test` does not exist as a script in `helio-mcp/` — confirmed by actually running it.**
   ```
   $ cd helio-mcp && npm test
   npm error Missing script: "test"
   ...
   EXIT: 1
   ```
   `helio-mcp/package.json`'s `scripts` block is `{build, start, dev, typecheck, verify, compose,
   verify-bound-panel}` — no `test`. See Change Request 1.

6. **No task item operationalizes AC1's post-merge alert recheck or AC4's PR #258 disposition.**
   Read tasks.md fully (sections 1–6, all items). Design.md Decision 5 states the plan in prose
   ("note in our PR body that it supersedes #258... after the human merges our PR, close #258 with
   a comment") and Decision 3 explicitly defers the definitive alerts-API recheck to "delivery/close,
   per the AC" — but neither action appears as a checklist item anywhere in tasks.md. See Change
   Request 2.

7. **Scope, non-goals, and version-jump characterization hold up.** No major-version bumps are
   actually required (`axios` 1.15→1.18, `react-router-dom`/`react-router` 7.16→7.18, both within
   major); `sharp` 0.33→0.35 is a 0.x "quasi-major" bump but is transitive/dev-only (build-time
   icon generation), and the design's existing risk item ("transitive bump breaks build toolchain")
   plus the required `npm run build` gate already covers this — no additional design flaw here.
   The proposal's "Modified Capabilities: None... archive with `--skip-specs`" is consistent with
   the spec delta's own header note that it exists only to make floors testable for evaluation, not
   for canonical merge — self-consistent, not a contradiction (minor naming inconsistency vs. the
   already-merged `dependency-security-patch` capability noted below as non-blocking).

### Verdict: REFUTE

### Change Requests

1. **Fix the `helio-mcp` test gate — it targets a script that does not exist.** ticket.md's AC2
   ("`npm test` (root, `frontend/`, `helio-mcp/`) ... all pass") and tasks.md task 5.1 ("`npm test`
   green in root, `frontend/`, and `helio-mcp/`") both assume a `helio-mcp` test script that is not
   present in `helio-mcp/package.json` — running it fails immediately with `npm error Missing
   script: "test"` (exit 1), unrelated to the dependency bump, reproduced above. Revise tasks.md
   task 5.1 (and note the correction against ticket.md's AC2 wording, since the AC as literally
   written is unsatisfiable) to substitute the checks `helio-mcp/` actually has:
   `npm run typecheck` (`tsc --noEmit`) and `npm run build` (`tsc`) — these are the real
   applicable regression gates for a dependency bump in a TypeScript-only package with no test
   suite.

2. **Add explicit tasks for AC1's post-merge verification and AC4's PR #258 disposition.**
   tasks.md has no task backing either of these two ACs — they exist only as prose in design.md
   Decisions 3 and 5. Since tasks.md is the operational checklist the executor works from, add a
   "Delivery" section (or extend section 6) with concrete items:
   - Note in the PR description that this change supersedes Dependabot PR #258, listing which of
     its 35 alerts each get resolved by this change vs. by #258 alone.
   - Post-merge (or as delivery instructions for whoever merges/closes): re-run
     `gh api repos/matto00/helio/dependabot/alerts?state=open` and confirm the count dropped from
     35 by exactly the scoped set (any alerts opened after this ticket was scoped are explicitly
     out-of-scope per ticket.md and should not block this check).
     Close PR #258 with a comment linking this change, once merged.
   Without an explicit task, both AC1's "verified... post-merge" clause and all of AC4 are at real
   risk of being silently skipped, since nothing currently instructs the executor (or a downstream
   agent) to perform them.

### Non-blocking notes

- Consider checking whether a newer `@vite-pwa/assets-generator` release exists that natively
  depends on `sharp >=0.35.0` before reaching for an `overrides` entry — Decision 2's own stated
  preference ("prefer resolution the dependency tree can express naturally... overrides are sticky
  footguns") would favor bumping the immediate parent over overriding its pinned transitive if a
  suitable parent version exists. Either path resolves the alert; not blocking.
- The new spec delta capability is named `dependency-security` while a prior, already-merged
  capability at `openspec/specs/dependency-security-patch/spec.md` covers a related but narrower
  scope (`follow-redirects` override only). Since this delta is explicitly archived with
  `--skip-specs` and never merges into the canonical spec tree, there's no collision — but a
  future dependency-sweep ticket might want to reuse/extend the existing `dependency-security-patch`
  capability name for consistency rather than inventing a new sibling name each time.
