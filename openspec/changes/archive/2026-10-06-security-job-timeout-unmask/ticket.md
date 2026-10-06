# HEL-1296: CI security job: 'Generate backend SBOM' hung 40+ min — add step timeout and find cause

## Description

origin_kind: followup — origin_ticket: HEL-1274

On PR matto00/helio#775, run 37361823617 attempt 1, the CI `security` job hung for 40+ minutes in the
"Generate backend SBOM" step before the lane cancelled it. On main this step takes 1–2 minutes. The run happened
around the start of the 2026-10-05 GitHub Actions outage, so the outage may be the cause. That needs checking,
not assuming.

## Acceptance Criteria

- Give the step a `timeout-minutes` (and the job too, if it lacks one), so a hang fails fast instead of holding a
  runner.
- Look into the cause: dependency resolution with no network timeout, a lock, or the outage. Record what the hung
  run's log shows.
- Coordinate with HEL-1287, which is editing the backend job in `ci.yml`. Keep this change to the security job.

## Scope addition (owner, 2026-10-06, from HEL-1319 — Linear comment)

In the CI `security` job, a failing audit step causes the later audit steps to be skipped. On runs 37396677223 and
37400422292, "Frontend audit (frontend/)" failed, so "helio-mcp audit (helio-mcp/)" never ran. That kept the
critical proxy-addr advisory (GHSA-jqcg-44mw-7w3h) hidden until the frontend one was fixed.

**Acceptance addition:** every audit step reports on every run, for example with `if: always()` (or `!cancelled()`)
on the later audit steps, and the job still fails if any of them failed. Show this on a run where an earlier audit
step fails and a later step still executes and reports.

## Driver constraints (this run)

- Edit only the `security` job in `.github/workflows/ci.yml` (HEL-1288 draft PR #774 edits the e2e job, lines 392+).
- Do not touch `playwright.config.ts`, `e2e/**` (HEL-1300), or `.gitignore` (HEL-1292).
- At most one CI run at a time. A throwaway commit that deliberately breaks one audit is allowed if reverted before
  the final head.
- npm must use a project-local cache (`npm_config_cache` in the scratchpad); nothing written under `~` outside the
  repo/worktrees.
