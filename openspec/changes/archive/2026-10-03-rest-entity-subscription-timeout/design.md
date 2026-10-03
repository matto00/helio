## Context

Root cause and evidence: see proposal.md Why. CD uses `google-github-actions/deploy-cloudrun@v3` with a `flags` string passed to `gcloud run deploy`; `docs/deployment.md` "CD trace" notes template settings carry forward, but the flag is made explicit so the setting is durable and guarded. `gcloud run deploy --help` lists `--[no-]cpu-throttling`.

## Goals / Non-Goals

**Goals:** make always-allocated CPU explicit and guarded in repo; document the rationale and billing trade-off.
**Non-Goals:** any gcloud/prod action (driver does it); the H2 pool-per-request fix (follow-up); raising `response-entity-subscription-timeout`; local red repro (not applicable to infra).

## Decisions

1. Append `--no-cpu-throttling` to the CD `flags` string next to `--max-instances=2`, and to `infra/deploy-backend.sh` next to `--cpu=1`.
2. Static guard: a small repo check script (node, following the `scripts/check-*.mjs` + `.selftest.mjs` convention) asserting the CD flags line contains `--no-cpu-throttling` and the deploy script does too, wired into the same place sibling check scripts run (pre-commit/CI per repo convention; reuse any existing deploy-flag check if one exists). Its selftest proves it fails when the flag is removed (mutation).
3. Docs: a section in `docs/deployment.md` citing HEL-1245, explaining scheduler/auto-run/rollups need CPU between requests, and the instance-time billing trade-off; update the CD trace sentence listing flags.
4. Evidence substitution: the AC "test red before fix" is replaced by the prod timing signature (14 failures all in the scheduled 13:00-13:31 UTC window; 4.3s gap between Pekko's log and the handler, ending the instant `/health` supplied CPU). Recorded in the PR body.

## Risks / Trade-offs

- [Higher Cloud Run cost: billed for instance time] -> owner accepted.
- [CD flag could be dropped later] -> static guard.
- [Fix unproven until the driver applies it in prod] -> ticket stays In Progress after merge; driver verifies and closes.

## Gate-Chain Implications Checklist

- **What does it execute?** `scripts/check-cloud-run-cpu.mjs` and its selftest run under `node` via `npm run check:cloud-run-cpu[:selftest]` from `.husky/pre-commit` (and CI). They only read two tracked files (`.github/workflows/cd-backend.yml`, `infra/deploy-backend.sh`) and string-match; no subprocess, no git calls, no network.
- **What environment does it inherit, and from where?** The hook's environment from git/husky, including `GIT_DIR`/`GIT_INDEX_FILE` when run from a linked worktree. The scripts never read those variables; the repo root is derived from the script's own `import.meta.url` (or an explicit argv path), not from cwd or git.
- **Does it write anything outside its own sandbox?** No. It reads two files and writes only to stdout/stderr; it creates, modifies and deletes nothing, and the selftest works on in-memory string mutations only.
- **Does it behave differently from a linked worktree than from a main checkout?** No. Paths resolve relative to the script file location, so a linked worktree reads its own checked-out copies of the two files identically to a main checkout; no git plumbing is involved.
- **What happens on its first run?** It passes on the current tree (flag present in both files) and exits 0 with `check-cloud-run-cpu OK`; the isolation test of both scripts under a hook-shaped environment passed (evidence persisted under `.concertino/runs/HEL-1245/evidence/.concertino/gate-chain-isolation-evidence/`).
