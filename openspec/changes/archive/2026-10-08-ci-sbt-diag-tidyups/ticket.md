# HEL-1362: CI sbt hang diagnostics: tidy-ups left over from HEL-1339

## Description

Leftovers from HEL-1339 (PR matto00/helio#812, d71f646cb). None of these is urgent.

1. **Static guard:** it checks line by line, so it misses a `ps | grep` pipeline split across lines.
2. **Stale timing note:** a `ci.yml` comment (around lines 214–215) and `ci-evidence.md` still say backend pre-steps
   take "25–40 s". On shard 0 the new selftest makes them 55–66 s. The 900 s job bound still holds, with about 54 s
   to spare.
3. **Misleading message:** the `kill -QUIT` fallback reports "thread dump captured" even when it only sent SIGQUIT.
4. **Capture budget:** the 25 s capture budget can run about 1 s over for each extra candidate PID.
5. **Logs in the repo:** about 5.5 MB of CI logs are committed under
   `openspec/changes/archive/2026-10-07-ci-sbt-hang-diagnostics/ci-logs/`. Decide whether they stay in the repo.
6. **Unused code:** `ci-sbt.sh --mode client` and the `active.json` lookup are not used anywhere in CI. Remove them,
   or record why they are kept.

## Driver constraints (this run)

- Re-derive each item against today's ci.yml/scripts (HEL-1296, 1287/1288, 1361, 1299 changed ci.yml since).
- Do NOT change cache keys/paths or the cache save/restore split HEL-1299 established (its post-merge measurements are
  in progress); if a tidy-up would touch those, escalate instead.
- CI-only changes: prove each on the PR's own CI runs (link run ids); any hang-only diagnostics path needs a deliberate
  exercise (selftest / forced deadline) or a reasoned explanation the skeptic accepts.

## Premise validation (orchestrator, 2026-10-08)

All six items still apply on origin/main b0ff8570 (verdict minor-staleness: the item-2 comment moved to ci.yml
~line 240-241). Live main run 37869010952 backend (0): job start -> "Compile and test" start = 55 s.
