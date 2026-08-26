# Dependency & CVE Management

How Helio's dependencies are kept current and how a new security finding gets
triaged. Covers what actually ships (epic HEL-434: HEL-452 backend CVE
remediation, HEL-456 Dependabot config + auto-merge, HEL-459 CI security gate).
If this doc and the live config ever disagree, the config is the source of
truth — the files listed at the end of each section are what to re-check.

## Cadence

`.github/dependabot.yml` runs four separate update jobs, all on a **weekly**
schedule:

- `npm` at the repo root (grouped: `dev-dependencies`)
- `npm` under `/frontend` (grouped: `dev-dependencies`, and a `react` group
  covering `react`, `react-dom`, `@types/react*`)
- `github-actions` at the repo root (grouped: all actions into one `github-actions`
  group)
- `sbt` under `/backend` (grouped: all sbt deps into one `sbt` group)

Each job caps at `open-pull-requests-limit: 10` and labels PRs `dependencies`.

**sbt is version-updates-only.** Dependabot does not support
security-advisory-driven updates for the `sbt` ecosystem — the `sbt` job above
only opens PRs for new releases on its weekly schedule, the same as any other
ecosystem's routine bump. It does **not** open an out-of-band PR the moment a
new CVE is published against a backend dependency, the way GitHub's
security-advisory-triggered updates do for `npm`/`github-actions`. Backend CVE
coverage instead comes from the CI `security` job's own scan (below), which
runs on every push/PR regardless of Dependabot's schedule (subject to the
`paths-ignore` caveat in "CI CVE gate" below).

Source: `.github/dependabot.yml`.

## Auto-merge policy

Two workflows implement auto-merge, split across two different GitHub Actions
trigger types because of a hard constraint in `dependabot/fetch-metadata@v3`:
that action resolves the PR it inspects exclusively from
`context.payload.pull_request`, which does not exist on a `workflow_run`
payload.

1. **`dependabot-metadata.yml`** — triggers on `pull_request:
[opened, synchronize, reopened]`, gated to `github.actor ==
'dependabot[bot]'` (skips cleanly, not failed, for human PRs). Runs
   `dependabot/fetch-metadata@v3` and records its `update-type` output as one
   of the PR labels `dependabot-semver-patch` / `dependabot-semver-minor` /
   `dependabot-semver-major`. On a `synchronize` event (e.g. Dependabot
   force-pushing a rebase) it removes any stale semver label from a prior run
   first, so at most one is ever present.

2. **`dependabot-auto-merge.yml`** — triggers on `workflow_run: ["CI"],
types: [completed]`, gated to `conclusion == 'success' && event ==
'pull_request'`. It resolves the PR for the CI'd head SHA, **re-verifies
   authenticity and freshness itself** (it does not trust the metadata
   workflow's trigger as an authenticity signal — only the label value that
   workflow leaves behind), then reads back the `dependabot-semver-*` label:
   patch/minor merge via `gh pr merge --squash --delete-branch`; major gets
   labeled `major-update` for manual review instead.

**Why not native `gh pr merge --auto` / GitHub's auto-merge toggle:** this
repo has no branch protection / required status checks configured, so both of
those merge immediately on request rather than waiting for CI — a real safety
hazard. Reacting to the `CI` workflow's own `workflow_run` completion is what
makes the gating real here.

### Silent-abort conditions

`dependabot-auto-merge.yml`'s `resolve` step exits `0` (job reports as
succeeded, no PR action taken, nothing surfaced as an error) in any of these
cases — check these first if a green-CI Dependabot PR is sitting unmerged:

| Condition                              | What it means                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No open PR found for the CI'd head SHA | `gh pr list --search "sha:<HEAD_SHA>"` returned nothing                                                                                                                                          |
| Head SHA no longer matches             | Force-push race — the PR moved after CI started                                                                                                                                                  |
| PR author isn't `dependabot[bot]`      | Should not normally reach this workflow, but re-checked defensively                                                                                                                              |
| PR base ref isn't `main`               | Guards against a Dependabot PR opened against a non-default base                                                                                                                                 |
| No `dependabot-semver-*` label present | `dependabot-metadata.yml` for this PR hasn't completed yet, wasn't triggered, or ran and exited cleanly leaving the PR unlabeled because `fetch-metadata` returned an unrecognized `update-type` |

Source: `.github/workflows/dependabot-auto-merge.yml`,
`.github/workflows/dependabot-metadata.yml`.

## CI CVE gate

The `security` job in `.github/workflows/ci.yml` runs on every push/PR to
`main` (subject to the repo-wide `paths-ignore` for `**.md`, `LICENSE`,
`.github/ISSUE_TEMPLATE/**`, `docs/**` — a docs-only change like this one
legitimately triggers no CI run at all).

**Backend:** `sbt generateSbom` produces a CycloneDX SBOM of the resolved
compile-scope classpath. A positive-control check refuses to trust an
SBOM with zero components as "clean." `osv-scanner` (v2.5.1, keyless, queries
osv.dev live) scans it against `backend/osv-scanner.toml`. A `jq` filter then
enforces **CVSS >= 7**, using osv-scanner's own resolved `max_severity` score
where present, and falling back to `database_specific.severity` in
`{HIGH, CRITICAL}` when `max_severity` is absent. `[[IgnoredVulns]]`-suppressed
findings are already stripped from the JSON by osv-scanner itself before this
filter runs, so a suppression fully removes an entry from the gate, not just
from the visible failure count.

**Frontend:** `audit-ci` wraps `npm audit` for both the root and `frontend/`
lockfiles against `.audit-ci.jsonc` / `frontend/.audit-ci.jsonc`, both
currently configured `"high": true` with an empty `allowlist`.

Source: `.github/workflows/ci.yml` (`security` job), `backend/osv-scanner.toml`,
`.audit-ci.jsonc`, `frontend/.audit-ci.jsonc`.

## Suppression / allowlist process

**Backend** — `backend/osv-scanner.toml`, `[[IgnoredVulns]]` entries. Currently
5 entries, each carrying a `reason` string with the ticket, the technical
justification, and a `Review by 2026-11-26` date. **The review-by date is a
manual convention only — nothing in CI reads or enforces it.** A suppression
does not expire on its own; someone has to notice and re-check it.

**Frontend** — `.audit-ci.jsonc` / `frontend/.audit-ci.jsonc`, `allowlist`
array. Both are currently empty. The same convention applies: any future entry
should carry an inline comment with the ticket and a review-by date, but
`audit-ci` does not enforce expiry either.

Never add a suppression without a real, written justification — a false-clean
gate is worse than no gate.

## SLA

**Scope:** this SLA covers **Dependabot alerts and CI `security`-job
findings** — i.e. the population this doc's CI gate and weekly Dependabot runs
surface internally. It does **not** redefine or override
[`SECURITY.md`](../SECURITY.md)'s existing SLA for **externally reported
vulnerabilities** (48-hour acknowledgement, 7-day status update via
dev@helioapp.dev) — that governs a different population (outside reports) and
remains unchanged. If you're triaging an externally reported vulnerability,
follow `SECURITY.md`, not this section.

For a new high/critical Dependabot alert or a CI `security`-job failure: **3
business days** to either fix it or add a justified, dated suppression,
consistent with the weekly Dependabot cadence this repo runs on.

## Manual triage runbook

When a CI `security` job fails or a Dependabot alert needs attention outside
the normal PR flow:

1. **List open alerts:**
   ```bash
   gh api repos/:owner/:repo/dependabot/alerts --jq '.[] | select(.state == "open") | {number, severity: .security_advisory.severity, package: .dependency.package.name}'
   ```
2. **Determine direct vs. transitive.**
   - `npm`: check `package.json` — if the vulnerable package isn't a direct
     dependency, it's transitive. Fix via the top-level `overrides` field in
     `package.json` (root or `frontend/package.json`) pinning the transitive
     package to a patched version, then regenerate the lockfile.
   - `sbt`: check `build.sbt` — if not a direct `libraryDependencies` entry,
     it's pulled in by another library (often Spark). A version bump may not
     be possible without bumping the parent library (see the existing
     `backend/osv-scanner.toml` suppressions for examples where it isn't).
3. **Regenerate lockfiles after any `overrides`/version change:**
   ```bash
   npm install            # root
   npm --prefix frontend install
   ```
   Commit the updated `package-lock.json` alongside the `package.json` change.
4. **If genuinely unfixable**, add a suppression per the section above with a
   full written justification and review-by date — never a blanket or
   unexplained entry.
5. **Verify the gate is green before opening a PR.** Reproduce the same checks
   CI runs, locally:
   - Backend: `cd backend && sbt -batch generateSbom`, then
     `osv-scanner scan --sbom=target/sbom.cdx.json --config=osv-scanner.toml --format=json`.
     Note that CI additionally applies the CVSS >= 7 filter (see "CI CVE gate"
     above), so a raw osv-scanner finding below that threshold does not fail CI.
   - Frontend: `npx audit-ci --config .audit-ci.jsonc` at the repo root, and
     `cd frontend && npx audit-ci --config .audit-ci.jsonc`.
     A change to `backend/osv-scanner.toml`, `package.json`, or a lockfile is
     **not** covered by the `**.md` / `docs/**` `paths-ignore` above, so pushing
     it also triggers the real CI `security` job — that push is the final,
     authoritative confirmation the gate is green.

## `osv-scan.py` — archived evidence tool, not a CI gate

`openspec/changes/archive/2026-08-26-remediate-backend-dependency-cves/osv-scan.py`
was a one-off tool used to establish the HEL-452 baseline. It is **not wired
into any CI job, and its exit code is not consumed as a pass/fail signal by
anything.** **The script exits `0` no matter how many advisories it finds** —
`scan()`/`report()` only print results; nothing in `main()` sets a non-zero
status based on findings. That is the real reason it cannot serve as a gate.
Its two non-zero exits signal only that the _scan itself_ could not run, never
a finding: `raise SystemExit(2)` on a dependency-tree dump truncated by
terminal width, and an uncaught `FileNotFoundError` (exit 1) on an unreadable
input path. Do not reuse it in place of the `security` job's osv-scanner step
above, and do not assume a clean run of it proves anything CI-gate-equivalent
— per its own docstring it also has two unguarded false-clean gaps (Maven
"relocated" coordinates that never appear in `sbt dependencyTree` output at
all, and letter-prefixed Maven versions like `v1-rev20240621-2.0.0` that its
coordinate regex silently drops).

## See also

- [`SECURITY.md`](../SECURITY.md) — externally reported vulnerability policy
  and SLA (separate from the internal SLA above)
- HEL-452 — backend CVE remediation that produced the current
  `backend/osv-scanner.toml` suppressions
- HEL-456 — shipped `.github/dependabot.yml` and both auto-merge workflows
- HEL-459 — shipped the CI `security` job (osv-scanner backend, audit-ci
  frontend)
