# HEL-1427 real-CI evidence

Throwaway PR: https://github.com/matto00/helio/pull/873 (draft, "HEL-1427 [throwaway RED proof - do not merge]"), branch
`task/ci-build-prod-docker-image/HEL-1427-red-proof` (impl commit adb1fece + mutation 5aff692f + revert 0d2c7797).

## RED (mutation: `COPY backend/project/*.scala backend/project/` removed from Dockerfile)
- Run 37883321913 (head 5aff692f): https://github.com/matto00/helio/actions/runs/37883321913 -> conclusion failure
- `docker-image` job 113667697496: failure (56 s, 04:19:23Z-04:20:19Z). Log:
  `sbt.internal.EvalException: ... /build/backend/build.sbt ... L161: Not found: TestShards`, then
  `ERROR: failed to build: failed to solve: process "/bin/sh -c cd backend && sbt update" did not complete successfully: exit code: 1`
- `ci-complete` job 113669469121: failure. Log line: `results: success, success, success, success, failure`
  (order frontend, backend, security, e2e, docker-image). Every other job (frontend, security, backend 0-3, e2e 1-4) = success,
  so the failure is attributable to `docker-image` only.

## GREEN (mutation reverted; tree identical to adb1fece)
- Run 37883939609 (head 0d2c7797): https://github.com/matto00/helio/actions/runs/37883939609 -> success
- `docker-image` job 113669618345: success, 195 s (04:27:13Z-04:30:28Z).
- Last-finishing other job: `frontend` 113669618245 finished 04:35:43Z (510 s); e2e legs finished 04:33:30Z-04:35:08Z;
  backend legs 04:30:07Z-04:31:21Z. docker-image finished ~5 min before the last other job -> D3 acceptance condition MET.
- `ci-complete` job 113671691999: success. Log: `results: success, success, success, success, success`.
- `docker history` (runtime image): total 840MB; layers: jar COPY 316MB, `chown` RUN 316MB (duplicate of jar layer),
  JDK 164MB, apk 34.9MB, alpine 8.42MB. (Builder-stage layers are not part of the final image history.)
- Cache check: the job has no cache step or flag (plain `docker build`). `gh cache list --ref refs/pull/873/merge` returned `[]`,
  so no Actions cache entry was created for the run.

## Caching-bullet deviation (for the PR body)
Ticket asks for layer caching to avoid significant wall time. Not used (design D4): the job runs in parallel and finishes in
195 s versus 510 s for the slowest job (frontend), i.e. adds no wall time; a type=gha cache would persist the builder's
dependency layer (full Coursier tree) against the 10 GB HEL-1299 budget under measurement. Cold, cache-less build is 195 s.

## Timeout
`timeout-minutes: 8` (~2.5x 195 s), cited in ci.yml.
