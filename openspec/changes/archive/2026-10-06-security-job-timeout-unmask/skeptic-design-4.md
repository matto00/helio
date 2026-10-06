## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD e043566d1a0534c5aa98085dfa2b94431775ad28. The change dir is untracked, and no workflow edit exists
yet. I read ticket.md, proposal.md, design.md, tasks.md, specs/ci-security-job-reporting/spec.md,
skeptic-design-3.md, and `.github/workflows/ci.yml` lines 240-366 in the worktree.

### What I verified (with evidence)

**Round-3 CR1 is addressed.**
- design.md D2 now says "Frontend audit (frontend/)": `npm-ci-frontend` **only**.
- The node/npm list gates `npm-ci-frontend` on `steps.setup-node.outcome == 'success'`, not on the root install.
- spec.md adds "The root npm install fails but the frontend install succeeds".
- D4 lists that scenario as proved by expression review only.
- tasks.md 1.4 requires a check that neither `npm-ci-frontend` nor the frontend/ audit references `npm-ci-root`.

**The frontend path is really independent of the root install** (re-checked, not taken from round 3):
- `frontend/package.json` declares `audit-ci ^7.1.0` as a devDependency.
- `frontend/package.json` has no install, prepare or postinstall scripts, and there are no `file:`, `link:` or
  workspace references in either package.json.
- The root `prepare: husky` script is root-only.

**Full per-step gating table** (the real step order in ci.yml 251-366, with D2 applied):

| # | Step (id) | Planned `if` | Genuine prereqs | Can a non-prereq failure skip it? |
|---|---|---|---|---|
| 1 | checkout (`checkout`) | implicit | none | No. It is the first step. |
| 2 | setup-java (`setup-java`) | implicit success() | checkout | No. Only checkout precedes it. |
| 3 | setup-sbt (`setup-sbt`) | implicit success() | checkout | Yes, setup-java (see note 1). It is harmless: `sbom` needs both anyway. |
| 4 | Cache sbt | implicit success() | checkout | Yes, setup-java or setup-sbt. It is harmless: `sbom` is skipped in both cases, and the cache only serves `sbom`. |
| 5 | setup-node (`setup-node`) | `!cancelled() && checkout==success` | checkout | No. |
| 6 | npm ci (`npm-ci-root`) | `!cancelled() && setup-node==success` | setup-node | No. |
| 7 | npm --prefix frontend ci (`npm-ci-frontend`) | `!cancelled() && setup-node==success` | setup-node | No. This was the round-3 fix. |
| 8 | Generate backend SBOM (`sbom`) | `!cancelled() && setup-java==success && setup-sbt==success`, timeout 2 | java, sbt (and checkout, transitively) | No. A cache or npm failure does not reach it. |
| 9 | SBOM positive control (`sbom-control`) | `sbom==success` | the SBOM file | No. |
| 10 | Install osv-scanner (`osv-install`) | `sbom-control==success` | chain | No. A conservative chain link; its only consumer is #11. |
| 11 | Scan (`osv-scan`) | `osv-install==success` | binary + SBOM (transitive) | No. |
| 12 | CVSS gate | `osv-scan==success` | /tmp/osv-scan.json | No. |
| 13 | Frontend audit (root) | `npm-ci-root==success` | root audit-ci | No. |
| 14 | Frontend audit (frontend/) | `npm-ci-frontend==success` | frontend audit-ci | No. Failures in #6 and #8-#13 do not reach it. |
| 15 | helio-mcp audit | `npm-ci-root==success` | root-pinned audit-ci | No. Failures in #7, #8-#12 and #14 do not reach it. |

- **No audit is masked by a non-prerequisite failure.** The four audits are #8-#12, #13, #14 and #15. Each audit's
  `if` references only its own genuine install or toolchain, plus `!cancelled()`.
- **No step runs against a missing prerequisite.** A prerequisite with outcome `skipped` or `failure` fails the
  `== 'success'` test, and checkout is reached transitively by every path.
- **The job still fails on any failure.** No `continue-on-error` is planned anywhere (D3). A step-level timeout
  counts as a step failure. D4 checks this on real CI rather than assuming it.

**D1 is grounded in real data.** I read the security job of the last 25 completed ci.yml runs via
`gh api repos/matto00/helio/actions/runs/<id>/jobs`, covering 2026-10-05 23:36Z to 2026-10-06 06:53Z:
- "Generate backend SBOM" took 12-24 s.
- The whole job took 46-92 s.
- Setup before the SBOM step took about 30-46 s.

A 2-min step timeout is 5-10× the typical step time. Worst case is about 46 + 120 + about 15 + post-steps, roughly
3 min 10 s, which is under the unchanged 5-min job timeout. The ticket says the step takes "1-2 minutes on main", but
the measurements contradict that. design.md correctly uses the measured numbers.

**The hung-run log claims are accurate.** I read
`gh api --allow-escape-sequences repos/matto00/helio/actions/jobs/111938037178/logs`:
- The job is recorded as `cancelled` with 0 steps.
- 19:20:04.8Z: `Run sbt -batch generateSbom`.
- 19:20:04.9Z: "entering thin client - BEEP WHIRR".
- 19:20:20.8Z: "set current project to helio-backend".
- The next line is 20:03:56.8Z, "The runner has received a shutdown signal", then "The operation was canceled".
- The sbt cache restored from `sbt-7ddfc283…`. There is no lock line.

The "consistent with the outage, not proven" framing is honest.

**D4 is executable and falsifiable.**
- `generateSbom` (backend/build.sbt:35) is invoked only by ci.yml:279, so a `Thread.sleep` there affects only this
  step.
- `frontend/.audit-ci.jsonc` holds `"high": true`, with moderate advisories noted against HEL-1320, so the
  replace-with-moderate break is real. Task 2.1 checks it locally first.
- The expected outcomes name concrete step conclusions, so the run can disprove them.
- Revert-then-green is required.

### Verdict: CONFIRM

### Non-blocking notes

1. **Spec wording is stricter than the design.** spec.md says "No setup step SHALL be skipped merely because a setup
   step that is not its own prerequisite failed." The design keeps setup-sbt and Cache sbt on implicit `success()`,
   so a setup-java failure skips them even though neither strictly needs Java to install or restore.
   - There is no behavioural consequence: both serve only `sbom`, which is skipped in that case anyway.
   - But a literal final-gate reading could flag this as spec divergence.
   - Suggested fix: narrow the sentence to "No audit, and no setup step an audit depends on, SHALL be skipped merely
     because a step that is not among that audit's prerequisites failed." Alternatively, have ci-proof.md state
     explicitly that setup-sbt and Cache sbt skipping after a setup-java failure is accepted.
2. **Carry-over from earlier rounds.**
   - Wrap every `if:` in `${{ }}`, because a bare leading `!` is a YAML tag.
   - Reference only ids that are declared: an undeclared id evaluates to an empty outcome and silently skips the
     step. Run actionlint if it is available.
   - The build.sbt throwaway changes the sbt cache key, so do not misread a restore-key hit in the revert run.
   - Quote helio-mcp's audit-ci output lines in ci-proof.md.
3. **sbt 2 runs a background server.** `sbt -batch` enters thin-client mode, so the step timeout kills the client
   while the background sbt server may outlive it until job cleanup. On the red run, check that the following npm
   audits are not slowed or blocked by it. Record what you see in ci-proof.md, because this is the first real
   observation of that behaviour.
