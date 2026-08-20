## Context

Root `npm audit` reports the `brace-expansion` regex-DoS advisory pair
GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895. This is a transitive dependency
bump only — spun off from HEL-688's 35-alert Dependabot sweep (PR
matto00/helio#370), which established the pattern for this kind of fix:
targeted `npm update` / scoped `overrides`, never `npm audit fix --force` or a
blanket update.

## Goals / Non-Goals

**Goals:**
- Every installed `brace-expansion` instance in the root lockfile reaches a
  version that patches both GHSAs.
- Root `npm audit` no longer reports either advisory.
- `frontend/` and `helio-mcp/` lockfiles are covered too, if Dependabot has
  independently raised the same pair against them.
- Root `npm test` and lint stay green.

**Non-Goals:**
- No `npm audit fix --force` or blanket dependency updates.
- No unrelated dependency bumps.
- No application code changes — this is a lockfile-only change.

## Decisions

- **Targeted fix over blanket update**: Use `npm update brace-expansion` (or,
  if the vulnerable version is pinned deep in the dependency tree and a plain
  `update` can't reach it, a scoped `overrides` entry in the root
  `package.json` pinning `brace-expansion` to the first patched version) —
  same approach HEL-688 used, so the audit trail and fix pattern stay
  consistent across sibling security tickets. Alternative considered: `npm
  audit fix --force`, rejected because it can silently bump unrelated
  majors and was explicitly ruled out by HEL-688's own design.
- **`specs/dependency-security/spec.md` exists only to make the version floor
  testable, and is archived with `--skip-specs`**: this change touches only
  `package-lock.json` (and possibly the two other lockfiles) — no application
  capability's request/response shape, business logic, or user-facing
  behavior changes. Per the proposal's Capabilities section (both New and
  Modified are empty), the delta is never merged into canonical
  `openspec/specs/`; `openspec archive` runs with `--skip-specs`, matching the
  "infra/doc-only" carve-out in this repo's own orchestrator instructions and
  the identical pattern HEL-688 used for its own `dependency-security` delta.
- **Verify all three lockfiles**: Rather than assuming only the root lockfile
  is affected, explicitly check `frontend/package-lock.json` and
  `helio-mcp/package-lock.json` for the same vulnerable `brace-expansion`
  range via `npm ls brace-expansion` in each workspace, and cover them if the
  vulnerable range is present — this directly satisfies the ticket's stated
  scope item.
- **AC3 (Dependabot alert parity/closure) is operationalized as a tracked
  task with a concrete carrier, not prose intent**: per the ticket's own
  framing, this GHSA pair reached `npm audit` before Dependabot raised any
  alert for it — the exact contingency AC3 exists for. Task 1.3 checks `gh api
  "repos/matto00/helio/dependabot/alerts?state=open"` for this pair
  *before* delivery (as of this design round: zero open alerts — verified
  live). If that check still finds zero alerts at execution time, AC3 is
  vacuously satisfied and nothing further is needed. If an alert *has*
  appeared by then, tasks.md §6 (orchestrator-owned, mirroring HEL-688's
  tasks.md §7 pattern — PR body + Linear closing comment as the carrier,
  since the orchestrator's generic Phase 3/4 procedures never consult
  tasks.md on their own) re-checks the alerts API after merge and confirms
  the alert has closed before the ticket is marked Done.

## Risks / Trade-offs

- [Risk] A scoped `overrides` entry could mask a legitimately different
  `brace-expansion` requirement elsewhere in the tree, causing subtle
  breakage in a transitive consumer (e.g. glob/minimatch) → Mitigation: run
  root `npm test` and lint after the bump; only fall back to `overrides` if
  `npm update` alone cannot reach the patched version, and prefer the
  smallest override scope that resolves the audit finding.
- [Risk] The vulnerable range might also be present in `frontend/` or
  `helio-mcp/` lockfiles, which are out of the ticket's literal "root
  lockfile" wording but explicitly in its Scope section → Mitigation: check
  both explicitly per the Decisions section above; only touch them if the
  vulnerable range is actually present.
- [Risk] A Dependabot alert for this GHSA pair appears between planning and
  merge (plausible — that's exactly how this ticket came to exist in the
  first place, per its own Context section) and AC3 goes unverified because
  the orchestrator's generic Phase 3/4 flow has no reason to know about it →
  Mitigation: task 3.1 checks the alerts API live before delivery; if an
  alert has appeared, the orchestrator-owned post-merge task (Decisions,
  above) carries the check through the PR body and Linear closing comment so
  it isn't silently dropped at the tasks.md → delivery handoff.

## Planner Notes

- Self-approved: no `design.md`-worthy architectural decision here beyond
  "targeted bump, verify no regressions, check sibling lockfiles, verify
  Dependabot alert parity" — matches HEL-688's established, already-
  precedented pattern (including its tasks.md §7 orchestrator-owned-task
  mechanism for a post-merge AC). Not escalated.
- Self-approved: skipping spec deltas (beyond the testability-only
  `dependency-security` delta) — this is a pure dependency-lockfile change
  with zero capability/requirement surface change, matching this repo's own
  "infra/doc-only changes" `--skip-specs` carve-out.
