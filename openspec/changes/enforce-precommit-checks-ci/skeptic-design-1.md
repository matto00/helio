## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `8fc7face201a696ba4c3011d5a148702b3a3d79d` (branch is even with base `main`;
planning artifacts are uncommitted, as expected at a design gate).

### What I verified (with evidence)

**Premise — the four checks really are absent from CI. CONFIRMED (both forms).**
- By npm-script name: `grep -rn "repo-integrity\|scala-quality\|check:schemas\|spec-structure" .github/` → **no hits**.
- By underlying script path: `grep -rn "check-repo-integrity\|check-scala-quality\|check-schema-drift\|check-spec-structure" .github/` → **no hits**.
The ticket's table maps each script correctly against root `package.json` (`check:schemas` → `scripts/check-schema-drift.mjs`, the non-obvious one). Premise is sound.

**AC3 — the four pass on current main. CONFIRMED, nothing to fix or file.**
Ran all four in the worktree (identical tree to base): `check:repo-integrity` exit 0; `check:scala-quality` exit 0 ("clean (164 soft warning(s))" — soft warnings are non-fatal by design); `check:schemas` exit 0 (95 schemas / 49 protocol files); `check:spec-structure` exit 0 (383 canonical specs, 0 issues).

**Approach — extend `frontend`, don't add a job. CONFIRMED correct.**
`.github/workflows/ci.yml:406-408`: `ci-complete: if: always()`, `needs: [frontend, backend, security, e2e]`, failing only on `failure`/`cancelled`. A step added to `frontend` therefore gates `ci-complete` with **no** `needs:` edit. Task 2.2's "confirm no new entry is needed" is verified true in advance.

**Cited precedent — accurate, not invented.** All four cited tickets are real comments in this file and every one extended the `frontend` job rather than adding a fifth: HEL-913 (lines 32-43), HEL-846 (47-55), HEL-1037 (56-60), HEL-996 (71-95), plus an uncited fifth instance HEL-866 (61-70). The design's characterization of the precedent is exact.

**`check:spec-structure`'s environment dependency — correctly identified, and the wiring is non-vacuous.**
`scripts/check-spec-structure.mjs:49-73`: resolves the CLI via `which openspec`, and on failure **`process.exit(2)`** — a hard fail, not a silent skip. So (a) ordering after HEL-996's "Install openspec CLI" step (ci.yml:83-87) is genuinely load-bearing, not cosmetic, and (b) the new CI step cannot pass vacuously if the CLI is missing. Design's Risk #2 and Decision 1's ordering rationale both hold.

**Gate chain unchanged.** `.husky/pre-commit`'s real content is not modified by the shipped diff (task 3.4 explicitly confines the failability demo to a scratch copy). No gate-chain concern.

**Scope/AC coverage.** AC1 → tasks 2.1/2.2; AC2 → tasks 3.1-3.4; AC3 → task 1.1. No AC uncovered, no task outside the ticket. `skip_specs: true` is justified (no API/schema/behavior contract touched).

### Verdict: REFUTE

The wiring half is sound and I would ship it as-is. The **drift guard** — the ticket's second AC, whose entire value is having no blind spots — is specified with one internal contradiction and two unspecified cases that an implementer would have to resolve by guessing. All three are cheap paragraph-level fixes to design.md.

### Change Requests

1. **`design.md` Decision 2 contradicts itself about `npm test`, leaving a permanent blind spot in the guard.**
   The parse rule is "extract every `npm run <script>` line (regex over non-comment lines)", but the Exclusions paragraph asserts "`npm test` and lint/typecheck/format steps … the guard still checks them like any other hook script (uniform treatment, no hand-maintained allowlist to rot)." These cannot both hold: `.husky/pre-commit:19` is the bare shorthand **`npm test`**, not `npm run test`, so the stated regex cannot see it (measured: 18 `npm run` lines + 1 `npm test` = 19 hook invocations). Under the literal regex the guard silently ignores `npm test` forever — if a future change drops `npm test` from `ci.yml:96`, the guard stays green, which is exactly the drift this ticket exists to catch. Resolve explicitly: state that the hook parser matches **both** `npm run <script>` and the `npm <script>` shorthand forms (`npm test`, `npm start`), or state that `npm test` is deliberately out of the guard's scope and why. Do not leave both sentences standing.

2. **The script→underlying-path resolution table is specified only for the `node scripts/*.mjs` case, which covers 13 of the 19 hook entries.** Decision 2's example (`check:repo-integrity` -> `node scripts/check-repo-integrity.mjs`) does not generalize to the six hook scripts whose `package.json` commands are not node-script invocations: `lint` (`eslint . --max-warnings=0`), `typecheck` (`npm --prefix frontend run typecheck`), `check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`), `check:helio-mcp-types` (`npm --prefix helio-mcp run typecheck`), `format:check` (`prettier . --check`), and — if CR1 resolves toward inclusion — `test` (`jest && npm --prefix frontend test`, a compound command). Specify the behavior for a hook script that resolves to no single script path: name-matching only, with path-resolution treated as an optional additional way to be covered (never a requirement). As written an implementer could reasonably build a resolver that throws or mis-resolves on a compound command.

3. **"Covered by CI" is defined as appearing in any `.github/workflows/*.yml`, which admits the same class of hole the ticket is closing.** The repo has five workflows; only `ci.yml`'s jobs feed `ci-complete`. `cd-backend.yml`, `cd-frontend.yml`, `dependabot-auto-merge.yml` and `dependabot-metadata.yml` do not gate a PR. Under the design as written, a check that exists only in a CD workflow (tag-triggered — `cd-backend.yml` runs on `push: tags: ["v*"]`, never on a PR) counts as "covered" and the guard reports green while nothing blocks a merge. Narrow the guard's notion of coverage to workflows/jobs that actually gate `ci-complete` (at minimum: only `ci.yml`, and state that assumption in the script header), or justify in design.md why any-workflow presence is acceptable.

### Non-blocking notes

- design.md's Context says all four are "pure Node.js (`readFileSync`/`readdirSync` over the tree)". Two of them shell out: `check-repo-integrity.mjs:36` runs `git config --get core.bare` (via `gitChildEnv()`), and `check-spec-structure.mjs` runs `which` plus dynamic-imports the CLI's `dist/` modules. The operative conclusion is unaffected (no sbt, no network, sub-second, and `actions/checkout` yields `core.bare=false` so repo-integrity will pass in CI) — but the characterization is inaccurate and shouldn't be relied on later as if it were verified.
- The glob `.github/workflows/*.yml` will silently miss a future `.yaml`-suffixed workflow. Cheap to match both.
- Decision 1 places the four "immediately after the existing `check:openspec`/`check:openspec:selftest` steps" — that lands them between `ci.yml:95` and the existing `npm test` at line 96. No conflict, just noting the insertion point is mid-job, not end-of-job.
